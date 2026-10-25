import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { z } from "zod";
import { DesktopTool, ExecutionContext, ToolResult } from "./DesktopTool";

const trimVideoInputSchema = z.object({
  sourcePath: z.string().min(1, "sourcePath is required"),
  startSeconds: z.number().min(0, "startSeconds cannot be negative").default(0),
  durationSeconds: z.number().positive("durationSeconds must be greater than 0"),
  outputFilename: z.string().optional(),
  outputDirectory: z.string().optional(),
  overwrite: z.boolean().default(false),
});

export type TrimVideoInput = z.infer<typeof trimVideoInputSchema>;

export interface TrimVideoOutput {
  outputPath: string;
  filename: string;
  sizeBytes: number;
  startSeconds: number;
  durationSeconds: number;
  verifiedDurationSeconds?: number;
}

const SUPPORTED_VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mkv",
  ".mov",
  ".avi",
  ".webm",
  ".flv",
  ".wmv",
  ".m4v",
]);

export function getFFmpegExecutable(): string {
  // 1. Check ffmpeg-static package
  try {
    const ffmpegStatic = require("ffmpeg-static");
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      return ffmpegStatic;
    }
  } catch (e) {
    // ignore
  }

  // 2. Check process.env.FFMPEG_PATH
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }

  // 3. Fallback to system "ffmpeg" in PATH
  return "ffmpeg";
}

/**
 * Safely probes the duration of a video file using FFmpeg stderr output.
 */
export async function probeVideoDuration(ffmpegPath: string, filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(ffmpegPath, ["-i", filePath], { shell: false });
      let stderrOutput = "";

      proc.stderr.on("data", (chunk) => {
        stderrOutput += chunk.toString();
      });

      proc.on("close", () => {
        const match = stderrOutput.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (match) {
          const hours = parseFloat(match[1]);
          const minutes = parseFloat(match[2]);
          const seconds = parseFloat(match[3]);
          resolve(hours * 3600 + minutes * 60 + seconds);
        } else {
          resolve(null);
        }
      });

      proc.on("error", () => resolve(null));
    } catch (e) {
      resolve(null);
    }
  });
}

export class TrimVideoTool implements DesktopTool<TrimVideoInput, TrimVideoOutput> {
  public name = "trim_video";
  public description = "Extract/trim a safe section of a video using FFmpeg without shell execution";
  public inputSchema = trimVideoInputSchema;
  public requiresApproval = true;

  public async execute(input: TrimVideoInput, context: ExecutionContext): Promise<ToolResult<TrimVideoOutput>> {
    const startTime = Date.now();
    const parsed = trimVideoInputSchema.parse(input);

    // 1. Validate source path
    const srcVal = context.fileSystem.validatePath(parsed.sourcePath, "read");
    if (!srcVal.allowed) {
      return {
        success: false,
        error: srcVal.error || "Source video path is outside permitted directories",
        durationMs: Date.now() - startTime,
      };
    }

    if (!fs.existsSync(srcVal.normalizedPath)) {
      return {
        success: false,
        error: `Source video not found: '${srcVal.normalizedPath}'`,
        durationMs: Date.now() - startTime,
      };
    }

    const ext = path.extname(srcVal.normalizedPath).toLowerCase();
    if (!SUPPORTED_VIDEO_EXTENSIONS.has(ext)) {
      return {
        success: false,
        error: `Unsupported video format '${ext}'. Allowed formats: ${Array.from(SUPPORTED_VIDEO_EXTENSIONS).join(", ")}`,
        durationMs: Date.now() - startTime,
      };
    }

    // 2. Determine and validate output path
    let targetDir = path.dirname(srcVal.normalizedPath);
    if (parsed.outputDirectory) {
      const byName = context.fileSystem.findAllowedDirectoryByName(parsed.outputDirectory);
      if (byName) {
        targetDir = byName.path;
      } else {
        const dirVal = context.fileSystem.validatePath(parsed.outputDirectory, "write");
        if (!dirVal.allowed) {
          return {
            success: false,
            error: dirVal.error || "Output directory is not permitted for writing",
            durationMs: Date.now() - startTime,
          };
        }
        targetDir = dirVal.normalizedPath;
      }
    }

    let outFilename = parsed.outputFilename;
    if (!outFilename) {
      const baseNoExt = path.basename(srcVal.normalizedPath, ext);
      outFilename = `${baseNoExt}_trim_${parsed.startSeconds}s_${parsed.durationSeconds}s${ext}`;
    }

    // Sanitize filename to prevent subpath traversal in filename
    outFilename = path.basename(outFilename);
    const candidateOutputPath = path.join(targetDir, outFilename);

    let finalOutputPath = candidateOutputPath;
    if (!parsed.overwrite && fs.existsSync(candidateOutputPath)) {
      const base = path.basename(outFilename, ext);
      finalOutputPath = path.join(targetDir, `${base}_${Date.now()}${ext}`);
    }

    const outVal = context.fileSystem.validatePath(finalOutputPath, "write");
    if (!outVal.allowed) {
      return {
        success: false,
        error: outVal.error || "Output path violates security policy",
        durationMs: Date.now() - startTime,
      };
    }

    // 3. Locate FFmpeg binary
    const ffmpegPath = getFFmpegExecutable();

    // 4. Construct safe argument list (no shell injection!)
    context.onProgress?.("PROCESSING", `Processing video with FFmpeg...`, 30);

    // Try stream copy first for fast execution
    let success = await this.runFFmpegProcess(
      ffmpegPath,
      [
        "-y",
        "-ss",
        String(parsed.startSeconds),
        "-i",
        srcVal.normalizedPath,
        "-t",
        String(parsed.durationSeconds),
        "-c",
        "copy",
        outVal.normalizedPath,
      ],
      context
    );

    // If stream copy failed, retry with re-encode
    if (!success && !context.signal?.aborted) {
      context.onProgress?.("PROCESSING", `Re-encoding video stream...`, 50);
      success = await this.runFFmpegProcess(
        ffmpegPath,
        [
          "-y",
          "-ss",
          String(parsed.startSeconds),
          "-i",
          srcVal.normalizedPath,
          "-t",
          String(parsed.durationSeconds),
          "-c:v",
          "libx264",
          "-c:a",
          "aac",
          "-preset",
          "ultrafast",
          outVal.normalizedPath,
        ],
        context
      );
    }

    if (!success) {
      return {
        success: false,
        error: context.signal?.aborted ? "Video processing was cancelled" : "FFmpeg execution failed",
        durationMs: Date.now() - startTime,
      };
    }

    // 5. Verify output file exists on disk and is non-empty
    if (!fs.existsSync(outVal.normalizedPath)) {
      return {
        success: false,
        error: "Verification failed: Output file was not created on disk",
        durationMs: Date.now() - startTime,
      };
    }

    const outStats = fs.statSync(outVal.normalizedPath);
    if (outStats.size === 0) {
      return {
        success: false,
        error: "Verification failed: Output file was created but has 0 bytes",
        durationMs: Date.now() - startTime,
      };
    }

    // 6. Verify duration
    const verifiedDuration = await probeVideoDuration(ffmpegPath, outVal.normalizedPath);

    return {
      success: true,
      data: {
        outputPath: outVal.normalizedPath,
        filename: path.basename(outVal.normalizedPath),
        sizeBytes: outStats.size,
        startSeconds: parsed.startSeconds,
        durationSeconds: parsed.durationSeconds,
        verifiedDurationSeconds: verifiedDuration || undefined,
      },
      metadata: {
        source: srcVal.normalizedPath,
        sizeBytes: outStats.size,
        duration: verifiedDuration,
      },
      durationMs: Date.now() - startTime,
    };
  }

  private runFFmpegProcess(
    ffmpegPath: string,
    args: string[],
    context: ExecutionContext
  ): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        // Safe spawn: shell is explicitly false, args is an array
        const proc = spawn(ffmpegPath, args, {
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });

        if (context.signal) {
          const onAbort = () => {
            try {
              proc.kill("SIGKILL");
            } catch (e) {}
          };
          context.signal.addEventListener("abort", onAbort, { once: true });
        }

        let stderrBuffer = "";
        proc.stderr?.on("data", (chunk) => {
          stderrBuffer += chunk.toString();
        });

        proc.on("close", (code) => {
          if (code === 0) {
            resolve(true);
          } else {
            console.warn(`[FFmpeg] Exited with code ${code}. Stderr: ${stderrBuffer.slice(-300)}`);
            resolve(false);
          }
        });

        proc.on("error", (err) => {
          console.error("[FFmpeg] Process error:", err);
          resolve(false);
        });
      } catch (err) {
        console.error("[FFmpeg] Spawn error:", err);
        resolve(false);
      }
    });
  }
}
