import { NextRequest, NextResponse } from "next/server";
import { TaskExecutionEngine } from "@/engine/TaskExecutionEngine";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { approved = true, reason } = body;

    const engine = TaskExecutionEngine.getInstance();
    const success = await engine.handleApprovalResponse({
      taskId: id,
      approved,
      reason,
    });

    if (!success) {
      return NextResponse.json({ error: "Failed to apply approval or task not waiting for approval" }, { status: 400 });
    }

    const task = engine.getTask(id);
    return NextResponse.json({ success: true, task });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
