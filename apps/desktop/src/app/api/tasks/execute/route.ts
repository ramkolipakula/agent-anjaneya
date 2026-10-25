import { NextRequest, NextResponse } from "next/server";
import { TaskExecutionEngine } from "@/engine/TaskExecutionEngine";
import { isTerminalTaskStatus } from "@agent-anjaneya/protocol";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { taskId, inputText, mobileDeviceId, desktopDeviceId, mobileSentAt, backendReceivedAt } = body;

    if (!taskId || !inputText) {
      return NextResponse.json({ error: "taskId and inputText are required" }, { status: 400 });
    }

    const engine = TaskExecutionEngine.getInstance();

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        const sendEvent = (type: string, payload: any) => {
          try {
            const data = JSON.stringify({ type, payload }) + "\n";
            controller.enqueue(encoder.encode(data));
          } catch (e) {
            // Stream might be closed
          }
        };

        // Hook engine event listener
        const previousCb = (engine as any).eventCallback;
        engine.setEventCallback((type: string, payload: any) => {
          if (payload?.taskId === taskId) {
            sendEvent(type, payload);

            if (payload?.status && isTerminalTaskStatus(payload.status)) {
              setTimeout(() => {
                try {
                  controller.close();
                } catch (e) {}
              }, 500);
            }
          }
        });

        // Submit task to engine
        try {
          await engine.submitTask({
            taskId,
            inputText,
            mobileDeviceId: mobileDeviceId || "mobile-client",
            desktopDeviceId: desktopDeviceId || "desktop-client",
            mobileSentAt,
            backendReceivedAt,
          });
        } catch (err: any) {
          sendEvent("TASK_FAILED", {
            taskId,
            status: "FAILED",
            error: err.message || "Failed to submit task to engine",
            timestamp: new Date().toISOString(),
          });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
