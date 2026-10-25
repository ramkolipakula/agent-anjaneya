import { NextRequest, NextResponse } from "next/server";
import { AuditLogger } from "@/engine/audit/AuditLogger";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const taskId = searchParams.get("taskId") || undefined;

    const logs = AuditLogger.getInstance().getRecentLogs(limit, taskId);
    return NextResponse.json({ logs });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
