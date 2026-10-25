import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { generateSecureToken, hashSecret, getCorsHeaders, verifyDeviceCredentials } from "@/lib/auth";

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(req),
  });
}

// Convenient endpoint to discover active local desktop pairing session
export async function GET(req: Request) {
  const cors = getCorsHeaders(req);
  try {
    const session = await prisma.pairingSession.findFirst({
      where: {
        status: "ACTIVE",
        expiresAt: { gt: new Date() },
        pinCode: { not: null },
      },
      orderBy: { createdAt: "desc" },
      include: {
        desktopDevice: true,
      },
    });

    if (!session) {
      return NextResponse.json({ active: false }, { headers: cors });
    }

    return NextResponse.json(
      {
        active: true,
        pairingSessionId: session.id,
        pinCode: session.pinCode,
        desktopDeviceId: session.desktopDeviceId,
        desktopDeviceName: session.desktopDevice.deviceName,
        expiresAt: session.expiresAt.toISOString(),
      },
      { headers: cors }
    );
  } catch (err) {
    return NextResponse.json({ active: false }, { status: 500, headers: cors });
  }
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
    const pinCode = Math.floor(100000 + Math.random() * 900000).toString();

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5); // 5 minutes expiry

    const session = await prisma.pairingSession.create({
      data: {
        desktopDeviceId: device.id,
        tokenHash,
        pinCode,
        expiresAt,
        status: "ACTIVE",
      },
    });

    const existingConnection = await prisma.deviceConnection.findFirst({
      where: {
        desktopDeviceId: device.id,
        status: "ACTIVE",
      },
      include: {
        mobileDevice: true,
      },
    });

    return NextResponse.json(
      {
        deviceId: device.id,
        deviceSecret: actualDeviceSecret,
        pairingSessionId: session.id,
        pairingToken,
        pinCode,
        desktopDeviceId: device.id,
        expiresAt: expiresAt.toISOString(),
        pairedMobile: existingConnection
          ? {
              deviceId: existingConnection.mobileDeviceId,
              deviceName: existingConnection.mobileDevice.deviceName,
              status: existingConnection.mobileDevice.status,
            }
          : null,
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
