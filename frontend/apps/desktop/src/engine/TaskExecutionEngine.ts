import {
  TaskStatus,
  TaskPlan,
  isValidTaskTransition,
  isTerminalTaskStatus,
  canCancelTask,
  TaskApprovalRequestPayload,
  TaskProgressPayload,
  TaskCompletedPayload,
  TaskFailedPayload,
} from "@agent-anjaneya/protocol";
import fs from "fs";
import os from "os";
import path from "path";
import { SecureFileSystem } from "./filesystem/SecureFileSystem";
import { ToolRegistry } from "./tools/ToolRegistry";
import { TaskPlanner } from "./planner/TaskPlanner";
import { AuditLogger } from "./audit/AuditLogger";
import { ExecutionContext } from "./tools/DesktopTool";

export interface EngineTask {
  id: string;
  inputText: string;
  status: TaskStatus;
  plan?: TaskPlan;
  createdAt: string;
  updatedAt: string;
  mobileDeviceId: string;
  desktopDeviceId: string;
  error?: string;
  result?: any;
  abortController?: AbortController;
  timestamps: {
    mobileSentAt?: string;
    backendReceivedAt?: string;
    desktopReceivedAt?: string;
    planningStartedAt?: string;
    planningFinishedAt?: string;
    approvalRequestedAt?: string;
    approvalReceivedAt?: string;
    executionStartedAt?: string;
    executionCompletedAt?: string;
    verificationCompletedAt?: string;
  };
}

export type EventCallback = (type: string, payload: any) => void;

export class TaskExecutionEngine {
  private static instance: TaskExecutionEngine;
  private tasks: Map<string, EngineTask> = new Map();
  private fileSystem: SecureFileSystem;
  private toolRegistry: ToolRegistry;
  private planner: TaskPlanner;
  private auditLogger: AuditLogger;
  private eventCallback: EventCallback | null = null;
  private taskListeners: Map<string, Set<EventCallback>> = new Map();
  private globalListeners: Set<EventCallback> = new Set();
  private storagePath: string;

  constructor(fileSystem?: SecureFileSystem, toolRegistry?: ToolRegistry, planner?: TaskPlanner) {
    this.auditLogger = AuditLogger.getInstance();
    this.fileSystem = fileSystem || new SecureFileSystem();
    this.toolRegistry = toolRegistry || new ToolRegistry(this.auditLogger);
    this.planner = planner || new TaskPlanner();

    const baseDir = path.join(os.homedir(), ".agent-anjaneya");
    try {
      if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
      }
    } catch {}
    this.storagePath = path.join(baseDir, "desktop-tasks.json");
    this.loadPersistedTasks();

    // Wire multi-agent activity events to engine callback
    this.planner.getOrchestrator().setActivityCallback((activity) => {
      this.emitEvent("AGENT_ACTIVITY", activity);
      this.emitEvent("TASK_PROGRESS", {
        taskId: activity.taskId,
        status: "PLANNING",
        step: activity.stage,
        message: activity.summary,
        metadata: {
          agentRole: activity.agentRole,
          evidence: activity.evidence,
          debateRound: activity.debateRound,
          metrics: activity.metrics,
        },
        timestamp: activity.timestamp,
      } as TaskProgressPayload);
    });
  }

  public static getInstance(): TaskExecutionEngine {
    if (!TaskExecutionEngine.instance) {
      TaskExecutionEngine.instance = new TaskExecutionEngine();
    }
    return TaskExecutionEngine.instance;
  }

  /**
   * Subscribes a listener to events specifically scoped to a single taskId.
   * Multiple concurrent tasks never overwrite each other, and each task receives only its events.
   * Returns an unsubscribe cleanup callback.
   */
  public subscribeToTask(taskId: string, cb: EventCallback): () => void {
    let listeners = this.taskListeners.get(taskId);
    if (!listeners) {
      listeners = new Set();
      this.taskListeners.set(taskId, listeners);
    }
    listeners.add(cb);

    return () => {
      const set = this.taskListeners.get(taskId);
      if (set) {
        set.delete(cb);
        if (set.size === 0) {
          this.taskListeners.delete(taskId);
        }
      }
    };
  }

  /**
   * Subscribes a global event listener (e.g. for socket multiplexer or audit stream).
   */
  public subscribeGlobal(cb: EventCallback): () => void {
    this.globalListeners.add(cb);
    return () => {
      this.globalListeners.delete(cb);
    };
  }

  public setEventCallback(cb: EventCallback | null): void {
    this.eventCallback = cb;
  }

  public getFileSystem(): SecureFileSystem {
    return this.fileSystem;
  }

  public getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  public getPlanner(): TaskPlanner {
    return this.planner;
  }

  public getTask(id: string): EngineTask | undefined {
    return this.tasks.get(id);
  }

  public getAllTasks(): EngineTask[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * Safely transitions task state adhering to protocol state machine.
   * Strictly enforces that terminal states cannot transition back to active states.
   */
  private transitionTaskStatus(task: EngineTask, newStatus: TaskStatus): boolean {
    if (task.status === newStatus) return true;

    if (isTerminalTaskStatus(task.status)) {
      console.warn(`[Engine] Illegal transition rejected: Task ${task.id} is in terminal state '${task.status}' and cannot transition to '${newStatus}'`);
      return false;
    }

    if (!isValidTaskTransition(task.status, newStatus)) {
      console.warn(`[Engine] Invalid task state transition attempted: ${task.status} -> ${newStatus}`);
      return false;
    }

    task.status = newStatus;
    task.updatedAt = new Date().toISOString();
    this.persistTasks();
    return true;
  }

  private emitEvent(type: string, payload: any): void {
    // 1. Call legacy/default eventCallback if registered
    if (this.eventCallback) {
      try {
        this.eventCallback(type, payload);
      } catch (e) {
        console.error("[Engine] Error in global eventCallback:", e);
      }
    }

    // 2. Call all registered global listeners
    for (const listener of this.globalListeners) {
      try {
        listener(type, payload);
      } catch (e) {
        console.error("[Engine] Error in global listener:", e);
      }
    }

    // 3. Call task-scoped listeners registered specifically for this task
    const taskId = payload?.taskId;
    if (taskId) {
      const listeners = this.taskListeners.get(taskId);
      if (listeners) {
        for (const listener of listeners) {
          try {
            listener(type, payload);
          } catch (e) {
            console.error(`[Engine] Error in task-scoped listener for ${taskId}:`, e);
          }
        }
      }
    }
  }

  /**
   * Submits a new task instruction from mobile or UI.
   * Idempotent: repeated delivery of the same taskId will return the existing task
   * without re-executing it.
   */
  public async submitTask(params: {
    taskId: string;
    inputText: string;
    mobileDeviceId: string;
    desktopDeviceId: string;
    mobileSentAt?: string;
    backendReceivedAt?: string;
  }): Promise<EngineTask> {
    const existing = this.tasks.get(params.taskId);
    if (existing) {
      console.warn(`[Engine] Task ${params.taskId} already submitted (status: ${existing.status}). Skipping duplicate submission.`);
      return existing;
    }

    const desktopReceivedAt = new Date().toISOString();

    const task: EngineTask = {
      id: params.taskId,
      inputText: params.inputText,
      status: "RECEIVED",
      createdAt: desktopReceivedAt,
      updatedAt: desktopReceivedAt,
      mobileDeviceId: params.mobileDeviceId,
      desktopDeviceId: params.desktopDeviceId,
      abortController: new AbortController(),
      timestamps: {
        mobileSentAt: params.mobileSentAt,
        backendReceivedAt: params.backendReceivedAt,
        desktopReceivedAt,
      },
    };

    this.tasks.set(task.id, task);
    this.persistTasks();

    // Run planning and execution asynchronously
    this.processTask(task).catch((err) => {
      console.error(`[Engine] Unhandled error processing task ${task.id}:`, err);
    });

    return task;
  }

  private async processTask(task: EngineTask): Promise<void> {
    // 1. Transition: RECEIVED -> PLANNING
    if (!this.transitionTaskStatus(task, "PLANNING")) return;
    task.timestamps.planningStartedAt = new Date().toISOString();

    this.emitEvent("TASK_PROGRESS", {
      taskId: task.id,
      status: "PLANNING",
      step: "PLANNING",
      message: "Analyzing task instruction...",
      timestamp: new Date().toISOString(),
    } as TaskProgressPayload);

    // 2. Generate structured TaskPlan
    let plan: TaskPlan;
    try {
      plan = await this.planner.plan(task.inputText, task.id, {
        fileSystem: this.fileSystem,
        toolRegistry: this.toolRegistry,
        signal: task.abortController?.signal,
      });
      task.plan = plan;
      task.timestamps.planningFinishedAt = new Date().toISOString();
    } catch (err: any) {
      this.transitionTaskStatus(task, "FAILED");
      task.error = `Planning error: ${err.message}`;
      this.emitEvent("TASK_FAILED", {
        taskId: task.id,
        status: "FAILED",
        error: task.error,
        code: "PLANNING_ERROR",
        timestamp: new Date().toISOString(),
      } as TaskFailedPayload);
      return;
    }

    // 3. Handle Unsupported Operations (Section 9 Security requirement)
    if (plan.intent === "UNSUPPORTED") {
      this.transitionTaskStatus(task, "FAILED");
      task.error = "UNSUPPORTED_OPERATION: Operation not recognized or not permitted by desktop agent.";
      this.emitEvent("TASK_FAILED", {
        taskId: task.id,
        status: "FAILED",
        error: task.error,
        code: "UNSUPPORTED_OPERATION",
        timestamp: new Date().toISOString(),
      } as TaskFailedPayload);
      return;
    }

    // 4. File Discovery Step (if plan operates on a named file)
    let resolvedSourcePath = plan.sourceFile;
    if (plan.sourceFile && (plan.intent === "VIDEO_TRIM" || plan.intent === "FIND_FILE" || plan.intent === "GET_METADATA")) {
      const searchDir = plan.targetDirectory || "Videos";
      this.emitEvent("TASK_PROGRESS", {
        taskId: task.id,
        status: task.status,
        step: "SEARCHING",
        message: `Searching your ${searchDir} folder...`,
        timestamp: new Date().toISOString(),
      } as TaskProgressPayload);

      const findContext: ExecutionContext = {
        taskId: task.id,
        signal: task.abortController?.signal,
        fileSystem: this.fileSystem,
      };

      const findResult = await this.toolRegistry.executeTool(
        "find_file",
        { filename: plan.sourceFile, directory: plan.targetDirectory },
        findContext
      );

      if (!findResult.success || !findResult.data?.matches || findResult.data.matches.length === 0) {
        this.transitionTaskStatus(task, "FAILED");
        task.error = `File '${plan.sourceFile}' was not found in permitted directories.`;
        this.emitEvent("TASK_FAILED", {
          taskId: task.id,
          status: "FAILED",
          error: task.error,
          code: "FILE_NOT_FOUND",
          timestamp: new Date().toISOString(),
        } as TaskFailedPayload);
        return;
      }

      const matches = findResult.data.matches;
      if (matches.length > 1) {
        // If multiple matches exist, pick the first one or alert user
        this.emitEvent("TASK_PROGRESS", {
          taskId: task.id,
          status: task.status,
          step: "MULTIPLE_FILES_FOUND",
          message: `Found ${matches.length} matching files. Using: ${matches[0].name} (${matches[0].relativePath})`,
          metadata: { matches },
          timestamp: new Date().toISOString(),
        } as TaskProgressPayload);
      } else {
        this.emitEvent("TASK_PROGRESS", {
          taskId: task.id,
          status: task.status,
          step: "FOUND",
          message: `Found ${matches[0].name}.`,
          timestamp: new Date().toISOString(),
        } as TaskProgressPayload);
      }

      resolvedSourcePath = matches[0].fullPath;
      plan.toolInput.sourcePath = resolvedSourcePath;
      if (resolvedSourcePath) {
        plan.toolInput.outputDirectory = path.dirname(resolvedSourcePath);
      }
    }

    // 5. If this is a read-only find_file or list_directories task, complete it immediately
    if (plan.intent === "FIND_FILE") {
      this.transitionTaskStatus(task, "RUNNING");
      this.transitionTaskStatus(task, "COMPLETED");
      this.emitEvent("TASK_COMPLETED", {
        taskId: task.id,
        status: "COMPLETED",
        outputPath: resolvedSourcePath,
        summary: `Found file at ${resolvedSourcePath}`,
        timestamp: new Date().toISOString(),
      } as TaskCompletedPayload);
      return;
    }

    if (plan.intent === "LIST_DIRECTORIES") {
      const listContext: ExecutionContext = {
        taskId: task.id,
        signal: task.abortController?.signal,
        fileSystem: this.fileSystem,
      };

      this.transitionTaskStatus(task, "RUNNING");

      const result = await this.toolRegistry.executeTool(
        "list_directories",
        plan.toolInput || {},
        listContext
      );

      if (!result.success) {
        this.transitionTaskStatus(task, "FAILED");
        task.error = result.error || "Failed to list directories";
        this.emitEvent("TASK_FAILED", {
          taskId: task.id,
          status: "FAILED",
          error: task.error,
          code: (result.metadata?.code as string) || "DIRECTORY_LIST_FAILED",
          timestamp: new Date().toISOString(),
        } as TaskFailedPayload);
        return;
      }

      this.transitionTaskStatus(task, "COMPLETED");
      const data = result.data;
      const dirList = data?.directories || [];
      const targetLabel = data?.targetPath || "allowed folders";
      const summary = dirList.length > 0
        ? `Directories in ${targetLabel} (${dirList.length}): ${Array.isArray(dirList) ? dirList.map((d: any) => (typeof d === "string" ? d : d.name)).join(", ") : ""}`
        : `No subdirectories found in ${targetLabel}.`;

      this.emitEvent("TASK_COMPLETED", {
        taskId: task.id,
        status: "COMPLETED",
        metadata: data,
        summary,
        timestamp: new Date().toISOString(),
      } as TaskCompletedPayload);
      return;
    }

    // 6. User Approval Workflow
    if (plan.requiresApproval) {
      const preparingMsg = plan.proposal ? "Proposal ready. Waiting for approval." : "Preparing video processing...";
      this.emitEvent("TASK_PROGRESS", {
        taskId: task.id,
        status: "PLANNING",
        step: "PREPARING",
        message: preparingMsg,
        timestamp: new Date().toISOString(),
      } as TaskProgressPayload);

      this.transitionTaskStatus(task, "WAITING_FOR_APPROVAL");
      task.timestamps.approvalRequestedAt = new Date().toISOString();

      this.emitEvent("TASK_PROGRESS", {
        taskId: task.id,
        status: "WAITING_FOR_APPROVAL",
        step: "APPROVAL_REQUIRED",
        message: "Waiting for your approval.",
        timestamp: new Date().toISOString(),
      } as TaskProgressPayload);

      if (plan.proposal) {
        this.emitEvent("TASK_PROPOSAL_READY", {
          taskId: task.id,
          proposal: plan.proposal,
          timestamp: new Date().toISOString(),
        });
      }

      // Emit formal TASK_APPROVAL_REQUEST to mobile
      this.emitEvent("TASK_APPROVAL_REQUEST", {
        taskId: task.id,
        title: plan.title,
        intent: plan.intent,
        operation: plan.operation,
        sourceFile: plan.sourceFile,
        outputFile: plan.outputFile,
        proposal: plan.proposal,
        requiresApproval: true,
        details: plan.proposal?.conciseSummary || `Extract first ${plan.operation.durationSeconds || 10} seconds to ${plan.outputFile || "output.mp4"}`,
        timestamp: new Date().toISOString(),
      } as TaskApprovalRequestPayload);

      // Execution will resume when handleApprovalResponse() is invoked
      return;
    }

    // 7. Directly execute pre-approved tasks
    await this.executeApprovedPlan(task);
  }

  /**
   * Handles user's approval response from mobile or desktop UI.
   * Strictly enforces that approval is only accepted when status === "WAITING_FOR_APPROVAL".
   */
  public async handleApprovalResponse(params: {
    taskId: string;
    approved: boolean;
    reason?: string;
  }): Promise<boolean> {
    const task = this.tasks.get(params.taskId);
    if (!task) {
      console.warn(`[Engine] Approval received for non-existent task ${params.taskId}`);
      return false;
    }

    if (task.status !== "WAITING_FOR_APPROVAL") {
      console.warn(`[Engine] Approval rejected: Task ${task.id} is in status '${task.status}', expected 'WAITING_FOR_APPROVAL'`);
      return false;
    }

    task.timestamps.approvalReceivedAt = new Date().toISOString();

    if (!params.approved) {
      this.transitionTaskStatus(task, "CANCELLED");
      task.error = params.reason || "Task cancelled by user";
      this.emitEvent("TASK_CANCELLED", {
        taskId: task.id,
        reason: task.error,
        timestamp: new Date().toISOString(),
      });
      return true;
    }

    // Transition: WAITING_FOR_APPROVAL -> APPROVED
    if (!this.transitionTaskStatus(task, "APPROVED")) {
      return false;
    }

    await this.executeApprovedPlan(task);
    return true;
  }

  /**
   * Executes the approved plan.
   */
  private async executeApprovedPlan(task: EngineTask): Promise<void> {
    if (!task.plan) return;

    // Transition: APPROVED -> RUNNING
    if (!this.transitionTaskStatus(task, "RUNNING")) return;
    task.timestamps.executionStartedAt = new Date().toISOString();

    const runningMessage =
      task.plan.operation?.type === "MULTI_AGENT_EXECUTION"
        ? `Executing plan: ${task.plan.title}...`
        : "Processing video...";

    this.emitEvent("TASK_PROGRESS", {
      taskId: task.id,
      status: "RUNNING",
      step: "RUNNING",
      message: runningMessage,
      timestamp: new Date().toISOString(),
    } as TaskProgressPayload);

    const context: ExecutionContext = {
      taskId: task.id,
      signal: task.abortController?.signal,
      fileSystem: this.fileSystem,
      onProgress: (step, msg, progress) => {
        this.emitEvent("TASK_PROGRESS", {
          taskId: task.id,
          status: "RUNNING",
          step,
          message: msg,
          progressPercent: progress,
          timestamp: new Date().toISOString(),
        } as TaskProgressPayload);
      },
    };

    // Branch A: Multi-Step Execution (from Multi-Agent Planning)
    if (task.plan.operation?.type === "MULTI_AGENT_EXECUTION" && task.plan.proposal?.steps) {
      const steps = task.plan.proposal.steps;
      let lastOutputPath: string | undefined;
      let accumulatedData: Record<string, any> = {};

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (task.abortController?.signal.aborted) {
          this.transitionTaskStatus(task, "CANCELLED");
          this.emitEvent("TASK_CANCELLED", {
            taskId: task.id,
            reason: "Task was cancelled by user",
            timestamp: new Date().toISOString(),
          });
          return;
        }

        const pct = Math.round(((i + 1) / steps.length) * 100);
        this.emitEvent("TASK_PROGRESS", {
          taskId: task.id,
          status: "RUNNING",
          step: `STEP_${step.stepId}`,
          message: step.description,
          progressPercent: pct,
          timestamp: new Date().toISOString(),
        } as TaskProgressPayload);

        const stepInput = { ...(step.input || {}) };
        if (step.tool === "verify_output" && !stepInput.filePath && lastOutputPath) {
          stepInput.filePath = lastOutputPath;
        }

        const stepResult = await this.toolRegistry.executeTool(
          step.tool,
          stepInput,
          context
        );

        if (!stepResult.success) {
          this.transitionTaskStatus(task, "FAILED");
          task.error = `Step '${step.description}' failed: ${stepResult.error}`;
          this.emitEvent("TASK_FAILED", {
            taskId: task.id,
            status: "FAILED",
            error: task.error,
            code: (stepResult.metadata?.code as string) || "STEP_FAILED",
            step: step.stepId,
            timestamp: new Date().toISOString(),
          } as TaskFailedPayload);
          return;
        }

        if (stepResult.data?.outputPath) {
          lastOutputPath = stepResult.data.outputPath;
        }
        accumulatedData = { ...accumulatedData, ...stepResult.data };
      }

      task.timestamps.executionCompletedAt = new Date().toISOString();

      // Output Verification Step
      this.transitionTaskStatus(task, "VERIFYING");
      this.emitEvent("TASK_PROGRESS", {
        taskId: task.id,
        status: "VERIFYING",
        step: "VERIFYING",
        message: "Verifying multi-agent output bundle...",
        timestamp: new Date().toISOString(),
      } as TaskProgressPayload);

      const verifyContext: ExecutionContext = {
        taskId: task.id,
        signal: task.abortController?.signal,
        fileSystem: this.fileSystem,
      };

      if (lastOutputPath) {
        const verifyResult = await this.toolRegistry.executeTool(
          "verify_output",
          {
            filePath: lastOutputPath,
            expectedMinSize: task.plan.verification?.expectedMinSize || 100,
          },
          verifyContext
        );

        if (!verifyResult.success) {
          this.transitionTaskStatus(task, "FAILED");
          task.error = `Verification error: ${verifyResult.error}`;
          this.emitEvent("TASK_FAILED", {
            taskId: task.id,
            status: "FAILED",
            error: task.error,
            code: "VERIFICATION_FAILED",
            timestamp: new Date().toISOString(),
          } as TaskFailedPayload);
          return;
        }
      }

      task.timestamps.verificationCompletedAt = new Date().toISOString();
      this.transitionTaskStatus(task, "COMPLETED");
      task.result = {
        ...accumulatedData,
        outputPath: lastOutputPath,
      };

      const tExec = task.timestamps.executionStartedAt && task.timestamps.executionCompletedAt
        ? new Date(task.timestamps.executionCompletedAt).getTime() - new Date(task.timestamps.executionStartedAt).getTime()
        : 10;

      this.emitEvent("TASK_PROGRESS", {
        taskId: task.id,
        status: "COMPLETED",
        step: "COMPLETED",
        message: "Completed all planned steps.",
        timestamp: new Date().toISOString(),
      } as TaskProgressPayload);

      this.emitEvent("TASK_COMPLETED", {
        taskId: task.id,
        status: "COMPLETED",
        outputPath: lastOutputPath,
        summary: `Completed successfully: ${task.plan.title}`,
        metadata: accumulatedData,
        executionTimeMs: tExec,
        timestamp: new Date().toISOString(),
      } as TaskCompletedPayload);
      return;
    }

    // Branch B: Single-Step Tool Execution (Phase 2 Deterministic)
    const toolResult = await this.toolRegistry.executeTool(
      task.plan.toolName,
      task.plan.toolInput,
      context
    );

    task.timestamps.executionCompletedAt = new Date().toISOString();

    if (!toolResult.success || !toolResult.data?.outputPath) {
      if (task.abortController?.signal.aborted) {
        this.transitionTaskStatus(task, "CANCELLED");
        this.emitEvent("TASK_CANCELLED", {
          taskId: task.id,
          reason: "Task was cancelled by user",
          timestamp: new Date().toISOString(),
        });
      } else {
        this.transitionTaskStatus(task, "FAILED");
        task.error = toolResult.error || "Tool execution failed";
        this.emitEvent("TASK_FAILED", {
          taskId: task.id,
          status: "FAILED",
          error: task.error,
          timestamp: new Date().toISOString(),
        } as TaskFailedPayload);
      }
      return;
    }

    // 8. Output Verification Step
    this.transitionTaskStatus(task, "VERIFYING");
    this.emitEvent("TASK_PROGRESS", {
      taskId: task.id,
      status: "VERIFYING",
      step: "VERIFYING",
      message: "Verifying output...",
      timestamp: new Date().toISOString(),
    } as TaskProgressPayload);

    const verifyContext: ExecutionContext = {
      taskId: task.id,
      signal: task.abortController?.signal,
      fileSystem: this.fileSystem,
    };

    const verifyResult = await this.toolRegistry.executeTool(
      "verify_output",
      {
        filePath: toolResult.data.outputPath,
        expectedMinSize: task.plan.verification?.expectedMinSize || 1024,
        expectedDuration: task.plan.verification?.expectedDuration,
        durationTolerance: task.plan.verification?.durationTolerance || 1.5,
      },
      verifyContext
    );

    task.timestamps.verificationCompletedAt = new Date().toISOString();

    if (!verifyResult.success) {
      this.transitionTaskStatus(task, "FAILED");
      task.error = `Verification error: ${verifyResult.error}`;
      this.emitEvent("TASK_FAILED", {
        taskId: task.id,
        status: "FAILED",
        error: task.error,
        code: "VERIFICATION_FAILED",
        timestamp: new Date().toISOString(),
      } as TaskFailedPayload);
      return;
    }

    // 9. Completion Step
    this.transitionTaskStatus(task, "COMPLETED");
    task.result = {
      ...toolResult.data,
      verification: verifyResult.data,
    };

    // Calculate latency metrics
    const tPlanning =
      task.timestamps.planningStartedAt && task.timestamps.planningFinishedAt
        ? new Date(task.timestamps.planningFinishedAt).getTime() -
          new Date(task.timestamps.planningStartedAt).getTime()
        : 0;

    const tApprovalWait =
      task.timestamps.approvalRequestedAt && task.timestamps.approvalReceivedAt
        ? new Date(task.timestamps.approvalReceivedAt).getTime() -
          new Date(task.timestamps.approvalRequestedAt).getTime()
        : 0;

    const tExecution =
      task.timestamps.executionStartedAt && task.timestamps.executionCompletedAt
        ? new Date(task.timestamps.executionCompletedAt).getTime() -
          new Date(task.timestamps.executionStartedAt).getTime()
        : 0;

    const tVerification =
      task.timestamps.executionCompletedAt && task.timestamps.verificationCompletedAt
        ? new Date(task.timestamps.verificationCompletedAt).getTime() -
          new Date(task.timestamps.executionCompletedAt).getTime()
        : 0;

    const tTotal =
      task.timestamps.mobileSentAt && task.timestamps.verificationCompletedAt
        ? new Date(task.timestamps.verificationCompletedAt).getTime() -
          new Date(task.timestamps.mobileSentAt).getTime()
        : tExecution + tPlanning + tVerification;

    this.emitEvent("TASK_PROGRESS", {
      taskId: task.id,
      status: "COMPLETED",
      step: "COMPLETED",
      message: "Completed.",
      timestamp: new Date().toISOString(),
    } as TaskProgressPayload);

    this.emitEvent("TASK_COMPLETED", {
      taskId: task.id,
      status: "COMPLETED",
      outputPath: toolResult.data.outputPath,
      summary: `Saved to ${toolResult.data.outputPath}`,
      metadata: {
        filename: toolResult.data.filename,
        sizeBytes: toolResult.data.sizeBytes,
        durationSeconds: toolResult.data.verifiedDurationSeconds || toolResult.data.durationSeconds,
      },
      executionTimeMs: tExecution,
      latencyMetrics: {
        mobileSentAt: task.timestamps.mobileSentAt,
        backendReceivedAt: task.timestamps.backendReceivedAt,
        desktopReceivedAt: task.timestamps.desktopReceivedAt,
        planningStartedAt: task.timestamps.planningStartedAt,
        planningDurationMs: tPlanning,
        approvalRequestedAt: task.timestamps.approvalRequestedAt,
        approvalReceivedAt: task.timestamps.approvalReceivedAt,
        approvalWaitMs: tApprovalWait,
        executionStartedAt: task.timestamps.executionStartedAt,
        executionDurationMs: tExecution,
        verificationDurationMs: tVerification,
        totalRoundTripMs: tTotal,
      },
      timestamp: new Date().toISOString(),
    } as TaskCompletedPayload);
  }

  /**
   * Cancels an active or pending task.
   */
  public cancelTask(taskId: string, reason = "Cancelled by user"): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (!canCancelTask(task.status)) {
      console.warn(`[Engine] Task ${taskId} cannot be cancelled in state ${task.status}`);
      return false;
    }

    if (task.abortController) {
      task.abortController.abort();
    }

    this.transitionTaskStatus(task, "CANCELLED");
    task.error = reason;

    this.emitEvent("TASK_CANCELLED", {
      taskId: task.id,
      reason,
      timestamp: new Date().toISOString(),
    });

    return true;
  }

  /**
   * Loads persisted tasks from disk on engine startup.
   * In-flight uncompleted tasks from a prior crashed/stopped process are safely marked as FAILED.
   */
  private loadPersistedTasks(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, "utf-8");
        const parsed: EngineTask[] = JSON.parse(raw);
        for (const t of parsed) {
          t.abortController = new AbortController();
          if (t.status === "PLANNING" || t.status === "RUNNING" || t.status === "VERIFYING" || t.status === "APPROVED") {
            t.status = "FAILED";
            t.error = "TASK_INTERRUPTED: Desktop process restarted while task was in progress. Marked as failed for safety.";
            t.updatedAt = new Date().toISOString();
          }
          this.tasks.set(t.id, t);
        }
      }
    } catch (e) {
      console.warn("[Engine] Failed to load persisted tasks:", e);
    }
  }

  /**
   * Persists task states to disk for crash recovery and restart persistence.
   */
  private persistTasks(): void {
    try {
      const serializable = Array.from(this.tasks.values()).map(({ abortController, ...rest }) => rest);
      fs.writeFileSync(this.storagePath, JSON.stringify(serializable, null, 2), "utf-8");
    } catch (e) {
      console.warn("[Engine] Failed to persist tasks to disk:", e);
    }
  }

  /**
   * Clears in-memory and persisted tasks (used for clean testing environments).
   */
  public clearTasksForTesting(): void {
    this.tasks.clear();
    this.taskListeners.clear();
    this.globalListeners.clear();
    this.eventCallback = null;
    try {
      if (fs.existsSync(this.storagePath)) {
        fs.unlinkSync(this.storagePath);
      }
    } catch {}
  }
}
