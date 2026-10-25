import fs from "fs";
import path from "path";
import { z } from "zod";
import { DesktopTool, ExecutionContext, ToolResult } from "./DesktopTool";
import { FileMatch } from "../filesystem/types";

const findFileInputSchema = z.object({
  filename: z.string().min(1, "Filename must not be empty"),
  directory: z.string().optional(),
  maxDepth: z.number().int().min(1).max(10).default(5),
  exactMatch: z.boolean().default(true),
});

export type FindFileInput = z.infer<typeof findFileInputSchema>;

export interface FindFileOutput {
  matches: FileMatch[];
  totalMatches: number;
  searchedDirectories: string[];
}

const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  ".expo",
  "appdata",
  "$recycle.bin",
  "system volume information",
  "recovery",
  "dist",
  "build",
]);

export class FindFileTool implements DesktopTool<FindFileInput, FindFileOutput> {
  public name = "find_file";
  public description = "Search for files within allowed directories with traversal prevention and depth limits";
  public inputSchema = findFileInputSchema;
  public requiresApproval = false;

  public async execute(input: FindFileInput, context: ExecutionContext): Promise<ToolResult<FindFileOutput>> {
    const startTime = Date.now();
    const parsed = findFileInputSchema.parse(input);
    const targetFilename = parsed.filename.trim();
    const targetLower = targetFilename.toLowerCase();

    // Determine target root directories to search
    const rootsToSearch: { id: string; name: string; path: string }[] = [];

    if (parsed.directory) {
      // Check if it's an alias (e.g. "Videos" or "Documents")
      const byName = context.fileSystem.findAllowedDirectoryByName(parsed.directory);
      if (byName) {
        rootsToSearch.push({ id: byName.id, name: byName.name, path: byName.path });
      } else {
        const val = context.fileSystem.validatePath(parsed.directory, "read");
        if (!val.allowed) {
          return {
            success: false,
            error: val.error || "Specified directory is not allowed",
            durationMs: Date.now() - startTime,
          };
        }
        rootsToSearch.push({
          id: val.matchedDirectory?.id || "custom",
          name: val.matchedDirectory?.name || path.basename(val.normalizedPath),
          path: val.normalizedPath,
        });
      }
    } else {
      for (const dir of context.fileSystem.listAllowedDirectories()) {
        rootsToSearch.push({ id: dir.id, name: dir.name, path: dir.path });
      }
    }

    const matches: FileMatch[] = [];
    const searchedPaths: string[] = [];

    for (const root of rootsToSearch) {
      if (context.signal?.aborted) {
        return {
          success: false,
          error: "Search cancelled by user",
          durationMs: Date.now() - startTime,
        };
      }

      if (!fs.existsSync(root.path)) {
        continue;
      }

      searchedPaths.push(root.path);
      this.searchDirectory(
        root.path,
        root.path,
        root.id,
        root.name,
        targetFilename,
        targetLower,
        parsed.exactMatch,
        0,
        parsed.maxDepth,
        matches,
        context
      );
    }

    return {
      success: true,
      data: {
        matches,
        totalMatches: matches.length,
        searchedDirectories: searchedPaths,
      },
      metadata: {
        matchesCount: matches.length,
        filename: targetFilename,
      },
      durationMs: Date.now() - startTime,
    };
  }

  private searchDirectory(
    currentDir: string,
    rootDir: string,
    directoryId: string,
    directoryName: string,
    targetFilename: string,
    targetLower: string,
    exactMatch: boolean,
    currentDepth: number,
    maxDepth: number,
    results: FileMatch[],
    context: ExecutionContext
  ): void {
    if (currentDepth > maxDepth || context.signal?.aborted) {
      return;
    }

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (e) {
      // Inaccessible directory, skip gracefully
      return;
    }

    for (const entry of entries) {
      if (context.signal?.aborted) return;

      const fullPath = path.join(currentDir, entry.name);
      const nameLower = entry.name.toLowerCase();

      if (entry.isDirectory()) {
        if (IGNORED_DIR_NAMES.has(nameLower) || entry.name.startsWith(".")) {
          continue;
        }

        // Validate directory path before recursing
        const check = context.fileSystem.validatePath(fullPath, "read");
        if (check.allowed) {
          this.searchDirectory(
            check.normalizedPath,
            rootDir,
            directoryId,
            directoryName,
            targetFilename,
            targetLower,
            exactMatch,
            currentDepth + 1,
            maxDepth,
            results,
            context
          );
        }
      } else if (entry.isFile()) {
        const isMatch = exactMatch
          ? nameLower === targetLower
          : nameLower.includes(targetLower);

        if (isMatch) {
          const val = context.fileSystem.validatePath(fullPath, "read");
          if (val.allowed) {
            try {
              const stats = fs.statSync(val.normalizedPath);
              results.push({
                name: entry.name,
                fullPath: val.normalizedPath,
                relativePath: path.relative(rootDir, val.normalizedPath),
                directoryId,
                directoryName,
                sizeBytes: stats.size,
                modifiedAt: stats.mtime.toISOString(),
                extension: path.extname(entry.name).toLowerCase(),
              });
            } catch (e) {
              // Ignore stat errors
            }
          }
        }
      }
    }
  }
}
