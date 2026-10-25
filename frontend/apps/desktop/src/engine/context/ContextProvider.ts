import { SecureFileSystem } from "../filesystem/SecureFileSystem";

export interface ContextQuery {
  taskId: string;
  query: string;
  requiredKeys?: string[];
  maxEntries?: number;
  signal?: AbortSignal;
}

export interface ContextResult {
  providerName: string;
  key: string;
  data: any;
  summary: string;
  latencyMs: number;
}

export interface ContextProvider {
  name: string;
  getContext(query: ContextQuery, fileSystem: SecureFileSystem): Promise<ContextResult[]>;
}
