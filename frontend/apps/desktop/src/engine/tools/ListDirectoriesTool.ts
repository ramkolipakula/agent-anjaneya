import fs from "fs";
import { z } from "zod";
import { DesktopTool, ExecutionContext, ToolResult } from "./DesktopTool";
import { AllowedDirectory } from "../filesystem/types";

const listDirectoriesInputSchema = z.object({
  directoryPath: z.string().optional(),
});

export type ListDirectoriesInput = z.infer<typeof listDirectoriesInputSchema>;

export interface ListDirectoriesOutput {
  targetPath?: string;
  directories: string[] | AllowedDirectory[];
  allowedDirectories?: AllowedDirectory[];
  count: number;
}

export class ListDirectoriesTool implements DesktopTool<ListDirectoriesInput, ListDirectoriesOutput> {
  public name = "list_directories";
  public description = "List subdirectories in an authorized filesystem location or list configured allowed folders";
  public inputSchema = listDirectoriesInputSchema;
  public requiresApproval = false;

  public async execute(input: ListDirectoriesInput, context: ExecutionContext): Promise<ToolResult<ListDirectoriesOutput>> {
    const startTime = Date.now();

    // 1. If no specific directory is requested, return configured allowed directories
    if (!input.directoryPath || !input.directoryPath.trim()) {
      const allowed = context.fileSystem.listAllowedDirectories();
      return {
        success: true,
        data: {
          directories: allowed.map((d) => d.name),
          allowedDirectories: allowed,
          count: allowed.length,
        },
        durationMs: Date.now() - startTime,
      };
    }

    let targetPath = input.directoryPath.trim();

    // Handle drive letter variations like "D drive" or "D:" -> "D:\"
    const driveMatch = targetPath.match(/^([a-zA-Z])(?:\s*drive|:)?$/i);
    if (driveMatch) {
      targetPath = `${driveMatch[1].toUpperCase()}:\\`;
    }

    // Check if target is a named allowed folder (e.g. "Videos", "Documents")
    const namedDir = context.fileSystem.findAllowedDirectoryByName(targetPath);
    if (namedDir) {
      targetPath = namedDir.path;
    }

    // 2. Strict Security: Authoritative Filesystem Allowlist check
    const validation = context.fileSystem.validatePath(targetPath, "read");
    if (!validation.allowed) {
      return {
        success: false,
        error: `ACCESS_DENIED: Location '${targetPath}' is outside the permitted folders. Please authorize '${targetPath}' or a specific subfolder in settings to allow access.`,
        durationMs: Date.now() - startTime,
        metadata: {
          code: "UNAUTHORIZED_DIRECTORY",
          requestedPath: targetPath,
        },
      };
    }

    const resolvedDir = validation.normalizedPath;

    // 3. Verify directory existence
    try {
      if (!fs.existsSync(resolvedDir)) {
        return {
          success: false,
          error: `Directory '${resolvedDir}' does not exist on disk.`,
          durationMs: Date.now() - startTime,
        };
      }

      const stat = fs.statSync(resolvedDir);
      if (!stat.isDirectory()) {
        return {
          success: false,
          error: `Path '${resolvedDir}' is a file, not a directory.`,
          durationMs: Date.now() - startTime,
        };
      }

      // 4. Read immediate directories with graceful error handling for permission issues
      const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
      const dirNames: string[] = [];

      for (const entry of entries) {
        try {
          if (entry.isDirectory()) {
            dirNames.push(entry.name);
          }
        } catch {
          // Gracefully ignore individual entry read errors (e.g. permission denied)
        }
      }

      return {
        success: true,
        data: {
          targetPath: resolvedDir,
          directories: dirNames,
          count: dirNames.length,
        },
        durationMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Failed to inspect directory '${resolvedDir}': ${message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }
}
