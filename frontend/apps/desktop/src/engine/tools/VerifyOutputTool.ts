import fs from "fs";
import path from "path";
import { z } from "zod";
import { DesktopTool, ExecutionContext, ToolResult } from "./DesktopTool";
import { getFFmpegExecutable, probeVideoDuration } from "./TrimVideoTool";

const verifyOutputInputSchema = z.object({
  filePath: z.string().min(1, "filePath is required"),
  expectedMinSize: z.number().min(0).default(1),
  expectedDuration: z.number().optional(),
  durationTolerance: z.number().default(1.5),
});

export type VerifyOutputInput = z.infer<typeof verifyOutputInputSchema>;

export interface VerifyOutputResult {
  verified: boolean;
  filePath: string;
  sizeBytes: number;
  actualDurationSeconds?: number;
  message: string;
}

export class VerifyOutputTool implements DesktopTool<VerifyOutputInput, VerifyOutputResult> {
  public name = "verify_output";
  public description = "Verify that a generated output file exists, is non-empty, and has valid media parameters";
  public inputSchema = verifyOutputInputSchema;
  public requiresApproval = false;

  public async execute(input: VerifyOutputInput, context: ExecutionContext): Promise<ToolResult<VerifyOutputResult>> {
    const startTime = Date.now();
    const parsed = verifyOutputInputSchema.parse(input);

    const val = context.fileSystem.validatePath(parsed.filePath, "read");
    if (!val.allowed) {
      return {
        success: false,
        error: val.error || "File path is not within permitted directories",
        durationMs: Date.now() - startTime,
      };
    }

    if (!fs.existsSync(val.normalizedPath)) {
      return {
        success: false,
        error: `Verification failed: File '${val.normalizedPath}' does not exist on disk`,
        durationMs: Date.now() - startTime,
      };
    }

    let stats: fs.Stats;
    try {
      stats = fs.statSync(val.normalizedPath);
    } catch (e: any) {
      return {
        success: false,
        error: `Verification failed: Unable to read file stats: ${e.message}`,
        durationMs: Date.now() - startTime,
      };
    }

    if (stats.size < parsed.expectedMinSize) {
      return {
        success: false,
        error: `Verification failed: File size is ${stats.size} bytes, less than expected minimum of ${parsed.expectedMinSize} bytes`,
        durationMs: Date.now() - startTime,
      };
    }

    let actualDuration: number | undefined;
    const ext = path.extname(val.normalizedPath).toLowerCase();
    const isVideo = [".mp4", ".mkv", ".mov", ".avi", ".webm"].includes(ext);

    if (isVideo && parsed.expectedDuration !== undefined) {
      const ffmpeg = getFFmpegExecutable();
      const probed = await probeVideoDuration(ffmpeg, val.normalizedPath);

      if (probed !== null) {
        actualDuration = probed;
        const diff = Math.abs(probed - parsed.expectedDuration);
        if (diff > parsed.durationTolerance) {
          return {
            success: false,
            error: `Verification failed: Video duration was ${probed.toFixed(2)}s, expected ${parsed.expectedDuration}s (tolerance ±${parsed.durationTolerance}s)`,
            durationMs: Date.now() - startTime,
          };
        }
      }
    }

    return {
      success: true,
      data: {
        verified: true,
        filePath: val.normalizedPath,
        sizeBytes: stats.size,
        actualDurationSeconds: actualDuration,
        message: `Output verified successfully: ${path.basename(val.normalizedPath)} (${stats.size} bytes${
          actualDuration ? `, ${actualDuration.toFixed(1)}s` : ""
        })`,
      },
      durationMs: Date.now() - startTime,
    };
  }
}
