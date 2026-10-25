import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import crypto from "crypto";

export async function POST(req: Request) {
  try {
    const { deviceId, deviceName } = await req.json();

    // Ensure base user exists
    await prisma.user.upsert({
      where: { id: "user-1" },
      update: {},
      create: {
        id: "user-1",
        email: "user@example.com",
      },
    });

    // Check if device exists, otherwise create it
    let device = await prisma.device.findUnique({
      where: { id: deviceId }
    });

    if (!device) {
      device = await prisma.device.create({
        data: {
          id: deviceId,
          userId: "user-1", // mock single user for now
          deviceType: "DESKTOP",
          deviceName: deviceName || "Desktop",
          platform: "web",
          appVersion: "1.0.0",
          status: "ONLINE"
        }
      });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5); // 5 minutes expiry

    const session = await prisma.pairingSession.create({
      data: {
        desktopDeviceId: device.id,
        tokenHash,
        expiresAt,
        status: "ACTIVE"
      }
    });

    return NextResponse.json({
      pairingSessionId: session.id,
      pairingToken: token
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
