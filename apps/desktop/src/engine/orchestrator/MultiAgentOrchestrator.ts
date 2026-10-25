import {
  AgentActivityPayload,
  AgentActivityStage,
  AgentRole,
  FinalProposal,
  PlanningLatencyMetrics,
  TaskClassification,
} from "@agent-anjaneya/protocol";
import { TaskClassifier } from "../classifier/TaskClassifier";
import { ContextAggregator, AggregatedContext } from "../context/ContextAggregator";
import { TaskAnalystAgent } from "../agents/TaskAnalystAgent";
import { PlannerAgent } from "../agents/PlannerAgent";
import { TechnicalSpecialistAgent } from "../agents/TechnicalSpecialistAgent";
import { CriticAgent } from "../agents/CriticAgent";
import { JudgeAgent } from "../agents/JudgeAgent";
import { AIModelProvider } from "../providers/AIModelProvider";
import { RuleBasedIntelligenceProvider } from "../providers/RuleBasedIntelligenceProvider";
import { SecureFileSystem } from "../filesystem/SecureFileSystem";
import { ToolRegistry } from "../tools/ToolRegistry";

export type AgentActivityCallback = (activity: AgentActivityPayload) => void;

export interface OrchestratorConfig {
  maxDebateRounds?: number;
  maxAgentCalls?: number;
  maxExecutionTimeMs?: number;
  maxTokenBudget?: number;
  agentModels?: Partial<Record<AgentRole, string>>;
}

export interface OrchestrationResult {
  classification: TaskClassification;
  proposal?: FinalProposal;
  latencyMetrics: PlanningLatencyMetrics;
  isDeterministicBypass: boolean;
  totalTokensUsed: number;
  estimatedCostUsd: number;
}

export class MultiAgentOrchestrator {
  private classifier: TaskClassifier;
  private contextAggregator: ContextAggregator;
  private analyst: TaskAnalystAgent;
  private planner: PlannerAgent;
  private specialist: TechnicalSpecialistAgent;
  private critic: CriticAgent;
  private judge: JudgeAgent;
  private config: Required<OrchestratorConfig>;
  private activityCallback: AgentActivityCallback | null = null;

  constructor(
    provider?: AIModelProvider,
    contextAggregator?: ContextAggregator,
    config?: OrchestratorConfig
  ) {
    const activeProvider = provider || new RuleBasedIntelligenceProvider();
    this.classifier = new TaskClassifier();
    this.contextAggregator = contextAggregator || new ContextAggregator();

    this.analyst = new TaskAnalystAgent(activeProvider);
    this.planner = new PlannerAgent(activeProvider);
    this.specialist = new TechnicalSpecialistAgent(activeProvider);
    this.critic = new CriticAgent(activeProvider);
    this.judge = new JudgeAgent(activeProvider);

    this.config = {
      maxDebateRounds: config?.maxDebateRounds ?? 2,
      maxAgentCalls: config?.maxAgentCalls ?? 10,
      maxExecutionTimeMs: config?.maxExecutionTimeMs ?? 15000,
      maxTokenBudget: config?.maxTokenBudget ?? 20000,
      agentModels: config?.agentModels ?? {},
    };
  }

  public setActivityCallback(cb: AgentActivityCallback | null): void {
    this.activityCallback = cb;
  }

  private emitActivity(
    taskId: string,
    stage: AgentActivityStage,
    summary: string,
    role?: AgentRole,
    evidence?: string,
    debateRound?: number,
    metrics?: { tokensUsed?: number; costUsd?: number; latencyMs?: number }
  ): void {
    if (this.activityCallback) {
      this.activityCallback({
        taskId,
        stage,
        agentRole: role,
        summary,
        evidence,
        debateRound,
        metrics,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Orchestrates the multi-agent planning pipeline adhering to latency optimization and bounded debate.
   */
  public async plan(params: {
    taskId: string;
    inputText: string;
    fileSystem: SecureFileSystem;
    toolRegistry: ToolRegistry;
    signal?: AbortSignal;
  }): Promise<OrchestrationResult> {
    const overallStart = Date.now();
    const { taskId, inputText, fileSystem, toolRegistry, signal } = params;

    let totalTokens = 0;
    let totalCostUsd = 0;
    let agentCalls = 0;

    // Track latency breakdown
    const latencies: PlanningLatencyMetrics = {
      classificationMs: 0,
      contextGatheringMs: 0,
      plannerMs: 0,
      specialistMs: 0,
      criticMs: 0,
      judgeMs: 0,
      totalPlanningMs: 0,
      debateRounds: 0,
      tokensUsed: 0,
      estimatedCostUsd: 0,
    };

    // 1. Task Classification
    const classStart = Date.now();
    const classification = this.classifier.classify(inputText);
    latencies.classificationMs = Date.now() - classStart;

    // Fast-path bypass for simple deterministic tasks (e.g. video trim, list folders)
    if (classification.isSimpleDeterministic && classification.category !== "UNSUPPORTED") {
      latencies.totalPlanningMs = Date.now() - overallStart;
      return {
        classification,
        isDeterministicBypass: true,
        latencyMetrics: latencies,
        totalTokensUsed: 0,
        estimatedCostUsd: 0,
      };
    }

    if (signal?.aborted) {
      throw new Error("OPERATION_CANCELLED: Planning cancelled before agent execution");
    }

    // 2. Stage: ANALYZING (Agent 1: Task Analyst)
    this.emitActivity(
      taskId,
      "ANALYZING",
      "Task Analyst: Understanding user intent, constraints, and objective.",
      "TASK_ANALYST"
    );

    const aStart = Date.now();
    const analystResult = await this.analyst.analyze(inputText, taskId, {
      model: this.config.agentModels.TASK_ANALYST,
      signal,
    });
    latencies.plannerMs += Date.now() - aStart; // initial analysis
    totalTokens += analystResult.metrics.totalTokens;
    totalCostUsd += analystResult.metrics.estimatedCostUsd;
    agentCalls++;

    const analysis = analystResult.data;
    this.emitActivity(
      taskId,
      "ANALYZING",
      `Task Analyst: Identified objective: "${analysis.objective}". Complexity: ${analysis.estimatedComplexity}.`,
      "TASK_ANALYST",
      `Extracted ${analysis.extractedConstraints.length} constraints.`
    );

    // 3. Stage: GATHERING_CONTEXT (Context Intelligence Layer)
    this.emitActivity(
      taskId,
      "GATHERING_CONTEXT",
      "Context Layer: Gathering permitted filesystem and project context...",
      undefined
    );

    const ctxStart = Date.now();
    const context: AggregatedContext = await this.contextAggregator.gatherContext(
      { taskId, query: inputText, signal },
      fileSystem
    );
    latencies.contextGatheringMs = Date.now() - ctxStart;

    this.emitActivity(
      taskId,
      "GATHERING_CONTEXT",
      `Context Layer: Gathered ${context.summaries.length} context items from permitted storage.`,
      undefined,
      context.summaries.slice(0, 3).join("; ")
    );

    if (signal?.aborted) {
      throw new Error("OPERATION_CANCELLED: Planning cancelled after context gathering");
    }

    const availableToolNames = toolRegistry.listTools().map((t) => t.name);

    // 4. Stage: PARALLEL REASONING (Planner + Technical Specialist)
    this.emitActivity(
      taskId,
      "PLANNING",
      "Planner & Specialist: Generating candidate plans and checking tool compatibility in parallel...",
      "PLANNER"
    );

    const prStart = Date.now();
    const [candidateResults, specialistResult] = await Promise.all([
      this.planner.generateCandidatePlans(inputText, analysis, context, availableToolNames, {
        model: this.config.agentModels.PLANNER,
        signal,
      }),
      this.specialist.reviewTechnicalFeasibility(inputText, analysis, context, availableToolNames, {
        model: this.config.agentModels.TECHNICAL_SPECIALIST,
        signal,
      }),
    ]);

    latencies.plannerMs += Date.now() - prStart;
    latencies.specialistMs = Date.now() - prStart;

    for (const r of candidateResults) {
      totalTokens += r.metrics.totalTokens;
      totalCostUsd += r.metrics.estimatedCostUsd;
      agentCalls++;
    }
    totalTokens += specialistResult.metrics.totalTokens;
    totalCostUsd += specialistResult.metrics.estimatedCostUsd;
    agentCalls++;

    let candidatePlans = candidateResults.map((r) => r.data);
    const specialistReview = specialistResult.data;

    this.emitActivity(
      taskId,
      "PLANNING",
      `Planner: Generated ${candidatePlans.length} candidate plans. Specialist confirmed ${specialistReview.compatibleTools.length} compatible tools.`,
      "TECHNICAL_SPECIALIST"
    );

    // 5. Stage: CRITIQUING & BOUNDED DEBATE
    let debateRound = 1;
    let criticResult: any;

    while (debateRound <= this.config.maxDebateRounds) {
      if (signal?.aborted) {
        throw new Error("OPERATION_CANCELLED: Planning cancelled during agent debate");
      }

      this.emitActivity(
        taskId,
        "CRITIQUING",
        `Critic: Reviewing candidate plans for security risks and missing steps (Debate round ${debateRound}/${this.config.maxDebateRounds})...`,
        "CRITIC",
        undefined,
        debateRound
      );

      const crStart = Date.now();
      criticResult = await this.critic.evaluatePlans(candidatePlans, analysis, context, {
        model: this.config.agentModels.CRITIC,
        signal,
      });
      latencies.criticMs += Date.now() - crStart;
      totalTokens += criticResult.metrics.totalTokens;
      totalCostUsd += criticResult.metrics.estimatedCostUsd;
      agentCalls++;

      const critique = criticResult.data;
      latencies.debateRounds = debateRound;

      // Early termination if consensus reached or plan is rejected as unsafe
      if (critique.overallVerdict === "ACCEPTABLE" || critique.overallVerdict === "REJECTED_UNSAFE") {
        this.emitActivity(
          taskId,
          "CRITIQUING",
          `Critic Verdict: ${critique.overallVerdict}. ${critique.summary}`,
          "CRITIC",
          critique.issues.length > 0 ? `${critique.issues.length} issue(s) identified.` : "No blocking issues.",
          debateRound
        );
        break;
      }

      // If revision needed and rounds remain, revise candidate plans
      if (debateRound < this.config.maxDebateRounds && agentCalls < this.config.maxAgentCalls) {
        this.emitActivity(
          taskId,
          "PLANNING",
          `Planner: Revising plans based on Critic findings...`,
          "PLANNER",
          critique.issues.map((i: any) => i.recommendation).join("; "),
          debateRound
        );

        const revStart = Date.now();
        const revisedResults = await this.planner.generateCandidatePlans(
          `${inputText}\nCRITIC_FEEDBACK: ${critique.summary}`,
          analysis,
          context,
          availableToolNames,
          { model: this.config.agentModels.PLANNER, signal }
        );
        latencies.plannerMs += Date.now() - revStart;
        for (const r of revisedResults) {
          totalTokens += r.metrics.totalTokens;
          totalCostUsd += r.metrics.estimatedCostUsd;
          agentCalls++;
        }
        candidatePlans = revisedResults.map((r) => r.data);
      }

      debateRound++;
    }

    // 6. Stage: EVALUATING (Agent 5: Judge)
    this.emitActivity(
      taskId,
      "EVALUATING",
      "Judge: Comparing candidate plans, resolving debate, and producing the validated proposal...",
      "JUDGE"
    );

    const jStart = Date.now();
    const judgeResult = await this.judge.judgeAndSynthesize(
      taskId,
      analysis,
      candidatePlans,
      specialistReview,
      criticResult.data,
      context,
      { model: this.config.agentModels.JUDGE, signal }
    );
    latencies.judgeMs = Date.now() - jStart;
    totalTokens += judgeResult.metrics.totalTokens;
    totalCostUsd += judgeResult.metrics.estimatedCostUsd;
    agentCalls++;

    const proposal = judgeResult.data;

    // 7. Stage: PROPOSAL_READY
    latencies.totalPlanningMs = Date.now() - overallStart;
    latencies.tokensUsed = totalTokens;
    latencies.estimatedCostUsd = totalCostUsd;

    this.emitActivity(
      taskId,
      "PROPOSAL_READY",
      proposal.status === "REJECTED"
        ? `Task Rejected: ${proposal.conciseSummary}`
        : `Proposal Ready: ${proposal.userObjective}. Steps: ${proposal.steps.length}.`,
      "JUDGE",
      proposal.conciseSummary,
      latencies.debateRounds,
      { tokensUsed: totalTokens, costUsd: totalCostUsd, latencyMs: latencies.totalPlanningMs }
    );

    return {
      classification,
      proposal,
      latencyMetrics: latencies,
      isDeterministicBypass: false,
      totalTokensUsed: totalTokens,
      estimatedCostUsd: totalCostUsd,
    };
  }
}
