import fs from "fs";
import path from "path";
import { ContextProvider, ContextQuery, ContextResult } from "./ContextProvider";
import { SecureFileSystem } from "../filesystem/SecureFileSystem";

export class ProjectContextProvider implements ContextProvider {
  public readonly name = "ProjectContextProvider";

  public async getContext(query: ContextQuery, fileSystem: SecureFileSystem): Promise<ContextResult[]> {
    const start = Date.now();
    const results: ContextResult[] = [];
    const lower = query.query.toLowerCase();

    // Only activate if the instruction involves development, projects, or websites
    if (!lower.includes("project") && !lower.includes("portfolio") && !lower.includes("website") && !lower.includes("build") && !lower.includes("code")) {
      return results;
    }

    const allowedDirs = fileSystem.listAllowedDirectories();
    const foundProjects: Array<{ name: string; folder: string; framework?: string; dependencies?: string[] }> = [];

    for (const dir of allowedDirs) {
      if (!fs.existsSync(dir.path)) continue;

      try {
        // Check if root of directory has package.json
        const rootPkg = path.join(dir.path, "package.json");
        if (fs.existsSync(rootPkg)) {
          const content = JSON.parse(fs.readFileSync(rootPkg, "utf-8"));
          const allDeps = { ...(content.dependencies || {}), ...(content.devDependencies || {}) };
          let framework = "Node.js";
          if (allDeps["next"]) framework = "Next.js";
          else if (allDeps["react"]) framework = "React";
          else if (allDeps["vue"]) framework = "Vue";

          foundProjects.push({
            name: content.name || dir.name,
            folder: dir.name,
            framework,
            dependencies: Object.keys(allDeps).slice(0, 8),
          });
        }

        // Check immediate subdirectories for projects
        const subentries = fs.readdirSync(dir.path, { withFileTypes: true });
        for (const sub of subentries) {
          if (sub.isDirectory() && !sub.name.startsWith(".") && sub.name !== "node_modules") {
            const subPkg = path.join(dir.path, sub.name, "package.json");
            if (fs.existsSync(subPkg)) {
              try {
                const content = JSON.parse(fs.readFileSync(subPkg, "utf-8"));
                const allDeps = { ...(content.dependencies || {}), ...(content.devDependencies || {}) };
                let framework = "Node.js";
                if (allDeps["next"]) framework = "Next.js";
                else if (allDeps["react"]) framework = "React";

                foundProjects.push({
                  name: content.name || sub.name,
                  folder: `${dir.name}/${sub.name}`,
                  framework,
                  dependencies: Object.keys(allDeps).slice(0, 8),
                });
              } catch (e) {}
            }
          }
        }
      } catch (e) {}
    }

    results.push({
      providerName: this.name,
      key: "existingProjects",
      data: foundProjects,
      summary:
        foundProjects.length > 0
          ? `Found ${foundProjects.length} existing project(s): ${foundProjects.map((p) => `${p.name} (${p.framework || "unknown"})`).join(", ")}`
          : "No existing projects found in allowed directories",
      latencyMs: Date.now() - start,
    });

    return results;
  }
}
