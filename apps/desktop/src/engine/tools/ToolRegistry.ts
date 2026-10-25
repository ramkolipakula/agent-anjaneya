import { DesktopTool, ExecutionContext, ToolResult } from "./DesktopTool";
import { FindFileTool } from "./FindFileTool";
import { GetFileMetadataTool } from "./GetFileMetadataTool";
import { TrimVideoTool } from "./TrimVideoTool";
import { VerifyOutputTool } from "./VerifyOutputTool";
import { ListAllowedDirectoriesTool } from "./ListAllowedDirectoriesTool";
import { AuditLogger } from "../audit/AuditLogger";

export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, DesktopTool> = new Map();
  private auditLogger: AuditLogger;

  constructor(auditLogger?: AuditLogger) {
    this.auditLogger = auditLogger || AuditLogger.getInstance();
    this.registerDefaultTools();
  }

  public static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  private registerDefaultTools(): void {
    this.registerTool(new FindFileTool());
    this.registerTool(new GetFileMetadataTool());
    this.registerTool(new TrimVideoTool());
    this.registerTool(new VerifyOutputTool());
    this.registerTool(new ListAllowedDirectoriesTool());
  }

  public registerTool(tool: DesktopTool): void {
    if (!tool.name || typeof tool.name !== "string") {
      throw new Error("Tool must have a valid string name");
    }
    this.tools.set(tool.name, tool);
  }

  public hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  public getTool(name: string): DesktopTool | undefined {
    return this.tools.get(name);
  }

  public listTools(): { name: string; description: string; requiresApproval: boolean }[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      requiresApproval: t.requiresApproval,
    }));
  }

  /**
   * Executes a registered tool safely with input validation, timeout, audit logging, and error handling.
   * If a tool is not registered, returns UNSUPPORTED_OPERATION without executing arbitrary code.
   */
  public async executeTool(
    toolName: string,
    rawInput: any,
    context: ExecutionContext,
    timeoutMs = 60000
  ): Promise<ToolResult> {
    const startTime = Date.now();

    // 1. Verify tool exists in registry
    const tool = this.tools.get(toolName);
    if (!tool) {
      this.auditLogger.log({
        eventType: "SECURITY_VIOLATION",
        action: `Attempted execution of unapproved tool '${toolName}'`,
        status: "DENIED",
        taskId: context.taskId,
        toolName,
        error: "UNSUPPORTED_OPERATION",
      });

      return {
        success: false,
        error: "UNSUPPORTED_OPERATION",
        durationMs: Date.now() - startTime,
      };
    }

    // 2. Validate inputs against tool's Zod schema
    const parseResult = tool.inputSchema.safeParse(rawInput);
    if (!parseResult.success) {
      const issues = (parseResult.error as any).issues || (parseResult.error as any).errors || [];
      const errMessages = issues.length > 0
        ? issues.map((e: any) => `${e.path?.join(".") || "field"}: ${e.message}`).join("; ")
        : parseResult.error.message;
      this.auditLogger.log({
        eventType: "POLICY_CHECK",
        action: `Input validation failed for tool '${toolName}'`,
        status: "FAILURE",
        taskId: context.taskId,
        toolName,
        error: `INVALID_INPUT: ${errMessages}`,
      });

      return {
        success: false,
        error: `INVALID_INPUT: ${errMessages}`,
        durationMs: Date.now() - startTime,
      };
    }

    // 3. Setup timeout and abort controller
    const abortController = new AbortController();
    if (context.signal) {
      context.signal.addEventListener("abort", () => abortController.abort(), { once: true });
    }

    let timeoutTimer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<ToolResult>((_, reject) => {
      timeoutTimer = setTimeout(() => {
        abortController.abort();
        reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const executionContext: ExecutionContext = {
      ...context,
      signal: abortController.signal,
    };

    try {
      this.auditLogger.log({
        eventType: "TOOL_EXECUTION",
        action: `Starting execution of '${toolName}'`,
        status: "SUCCESS",
        taskId: context.taskId,
        toolName,
        details: { input: rawInput },
      });

      const result = await Promise.race([
        tool.execute(parseResult.data, executionContext),
        timeoutPromise,
      ]);

      if (timeoutTimer) clearTimeout(timeoutTimer);

      const durationMs = Date.now() - startTime;
      this.auditLogger.log({
        eventType: "TOOL_EXECUTION",
        action: `Completed execution of '${toolName}'`,
        status: result.success ? "SUCCESS" : "FAILURE",
        taskId: context.taskId,
        toolName,
        durationMs,
        error: result.error,
        details: { success: result.success },
      });

      return {
        ...result,
        durationMs,
      };
    } catch (err: any) {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      const durationMs = Date.now() - startTime;

      this.auditLogger.log({
        eventType: "TOOL_EXECUTION",
        action: `Tool execution error in '${toolName}'`,
        status: "FAILURE",
        taskId: context.taskId,
        toolName,
        durationMs,
        error: err.message,
      });

      return {
        success: false,
        error: err.message || "Unknown error during tool execution",
        durationMs,
      };
    }
  }
}
