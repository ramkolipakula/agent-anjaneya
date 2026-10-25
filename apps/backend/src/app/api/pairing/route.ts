import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { generateSecureToken, hashSecret, getCorsHeaders, verifyDeviceCredentials } from "@/lib/auth";

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(req),
  });
}

export async function POST(req: Request) {
  const cors = getCorsHeaders(req);
  try {
    const { deviceId, deviceName, deviceSecret } = await req.json();

    // Ensure base user exists
    await prisma.user.upsert({
      where: { id: "user-1" },
      update: {},
      create: {
        id: "user-1",
        email: "user@example.com",
      },
    });

    let device: any = null;
    let actualDeviceSecret = deviceSecret;

    if (deviceId && deviceSecret) {
      device = await verifyDeviceCredentials(deviceId, deviceSecret);
    }

    if (!device) {
      // Register or re-issue secret for this device
      actualDeviceSecret = generateSecureToken(32);
      const secretHash = hashSecret(actualDeviceSecret);
      const newDeviceId = deviceId || "desktop-" + generateSecureToken(6);

      device = await prisma.device.upsert({
        where: { id: newDeviceId },
        update: {
          deviceName: deviceName || "Desktop",
          deviceSecretHash: secretHash,
          status: "ONLINE",
          lastSeenAt: new Date(),
        },
        create: {
          id: newDeviceId,
          userId: "user-1",
          deviceType: "DESKTOP",
          deviceName: deviceName || "Desktop",
          platform: "desktop",
          appVersion: "1.0.0",
          deviceSecretHash: secretHash,
          status: "ONLINE",
          lastSeenAt: new Date(),
        },
      });
    }

    // Invalidate any previous ACTIVE pairing sessions for this desktop
    await prisma.pairingSession.updateMany({
      where: {
        desktopDeviceId: device.id,
        status: "ACTIVE",
      },
      data: {
        status: "CANCELLED",
      },
    });

    const pairingToken = generateSecureToken(32);
    const tokenHash = hashSecret(pairingToken);

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5); // 5 minutes expiry

    const session = await prisma.pairingSession.create({
      data: {
        desktopDeviceId: device.id,
        tokenHash,
        expiresAt,
        status: "ACTIVE",
      },
    });

    return NextResponse.json(
      {
        deviceId: device.id,
        deviceSecret: actualDeviceSecret,
        pairingSessionId: session.id,
        pairingToken,
        desktopDeviceId: device.id,
        expiresAt: expiresAt.toISOString(),
      },
      { headers: cors }
    );
  } catch (error) {
    console.error("Pairing creation error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500, headers: cors }
    );
  }
}
