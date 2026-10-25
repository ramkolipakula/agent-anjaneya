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
    const { pairingSessionId, pairingToken, mobileDeviceId, mobileDeviceName, mobileDeviceSecret } =
      await req.json();

    if (!pairingSessionId || !pairingToken) {
      return NextResponse.json(
        { error: "pairingSessionId and pairingToken are required" },
        { status: 400, headers: cors }
      );
    }

    const tokenHash = hashSecret(pairingToken);

    // Atomic transaction for single-use pairing token consumption and connection creation
    const result = await prisma.$transaction(async (tx) => {
      // 1. Ensure user exists
      const user = await tx.user.upsert({
        where: { id: "user-1" },
        update: {},
        create: {
          id: "user-1",
          email: "user@example.com",
        },
      });

      // 2. Fetch session and lock it by checking validity
      const session = await tx.pairingSession.findUnique({
        where: { id: pairingSessionId },
      });

      if (!session) {
        throw new Error("INVALID_SESSION");
      }

      if (session.status !== "ACTIVE" || session.expiresAt <= new Date()) {
        throw new Error("EXPIRED_OR_USED");
      }

      if (session.tokenHash !== tokenHash) {
        throw new Error("INVALID_TOKEN");
      }

      // 3. Atomically consume the token. If another concurrent request beat us, count will be 0.
      const updateResult = await tx.pairingSession.updateMany({
        where: {
          id: pairingSessionId,
          status: "ACTIVE",
          tokenHash: tokenHash,
          expiresAt: { gt: new Date() },
        },
        data: {
          status: "USED",
          usedAt: new Date(),
        },
      });

      if (updateResult.count !== 1) {
        throw new Error("CONCURRENT_CONSUMPTION");
      }

      // 4. Resolve or register the mobile device
      let actualMobileSecret = mobileDeviceSecret;
      let mobileDevice: any = null;

      if (mobileDeviceId && mobileDeviceSecret) {
        const existing = await tx.device.findUnique({ where: { id: mobileDeviceId } });
        if (existing && existing.deviceSecretHash === hashSecret(mobileDeviceSecret)) {
          mobileDevice = existing;
        }
      }

      if (!mobileDevice) {
        actualMobileSecret = generateSecureToken(32);
        const secretHash = hashSecret(actualMobileSecret);
        const resolvedMobileId = mobileDeviceId || "mobile-" + generateSecureToken(6);

        mobileDevice = await tx.device.upsert({
          where: { id: resolvedMobileId },
          update: {
            deviceName: mobileDeviceName || "Ram's Phone",
            deviceSecretHash: secretHash,
            status: "ONLINE",
            lastSeenAt: new Date(),
          },
          create: {
            id: resolvedMobileId,
            userId: user.id,
            deviceType: "MOBILE",
            deviceName: mobileDeviceName || "Ram's Phone",
            platform: "mobile",
            appVersion: "1.0.0",
            deviceSecretHash: secretHash,
            status: "ONLINE",
            lastSeenAt: new Date(),
          },
        });
      }

      // 5. Create or activate DeviceConnection (unique constraint prevents duplicate connections)
      const connection = await tx.deviceConnection.upsert({
        where: {
          mobileDeviceId_desktopDeviceId: {
            mobileDeviceId: mobileDevice.id,
            desktopDeviceId: session.desktopDeviceId,
          },
        },
        update: {
          status: "ACTIVE",
          updatedAt: new Date(),
        },
        create: {
          userId: user.id,
          mobileDeviceId: mobileDevice.id,
          desktopDeviceId: session.desktopDeviceId,
          status: "ACTIVE",
        },
      });

      return {
        desktopDeviceId: session.desktopDeviceId,
        mobileDeviceId: mobileDevice.id,
        mobileDeviceSecret: actualMobileSecret,
        connectionId: connection.id,
      };
    });

    // Notify desktop socket if connected
    const io = (globalThis as any).io;
    if (io) {
      io.to(result.desktopDeviceId).emit("message", {
        id: generateSecureToken(8),
        type: "PAIRING_SUCCESSFUL",
        timestamp: new Date().toISOString(),
        sourceDeviceId: result.mobileDeviceId,
        targetDeviceId: result.desktopDeviceId,
        payload: {
          mobileDeviceId: result.mobileDeviceId,
          mobileDeviceName: mobileDeviceName || "Ram's Phone",
        },
      });
    }

    return NextResponse.json(
      {
        success: true,
        desktopDeviceId: result.desktopDeviceId,
        mobileDeviceId: result.mobileDeviceId,
        mobileDeviceSecret: result.mobileDeviceSecret,
        connectionId: result.connectionId,
      },
      { headers: cors }
    );
  } catch (error: any) {
    console.error("Pairing verification failed:", error?.message || error);
    const message = error?.message || "Internal Server Error";

    let status = 400;
    if (message === "INVALID_SESSION") status = 404;
    else if (message === "EXPIRED_OR_USED" || message === "CONCURRENT_CONSUMPTION") status = 409;
    else if (message === "INVALID_TOKEN") status = 401;
    else status = 500;

    return NextResponse.json({ error: message, success: false }, { status, headers: cors });
  }
}
