import fs from "fs";
import path from "path";
import { z } from "zod";
import { DesktopTool, ExecutionContext, ToolResult } from "./DesktopTool";

const getFileMetadataInputSchema = z.object({
  filePath: z.string().min(1, "filePath must not be empty"),
});

export type GetFileMetadataInput = z.infer<typeof getFileMetadataInputSchema>;

export interface FileMetadataOutput {
  name: string;
  fullPath: string;
  sizeBytes: number;
  isFile: boolean;
  isDirectory: boolean;
  createdAt: string;
  modifiedAt: string;
  extension: string;
  mimeTypeEstimate: string;
  isMedia: boolean;
}

export class GetFileMetadataTool implements DesktopTool<GetFileMetadataInput, FileMetadataOutput> {
  public name = "get_file_metadata";
  public description = "Retrieve filesystem metadata and safety info for a specific file";
  public inputSchema = getFileMetadataInputSchema;
  public requiresApproval = false;

  public async execute(input: GetFileMetadataInput, context: ExecutionContext): Promise<ToolResult<FileMetadataOutput>> {
    const startTime = Date.now();
    const parsed = getFileMetadataInputSchema.parse(input);

    const val = context.fileSystem.validatePath(parsed.filePath, "read");
    if (!val.allowed) {
      return {
        success: false,
        error: val.error || "File path is not within allowed directories",
        durationMs: Date.now() - startTime,
      };
    }

    if (!fs.existsSync(val.normalizedPath)) {
      return {
        success: false,
        error: `File not found at '${val.normalizedPath}'`,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const stats = fs.statSync(val.normalizedPath);
      const ext = path.extname(val.normalizedPath).toLowerCase();
      const mediaExts = new Set([".mp4", ".mkv", ".mov", ".avi", ".webm", ".mp3", ".wav", ".m4a"]);
      const isMedia = mediaExts.has(ext);

      let mimeType = "application/octet-stream";
      if (ext === ".mp4") mimeType = "video/mp4";
      else if (ext === ".mkv") mimeType = "video/x-matroska";
      else if (ext === ".mov") mimeType = "video/quicktime";
      else if (ext === ".webm") mimeType = "video/webm";
      else if (ext === ".pdf") mimeType = "application/pdf";
      else if (ext === ".txt") mimeType = "text/plain";
      else if (ext === ".json") mimeType = "application/json";

      return {
        success: true,
        data: {
          name: path.basename(val.normalizedPath),
          fullPath: val.normalizedPath,
          sizeBytes: stats.size,
          isFile: stats.isFile(),
          isDirectory: stats.isDirectory(),
          createdAt: stats.birthtime.toISOString(),
          modifiedAt: stats.mtime.toISOString(),
          extension: ext,
          mimeTypeEstimate: mimeType,
          isMedia,
        },
        durationMs: Date.now() - startTime,
      };
    } catch (e: any) {
      return {
        success: false,
        error: `Failed to read file stats: ${e.message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }
}
