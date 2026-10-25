import fs from "fs";
import path from "path";
import os from "os";
import { z } from "zod";
import {
  agentAnalysisSchema,
  candidatePlanSchema,
  critiqueSchema,
  finalProposalSchema,
  taskClassificationSchema,
} from "@agent-anjaneya/protocol";
import { TaskClassifier } from "../src/engine/classifier/TaskClassifier";
import { ContextAggregator } from "../src/engine/context/ContextAggregator";
import { FilesystemContextProvider } from "../src/engine/context/FilesystemContextProvider";
import { ProjectContextProvider } from "../src/engine/context/ProjectContextProvider";
import { TaskHistoryProvider } from "../src/engine/context/TaskHistoryProvider";
import { UserPreferencesProvider } from "../src/engine/context/UserPreferencesProvider";
import { SecureFileSystem } from "../src/engine/filesystem/SecureFileSystem";
import { RuleBasedIntelligenceProvider } from "../src/engine/providers/RuleBasedIntelligenceProvider";
import { FallbackAIProvider } from "../src/engine/providers/FallbackAIProvider";
import { AIModelProvider, ProviderOptions, ProviderResult } from "../src/engine/providers/AIModelProvider";
import { TaskAnalystAgent } from "../src/engine/agents/TaskAnalystAgent";
import { PlannerAgent } from "../src/engine/agents/PlannerAgent";
import { TechnicalSpecialistAgent } from "../src/engine/agents/TechnicalSpecialistAgent";
import { CriticAgent } from "../src/engine/agents/CriticAgent";
import { JudgeAgent } from "../src/engine/agents/JudgeAgent";
import { MultiAgentOrchestrator } from "../src/engine/orchestrator/MultiAgentOrchestrator";
import { ToolRegistry } from "../src/engine/tools/ToolRegistry";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✔ Passed: ${message}`);
}

class FailingMockProvider implements AIModelProvider {
  public readonly id = "failing-mock";
  public readonly name = "Failing Mock Provider";
  public readonly defaultModel = "fail-1";

  public async generateStructured<T>(): Promise<ProviderResult<T>> {
    throw new Error("MOCK_NETWORK_TIMEOUT: Connection to AI model timed out after 3000ms");
  }
}

async function runMultiAgentUnitTests() {
  console.log("\n=======================================================");
  console.log("=== RUNNING PHASE 3 MULTI-AGENT INTELLIGENCE TESTS ====");
  console.log("=======================================================\n");

  const testTempDir = path.join(os.tmpdir(), "agent_phase3_test_" + Math.random().toString(36).substring(7));
  fs.mkdirSync(testTempDir, { recursive: true });

  const allowedProjectsDir = path.join(testTempDir, "Projects");
  const allowedVideosDir = path.join(testTempDir, "Videos");
  fs.mkdirSync(allowedProjectsDir, { recursive: true });
  fs.mkdirSync(allowedVideosDir, { recursive: true });

  // Create mock project inside allowed folder
  const sampleProjectDir = path.join(allowedProjectsDir, "web-app");
  fs.mkdirSync(sampleProjectDir, { recursive: true });
  fs.writeFileSync(
    path.join(sampleProjectDir, "package.json"),
    JSON.stringify({ name: "my-web-app", dependencies: { next: "14.0.0", react: "18.2.0" } }),
    "utf-8"
  );

  const sfs = new SecureFileSystem([
    { id: "dir-proj", name: "Projects", path: allowedProjectsDir, readOnly: false, isDefault: true },
    { id: "dir-vid", name: "Videos", path: allowedVideosDir, readOnly: false },
  ]);

  const toolRegistry = new ToolRegistry();
  const ruleProvider = new RuleBasedIntelligenceProvider();

  // ----------------------------------------------------
  // Test 1: Task Classification
  // ----------------------------------------------------
  console.log("--- Test 1: Task Classification System ---");
  const classifier = new TaskClassifier();

  const c1 = classifier.classify("Trim the first 10 seconds of video.mp4");
  assert(c1.category === "MEDIA_PROCESSING", "Classified as MEDIA_PROCESSING");
  assert(c1.isSimpleDeterministic === true, "Marked as simple deterministic (bypass candidate)");
  assert(c1.requiresApproval === true, "Requires approval for media output");

  const c2 = classifier.classify("Build a portfolio website using my existing projects");
  assert(c2.category === "SOFTWARE_DEVELOPMENT", "Classified as SOFTWARE_DEVELOPMENT");
  assert(c2.isSimpleDeterministic === false, "Complex dev task requires multi-agent debate");
  assert(c2.requiresContextGathering === true, "Requires context gathering");

  const c3 = classifier.classify("Delete everything from my Documents folder");
  assert(c3.category === "UNSUPPORTED", "Broad destructive operation classified as UNSUPPORTED");
  assert(c3.safetyRisk === "CRITICAL", "Flagged with CRITICAL safety risk");

  const c4 = classifier.classify("List allowed directories");
  assert(c4.category === "FILE_OPERATION", "Classified as FILE_OPERATION");
  assert(c4.requiresApproval === false, "Read-only list does not require approval");

  // ----------------------------------------------------
  // Test 2: Structured Output Schemas (Zod Validation)
  // ----------------------------------------------------
  console.log("\n--- Test 2: Structured Output Validation ---");
  const analyst = new TaskAnalystAgent(ruleProvider);
  const aRes = await analyst.analyze("Build a portfolio website using my existing projects", "task-t2");
  assert(aRes.data.role === "TASK_ANALYST", "AgentAnalysis returned correct role");
  assert(typeof aRes.data.objective === "string", "Objective extracted as string");
  assert(Array.isArray(aRes.data.extractedConstraints), "Constraints extracted as array");
  assert(agentAnalysisSchema.safeParse(aRes.data).success, "AgentAnalysis validated with Zod schema");

  const planner = new PlannerAgent(ruleProvider);
  const dummyContext = { results: {}, summaries: ["Found my-web-app project in Projects"], totalLatencyMs: 5, providerLatencies: {} };
  const pPlans = await planner.generateCandidatePlans(
    "Build a portfolio website",
    aRes.data,
    dummyContext,
    ["inspect_project", "scaffold_project", "build_project", "verify_output"]
  );
  assert(pPlans.length >= 2, "Planner generated multiple candidate plans (Plan A and Plan B)");
  assert(candidatePlanSchema.safeParse(pPlans[0].data).success, "Plan A validated with candidatePlanSchema");
  assert(candidatePlanSchema.safeParse(pPlans[1].data).success, "Plan B validated with candidatePlanSchema");

  const specialist = new TechnicalSpecialistAgent(ruleProvider);
  const specRes = await specialist.reviewTechnicalFeasibility(
    "Build portfolio",
    aRes.data,
    dummyContext,
    ["inspect_project", "scaffold_project", "build_project"]
  );
  assert(specRes.data.role === "TECHNICAL_SPECIALIST", "TechnicalSpecialist returned correct role");
  assert(specRes.data.compatibleTools.includes("inspect_project"), "Specialist identified compatible tools");

  const critic = new CriticAgent(ruleProvider);
  const critRes = await critic.evaluatePlans(pPlans.map((p) => p.data), aRes.data, dummyContext);
  assert(critRes.data.role === "CRITIC", "Critic returned correct role");
  assert(critiqueSchema.safeParse(critRes.data).success, "Critique validated with critiqueSchema");

  const judge = new JudgeAgent(ruleProvider);
  const jRes = await judge.judgeAndSynthesize(
    "task-t2",
    aRes.data,
    pPlans.map((p) => p.data),
    specRes.data,
    critRes.data,
    dummyContext
  );
  assert(finalProposalSchema.safeParse(jRes.data).success, "FinalProposal validated with finalProposalSchema");
  assert(jRes.data.steps.length > 0, "Final proposal contains structured execution steps");

  // ----------------------------------------------------
  // Test 3: Context Intelligence & Permission Control
  // ----------------------------------------------------
  console.log("\n--- Test 3: Context Intelligence & Permissions ---");
  const agg = new ContextAggregator([
    new FilesystemContextProvider(),
    new ProjectContextProvider(),
    new TaskHistoryProvider(),
    new UserPreferencesProvider(),
  ]);

  const ctx = await agg.gatherContext({ taskId: "t3", query: "Build portfolio from projects" }, sfs);
  assert(ctx.summaries.length > 0, "Aggregated context returned summaries");
  assert(ctx.results["existingProjects"] !== undefined, "ProjectContextProvider discovered project");
  assert(
    ctx.results["existingProjects"][0]?.name === "my-web-app",
    "Found sample project name 'my-web-app' inside allowed folder"
  );

  // Verify that context provider does NOT read .env even if present in allowed dir
  fs.writeFileSync(path.join(allowedProjectsDir, ".env"), "SECRET_API_KEY=leak", "utf-8");
  const valSecret = sfs.validatePath(path.join(allowedProjectsDir, ".env"), "read");
  assert(!valSecret.allowed, "Context layer strictly forbidden from reading .env files");

  // ----------------------------------------------------
  // Test 4: Provider Fallback on Failure
  // ----------------------------------------------------
  console.log("\n--- Test 4: Provider Fallback Mechanism ---");
  const failingProvider = new FailingMockProvider();
  const fallbackProvider = new FallbackAIProvider([failingProvider, ruleProvider]);

  const fallbackRes = await fallbackProvider.generateStructured(
    "ROLE: TASK_ANALYST\nObjective: Test fallback",
    agentAnalysisSchema
  );
  assert(fallbackRes.data.role === "TASK_ANALYST", "Fallback provider seamlessly rescued execution on primary failure");
  assert(fallbackRes.providerId === "rule-based", "Result originates from healthy secondary fallback provider");

  // ----------------------------------------------------
  // Test 5: Parallel Orchestrator & Bounded Debate Limits
  // ----------------------------------------------------
  console.log("\n--- Test 5: Parallel Orchestrator & Debate Limits ---");
  const activityEvents: string[] = [];
  const orchestrator = new MultiAgentOrchestrator(ruleProvider, agg, {
    maxDebateRounds: 2,
    maxAgentCalls: 10,
    maxExecutionTimeMs: 5000,
  });

  orchestrator.setActivityCallback((act) => {
    activityEvents.push(`[${act.stage}] ${act.summary}`);
  });

  const orchResult = await orchestrator.plan({
    taskId: "task-orch-1",
    inputText: "Build a portfolio website using my existing projects",
    fileSystem: sfs,
    toolRegistry,
  });

  assert(orchResult.proposal !== undefined, "MultiAgentOrchestrator produced a final proposal");
  assert(orchResult.proposal?.steps.length === 4, "Proposal contains 4 verified steps");
  assert(orchResult.latencyMetrics.totalPlanningMs > 0, "Measured total planning latency");
  assert(orchResult.latencyMetrics.debateRounds <= 2, "Debate bounded by maxDebateRounds (<= 2)");
  assert(activityEvents.some((e) => e.includes("ANALYZING")), "Activity emitted ANALYZING stage");
  assert(activityEvents.some((e) => e.includes("PLANNING")), "Activity emitted PLANNING stage");
  assert(activityEvents.some((e) => e.includes("CRITIQUING")), "Activity emitted CRITIQUING stage");
  assert(activityEvents.some((e) => e.includes("EVALUATING")), "Activity emitted EVALUATING stage");
  assert(activityEvents.some((e) => e.includes("PROPOSAL_READY")), "Activity emitted PROPOSAL_READY stage");

  // ----------------------------------------------------
  // Test 6: Cancellation Propagation (AbortSignal)
  // ----------------------------------------------------
  console.log("\n--- Test 6: Cancellation Propagation ---");
  const abortController = new AbortController();
  abortController.abort(); // already aborted

  let wasCancelled = false;
  try {
    await orchestrator.plan({
      taskId: "task-abort",
      inputText: "Build a portfolio website using my existing projects",
      fileSystem: sfs,
      toolRegistry,
      signal: abortController.signal,
    });
  } catch (err: any) {
    if (err.message.includes("OPERATION_CANCELLED") || err.message.includes("aborted")) {
      wasCancelled = true;
    }
  }
  assert(wasCancelled, "AbortSignal immediately terminates agent execution pipeline");

  // ----------------------------------------------------
  // Test 7: Critic Detection of Security Issue
  // ----------------------------------------------------
  console.log("\n--- Test 7: Critic Security Detection & Judge Rejection ---");
  const criticSecurityRes = await critic.evaluatePlans(
    [
      {
        planId: "plan-unsafe",
        title: "Delete All Files",
        objective: "Wipe user folder",
        steps: [{ stepId: "1", tool: "delete_everything", description: "Delete all files", dependencies: [], risk: "CRITICAL" }],
        estimatedComplexity: "HIGH",
        requiresApproval: false,
        expectedOutputs: [],
        rationale: "Unsafe",
      },
    ],
    aRes.data,
    dummyContext
  );

  assert(criticSecurityRes.data.overallVerdict === "REJECTED_UNSAFE", "Critic flagged plan as REJECTED_UNSAFE");
  assert(
    criticSecurityRes.data.issues.some((i) => i.severity === "CRITICAL"),
    "Critic flagged CRITICAL security risk"
  );

  const judgeSecurityRes = await judge.judgeAndSynthesize(
    "task-unsafe",
    aRes.data,
    [],
    specRes.data,
    criticSecurityRes.data,
    dummyContext
  );
  assert(judgeSecurityRes.data.status === "REJECTED", "Judge rejected plan due to Critic security finding");

  console.log("\n=======================================================");
  console.log("🎉 ALL PHASE 3 MULTI-AGENT UNIT TESTS PASSED!");
  console.log("=======================================================\n");
}

runMultiAgentUnitTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
