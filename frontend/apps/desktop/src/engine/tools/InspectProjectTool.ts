import fs from "fs";
import path from "path";
import { z } from "zod";
import { DesktopTool, ExecutionContext, ToolResult } from "./DesktopTool";

const inspectProjectSchema = z.object({
  projectPath: z.string().optional().default("Projects"),
  deep: z.boolean().optional(),
});

export class InspectProjectTool implements DesktopTool {
  public readonly name = "inspect_project";
  public readonly description = "Inspects an existing project in an allowed directory for dependencies, structure, and configs";
  public readonly inputSchema = inspectProjectSchema;
  public readonly requiresApproval = false;

  public async execute(input: z.infer<typeof inspectProjectSchema>, context: ExecutionContext): Promise<ToolResult> {
    if (context.signal?.aborted) {
      return { success: false, error: "Operation cancelled by user", metadata: { code: "CANCELLED" } };
    }

    const { projectPath } = input;
    const fileSystem = context.fileSystem;

    // Resolve path within allowed directories
    let targetDir = projectPath;
    const namedDir = fileSystem.findAllowedDirectoryByName(targetDir);
    if (namedDir) {
      targetDir = namedDir.path;
    } else if (!path.isAbsolute(targetDir)) {
      // Check if it exists inside any allowed directory
      let foundInAllowed = false;
      for (const dir of fileSystem.listAllowedDirectories()) {
        const candidate = path.join(dir.path, targetDir);
        if (fs.existsSync(candidate)) {
          targetDir = candidate;
          foundInAllowed = true;
          break;
        }
      }
      if (!foundInAllowed) {
        const defaultDir = fileSystem.getDefaultAllowedDirectory();
        if (!defaultDir) {
          return { success: false, error: "No allowed directory configured", metadata: { code: "DIR_NOT_CONFIGURED" } };
        }
        targetDir = path.join(defaultDir.path, targetDir);
      }
    }

    const val = fileSystem.validatePath(targetDir, "read");
    if (!val.allowed || !val.normalizedPath) {
      return { success: false, error: val.error || "Access denied to project path", metadata: { code: "ACCESS_DENIED" } };
    }

    const resolved = val.normalizedPath;
    if (!fs.existsSync(resolved)) {
      return { success: false, error: `Project directory '${resolved}' does not exist`, metadata: { code: "NOT_FOUND" } };
    }

    const stats = fs.statSync(resolved);
    if (!stats.isDirectory()) {
      return { success: false, error: `Path '${resolved}' is not a directory`, metadata: { code: "NOT_A_DIRECTORY" } };
    }

    // Inspect files safely (filtering out hidden/sensitive files)
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const files: string[] = [];
    const subdirectories: string[] = [];
    let packageJsonSummary: any = null;

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      if (entry.isDirectory()) {
        subdirectories.push(entry.name);
      } else {
        files.push(entry.name);
        if (entry.name === "package.json") {
          try {
            const rawPkg = fs.readFileSync(path.join(resolved, entry.name), "utf-8");
            const parsed = JSON.parse(rawPkg);
            packageJsonSummary = {
              name: parsed.name,
              version: parsed.version,
              dependencies: Object.keys(parsed.dependencies || {}),
              devDependencies: Object.keys(parsed.devDependencies || {}),
              scripts: Object.keys(parsed.scripts || {}),
            };
          } catch (e) {
            packageJsonSummary = { error: "Failed to parse package.json" };
          }
        }
      }
    }

    return {
      success: true,
      data: {
        projectPath: resolved,
        projectName: packageJsonSummary?.name || path.basename(resolved),
        packageJson: packageJsonSummary,
        files,
        subdirectories,
        totalFiles: files.length,
      },
    };
  }
}
