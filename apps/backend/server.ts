import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { Server } from "socket.io";
import { DeviceType, DeviceStatus, MessageType, RealtimeMessage } from "@agent-anjaneya/protocol";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3000", 10);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

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
      origin: "*", // allow mobile and desktop
    },
  });

  const deviceSockets = new Map<string, string>(); // deviceId -> socketId

  io.on("connection", (socket) => {
    console.log("Client connected", socket.id);
    let currentDeviceId: string | null = null;

    socket.on("register", (data: { deviceId: string }) => {
      currentDeviceId = data.deviceId;
      deviceSockets.set(currentDeviceId, socket.id);
      console.log(`Device ${currentDeviceId} registered`);
      
      socket.broadcast.emit("message", {
        id: Math.random().toString(36).substring(7),
        type: "DEVICE_CONNECTED",
        timestamp: new Date().toISOString(),
        sourceDeviceId: currentDeviceId,
        targetDeviceId: "*",
      } as RealtimeMessage);
    });

    socket.on("message", (msg: RealtimeMessage) => {
      console.log("Received message:", msg.type, "from", msg.sourceDeviceId, "to", msg.targetDeviceId);
      
      if (msg.targetDeviceId === "*") {
        socket.broadcast.emit("message", msg);
      } else {
        const targetSocketId = deviceSockets.get(msg.targetDeviceId);
        if (targetSocketId) {
          io.to(targetSocketId).emit("message", msg);
        } else {
          console.warn("Target device not found:", msg.targetDeviceId);
        }
      }
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected", socket.id);
      if (currentDeviceId) {
        deviceSockets.delete(currentDeviceId);
        
        io.emit("message", {
          id: Math.random().toString(36).substring(7),
          type: "DEVICE_DISCONNECTED",
          timestamp: new Date().toISOString(),
          sourceDeviceId: currentDeviceId,
          targetDeviceId: "*",
        } as RealtimeMessage);
      }
    });
  });

  server.once("error", (err) => {
    console.error(err);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
