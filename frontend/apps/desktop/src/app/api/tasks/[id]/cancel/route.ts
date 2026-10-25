import { NextRequest, NextResponse } from "next/server";
import { TaskExecutionEngine } from "@/engine/TaskExecutionEngine";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const { reason = "Cancelled by user" } = body;

    const engine = TaskExecutionEngine.getInstance();
    const success = engine.cancelTask(id, reason);

    if (!success) {
      return NextResponse.json({ error: "Failed to cancel task or task already finished" }, { status: 400 });
    }

    const task = engine.getTask(id);
    return NextResponse.json({ success: true, task });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
