import { PrismaClient } from "@prisma/client";
import {
  isValidTaskTransition,
  canCancelTask,
  isTerminalTaskStatus,
  TaskStatus,
} from "@agent-anjaneya/protocol";

const prisma = new PrismaClient();

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✔ Passed: ${message}`);
}

async function runTaskLifecycleSecurityTests() {
  console.log("\n=======================================================");
  console.log("=== RUNNING PHASE 2 TASK LIFECYCLE & PERSISTENCE TESTS ===");
  console.log("=======================================================\n");

  // Setup Base Test User and Devices
  let user = await prisma.user.findFirst({ where: { email: "test-phase2@example.com" } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: "test-phase2@example.com",
      },
    });
  }

  const desktopDev = await prisma.device.create({
    data: {
      userId: user.id,
      deviceName: "Test-Desktop-PC",
      deviceType: "DESKTOP",
      platform: "win32",
      appVersion: "1.0.0",
      deviceSecretHash: "dummyhash-desktop",
      status: "ONLINE",
    },
  });

  const mobileDev = await prisma.device.create({
    data: {
      userId: user.id,
      deviceName: "Test-Mobile-Phone",
      deviceType: "MOBILE",
      platform: "android",
      appVersion: "1.0.0",
      deviceSecretHash: "dummyhash-mobile",
      status: "ONLINE",
    },
  });

  const connection = await prisma.deviceConnection.create({
    data: {
      userId: user.id,
      mobileDeviceId: mobileDev.id,
      desktopDeviceId: desktopDev.id,
      status: "ACTIVE",
    },
  });

  console.log("--- Test 1: Task Creation and Persistence ---");
  const task = await prisma.task.create({
    data: {
      userId: user.id,
      desktopDeviceId: desktopDev.id,
      createdByDeviceId: mobileDev.id,
      inputText: "Find video.mp4 and extract the first 10 seconds",
      status: "RECEIVED",
    },
  });

  assert(!!task.id, "Task successfully created with unique ID");
  assert(task.status === "RECEIVED", "Initial task status is RECEIVED");
  assert(task.desktopDeviceId === desktopDev.id, "Task correctly bound to target desktop device");
  assert(task.createdByDeviceId === mobileDev.id, "Task correctly bound to mobile creator");

  console.log("\n--- Test 2: Task Event Audit Trail Persistence ---");
  const event1 = await prisma.taskEvent.create({
    data: {
      taskId: task.id,
      eventType: "TASK_CREATED",
      sourceDeviceId: mobileDev.id,
      payload: JSON.stringify({ text: task.inputText }),
    },
  });

  const event2 = await prisma.taskEvent.create({
    data: {
      taskId: task.id,
      eventType: "TASK_PLANNING",
      sourceDeviceId: desktopDev.id,
      payload: JSON.stringify({ intent: "VIDEO_TRIM" }),
    },
  });

  const events = await prisma.taskEvent.findMany({
    where: { taskId: task.id },
    orderBy: { createdAt: "asc" },
  });

  assert(events.length === 2, "Task events properly recorded in SQLite database");
  assert(events[0].eventType === "TASK_CREATED", "Event 1 is TASK_CREATED");
  assert(events[1].eventType === "TASK_PLANNING", "Event 2 is TASK_PLANNING");

  console.log("\n--- Test 3: Task State Machine Transitions (Valid vs Invalid) ---");
  // Valid transitions
  assert(isValidTaskTransition("CREATED", "RECEIVED"), "CREATED -> RECEIVED is valid");
  assert(isValidTaskTransition("RECEIVED", "PLANNING"), "RECEIVED -> PLANNING is valid");
  assert(isValidTaskTransition("PLANNING", "WAITING_FOR_APPROVAL"), "PLANNING -> WAITING_FOR_APPROVAL is valid");
  assert(isValidTaskTransition("WAITING_FOR_APPROVAL", "APPROVED"), "WAITING_FOR_APPROVAL -> APPROVED is valid");
  assert(isValidTaskTransition("APPROVED", "RUNNING"), "APPROVED -> RUNNING is valid");
  assert(isValidTaskTransition("RUNNING", "VERIFYING"), "RUNNING -> VERIFYING is valid");
  assert(isValidTaskTransition("VERIFYING", "COMPLETED"), "VERIFYING -> COMPLETED is valid");

  // Invalid transitions (Strictly rejected)
  assert(!isValidTaskTransition("COMPLETED", "RUNNING"), "COMPLETED -> RUNNING is strictly rejected (terminal state)");
  assert(!isValidTaskTransition("FAILED", "APPROVED"), "FAILED -> APPROVED is strictly rejected (terminal state)");
  assert(!isValidTaskTransition("CANCELLED", "PLANNING"), "CANCELLED -> PLANNING is strictly rejected (terminal state)");
  assert(!isValidTaskTransition("RECEIVED", "COMPLETED"), "RECEIVED -> COMPLETED is strictly rejected (cannot bypass execution)");
  assert(!isValidTaskTransition("PLANNING", "VERIFYING"), "PLANNING -> VERIFYING is strictly rejected (cannot bypass execution)");

  console.log("\n--- Test 4: Task Cancellation Rules ---");
  assert(canCancelTask("PLANNING"), "Active task in PLANNING can be cancelled");
  assert(canCancelTask("WAITING_FOR_APPROVAL"), "Task in WAITING_FOR_APPROVAL can be cancelled");
  assert(canCancelTask("RUNNING"), "Task in RUNNING can be cancelled");
  assert(!canCancelTask("COMPLETED"), "Finished task in COMPLETED cannot be cancelled");
  assert(!canCancelTask("FAILED"), "Failed task in FAILED cannot be cancelled");
  assert(isTerminalTaskStatus("COMPLETED"), "COMPLETED is a terminal status");
  assert(isTerminalTaskStatus("FAILED"), "FAILED is a terminal status");
  assert(isTerminalTaskStatus("CANCELLED"), "CANCELLED is a terminal status");

  console.log("\n--- Test 5: Reconnect Recovery & Task Synchronization ---");
  // Update task to WAITING_FOR_APPROVAL
  await prisma.task.update({
    where: { id: task.id },
    data: { status: "WAITING_FOR_APPROVAL" },
  });

  await prisma.taskEvent.create({
    data: {
      taskId: task.id,
      eventType: "TASK_APPROVAL_REQUEST",
      sourceDeviceId: desktopDev.id,
      payload: JSON.stringify({ requiresApproval: true }),
    },
  });

  // Query tasks on device reconnection (simulating TASK_SYNC)
  const syncTasks = await prisma.task.findMany({
    where: {
      userId: user.id,
      OR: [
        { desktopDeviceId: desktopDev.id },
        { createdByDeviceId: mobileDev.id },
      ],
    },
    include: {
      events: {
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  assert(syncTasks.length >= 1, "Reconnect recovery queries active and past tasks");
  const recoveredTask = syncTasks.find((t) => t.id === task.id);
  assert(!!recoveredTask, "Target task successfully recovered across disconnect");
  assert(recoveredTask?.status === "WAITING_FOR_APPROVAL", "Task status preserved as WAITING_FOR_APPROVAL");
  assert(recoveredTask?.events.length === 3, "All 3 task events preserved across reconnection");

  // Cleanup test entities
  await prisma.taskEvent.deleteMany({ where: { taskId: task.id } });
  await prisma.task.delete({ where: { id: task.id } });
  await prisma.deviceConnection.delete({ where: { id: connection.id } });
  await prisma.device.deleteMany({ where: { id: { in: [desktopDev.id, mobileDev.id] } } });
  await prisma.user.delete({ where: { id: user.id } });

  console.log("\n=======================================================");
  console.log("🎉 ALL TASK LIFECYCLE & PERSISTENCE TESTS PASSED!");
  console.log("=======================================================\n");
}

runTaskLifecycleSecurityTests()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
