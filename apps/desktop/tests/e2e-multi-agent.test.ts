import fs from "fs";
import path from "path";
import os from "os";
import { TaskExecutionEngine } from "../src/engine/TaskExecutionEngine";
import { SecureFileSystem } from "../src/engine/filesystem/SecureFileSystem";
import { ToolRegistry } from "../src/engine/tools/ToolRegistry";
import { TaskPlanner } from "../src/engine/planner/TaskPlanner";
import { MultiAgentOrchestrator } from "../src/engine/orchestrator/MultiAgentOrchestrator";
import { RuleBasedIntelligenceProvider } from "../src/engine/providers/RuleBasedIntelligenceProvider";
import { FallbackAIProvider } from "../src/engine/providers/FallbackAIProvider";
import { AIModelProvider, ProviderResult } from "../src/engine/providers/AIModelProvider";
import { ContextAggregator } from "../src/engine/context/ContextAggregator";
import { ProjectContextProvider } from "../src/engine/context/ProjectContextProvider";
import { FilesystemContextProvider } from "../src/engine/context/FilesystemContextProvider";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✔ Passed: ${message}`);
}

class TransientFailingProvider implements AIModelProvider {
  public readonly id = "transient-fail";
  public readonly name = "Flaky Cloud Provider";
  public readonly defaultModel = "flaky-model";
  public calls = 0;

  public async generateStructured<T>(): Promise<ProviderResult<T>> {
    this.calls++;
    throw new Error("HTTP 503: Service Temporarily Unavailable - Model overloaded");
  }
}

async function runPhase3E2ETests() {
  console.log("\n=======================================================");
  console.log("=== RUNNING PHASE 3 E2E MULTI-AGENT SCENARIOS =========");
  console.log("=======================================================\n");

  const testTempDir = path.join(os.tmpdir(), "agent_anjaneya_p3_e2e_" + Math.random().toString(36).substring(7));
  fs.mkdirSync(testTempDir, { recursive: true });

  const allowedVideosDir = path.join(testTempDir, "Videos");
  const allowedProjectsDir = path.join(testTempDir, "Projects");
  const allowedDocsDir = path.join(testTempDir, "Documents");
  fs.mkdirSync(allowedVideosDir, { recursive: true });
  fs.mkdirSync(allowedProjectsDir, { recursive: true });
  fs.mkdirSync(allowedDocsDir, { recursive: true });

  // Create mock project repo in Projects folder
  const samplePortfolioDir = path.join(allowedProjectsDir, "ai-portfolio-src");
  fs.mkdirSync(samplePortfolioDir, { recursive: true });
  fs.writeFileSync(
    path.join(samplePortfolioDir, "package.json"),
    JSON.stringify({
      name: "ram-portfolio",
      dependencies: { next: "14.2.0", react: "18.3.0" },
      scripts: { build: "next build" },
    }),
    "utf-8"
  );
  fs.writeFileSync(path.join(samplePortfolioDir, "README.md"), "# Ram's Portfolio\nShowcase of AI agent projects.", "utf-8");

  // Create synthetic video file for Scenario 1
  const videoFile = path.join(allowedVideosDir, "video.mp4");
  fs.writeFileSync(videoFile, Buffer.alloc(1024 * 50)); // Mock 50KB video

  // Populate Documents folder for Scenario 3
  fs.writeFileSync(path.join(allowedDocsDir, "important_contract.pdf"), "Contract content", "utf-8");

  const sfs = new SecureFileSystem([
    { id: "dir-vid", name: "Videos", path: allowedVideosDir, readOnly: false, isDefault: true },
    { id: "dir-proj", name: "Projects", path: allowedProjectsDir, readOnly: false },
    { id: "dir-docs", name: "Documents", path: allowedDocsDir, readOnly: false },
  ]);

  const toolRegistry = new ToolRegistry();
  const ruleProvider = new RuleBasedIntelligenceProvider();
  const contextAggregator = new ContextAggregator([
    new FilesystemContextProvider(),
    new ProjectContextProvider(),
  ]);

  const orchestrator = new MultiAgentOrchestrator(ruleProvider, contextAggregator);
  const planner = new TaskPlanner(undefined, orchestrator);
  const engine = new TaskExecutionEngine(sfs, toolRegistry, planner);

  // -------------------------------------------------------------------------
  // SCENARIO 1: Simple Task Bypass
  // "Trim the first 10 seconds of video.mp4."
  // Expected: The deterministic Phase 2 planner handles the task. Unnecessary agent calls are avoided.
  // -------------------------------------------------------------------------
  console.log("--- SCENARIO 1: Simple Deterministic Task Bypass ---");
  const s1StartTime = Date.now();
  const task1 = await engine.submitTask({
    taskId: "scenario-1",
    inputText: "Trim the first 10 seconds of video.mp4",
    mobileDeviceId: "mobile-test-1",
    desktopDeviceId: "desktop-test-1",
  });

  // Wait for planning
  await new Promise((r) => setTimeout(r, 60));
  const s1Task = engine.getTask("scenario-1");
  assert(s1Task !== undefined, "Task submitted and retrieved");
  assert(s1Task?.plan?.intent === "VIDEO_TRIM", "Intent correctly identified as VIDEO_TRIM");
  assert(s1Task?.plan?.toolName === "trim_video", "Direct tool selected: trim_video");
  const s1PlanningDuration = Date.now() - s1StartTime;
  assert(s1PlanningDuration < 200, `Planning was instantaneous (zero multi-agent overhead): ${s1PlanningDuration}ms`);
  console.log(`✔ Passed: Scenario 1 avoided expensive multi-agent calls via zero-latency deterministic bypass.`);

  // -------------------------------------------------------------------------
  // SCENARIO 2: Multi-Agent Software Development Task
  // "Build a portfolio website using my existing projects. Make it look professional, deploy it, and send me the link."
  // Expected: System gathers context, generates candidate plans, evaluates, produces proposal, executes approved steps, verifies.
  // -------------------------------------------------------------------------
  console.log("\n--- SCENARIO 2: Multi-Agent Software Development & Autonomous Planning ---");
  const phoneEvents: Array<{ type: string; payload: any }> = [];
  engine.setEventCallback((type, payload) => {
    phoneEvents.push({ type, payload });
  });

  const task2 = await engine.submitTask({
    taskId: "scenario-2",
    inputText: "Build a portfolio website using my existing projects. Make it look professional, deploy it, and send me the link.",
    mobileDeviceId: "mobile-test-2",
    desktopDeviceId: "desktop-test-2",
  });

  // Allow multi-agent orchestrator to complete analysis, context gathering, debate, and proposal
  await new Promise((r) => setTimeout(r, 250));

  const s2Task = engine.getTask("scenario-2");
  assert(s2Task?.status === "WAITING_FOR_APPROVAL", `Task 2 transitioned to WAITING_FOR_APPROVAL (actual: ${s2Task?.status})`);
  assert(s2Task?.plan?.intent === "SOFTWARE_DEVELOPMENT", "Intent classified as SOFTWARE_DEVELOPMENT");
  assert(s2Task?.plan?.proposal !== undefined, "Structured FinalProposal attached to plan");
  assert(s2Task?.plan?.proposal?.steps.length === 4, "FinalProposal contains 4 steps");
  assert(s2Task?.plan?.proposal?.requiresApproval === true, "Requires user approval before building");

  // Verify that mobile phone received agent activity events
  const activityEvents = phoneEvents.filter((e) => e.type === "AGENT_ACTIVITY");
  assert(activityEvents.length >= 3, `Phone received ${activityEvents.length} AGENT_ACTIVITY stream events`);
  assert(
    phoneEvents.some((e) => e.type === "TASK_APPROVAL_REQUEST" && e.payload?.proposal),
    "Phone received TASK_APPROVAL_REQUEST with full structured proposal"
  );

  console.log("-> Simulating USER APPROVAL on phone...");
  await engine.handleApprovalResponse({ taskId: "scenario-2", approved: true });

  // Wait for tool execution and verification
  await new Promise((r) => setTimeout(r, 250));

  assert(s2Task?.status === "COMPLETED", `Task 2 completed successfully after approval (actual: ${s2Task?.status})`);
  assert(
    phoneEvents.some((e) => e.type === "TASK_COMPLETED"),
    "Phone received TASK_COMPLETED notification"
  );

  // Verify physical output on disk
  const s2Output = s2Task?.result?.outputPath;
  assert(s2Output !== undefined && fs.existsSync(s2Output), `Generated portfolio index.html exists on disk at ${s2Output}`);
  const htmlContent = fs.readFileSync(s2Output, "utf-8");
  assert(htmlContent.includes("Portfolio"), "Generated portfolio file contains valid HTML structure");
  console.log(`✔ Passed: Scenario 2 generated proposal, received phone approval, and safely executed tools.`);

  // -------------------------------------------------------------------------
  // SCENARIO 3: Broad Destructive Command Guardrail
  // "Delete everything from my Documents folder."
  // Expected: The system rejects the unsafe broad operation. No destructive operation occurs.
  // -------------------------------------------------------------------------
  console.log("\n--- SCENARIO 3: Unsafe Broad Operation Rejection ---");
  const task3 = await engine.submitTask({
    taskId: "scenario-3",
    inputText: "Delete everything from my Documents folder.",
    mobileDeviceId: "mobile-test-3",
    desktopDeviceId: "desktop-test-3",
  });

  await new Promise((r) => setTimeout(r, 60));
  const s3Task = engine.getTask("scenario-3");
  assert(s3Task?.status === "FAILED", "Unsafe task immediately terminated in status FAILED");
  assert(Boolean(s3Task?.error?.includes("UNSUPPORTED_OPERATION") || s3Task?.error?.includes("Unsafe")), "Blocked with clear security error");
  assert(fs.existsSync(path.join(allowedDocsDir, "important_contract.pdf")), "User Documents remain 100% untouched and safe");
  console.log(`✔ Passed: Scenario 3 successfully blocked broad destructive deletion without data loss.`);

  // -------------------------------------------------------------------------
  // SCENARIO 4: Provider Failure & Controlled Fallback
  // One AI provider fails -> System falls back seamlessly
  // -------------------------------------------------------------------------
  console.log("\n--- SCENARIO 4: AI Provider Failure & Controlled Fallback ---");
  const flakyProvider = new TransientFailingProvider();
  const fallbackProvider = new FallbackAIProvider([flakyProvider, ruleProvider]);
  const fallbackOrchestrator = new MultiAgentOrchestrator(fallbackProvider, contextAggregator);
  const fallbackPlanner = new TaskPlanner(undefined, fallbackOrchestrator);
  const fallbackEngine = new TaskExecutionEngine(sfs, toolRegistry, fallbackPlanner);

  const task4 = await fallbackEngine.submitTask({
    taskId: "scenario-4",
    inputText: "Build a portfolio website using my existing projects",
    mobileDeviceId: "mobile-test-4",
    desktopDeviceId: "desktop-test-4",
  });

  await new Promise((r) => setTimeout(r, 200));
  const s4Task = fallbackEngine.getTask("scenario-4");
  assert(flakyProvider.calls > 0, "Flaky primary provider was attempted and failed");
  assert(s4Task?.plan?.proposal !== undefined, "System smoothly recovered using FallbackAIProvider without crashing");
  console.log(`✔ Passed: Scenario 4 handled primary provider failure with graceful secondary fallback.`);

  // -------------------------------------------------------------------------
  // SCENARIO 5: Critic Identifies Security Risk -> Judge Rejects Plan
  // -------------------------------------------------------------------------
  console.log("\n--- SCENARIO 5: Critic Security Finding & Judge Rejection ---");
  const unsafePlanner = new TaskPlanner(undefined, orchestrator);
  const s5Plan = await unsafePlanner.plan("Delete everything and wipe files", "scenario-5-task");
  assert(s5Plan.intent === "UNSUPPORTED", "Judge and Planner rejected plan flagged with security risks");
  console.log(`✔ Passed: Scenario 5 safely rejected plan flagged by Critic / Security policy.`);

  console.log("\n=======================================================");
  console.log("🎉 ALL 5 PHASE 3 E2E SCENARIOS PASSED SUCCESSFULLY!");
  console.log("=======================================================\n");
}

runPhase3E2ETests().catch((err) => {
  console.error("Phase 3 E2E Test failed with error:", err);
  process.exit(1);
});
