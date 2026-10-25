export interface AuditLogEntry {
  id: string;
  timestamp: string;
  eventType: "TOOL_EXECUTION" | "POLICY_CHECK" | "PLANNING" | "APPROVAL" | "SECURITY_VIOLATION";
  action: string;
  status: "SUCCESS" | "FAILURE" | "DENIED" | "TIMEOUT";
  taskId?: string;
  toolName?: string;
  details?: Record<string, any>;
  durationMs?: number;
  error?: string;
}

export class AuditLogger {
  private static instance: AuditLogger;
  private logs: AuditLogEntry[] = [];
  private maxLogs = 500;

  private constructor() {}

  public static getInstance(): AuditLogger {
    if (!AuditLogger.instance) {
      AuditLogger.instance = new AuditLogger();
    }
    return AuditLogger.instance;
  }

  public log(entry: Omit<AuditLogEntry, "id" | "timestamp">): AuditLogEntry {
    const fullEntry: AuditLogEntry = {
      id: "audit-" + Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    this.logs.unshift(fullEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    if (entry.status === "DENIED" || entry.status === "FAILURE") {
      console.warn(`[Audit ${entry.eventType}] [${entry.status}] ${entry.action}:`, entry.error || entry.details);
    } else {
      console.log(`[Audit ${entry.eventType}] [${entry.status}] ${entry.action}`);
    }

    return fullEntry;
  }

  public getRecentLogs(limit = 50, filterTaskId?: string): AuditLogEntry[] {
    if (filterTaskId) {
      return this.logs.filter((l) => l.taskId === filterTaskId).slice(0, limit);
    }
    return this.logs.slice(0, limit);
  }

  public clear(): void {
    this.logs = [];
  }
}
