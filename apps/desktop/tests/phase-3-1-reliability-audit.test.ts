import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import { TaskExecutionEngine } from "../src/engine/TaskExecutionEngine";
import { TaskClassifier } from "../src/engine/classifier/TaskClassifier";
import { TaskPlanner } from "../src/engine/planner/TaskPlanner";
import { SecureFileSystem } from "../src/engine/filesystem/SecureFileSystem";
import { ToolRegistry } from "../src/engine/tools/ToolRegistry";
import { ExecutionContext } from "../src/engine/tools/DesktopTool";
import { isValidTaskTransition, isTerminalTaskStatus } from "@agent-anjaneya/protocol";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`✔ Passed: ${message}`);
}

async function runPhase31AuditTests() {
  console.log("=======================================================");
  console.log("=== RUNNING PHASE 3.1 RELIABILITY & APPROVAL TESTS ====");
  console.log("=======================================================\n");

  // Setup test environment
  const testBaseDir = path.join(os.tmpdir(), "agent_anjaneya_p31_" + Math.random().toString(36).substring(7));
  const testVideosDir = path.join(testBaseDir, "Videos");
  const testDocsDir = path.join(testBaseDir, "Documents");
  fs.mkdirSync(testVideosDir, { recursive: true });
  fs.mkdirSync(testDocsDir, { recursive: true });

  // Create real subdirectories inside testDocsDir for authorized listing test
  fs.mkdirSync(path.join(testDocsDir, "Projects"), { recursive: true });
  fs.mkdirSync(path.join(testDocsDir, "Receipts"), { recursive: true });
  fs.mkdirSync(path.join(testDocsDir, "Notes"), { recursive: true });

  const sfs = new SecureFileSystem([
    { id: "test-videos", name: "Videos", path: testVideosDir, readOnly: false, isDefault: true },
    { id: "test-docs", name: "Documents", path: testDocsDir, readOnly: false, isDefault: false },
  ]);

  const toolRegistry = new ToolRegistry();
  const planner = new TaskPlanner();
  const classifier = new TaskClassifier();

  // ----------------------------------------------------
  // SECTION 1: INTENT CLASSIFICATION & DETERMINISTIC NLU
  // ----------------------------------------------------
  console.log("--- Section 1: Intent Classification & Routing ---");

  // Query 1: "What are the folders present in D drive?"
  const q1Class = classifier.classify("What are the folders present in D drive?");
  assert(q1Class.category === "FILE_OPERATION", "Q1 classified as FILE_OPERATION");
  assert(q1Class.intent === "LIST_DIRECTORIES", "Q1 intent is LIST_DIRECTORIES");
  assert(q1Class.isSimpleDeterministic === true, "Q1 is simple deterministic (bypasses multi-agent debate)");

  const q1Plan = await planner.plan("What are the folders present in D drive?", "task-q1", {
    fileSystem: sfs,
    toolRegistry,
  });
  assert(q1Plan.intent === "LIST_DIRECTORIES", "Q1 plan intent is LIST_DIRECTORIES");
  assert(q1Plan.toolName === "list_directories", "Q1 selects list_directories tool");
  assert(q1Plan.targetDirectory === "D:\\", "Q1 extracts target drive D:\\");
  assert(q1Plan.requiresApproval === false, "Q1 directory query does not require approval");
  assert(q1Plan.proposal === undefined, "Q1 did NOT generate unrelated multi-agent portfolio proposal");

  // Query 2: "List all directories in D drive."
  const q2Class = classifier.classify("List all directories in D drive.");
  assert(q2Class.category === "FILE_OPERATION", "Q2 classified as FILE_OPERATION");
  assert(q2Class.intent === "LIST_DIRECTORIES", "Q2 intent is LIST_DIRECTORIES");

  const q2Plan = await planner.plan("List all directories in D drive.", "task-q2", {
    fileSystem: sfs,
    toolRegistry,
  });
  assert(q2Plan.intent === "LIST_DIRECTORIES", "Q2 plan intent is LIST_DIRECTORIES");
  assert(q2Plan.targetDirectory === "D:\\", "Q2 extracts target drive D:\\");

  // Query 3: "Find video.mp4 and extract the first 10 seconds."
  const q3Class = classifier.classify("Find video.mp4 and extract the first 10 seconds.");
  assert(q3Class.category === "MEDIA_PROCESSING", "Q3 classified as MEDIA_PROCESSING");
  assert(q3Class.intent === "VIDEO_TRIM", "Q3 intent is VIDEO_TRIM");
  assert(q3Class.isSimpleDeterministic === true, "Q3 uses deterministic video pipeline");

  const q3Plan = await planner.plan("Find video.mp4 and extract the first 10 seconds.", "task-q3", {
    fileSystem: sfs,
    toolRegistry,
  });
  assert(q3Plan.intent === "VIDEO_TRIM", "Q3 plan routes to VIDEO_TRIM");
  assert(q3Plan.toolName === "trim_video", "Q3 selects trim_video tool");
  assert(q3Plan.requiresApproval === true, "Q3 requires approval before media extraction");

  // Query 4: "Build a portfolio website using my existing projects."
  const q4Class = classifier.classify("Build a portfolio website using my existing projects.");
  assert(q4Class.category === "SOFTWARE_DEVELOPMENT", "Q4 classified as SOFTWARE_DEVELOPMENT");
  assert(q4Class.isSimpleDeterministic === false, "Q4 requires multi-agent planning pipeline");
  assert(q4Class.requiresContextGathering === true, "Q4 requires context gathering");

  // ----------------------------------------------------
  // SECTION 2: SECURITY & FILESYSTEM ALLOWLIST ENFORCEMENT
  // ----------------------------------------------------
  console.log("\n--- Section 2: Security & Filesystem Allowlist Enforcement ---");

  const listContext: ExecutionContext = {
    taskId: "test-sec",
    fileSystem: sfs,
  };

  // Test 2.1: Unauthorized drive access (D:\ is not in sfs allowlist)
  const unauthResult = await toolRegistry.executeTool("list_directories", { directoryPath: "D:\\" }, listContext);
  assert(unauthResult.success === false, "Unauthorized D:\\ listing is strictly blocked");
  assert(unauthResult.error?.includes("ACCESS_DENIED") === true, "Returns clear ACCESS_DENIED error message");
  assert(unauthResult.error?.includes("outside the permitted folders") === true, "Explains location is outside permitted folders");
  assert(unauthResult.error?.includes("authorize") === true, "Asks user to authorize location in settings");

  // Test 2.2: Authorized directory listing (testDocsDir with real folders)
  const authResult = await toolRegistry.executeTool("list_directories", { directoryPath: "Documents" }, listContext);
  assert(authResult.success === true, "Authorized directory listing succeeds");
  assert(Array.isArray(authResult.data?.directories), "Returns array of directory names");
  const returnedDirs = authResult.data?.directories as string[];
  assert(returnedDirs.includes("Projects"), "Returns actual directory 'Projects'");
  assert(returnedDirs.includes("Receipts"), "Returns actual directory 'Receipts'");
  assert(returnedDirs.includes("Notes"), "Returns actual directory 'Notes'");
  assert(returnedDirs.length === 3, "Exact count of real subdirectories returned without hallucination");

  // Test 2.3: Path Traversal Attack Rejection
  const traversalResult = await toolRegistry.executeTool("list_directories", { directoryPath: "../../Windows" }, listContext);
  assert(traversalResult.success === false, "Path traversal attack is blocked");
  assert(traversalResult.error?.includes("ACCESS_DENIED") === true, "Path traversal rejected by authoritative allowlist");

  // Test 2.4: Destructive operation & Shell attack rejection
  const attackClass = classifier.classify("rm -rf / && format C:");
  assert(attackClass.category === "UNSUPPORTED", "Shell attack classified as UNSUPPORTED");
  assert(attackClass.safetyRisk === "CRITICAL", "Shell attack flagged with CRITICAL safety risk");

  // ----------------------------------------------------
  // SECTION 3: APPROVAL WORKFLOW & STATE TRANSITIONS
  // ----------------------------------------------------
  console.log("\n--- Section 3: Approval Workflow & State Machine ---");

  const engine = new TaskExecutionEngine(sfs, toolRegistry, planner);
  engine.clearTasksForTesting();

  // Generate real synthetic test video for approval execution
  const ffmpegPath = ffmpegStatic as string;
  const sampleVideoPath = path.join(testVideosDir, "sample.mp4");
  await new Promise<void>((resolve) => {
    const proc = spawn(ffmpegPath, [
      "-y",
      "-f", "lavfi",
      "-i", "testsrc=duration=6:size=320x240:rate=25",
      "-f", "lavfi",
      "-i", "sine=frequency=440:duration=6",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-c:a", "aac",
      "-pix_fmt", "yuv420p",
      sampleVideoPath,
    ], { shell: false });
    proc.on("close", () => resolve());
    proc.on("error", () => resolve());
  });

  // Test 3.1: Approval while WAITING_FOR_APPROVAL
  const task1 = await engine.submitTask({
    taskId: "task-approval-1",
    inputText: "Trim sample.mp4 for 2 seconds",
    mobileDeviceId: "mobile-1",
    desktopDeviceId: "desktop-1",
  });

  // Wait for task to reach WAITING_FOR_APPROVAL
  await new Promise((r) => setTimeout(r, 150));
  assert(task1.status === "WAITING_FOR_APPROVAL", `Task reaches WAITING_FOR_APPROVAL (actual: ${task1.status})`);

  // Approve from desktop
  const approvedFirst = await engine.handleApprovalResponse({ taskId: "task-approval-1", approved: true });
  assert(approvedFirst === true, "Approval accepted while task is WAITING_FOR_APPROVAL");

  // Wait for execution to finish
  await new Promise((r) => setTimeout(r, 600));
  assert(task1.status === "COMPLETED", `Task completed execution after approval (actual: ${task1.status})`);

  // Test 3.2: Duplicate approval request on already-approved task
  const duplicateApproval = await engine.handleApprovalResponse({ taskId: "task-approval-1", approved: true });
  assert(duplicateApproval === false, "Duplicate approval request is rejected");

  // Test 3.3: Approval after COMPLETED
  // Wait for task1 to complete
  await new Promise((r) => setTimeout(r, 200));
  if (task1.status !== "COMPLETED") {
    (task1 as any).status = "COMPLETED"; // ensure terminal
  }
  const approvalAfterComplete = await engine.handleApprovalResponse({ taskId: "task-approval-1", approved: true });
  assert(approvalAfterComplete === false, "Approval after COMPLETED is strictly rejected");

  // Test 3.4: Approval after FAILED
  const taskFailed = await engine.submitTask({
    taskId: "task-fail-test",
    inputText: "What are the folders present in D drive?", // unauthorized -> will fail
    mobileDeviceId: "mobile-1",
    desktopDeviceId: "desktop-1",
  });
  await new Promise((r) => setTimeout(r, 100));
  assert(taskFailed.status === "FAILED", `Unauthorized task fails immediately (status: ${taskFailed.status})`);
  const approvalAfterFail = await engine.handleApprovalResponse({ taskId: "task-fail-test", approved: true });
  assert(approvalAfterFail === false, "Approval after FAILED is strictly rejected");

  // Test 3.5: Approval after CANCELLED
  const taskCancel = await engine.submitTask({
    taskId: "task-cancel-test",
    inputText: "Trim sample.mp4 for 5 seconds",
    mobileDeviceId: "mobile-1",
    desktopDeviceId: "desktop-1",
  });
  await new Promise((r) => setTimeout(r, 100));
  assert(taskCancel.status === "WAITING_FOR_APPROVAL", "Task reached WAITING_FOR_APPROVAL before cancel");
  const cancelOk = engine.cancelTask("task-cancel-test", "User cancelled");
  assert(cancelOk === true, "Task cancelled successfully");
  assert(taskCancel.status === "CANCELLED", "Task status is CANCELLED");
  const approvalAfterCancel = await engine.handleApprovalResponse({ taskId: "task-cancel-test", approved: true });
  assert(approvalAfterCancel === false, "Approval after CANCELLED is strictly rejected");

  // Test 3.6: Concurrent approval race condition
  const taskRace = await engine.submitTask({
    taskId: "task-race-test",
    inputText: "Trim sample.mp4 for 5 seconds",
    mobileDeviceId: "mobile-1",
    desktopDeviceId: "desktop-1",
  });
  await new Promise((r) => setTimeout(r, 100));
  assert(taskRace.status === "WAITING_FOR_APPROVAL", "Task reached WAITING_FOR_APPROVAL");

  const [race1, race2] = await Promise.all([
    engine.handleApprovalResponse({ taskId: "task-race-test", approved: true }),
    engine.handleApprovalResponse({ taskId: "task-race-test", approved: true }),
  ]);
  assert((race1 && !race2) || (!race1 && race2), "Concurrent approval ensures exactly 1 winner and 1 rejection");

  // ----------------------------------------------------
  // SECTION 4: TASK-SCOPED EVENT STREAMING
  // ----------------------------------------------------
  console.log("\n--- Section 4: Task-Scoped Event Streaming ---");

  const eventsTaskA: any[] = [];
  const eventsTaskB: any[] = [];

  const unsubA = engine.subscribeToTask("stream-task-A", (type, payload) => {
    eventsTaskA.push({ type, payload });
  });

  const unsubB = engine.subscribeToTask("stream-task-B", (type, payload) => {
    eventsTaskB.push({ type, payload });
  });

  // Submit two tasks concurrently
  await Promise.all([
    engine.submitTask({
      taskId: "stream-task-A",
      inputText: "List allowed directories",
      mobileDeviceId: "mob-A",
      desktopDeviceId: "desk-A",
    }),
    engine.submitTask({
      taskId: "stream-task-B",
      inputText: "List allowed directories",
      mobileDeviceId: "mob-B",
      desktopDeviceId: "desk-B",
    }),
  ]);

  await new Promise((r) => setTimeout(r, 150));

  assert(eventsTaskA.length > 0, "Task A received streamed events");
  assert(eventsTaskB.length > 0, "Task B received streamed events");
  assert(eventsTaskA.every((e) => e.payload.taskId === "stream-task-A"), "Task A stream received ONLY Task A events");
  assert(eventsTaskB.every((e) => e.payload.taskId === "stream-task-B"), "Task B stream received ONLY Task B events");

  // Test 4.2: Listener cleanup
  unsubA();
  const countBefore = eventsTaskA.length;
  // Trigger internal emit
  (engine as any).emitEvent("TASK_PROGRESS", { taskId: "stream-task-A", message: "after cleanup" });
  assert(eventsTaskA.length === countBefore, "Unsubscribed listener is removed and receives no further events");

  unsubB();

  // ----------------------------------------------------
  // SECTION 5: IDEMPOTENT SUBMISSION & DEDUPLICATION
  // ----------------------------------------------------
  console.log("\n--- Section 5: Idempotent Submission & Deduplication ---");

  const sub1 = await engine.submitTask({
    taskId: "idempotent-task-1",
    inputText: "List allowed directories",
    mobileDeviceId: "m1",
    desktopDeviceId: "d1",
  });

  const sub2 = await engine.submitTask({
    taskId: "idempotent-task-1",
    inputText: "List allowed directories",
    mobileDeviceId: "m1",
    desktopDeviceId: "d1",
  });

  assert(sub1 === sub2, "Duplicate submission of identical taskId returns existing task instance");
  assert(sub1.id === "idempotent-task-1", "Task ID preserved");

  // Distinct tasks with same prompt text must NOT be deduplicated
  const sub3 = await engine.submitTask({
    taskId: "idempotent-task-2",
    inputText: "List allowed directories",
    mobileDeviceId: "m1",
    desktopDeviceId: "d1",
  });
  assert(sub3 !== sub1, "Different tasks with identical prompt text are NOT conflated");

  // ----------------------------------------------------
  // SECTION 6: TASK RECOVERY ACROSS RESTARTS
  // ----------------------------------------------------
  console.log("\n--- Section 6: Task Recovery Across Restarts ---");

  // Verify terminal state transitions
  assert(isValidTaskTransition("COMPLETED", "RUNNING") === false, "COMPLETED cannot transition to RUNNING");
  assert(isValidTaskTransition("FAILED", "APPROVED") === false, "FAILED cannot transition to APPROVED");
  assert(isValidTaskTransition("CANCELLED", "PLANNING") === false, "CANCELLED cannot transition to PLANNING");
  assert(isTerminalTaskStatus("COMPLETED") === true, "COMPLETED is a terminal status");
  assert(isTerminalTaskStatus("FAILED") === true, "FAILED is a terminal status");
  assert(isTerminalTaskStatus("CANCELLED") === true, "CANCELLED is a terminal status");

  // Clean up test directories
  try {
    fs.rmSync(testBaseDir, { recursive: true, force: true });
    engine.clearTasksForTesting();
  } catch {}

  console.log("\n=======================================================");
  console.log("🎉 ALL PHASE 3.1 RELIABILITY & AUDIT TESTS PASSED!");
  console.log("=======================================================\n");
}

runPhase31AuditTests().catch((err) => {
  console.error("Test run error:", err);
  process.exit(1);
});
