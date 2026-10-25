import fs from "fs";
import path from "path";
import { ContextProvider, ContextQuery, ContextResult } from "./ContextProvider";
import { SecureFileSystem } from "../filesystem/SecureFileSystem";

export class FilesystemContextProvider implements ContextProvider {
  public readonly name = "FilesystemContextProvider";

  public async getContext(query: ContextQuery, fileSystem: SecureFileSystem): Promise<ContextResult[]> {
    const start = Date.now();
    const results: ContextResult[] = [];

    const allowedDirs = fileSystem.listAllowedDirectories();
    const allowedDirSummaries = allowedDirs.map((d) => ({
      name: d.name,
      readOnly: d.readOnly,
      isDefault: d.isDefault,
    }));

    results.push({
      providerName: this.name,
      key: "allowedDirectories",
      data: allowedDirSummaries,
      summary: `Allowed folders: ${allowedDirs.map((d) => d.name).join(", ")}`,
      latencyMs: Date.now() - start,
    });

    // Check if query is looking for projects, videos, or documents
    const lower = query.query.toLowerCase();
    const isProjectQuery = lower.includes("project") || lower.includes("website") || lower.includes("portfolio") || lower.includes("code");
    const isVideoQuery = lower.includes("video") || lower.includes("mp4") || lower.includes("trim");

    for (const dir of allowedDirs) {
      if (!fs.existsSync(dir.path)) continue;

      try {
        const entries = fs.readdirSync(dir.path, { withFileTypes: true });
        const visibleFiles = entries
          .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
          .map((e) => ({
            name: e.name,
            isDirectory: e.isDirectory(),
          }))
          .slice(0, 15); // Strict cap on directory entries to prevent token explosion

        if (isProjectQuery || isVideoQuery || entries.length > 0) {
          results.push({
            providerName: this.name,
            key: `folder:${dir.name}`,
            data: { folder: dir.name, readOnly: dir.readOnly, items: visibleFiles },
            summary: `Folder '${dir.name}' contains ${visibleFiles.length} visible items`,
            latencyMs: Date.now() - start,
          });
        }
      } catch (e) {
        // Safe skip on read error
      }
    }

    return results;
  }
}
