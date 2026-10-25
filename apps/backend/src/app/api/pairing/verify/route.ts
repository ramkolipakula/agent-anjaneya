import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { generateSecureToken, hashSecret, getCorsHeaders } from "@/lib/auth";

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(req),
  });
}

export async function POST(req: Request) {
  const cors = getCorsHeaders(req);
  try {
    const {
      pairingSessionId,
      pairingToken,
      pinCode,
      autoPairLocal,
      mobileDeviceId,
      mobileDeviceName,
      mobileDeviceSecret,
    } = await req.json();

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

      // 2. Fetch session based on pairingToken, pinCode, or local discovery
      let session: any = null;

      if (pinCode) {
        const cleanPin = String(pinCode).replace(/\D/g, "");
        session = await tx.pairingSession.findFirst({
          where: {
            pinCode: cleanPin,
            status: "ACTIVE",
            expiresAt: { gt: new Date() },
          },
        });
      } else if (autoPairLocal) {
        session = await tx.pairingSession.findFirst({
          where: {
            status: "ACTIVE",
            expiresAt: { gt: new Date() },
            pinCode: { not: null },
          },
          orderBy: { createdAt: "desc" },
        });

        // Local dev convenience: if no active session but desktop is online, auto-provision
        if (!session) {
          const onlineDesktop = await tx.device.findFirst({
            where: {
              deviceType: "DESKTOP",
              status: "ONLINE",
              lastSeenAt: { gt: new Date(Date.now() - 5 * 60 * 1000) },
            },
            orderBy: { lastSeenAt: "desc" },
          });

          if (onlineDesktop) {
            session = await tx.pairingSession.create({
              data: {
                desktopDeviceId: onlineDesktop.id,
                tokenHash: hashSecret(generateSecureToken(32)),
                pinCode: "AUTOPR",
                expiresAt: new Date(Date.now() + 60 * 1000),
                status: "ACTIVE",
              },
            });
          }
        }
      } else if (pairingSessionId && pairingToken) {
        const tokenHash = hashSecret(pairingToken);
        const candidate = await tx.pairingSession.findUnique({
          where: { id: pairingSessionId },
        });
        if (candidate && candidate.tokenHash === tokenHash) {
          session = candidate;
        }
      }

      if (!session) {
        throw new Error("INVALID_SESSION_OR_PIN");
      }

      if (session.status !== "ACTIVE" || session.expiresAt <= new Date()) {
        throw new Error("EXPIRED_OR_USED");
      }

      // 3. Atomically consume the session token
      const updateResult = await tx.pairingSession.updateMany({
        where: {
          id: session.id,
          status: "ACTIVE",
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

      // 5. Create or activate DeviceConnection
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
    let userMessage = message;
    if (message === "INVALID_SESSION_OR_PIN") {
      status = 404;
      userMessage = "No active pairing session found. Please make sure the Desktop app is open and showing a PIN.";
    } else if (message === "EXPIRED_OR_USED") {
      status = 409;
      userMessage = "Pairing session has expired or already been used. Please refresh your Desktop screen for a new PIN.";
    } else if (message === "CONCURRENT_CONSUMPTION") {
      status = 409;
      userMessage = "Pairing code was already consumed by another request.";
    } else {
      status = 500;
    }

    return NextResponse.json({ error: userMessage, code: message, success: false }, { status, headers: cors });
  }
}
