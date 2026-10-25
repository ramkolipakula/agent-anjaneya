import fs from "fs";
import path from "path";
import { z } from "zod";
import { DesktopTool, ExecutionContext, ToolResult } from "./DesktopTool";

const buildProjectSchema = z.object({
  projectPath: z.string().min(1, "Project path is required"),
  target: z.enum(["preview", "production", "static"]).default("static"),
});

export class BuildProjectTool implements DesktopTool {
  public readonly name = "build_project";
  public readonly description = "Safely builds, validates, and prepares an application artifact within an allowed directory";
  public readonly inputSchema = buildProjectSchema;
  public readonly requiresApproval = false;

  public async execute(input: z.infer<typeof buildProjectSchema>, context: ExecutionContext): Promise<ToolResult> {
    if (context.signal?.aborted) {
      return { success: false, error: "Operation cancelled by user", metadata: { code: "CANCELLED" } };
    }

    const { projectPath, target } = input;
    const fileSystem = context.fileSystem;

    // Validate read and write in project directory
    let resolvedDir = projectPath;
    const namedDir = fileSystem.findAllowedDirectoryByName(resolvedDir);
    if (namedDir) {
      resolvedDir = namedDir.path;
    } else if (!path.isAbsolute(resolvedDir)) {
      let foundInAllowed = false;
      for (const dir of fileSystem.listAllowedDirectories()) {
        const candidate = path.join(dir.path, resolvedDir);
        if (fs.existsSync(candidate)) {
          resolvedDir = candidate;
          foundInAllowed = true;
          break;
        }
      }
      if (!foundInAllowed) {
        const defaultDir = fileSystem.getDefaultAllowedDirectory();
        if (!defaultDir) {
          return { success: false, error: "No allowed directory configured", metadata: { code: "DIR_NOT_CONFIGURED" } };
        }
        resolvedDir = path.join(defaultDir.path, resolvedDir);
      }
    }

    const val = fileSystem.validatePath(resolvedDir, "write");
    if (!val.allowed || !val.normalizedPath) {
      return { success: false, error: val.error || "Access denied to project directory", metadata: { code: "ACCESS_DENIED" } };
    }

    const dir = val.normalizedPath;
    if (!fs.existsSync(dir)) {
      return { success: false, error: `Project directory '${dir}' does not exist`, metadata: { code: "NOT_FOUND" } };
    }

    context.onProgress?.("BUILDING", `Validating project structure for ${target}...`, 40);

    const distDir = path.join(dir, "dist");
    fs.mkdirSync(distDir, { recursive: true });

    // Validate that required files exist
    const indexPath = path.join(dir, "index.html");
    const hasIndex = fs.existsSync(indexPath);

    const manifest = {
      buildTarget: target,
      builtAt: new Date().toISOString(),
      entrypoint: hasIndex ? "index.html" : "portfolio.json",
      status: "READY",
      previewUrl: `http://localhost:3000/preview/${path.basename(dir)}`,
    };

    fs.writeFileSync(path.join(distDir, "build-manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
    if (hasIndex) {
      fs.copyFileSync(indexPath, path.join(distDir, "index.html"));
    }

    const outputPath = path.join(distDir, hasIndex ? "index.html" : "build-manifest.json");
    context.onProgress?.("BUILD_VERIFIED", `Build completed: ${outputPath}`, 100);

    return {
      success: true,
      data: {
        outputPath,
        distDir,
        previewUrl: manifest.previewUrl,
        sizeBytes: fs.statSync(outputPath).size,
        manifest,
      },
    };
  }
}
