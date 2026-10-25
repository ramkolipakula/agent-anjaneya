import {
  FinalProposal,
  finalProposalSchema,
  CandidatePlan,
  Critique,
  TechnicalSpecialistReview,
  AgentAnalysis,
} from "@agent-anjaneya/protocol";
import { AIModelProvider, ProviderOptions, ProviderResult } from "../providers/AIModelProvider";
import { AggregatedContext } from "../context/ContextAggregator";

export class JudgeAgent {
  public readonly role = "JUDGE";
  private provider: AIModelProvider;

  constructor(provider: AIModelProvider) {
    this.provider = provider;
  }

  public async judgeAndSynthesize(
    taskId: string,
    analysis: AgentAnalysis,
    candidatePlans: CandidatePlan[],
    specialistReview: TechnicalSpecialistReview,
    critique: Critique,
    context: AggregatedContext,
    options?: ProviderOptions
  ): Promise<ProviderResult<FinalProposal>> {
    // If Critic issued REJECTED_UNSAFE, immediately respect safety guardrail
    if (critique.overallVerdict === "REJECTED_UNSAFE") {
      const rejectedProposal: FinalProposal = {
        proposalId: `proposal-rejected-${taskId}`,
        taskId,
        userObjective: analysis.objective,
        relevantContextSummary: critique.summary,
        proposedApproach: "Operation rejected by multi-agent consensus due to critical security risks.",
        steps: [],
        requiredTools: [],
        expectedOutputs: [],
        risks: critique.issues.map((i) => `CRITICAL: ${i.description}`),
        permissionsRequired: [],
        requiresApproval: false,
        estimatedComplexity: "HIGH",
        conciseSummary: `The requested task was rejected for safety reasons: ${critique.summary}`,
        status: "REJECTED",
      };

      return {
        data: finalProposalSchema.parse(rejectedProposal),
        metrics: { promptTokens: 50, completionTokens: 50, totalTokens: 100, estimatedCostUsd: 0 },
        latencyMs: 1,
        providerId: this.provider.id,
        modelId: this.provider.defaultModel,
      };
    }

    const prompt = `
ROLE: JUDGE
TASK_ID: ${taskId}
USER_OBJECTIVE: ${analysis.objective}
CANDIDATE_PLANS:
${JSON.stringify(candidatePlans, null, 2)}

TECHNICAL_SPECIALIST_REVIEW:
${JSON.stringify(specialistReview, null, 2)}

CRITIC_EVALUATION:
${JSON.stringify(critique, null, 2)}

CONTEXT_FACTS:
- ${context.summaries.join("\n- ")}

As the Judge:
1. Compare candidate plans against evidence and technical requirements.
2. Resolve any disagreements between Planner, Specialist, and Critic.
3. Eliminate redundant steps and enforce security boundaries.
4. Select the best valid plan and produce the FinalProposal.
5. Create a conciseSummary formatted clearly for mobile approval display:
   - Objective
   - Numbered steps (1-4 max)
   - Complexity
   - Clear approval call to action ("Approve to continue.")

Return structured JSON conforming to the FinalProposal schema.
`;

    const result = await this.provider.generateStructured(prompt, finalProposalSchema, options);
    result.data.taskId = taskId;
    return result;
  }
}
