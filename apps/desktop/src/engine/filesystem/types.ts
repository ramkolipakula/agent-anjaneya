export interface AllowedDirectory {
  id: string;
  name: string;
  path: string;
  readOnly: boolean;
  isDefault?: boolean;
}

export interface PathValidationResult {
  allowed: boolean;
  normalizedPath: string;
  matchedDirectory?: AllowedDirectory;
  error?: string;
}

export interface FileMatch {
  name: string;
  fullPath: string;
  relativePath: string;
  directoryId: string;
  directoryName: string;
  sizeBytes: number;
  modifiedAt: string;
  extension: string;
}
