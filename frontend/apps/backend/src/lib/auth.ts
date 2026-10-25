import crypto from "crypto";
import prisma from "@/lib/prisma";

export function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export async function verifyDeviceCredentials(deviceId: string, deviceSecret: string) {
  if (!deviceId || !deviceSecret) return null;
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
  });
  if (!device || !device.deviceSecretHash) return null;

  const secretHash = hashSecret(deviceSecret);
  const secretBuf = Buffer.from(secretHash);
  const storedBuf = Buffer.from(device.deviceSecretHash);

  if (secretBuf.length === storedBuf.length && crypto.timingSafeEqual(secretBuf, storedBuf)) {
    return device;
  }
  return null;
}

export function getCorsHeaders(req?: Request) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
    : ["http://localhost:3000", "http://localhost:3001", "http://localhost:8081"];

  let origin = allowedOrigins[0];
  if (req) {
    const reqOrigin = req.headers.get("origin");
    if (reqOrigin && (allowedOrigins.includes(reqOrigin) || allowedOrigins.includes("*"))) {
      origin = reqOrigin;
    }
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}
