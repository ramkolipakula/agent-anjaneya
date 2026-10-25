import { NextRequest, NextResponse } from "next/server";
import { TaskExecutionEngine } from "@/engine/TaskExecutionEngine";
import { AuditLogger } from "@/engine/audit/AuditLogger";

export async function GET() {
  try {
    const engine = TaskExecutionEngine.getInstance();
    const tasks = engine.getAllTasks();
    const directories = engine.getFileSystem().listAllowedDirectories();
    const auditLogs = AuditLogger.getInstance().getRecentLogs(30);

    return NextResponse.json({
      tasks,
      directories,
      auditLogs,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { taskId, inputText, mobileDeviceId, desktopDeviceId, mobileSentAt, backendReceivedAt } = body;

    if (!taskId || !inputText) {
      return NextResponse.json({ error: "taskId and inputText are required" }, { status: 400 });
    }

    const engine = TaskExecutionEngine.getInstance();
    const task = await engine.submitTask({
      taskId,
      inputText,
      mobileDeviceId: mobileDeviceId || "unknown-mobile",
      desktopDeviceId: desktopDeviceId || "ram-pc",
      mobileSentAt,
      backendReceivedAt,
    });

    return NextResponse.json({ success: true, task });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
