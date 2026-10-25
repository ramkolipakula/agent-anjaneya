import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { SecureFileSystem } from "../src/engine/filesystem/SecureFileSystem";
import { ToolRegistry } from "../src/engine/tools/ToolRegistry";
import { TaskPlanner } from "../src/engine/planner/TaskPlanner";
import { TaskExecutionEngine } from "../src/engine/TaskExecutionEngine";
import { getFFmpegExecutable, probeVideoDuration } from "../src/engine/tools/TrimVideoTool";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✔ Passed: ${message}`);
}

async function generateTestVideo(ffmpegPath: string, outputPath: string, durationSeconds = 15): Promise<boolean> {
  return new Promise((resolve) => {
    // Generate a safe 15s color bar video with sine audio
    const args = [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc=duration=${durationSeconds}:size=320x240:rate=25`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${durationSeconds}`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      "-pix_fmt",
      "yuv420p",
      outputPath,
    ];

    const proc = spawn(ffmpegPath, args, { shell: false });
    proc.on("close", (code) => {
      resolve(code === 0 && fs.existsSync(outputPath));
    });
    proc.on("error", (err) => {
      console.error("FFmpeg test video generation error:", err);
      resolve(false);
    });
  });
}

async function runEndToEndTaskTest() {
  console.log("\n=======================================================");
  console.log("=== RUNNING PHASE 2 FULL END-TO-END EXECUTION TEST ====");
  console.log("=======================================================\n");

  const ffmpegPath = getFFmpegExecutable();
  console.log(`Using FFmpeg at: ${ffmpegPath}`);
  assert(fs.existsSync(ffmpegPath) || ffmpegPath === "ffmpeg", "FFmpeg executable is available");

  // 1. Setup isolated test Videos folder
  const testWorkspace = path.join(os.tmpdir(), "agent_anjaneya_e2e_" + Math.random().toString(36).substring(7));
  const testVideosDir = path.join(testWorkspace, "Videos");
  fs.mkdirSync(testVideosDir, { recursive: true });

  const sourceVideoPath = path.join(testVideosDir, "video.mp4");
  console.log(`\nGenerating real 15s test video at: ${sourceVideoPath}...`);
  const generated = await generateTestVideo(ffmpegPath, sourceVideoPath, 15);
  assert(generated, "Real 15-second synthetic test video created on disk");

  const sourceDuration = await probeVideoDuration(ffmpegPath, sourceVideoPath);
  console.log(`Source video duration: ${sourceDuration?.toFixed(2)} seconds`);
  assert(sourceDuration !== null && Math.abs(sourceDuration - 15) < 1.0, "Source video duration confirmed to be ~15 seconds");

  // 2. Initialize Engine with Allowed Videos Folder
  const sfs = new SecureFileSystem([
    { id: "e2e-videos", name: "Videos", path: testVideosDir, readOnly: false, isDefault: true },
  ]);
  const registry = new ToolRegistry();
  const planner = new TaskPlanner();
  const engine = new TaskExecutionEngine(sfs, registry, planner);

  // 3. Setup Phone Event Listener to capture real events
  const capturedEvents: { type: string; payload: any; timestamp: number }[] = [];
  engine.setEventCallback((type, payload) => {
    capturedEvents.push({ type, payload, timestamp: Date.now() });
    console.log(`[PHONE EVENT] << ${type}:`, payload?.message || payload?.title || payload?.summary || payload);
  });

  // 4. PHONE sends command: "Find video.mp4 in my Videos folder and extract the first 10 seconds."
  console.log("\n--- Step 1: PHONE issues natural-language command ---");
  const taskId = "e2e-task-" + Date.now();
  const mobileSentAt = new Date().toISOString();

  await engine.submitTask({
    taskId,
    inputText: "Find video.mp4 in my Videos folder and extract the first 10 seconds.",
    mobileDeviceId: "phone-ram-01",
    desktopDeviceId: "pc-ram-01",
    mobileSentAt,
  });

  // 5. Wait for engine to discover file and reach WAITING_FOR_APPROVAL
  console.log("\n--- Step 2: DESKTOP discovers file and requests approval ---");
  let tries = 0;
  while (tries < 40) {
    const task = engine.getTask(taskId);
    if (task && task.status === "WAITING_FOR_APPROVAL") break;
    await new Promise((r) => setTimeout(r, 100));
    tries++;
  }

  const taskAtApproval = engine.getTask(taskId);
  assert(taskAtApproval?.status === "WAITING_FOR_APPROVAL", "Task transitioned to WAITING_FOR_APPROVAL");

  const approvalEvent = capturedEvents.find((e) => e.type === "TASK_APPROVAL_REQUEST");
  assert(!!approvalEvent, "PHONE received TASK_APPROVAL_REQUEST event");
  assert(approvalEvent?.payload?.requiresApproval === true, "requiresApproval flag is set");
  assert(approvalEvent?.payload?.sourceFile === "video.mp4", "Target sourceFile is video.mp4");

  // Verify file discovery event occurred
  const foundEvent = capturedEvents.find(
    (e) => e.type === "TASK_PROGRESS" && (e.payload?.step === "FOUND" || e.payload?.message?.includes("Found"))
  );
  assert(!!foundEvent, "DESKTOP reported 'Found video.mp4.' to phone");

  // 6. PHONE displays approval request -> USER Approves
  console.log("\n--- Step 3: USER approves task on PHONE ---");
  const approvedSuccess = await engine.handleApprovalResponse({
    taskId,
    approved: true,
  });
  assert(approvedSuccess, "Engine accepted user approval response");

  // 7. Wait for video processing, verification, and completion
  console.log("\n--- Step 4: DESKTOP executes FFmpeg, verifies, and notifies completion ---");
  let completionTries = 0;
  while (completionTries < 60) {
    const task = engine.getTask(taskId);
    if (task && (task.status === "COMPLETED" || task.status === "FAILED")) break;
    await new Promise((r) => setTimeout(r, 200));
    completionTries++;
  }

  const completedTask = engine.getTask(taskId);
  assert(completedTask?.status === "COMPLETED", "Task successfully reached terminal state COMPLETED");

  const completedEvent = capturedEvents.find((e) => e.type === "TASK_COMPLETED");
  assert(!!completedEvent, "PHONE received TASK_COMPLETED event notification");

  // 8. Confirm output file actually exists on disk and verify duration
  console.log("\n--- Step 5: Verification of physical output file ---");
  const outputPath = completedEvent?.payload?.outputPath;
  assert(!!outputPath, `Output path returned: ${outputPath}`);
  assert(fs.existsSync(outputPath), `Output file actually exists on disk at ${outputPath}`);

  const outputStats = fs.statSync(outputPath);
  assert(outputStats.size > 1024, `Output file has non-trivial size: ${outputStats.size} bytes`);

  const outputDuration = await probeVideoDuration(ffmpegPath, outputPath);
  console.log(`Measured output video duration: ${outputDuration?.toFixed(2)} seconds`);
  assert(outputDuration !== null, "Output video is valid media with readable duration");
  assert(Math.abs(outputDuration! - 10) < 1.5, `Output duration is ~10s (actual: ${outputDuration?.toFixed(2)}s)`);

  // 9. Verify real latency measurements
  console.log("\n--- Step 6: Verify Latency Metrics ---");
  const metrics = completedEvent?.payload?.latencyMetrics;
  assert(!!metrics, "Latency metrics included in completion payload");
  console.log("Measured Latency Metrics:", {
    planningDurationMs: `${metrics?.planningDurationMs}ms`,
    approvalWaitMs: `${metrics?.approvalWaitMs}ms`,
    executionDurationMs: `${metrics?.executionDurationMs}ms`,
    verificationDurationMs: `${metrics?.verificationDurationMs}ms`,
    totalRoundTripMs: `${metrics?.totalRoundTripMs}ms`,
  });
  assert(typeof metrics?.executionDurationMs === "number" && metrics.executionDurationMs > 0, "Real execution duration measured");
  assert(typeof metrics?.totalRoundTripMs === "number" && metrics.totalRoundTripMs > 0, "Real total round-trip measured");

  // Clean up test workspace
  try {
    fs.rmSync(testWorkspace, { recursive: true, force: true });
  } catch (e) {}

  console.log("\n=======================================================");
  console.log("🎉 ALL END-TO-END EXECUTION TESTS PASSED SUCCESSFULLY!");
  console.log("=======================================================\n");
}

runEndToEndTaskTest().catch((e) => {
  console.error("End-to-end test error:", e);
  process.exit(1);
});
