import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { Server, Socket } from "socket.io";
import prisma from "./src/lib/prisma";
import { verifyDeviceCredentials } from "./src/lib/auth";
import {
  RealtimeMessage,
  validateRealtimeMessage,
  ALLOWED_MESSAGE_TYPES,
} from "@agent-anjaneya/protocol";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3000", 10);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:3001", "http://localhost:8081"];

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error occurred handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  const io = new Server(server, {
    cors: {
      origin: allowedOrigins.includes("*") ? "*" : allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  (globalThis as any).io = io;

  // Priority 0: Authenticate device credentials during handshake
  io.use(async (socket: Socket, next) => {
    try {
      const { deviceId, deviceSecret } = socket.handshake.auth || {};
      if (!deviceId || !deviceSecret) {
        return next(new Error("AUTH_REQUIRED: deviceId and deviceSecret are mandatory"));
      }

      const device = await verifyDeviceCredentials(deviceId, deviceSecret);
      if (!device) {
        return next(new Error("AUTH_INVALID: Invalid deviceId or deviceSecret"));
      }

      socket.data = {
        deviceId: device.id,
        userId: device.userId,
        deviceType: device.deviceType,
        deviceName: device.deviceName,
      };

      return next();
    } catch (err: any) {
      return next(new Error("AUTH_ERROR: " + err.message));
    }
  });

  io.on("connection", async (socket: Socket) => {
    const { deviceId, userId, deviceType, deviceName } = socket.data;
    console.log(`[Socket] Authenticated connection from ${deviceType} ${deviceId} (${deviceName})`);

    // Join private device room
    socket.join(deviceId);

    // Update status to ONLINE and persist lastSeenAt
    await prisma.device.update({
      where: { id: deviceId },
      data: { status: "ONLINE", lastSeenAt: new Date() },
    });

    // Notify all active paired connections and sync counterpart online status
    const connections = await prisma.deviceConnection.findMany({
      where: {
        userId,
        status: "ACTIVE",
        OR: [{ mobileDeviceId: deviceId }, { desktopDeviceId: deviceId }],
      },
      include: {
        mobileDevice: true,
        desktopDevice: true,
      },
    });

    for (const conn of connections) {
      const isMobile = conn.mobileDeviceId === deviceId;
      const targetId = isMobile ? conn.desktopDeviceId : conn.mobileDeviceId;
      const targetDevice = isMobile ? conn.desktopDevice : conn.mobileDevice;

      // 1. Notify counterpart that this newly connected device is ONLINE
      io.to(targetId).emit("message", {
        id: Math.random().toString(36).substring(7),
        type: "DEVICE_CONNECTED",
        timestamp: new Date().toISOString(),
        sourceDeviceId: deviceId,
        targetDeviceId: targetId,
      } as RealtimeMessage);

      // 2. If counterpart is already online, notify this newly connected device immediately
      const targetRoom = io.sockets.adapter.rooms.get(targetId);
      const isTargetOnline = (targetRoom && targetRoom.size > 0) || targetDevice?.status === "ONLINE";
      if (isTargetOnline) {
        socket.emit("message", {
          id: Math.random().toString(36).substring(7),
          type: "DEVICE_CONNECTED",
          timestamp: new Date().toISOString(),
          sourceDeviceId: targetId,
          targetDeviceId: deviceId,
        } as RealtimeMessage);
      }
    }

    // Handle incoming messages
    socket.on("message", async (rawMsg: any) => {
      // 1. Validate structure
      const validation = validateRealtimeMessage(rawMsg);
      if (!validation.valid) {
        socket.emit("message", {
          id: Math.random().toString(36).substring(7),
          type: "ERROR",
          timestamp: new Date().toISOString(),
          sourceDeviceId: "server",
          targetDeviceId: deviceId,
          payload: { code: "INVALID_MESSAGE", error: validation.error },
        } as RealtimeMessage);
        return;
      }

      const msg: RealtimeMessage = rawMsg;

      // 2. Prevent sender spoofing: sourceDeviceId must match authenticated socket
      msg.sourceDeviceId = deviceId;

      // 3. Heartbeat handling
      if (msg.type === "HEARTBEAT") {
        await prisma.device.update({
          where: { id: deviceId },
          data: { lastSeenAt: new Date(), status: "ONLINE" },
        });

        socket.emit("message", {
          id: Math.random().toString(36).substring(7),
          type: "PONG",
          timestamp: new Date().toISOString(),
          sourceDeviceId: "server",
          targetDeviceId: deviceId,
        } as RealtimeMessage);

        // Also inform target if specified
        if (msg.targetDeviceId && msg.targetDeviceId !== "server") {
          io.to(msg.targetDeviceId).emit("message", msg);
        }
        return;
      }

      // 4. Verify authorization against active DeviceConnection
      const activeConn = await prisma.deviceConnection.findFirst({
        where: {
          userId,
          status: "ACTIVE",
          OR: [
            { mobileDeviceId: deviceId, desktopDeviceId: msg.targetDeviceId },
            { desktopDeviceId: deviceId, mobileDeviceId: msg.targetDeviceId },
          ],
        },
      });

      if (!activeConn) {
        console.warn(`[Socket] Unauthorized message attempt from ${deviceId} to ${msg.targetDeviceId}`);
        socket.emit("message", {
          id: Math.random().toString(36).substring(7),
          type: "ERROR",
          timestamp: new Date().toISOString(),
          sourceDeviceId: "server",
          targetDeviceId: deviceId,
          payload: {
            code: "UNAUTHORIZED_TARGET",
            message: "No active connection exists between these devices",
          },
        } as RealtimeMessage);
        return;
      }

      // 5. Handle TASK_SYNC for reconnect recovery
      if (msg.type === "TASK_SYNC") {
        try {
          const tasks = await prisma.task.findMany({
            where: {
              userId,
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
            take: 25,
          });

          socket.emit("message", {
            id: Math.random().toString(36).substring(7),
            type: "TASK_SYNC_RESPONSE",
            timestamp: new Date().toISOString(),
            sourceDeviceId: "server",
            targetDeviceId: deviceId,
            payload: { tasks },
          } as RealtimeMessage);
          return;
        } catch (e) {
          console.error("[Socket] Failed to sync tasks:", e);
        }
      }

      // 6. Task creation persistence
      if (msg.type === "TASK_CREATED") {
        try {
          const task = await prisma.task.create({
            data: {
              userId,
              desktopDeviceId: msg.targetDeviceId,
              createdByDeviceId: deviceId,
              inputText: msg.payload?.text || "",
              status: "RECEIVED",
            },
          });

          await prisma.taskEvent.create({
            data: {
              taskId: task.id,
              eventType: "TASK_CREATED",
              sourceDeviceId: deviceId,
              payload: JSON.stringify(msg.payload || {}),
            },
          });

          msg.payload = { ...msg.payload, taskId: task.id };
        } catch (e) {
          console.error("[Socket] Failed to persist task:", e);
        }
      } else if (msg.payload?.taskId && (msg.type.startsWith("TASK_") || msg.type === "AGENT_ACTIVITY")) {
        // Persist all subsequent task events and update state machine transitions
        const taskId = msg.payload.taskId;
        try {
          let newStatus: string | undefined;
          if (msg.type === "TASK_RECEIVED") newStatus = "RECEIVED";
          else if (msg.type === "TASK_PLANNING") newStatus = "PLANNING";
          else if (msg.type === "TASK_PROPOSAL_READY") newStatus = "PLANNING";
          else if (msg.type === "TASK_APPROVAL_REQUEST") newStatus = "WAITING_FOR_APPROVAL";
          else if (msg.type === "TASK_APPROVAL_RESPONSE") newStatus = msg.payload.approved ? "APPROVED" : "CANCELLED";
          else if (msg.type === "TASK_PROGRESS" && msg.payload.status) newStatus = msg.payload.status;
          else if (msg.type === "TASK_VERIFYING") newStatus = "VERIFYING";
          else if (msg.type === "TASK_COMPLETED") newStatus = "COMPLETED";
          else if (msg.type === "TASK_FAILED") newStatus = "FAILED";
          else if (msg.type === "TASK_CANCEL" || msg.type === "TASK_CANCELLED") newStatus = "CANCELLED";

          if (newStatus) {
            await prisma.task.update({
              where: { id: taskId },
              data: { status: newStatus },
            });
          }

          await prisma.taskEvent.create({
            data: {
              taskId,
              eventType: msg.type,
              sourceDeviceId: deviceId,
              payload: JSON.stringify(msg.payload || {}),
            },
          });
        } catch (e) {
          console.error(`[Socket] Failed to persist task event for ${taskId}:`, e);
        }
      }

      // 7. Deliver securely to authorized target device room
      io.to(msg.targetDeviceId).emit("message", msg);
    });

    // Handle disconnect
    socket.on("disconnect", async (reason) => {
      console.log(`[Socket] Client disconnected: ${deviceId} (${reason})`);

      await prisma.device.update({
        where: { id: deviceId },
        data: { status: "OFFLINE", lastSeenAt: new Date() },
      });

      const activeConns = await prisma.deviceConnection.findMany({
        where: {
          userId,
          status: "ACTIVE",
          OR: [{ mobileDeviceId: deviceId }, { desktopDeviceId: deviceId }],
        },
      });

      for (const conn of activeConns) {
        const targetId = conn.mobileDeviceId === deviceId ? conn.desktopDeviceId : conn.mobileDeviceId;
        io.to(targetId).emit("message", {
          id: Math.random().toString(36).substring(7),
          type: "DEVICE_DISCONNECTED",
          timestamp: new Date().toISOString(),
          sourceDeviceId: deviceId,
          targetDeviceId: targetId,
        } as RealtimeMessage);
      }
    });
  });

  // Background heartbeat reaper to detect offline devices
  setInterval(async () => {
    try {
      const thirtySecondsAgo = new Date(Date.now() - 30000);
      const staleDevices = await prisma.device.findMany({
        where: {
          status: "ONLINE",
          lastSeenAt: { lt: thirtySecondsAgo },
        },
      });

      for (const dev of staleDevices) {
        await prisma.device.update({
          where: { id: dev.id },
          data: { status: "OFFLINE" },
        });

        // Notify paired devices
        const conns = await prisma.deviceConnection.findMany({
          where: {
            status: "ACTIVE",
            OR: [{ mobileDeviceId: dev.id }, { desktopDeviceId: dev.id }],
          },
        });

        for (const conn of conns) {
          const targetId = conn.mobileDeviceId === dev.id ? conn.desktopDeviceId : conn.mobileDeviceId;
          io.to(targetId).emit("message", {
            id: Math.random().toString(36).substring(7),
            type: "DEVICE_DISCONNECTED",
            timestamp: new Date().toISOString(),
            sourceDeviceId: dev.id,
            targetDeviceId: targetId,
          } as RealtimeMessage);
        }
      }
    } catch (e) {
      // ignore
    }
  }, 15000);

  server.once("error", (err) => {
    console.error(err);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
