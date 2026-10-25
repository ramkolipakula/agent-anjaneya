import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import crypto from "crypto";

export async function POST(req: Request) {
  try {
    const { pairingSessionId, pairingToken, mobileDeviceId, mobileDeviceName } = await req.json();

    const session = await prisma.pairingSession.findUnique({
      where: { id: pairingSessionId }
    });

    if (!session) {
      return NextResponse.json({ error: "Invalid session" }, { status: 400 });
    }

    if (session.status !== "ACTIVE" || session.expiresAt < new Date()) {
      return NextResponse.json({ error: "Session expired or already used" }, { status: 400 });
    }

    const tokenHash = crypto.createHash("sha256").update(pairingToken).digest("hex");

    if (session.tokenHash !== tokenHash) {
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    // Ensure user exists
    await prisma.user.upsert({
      where: { id: "user-1" },
      update: {},
      create: {
        id: "user-1",
        email: "user@example.com",
      },
    });

    // Verify successful. Create or update mobile device.
    let mobileDevice = await prisma.device.findUnique({
      where: { id: mobileDeviceId }
    });

    if (!mobileDevice) {
      mobileDevice = await prisma.device.create({
        data: {
          id: mobileDeviceId,
          userId: "user-1", // mocked single user
          deviceType: "MOBILE",
          deviceName: mobileDeviceName || "Mobile Device",
          platform: "mobile",
          appVersion: "1.0.0",
          status: "ONLINE"
        }
      });
    }

    // Create connection
    await prisma.deviceConnection.create({
      data: {
        mobileDeviceId: mobileDevice.id,
        desktopDeviceId: session.desktopDeviceId
      }
    });

    // Mark session as used
    await prisma.pairingSession.update({
      where: { id: session.id },
      data: {
        status: "USED",
        usedAt: new Date()
      }
    });

    return NextResponse.json({ success: true, desktopDeviceId: session.desktopDeviceId });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
