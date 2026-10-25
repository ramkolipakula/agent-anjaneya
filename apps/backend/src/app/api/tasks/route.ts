import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const deviceId = searchParams.get("deviceId");
    const taskId = searchParams.get("taskId");

    if (taskId) {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          events: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!task) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }

      return NextResponse.json({ task });
    }

    if (!deviceId) {
      return NextResponse.json({ error: "deviceId or taskId is required" }, { status: 400 });
    }

    // Retrieve active and recent tasks for this device
    const tasks = await prisma.task.findMany({
      where: {
        OR: [
          { desktopDeviceId: deviceId },
          { createdByDeviceId: deviceId },
        ],
      },
      include: {
        events: {
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return NextResponse.json({ tasks });
  } catch (error: any) {
    console.error("[Tasks API Error]", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
