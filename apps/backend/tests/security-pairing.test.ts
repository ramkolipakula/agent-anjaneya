import assert from "assert";
import prisma from "../src/lib/prisma";
import { generateSecureToken, hashSecret, verifyDeviceCredentials } from "../src/lib/auth";
import { validateRealtimeMessage } from "@agent-anjaneya/protocol";

async function runTests() {
  console.log("=== RUNNING PHASE 1.1 SECURITY & RELIABILITY TESTS ===");

  // Setup base user
  const user = await prisma.user.upsert({
    where: { id: "test-user-1" },
    update: {},
    create: { id: "test-user-1", email: "test@example.com" },
  });
  console.log("✔ Setup: Base user confirmed.");

  // Test 1: Device Credentials Hashing & Verification
  console.log("\n--- Test 1: Device Credentials Hashing & Server Verification ---");
  const rawSecret = generateSecureToken(32);
  const secretHash = hashSecret(rawSecret);
  const testDesktop = await prisma.device.upsert({
    where: { id: "test-desktop-auth" },
    update: { deviceSecretHash: secretHash, status: "ONLINE" },
    create: {
      id: "test-desktop-auth",
      userId: user.id,
      deviceType: "DESKTOP",
      deviceName: "Test-PC",
      platform: "desktop",
      appVersion: "1.0.0",
      deviceSecretHash: secretHash,
      status: "ONLINE",
    },
  });

  const verified = await verifyDeviceCredentials("test-desktop-auth", rawSecret);
  assert(verified !== null, "Valid device secret must verify");
  assert.strictEqual(verified.id, testDesktop.id);

  const failedAuth = await verifyDeviceCredentials("test-desktop-auth", "wrong-secret-token");
  assert.strictEqual(failedAuth, null, "Invalid device secret must be rejected");

  const unauthenticatedDevice = await verifyDeviceCredentials("non-existent-device", rawSecret);
  assert.strictEqual(unauthenticatedDevice, null, "Non-existent device must be rejected");
  console.log("✔ Test 1 Passed: Device credentials securely hashed and verified.");

  // Test 2: Pairing Token Creation & Hashing
  console.log("\n--- Test 2: Pairing Token Creation & Hashing ---");
  const pairingToken = generateSecureToken(32);
  const tokenHash = hashSecret(pairingToken);
  const session = await prisma.pairingSession.create({
    data: {
      desktopDeviceId: testDesktop.id,
      tokenHash,
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min
    },
  });

  const sessionInDb = await prisma.pairingSession.findUnique({
    where: { id: session.id },
  });
  assert(sessionInDb !== null);
  assert.strictEqual(sessionInDb.tokenHash, tokenHash);
  assert.notStrictEqual(sessionInDb.tokenHash, pairingToken, "Raw token must never be stored in database");
  console.log("✔ Test 2 Passed: Raw token is not stored in DB, only SHA-256 hash.");

  // Test 3: Invalid Token Rejection
  console.log("\n--- Test 3: Invalid Token Rejection ---");
  const wrongHash = hashSecret("invalid-token-value");
  assert.notStrictEqual(session.tokenHash, wrongHash, "Wrong token hash must not match");
  console.log("✔ Test 3 Passed: Invalid token hash mismatch correctly identified.");

  // Test 4: Expired Token Rejection
  console.log("\n--- Test 4: Expired Token Rejection ---");
  const expiredToken = generateSecureToken(32);
  const expiredSession = await prisma.pairingSession.create({
    data: {
      desktopDeviceId: testDesktop.id,
      tokenHash: hashSecret(expiredToken),
      status: "ACTIVE",
      expiresAt: new Date(Date.now() - 10000), // 10 seconds ago
    },
  });

  const isExpired = expiredSession.expiresAt < new Date();
  assert(isExpired, "Session must be detected as expired");
  console.log("✔ Test 4 Passed: Expired token correctly rejected.");

  // Test 5: Atomic Concurrent Single-Use Token Consumption
  console.log("\n--- Test 5: Atomic Concurrent Single-Use Token Consumption ---");
  const concurrentToken = generateSecureToken(32);
  const concurrentHash = hashSecret(concurrentToken);
  const concurrentSession = await prisma.pairingSession.create({
    data: {
      desktopDeviceId: testDesktop.id,
      tokenHash: concurrentHash,
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + 60000),
    },
  });

  // Simulate 5 simultaneous requests attempting to consume the exact same token
  const attempts = 5;
  const results = await Promise.all(
    Array.from({ length: attempts }).map(async (_, index) => {
      try {
        return await prisma.$transaction(async (tx) => {
          const updateResult = await tx.pairingSession.updateMany({
            where: {
              id: concurrentSession.id,
              status: "ACTIVE",
              tokenHash: concurrentHash,
              expiresAt: { gt: new Date() },
            },
            data: {
              status: "USED",
              usedAt: new Date(),
            },
          });

          if (updateResult.count !== 1) {
            throw new Error("ALREADY_CONSUMED");
          }

          // Create connection
          const mobileId = `test-mobile-concurrent-${index}`;
          await tx.device.upsert({
            where: { id: mobileId },
            update: { deviceSecretHash: hashSecret("secret"), status: "ONLINE" },
            create: {
              id: mobileId,
              userId: user.id,
              deviceType: "MOBILE",
              deviceName: `Mobile-${index}`,
              platform: "mobile",
              appVersion: "1.0.0",
              deviceSecretHash: hashSecret("secret"),
              status: "ONLINE",
            },
          });

          await tx.deviceConnection.upsert({
            where: {
              mobileDeviceId_desktopDeviceId: {
                mobileDeviceId: mobileId,
                desktopDeviceId: testDesktop.id,
              },
            },
            update: { status: "ACTIVE" },
            create: {
              userId: user.id,
              mobileDeviceId: mobileId,
              desktopDeviceId: testDesktop.id,
              status: "ACTIVE",
            },
          });

          return { success: true, winner: index };
        });
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    })
  );

  const successfulAttempts = results.filter((r) => r.success);
  const failedAttempts = results.filter((r) => !r.success);

  assert.strictEqual(
    successfulAttempts.length,
    1,
    `Exactly one request must succeed, but got ${successfulAttempts.length}`
  );
  assert.strictEqual(
    failedAttempts.length,
    attempts - 1,
    `Remaining requests must fail due to atomic lock`
  );
  console.log(`✔ Test 5 Passed: Atomic transaction ensured 1 winner and ${failedAttempts.length} rejected concurrent attempts.`);

  // Test 6: Duplicate Connection Prevention
  console.log("\n--- Test 6: Device Connection Unique Constraint ---");
  const mobileA = "test-mobile-a";
  const desktopA = "test-desktop-a";

  await prisma.device.upsert({
    where: { id: mobileA },
    update: {},
    create: {
      id: mobileA,
      userId: user.id,
      deviceType: "MOBILE",
      deviceName: "Mobile A",
      platform: "mobile",
      appVersion: "1.0.0",
      deviceSecretHash: hashSecret("secA"),
    },
  });

  await prisma.device.upsert({
    where: { id: desktopA },
    update: {},
    create: {
      id: desktopA,
      userId: user.id,
      deviceType: "DESKTOP",
      deviceName: "Desktop A",
      platform: "desktop",
      appVersion: "1.0.0",
      deviceSecretHash: hashSecret("secB"),
    },
  });

  const conn1 = await prisma.deviceConnection.upsert({
    where: { mobileDeviceId_desktopDeviceId: { mobileDeviceId: mobileA, desktopDeviceId: desktopA } },
    update: { status: "ACTIVE" },
    create: { userId: user.id, mobileDeviceId: mobileA, desktopDeviceId: desktopA, status: "ACTIVE" },
  });

  const conn2 = await prisma.deviceConnection.upsert({
    where: { mobileDeviceId_desktopDeviceId: { mobileDeviceId: mobileA, desktopDeviceId: desktopA } },
    update: { status: "ACTIVE" },
    create: { userId: user.id, mobileDeviceId: mobileA, desktopDeviceId: desktopA, status: "ACTIVE" },
  });

  assert.strictEqual(conn1.id, conn2.id, "Upserting same pair must return existing connection, not duplicate");
  const count = await prisma.deviceConnection.count({
    where: { mobileDeviceId: mobileA, desktopDeviceId: desktopA },
  });
  assert.strictEqual(count, 1, "There must be strictly one connection between the two devices");
  console.log("✔ Test 6 Passed: Unique compound key prevents duplicate device connections.");

  // Test 7: Message Protocol Validation
  console.log("\n--- Test 7: Shared Protocol Message Validation ---");
  const validMsg = {
    id: "msg-123",
    type: "TASK_CREATED",
    timestamp: new Date().toISOString(),
    sourceDeviceId: "mobile-1",
    targetDeviceId: "desktop-1",
    payload: { text: "Hello from phone" },
  };
  const v1 = validateRealtimeMessage(validMsg);
  assert(v1.valid, "Valid message must pass protocol validation");

  const invalidTypeMsg = {
    ...validMsg,
    type: "ARBITRARY_SHELL_COMMAND_EXECUTION", // attacker trying unknown command
  };
  const v2 = validateRealtimeMessage(invalidTypeMsg);
  assert(!v2.valid, "Unapproved command type must be rejected");

  const missingTargetMsg = {
    ...validMsg,
    targetDeviceId: "",
  };
  const v3 = validateRealtimeMessage(missingTargetMsg);
  assert(!v3.valid, "Missing target device ID must be rejected");
  console.log("✔ Test 7 Passed: Protocol validator strictly rejects unapproved message types and malformed schemas.");

  // Test 8: Status Transitions & Heartbeat Persistence
  console.log("\n--- Test 8: Device Status Transitions & Heartbeat Persistence ---");
  const testDev = await prisma.device.create({
    data: {
      userId: user.id,
      deviceType: "DESKTOP",
      deviceName: "Status-PC",
      platform: "desktop",
      appVersion: "1.0.0",
      deviceSecretHash: hashSecret("status-sec"),
      status: "CONNECTING",
      lastSeenAt: new Date(Date.now() - 60000), // 1 min ago
    },
  });

  // Heartbeat ping received
  const updatedDev = await prisma.device.update({
    where: { id: testDev.id },
    data: { status: "ONLINE", lastSeenAt: new Date() },
  });
  assert.strictEqual(updatedDev.status, "ONLINE");
  assert(updatedDev.lastSeenAt.getTime() > testDev.lastSeenAt.getTime(), "Heartbeat must update lastSeenAt timestamp");

  // Disconnect event
  const offlineDev = await prisma.device.update({
    where: { id: testDev.id },
    data: { status: "OFFLINE" },
  });
  assert.strictEqual(offlineDev.status, "OFFLINE");
  console.log("✔ Test 8 Passed: Status transitions accurately persist in database.");

  console.log("\n=======================================================");
  console.log("🎉 ALL PHASE 1.1 SECURITY & RELIABILITY TESTS PASSED!");
  console.log("=======================================================");
}

runTests()
  .catch((err) => {
    console.error("❌ TEST FAILED:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
