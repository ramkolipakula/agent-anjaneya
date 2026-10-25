import prisma from "../src/lib/prisma";

async function main() {
  console.log("=== DB STATUS CHECK ===");
  const users = await prisma.user.findMany();
  console.log("Users:", users);

  const devices = await prisma.device.findMany();
  console.log("Devices:", devices.map(d => ({
    id: d.id,
    name: d.deviceName,
    type: d.deviceType,
    status: d.status,
    lastSeenAt: d.lastSeenAt,
  })));

  const sessions = await prisma.pairingSession.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  console.log("Pairing Sessions:", sessions.map(s => ({
    id: s.id,
    desktopDeviceId: s.desktopDeviceId,
    pinCode: s.pinCode,
    status: s.status,
    expiresAt: s.expiresAt,
    usedAt: s.usedAt,
  })));

  const connections = await prisma.deviceConnection.findMany({
    include: {
      mobileDevice: true,
      desktopDevice: true,
    },
  });
  console.log("Device Connections:", connections.map(c => ({
    id: c.id,
    mobile: `${c.mobileDevice.deviceName} (${c.mobileDeviceId}) [${c.mobileDevice.status}]`,
    desktop: `${c.desktopDevice.deviceName} (${c.desktopDeviceId}) [${c.desktopDevice.status}]`,
    status: c.status,
  })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
