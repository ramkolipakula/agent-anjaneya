import fs from "fs";
import path from "path";
import os from "os";
import { AllowedDirectory, PathValidationResult } from "./types";

// Forbidden system roots and directory prefixes (case-insensitive on Windows)
const FORBIDDEN_DIR_PREFIXES: string[] = [
  "c:\\windows",
  "c:\\program files",
  "c:\\program files (x86)",
  "c:\\programdata",
  "c:\\recovery",
  "c:\\system volume information",
  "c:\\boot",
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/var",
  "/sys",
  "/proc",
  "/root",
];

// If SystemRoot or windir is defined in environment, add it
if (process.env.SystemRoot) {
  FORBIDDEN_DIR_PREFIXES.push(process.env.SystemRoot.toLowerCase());
}
if (process.env.windir) {
  FORBIDDEN_DIR_PREFIXES.push(process.env.windir.toLowerCase());
}
if (process.env.ProgramFiles) {
  FORBIDDEN_DIR_PREFIXES.push(process.env.ProgramFiles.toLowerCase());
}
if (process.env["ProgramFiles(x86)"]) {
  FORBIDDEN_DIR_PREFIXES.push(process.env["ProgramFiles(x86)"].toLowerCase());
}

// Sensitive filenames and extensions that must NEVER be accessed
const FORBIDDEN_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i,
  /^\.git(\/|\\|$)/i,
  /^\.ssh(\/|\\|$)/i,
  /^\.aws(\/|\\|$)/i,
  /^\.azure(\/|\\|$)/i,
  /^\.kube(\/|\\|$)/i,
  /^(id_rsa|id_ed25519|id_dsa|id_ecdsa)(\..+)?$/i,
  /\.(pem|key|pfx|p12|kdbx|crt|cert|cer)$/i,
  /credentials\.json$/i,
  /service-account.*\.json$/i,
  /dev\.db(\-journal)?$/i,
];

export class SecureFileSystem {
  private allowedDirectories: Map<string, AllowedDirectory> = new Map();

  constructor(customDirectories?: AllowedDirectory[]) {
    if (customDirectories && customDirectories.length > 0) {
      for (const dir of customDirectories) {
        this.addAllowedDirectory(dir.name, dir.path, dir.readOnly, dir.isDefault);
      }
    } else {
      this.initDefaultDirectories();
    }
  }

  private initDefaultDirectories(): void {
    const home = os.homedir();

    const defaults = [
      { name: "Videos", path: path.join(home, "Videos"), readOnly: false, isDefault: true },
      { name: "Documents", path: path.join(home, "Documents"), readOnly: false, isDefault: true },
      { name: "Downloads", path: path.join(home, "Downloads"), readOnly: true, isDefault: true },
    ];

    for (const def of defaults) {
      try {
        if (!fs.existsSync(/*turbopackIgnore: true*/ def.path)) {
          fs.mkdirSync(/*turbopackIgnore: true*/ def.path, { recursive: true });
        }
      } catch (e) {
        // Ignored if permissions don't allow creating
      }
      this.addAllowedDirectory(def.name, def.path, def.readOnly, def.isDefault);
    }
  }

  public listAllowedDirectories(): AllowedDirectory[] {
    return Array.from(this.allowedDirectories.values());
  }

  public getDefaultAllowedDirectory(): AllowedDirectory | undefined {
    const list = this.listAllowedDirectories();
    return list.find((d) => d.isDefault) || list[0];
  }

  public getAllowedDirectoryById(id: string): AllowedDirectory | undefined {
    return this.allowedDirectories.get(id);
  }

  public findAllowedDirectoryByName(name: string): AllowedDirectory | undefined {
    const lower = name.toLowerCase().trim();
    for (const dir of this.allowedDirectories.values()) {
      if (dir.name.toLowerCase() === lower || path.basename(dir.path).toLowerCase() === lower) {
        return dir;
      }
    }
    return undefined;
  }

  public addAllowedDirectory(name: string, dirPath: string, readOnly = false, isDefault = false): AllowedDirectory {
    // Basic validation on the directory itself
    if (!dirPath || typeof dirPath !== "string") {
      throw new Error("Invalid directory path provided");
    }

    const resolved = path.resolve(dirPath);
    const normalized = path.normalize(resolved);
    const lower = normalized.toLowerCase();

    // Check against forbidden system directories
    for (const forbidden of FORBIDDEN_DIR_PREFIXES) {
      if (lower === forbidden || lower.startsWith(forbidden + path.sep)) {
        throw new Error(`Security violation: Cannot allow system directory '${normalized}'`);
      }
    }

    const id = "dir-" + Math.random().toString(36).substring(2, 9);
    const entry: AllowedDirectory = {
      id,
      name,
      path: normalized,
      readOnly,
      isDefault,
    };

    this.allowedDirectories.set(id, entry);
    return entry;
  }

  public removeAllowedDirectory(id: string): boolean {
    const dir = this.allowedDirectories.get(id);
    if (!dir) return false;
    return this.allowedDirectories.delete(id);
  }

  /**
   * Validates whether a file/directory path is within allowed directories and safe from path traversal / system escapes.
   */
  public validatePath(targetPath: string, mode: "read" | "write" = "read"): PathValidationResult {
    if (!targetPath || typeof targetPath !== "string") {
      return { allowed: false, normalizedPath: "", error: "Path must be a non-empty string" };
    }

    // 1. Detect null bytes (C-string poison attack)
    if (targetPath.indexOf("\0") !== -1) {
      return { allowed: false, normalizedPath: "", error: "Security violation: Null byte detected in path" };
    }

    // 2. Resolve & normalize path
    const resolvedPath = path.resolve(targetPath);
    const normalizedPath = path.normalize(resolvedPath);
    const lowerPath = normalizedPath.toLowerCase();

    // 3. Reject Windows system roots
    for (const forbidden of FORBIDDEN_DIR_PREFIXES) {
      if (lowerPath === forbidden || lowerPath.startsWith(forbidden + path.sep)) {
        return {
          allowed: false,
          normalizedPath,
          error: `Security violation: Access to system directory '${normalizedPath}' is denied`,
        };
      }
    }

    // 4. Reject sensitive files / application secrets
    const basename = path.basename(normalizedPath);
    for (const pattern of FORBIDDEN_FILE_PATTERNS) {
      if (pattern.test(basename) || pattern.test(normalizedPath)) {
        return {
          allowed: false,
          normalizedPath,
          error: `Security violation: Access to sensitive file '${basename}' is denied`,
        };
      }
    }

    // 5. Match against configured allowed directories
    let matchedDir: AllowedDirectory | undefined;
    for (const dir of this.allowedDirectories.values()) {
      const dirLower = dir.path.toLowerCase();
      if (lowerPath === dirLower || lowerPath.startsWith(dirLower + path.sep)) {
        matchedDir = dir;
        break;
      }
    }

    if (!matchedDir) {
      return {
        allowed: false,
        normalizedPath,
        error: `Security violation: Path '${normalizedPath}' is outside configured allowed directories`,
      };
    }

    // 6. Check write permission
    if (mode === "write" && matchedDir.readOnly) {
      return {
        allowed: false,
        normalizedPath,
        error: `Permission denied: Directory '${matchedDir.name}' is configured as read-only`,
      };
    }

    // 7. Prevent symlink escapes
    try {
      let matchedCanonical = matchedDir.path;
      try {
        if (fs.existsSync(matchedDir.path)) {
          matchedCanonical = fs.realpathSync(matchedDir.path);
        }
      } catch (e) {}
      const dirLower = matchedCanonical.toLowerCase();

      if (fs.existsSync(normalizedPath)) {
        const real = fs.realpathSync(normalizedPath);
        const realLower = real.toLowerCase();
        if (realLower !== dirLower && !realLower.startsWith(dirLower + path.sep)) {
          return {
            allowed: false,
            normalizedPath,
            error: "Security violation: Symlink escapes allowed directory boundary",
          };
        }
      } else {
        // If file doesn't exist yet (e.g. for write), verify parent directory realpath
        let parentDir = path.dirname(normalizedPath);
        while (parentDir && parentDir !== path.dirname(parentDir)) {
          if (fs.existsSync(parentDir)) {
            const realParent = fs.realpathSync(parentDir);
            const realParentLower = realParent.toLowerCase();
            if (realParentLower !== dirLower && !realParentLower.startsWith(dirLower + path.sep)) {
              return {
                allowed: false,
                normalizedPath,
                error: "Security violation: Parent symlink escapes allowed directory boundary",
              };
            }
            break;
          }
          parentDir = path.dirname(parentDir);
        }
      }
    } catch (e: any) {
      return {
        allowed: false,
        normalizedPath,
        error: `Path resolution error: ${e.message}`,
      };
    }

    return {
      allowed: true,
      normalizedPath,
      matchedDirectory: matchedDir,
    };
  }
}
