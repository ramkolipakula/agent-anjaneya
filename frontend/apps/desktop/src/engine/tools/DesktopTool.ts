import { z } from "zod";
import { SecureFileSystem } from "../filesystem/SecureFileSystem";

export interface ToolResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, any>;
  durationMs?: number;
}

export interface ExecutionContext {
  taskId: string;
  signal?: AbortSignal;
  onProgress?: (step: string, message: string, progress?: number, metadata?: any) => void;
  fileSystem: SecureFileSystem;
}

export interface DesktopTool<TInput = any, TOutput = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  requiresApproval: boolean;
  execute(input: TInput, context: ExecutionContext): Promise<ToolResult<TOutput>>;
}
