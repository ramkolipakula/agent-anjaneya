import { CandidatePlan, candidatePlanSchema, AgentAnalysis } from "@agent-anjaneya/protocol";
import { AIModelProvider, ProviderOptions, ProviderResult } from "../providers/AIModelProvider";
import { AggregatedContext } from "../context/ContextAggregator";

export class PlannerAgent {
  public readonly role = "PLANNER";
  private provider: AIModelProvider;

  constructor(provider: AIModelProvider) {
    this.provider = provider;
  }

  /**
   * Generates multiple candidate execution plans (Plan A and Plan B) for independent critique and evaluation.
   */
  public async generateCandidatePlans(
    instruction: string,
    analysis: AgentAnalysis,
    context: AggregatedContext,
    availableTools: string[],
    options?: ProviderOptions
  ): Promise<Array<ProviderResult<CandidatePlan>>> {
    const contextSummary = context.summaries.join("\n- ");

    // Prompt for Plan A: primary plan incorporating gathered context
    const promptPlanA = `
ROLE: PLANNER
VARIANT: CANDIDATE A
USER_INSTRUCTION: "${instruction}"
OBJECTIVE: ${analysis.objective}
CONSTRAINTS: ${analysis.extractedConstraints.join(", ")}
AVAILABLE_TOOLS: ${availableTools.join(", ")}
RELEVANT_CONTEXT:
- ${contextSummary}

Generate Candidate Plan A: An optimized execution plan that leverages existing context and available desktop tools.
Include explicit steps with tool names, input parameters, dependencies, and risk ratings (LOW, MEDIUM, HIGH).
`;

    // Prompt for Plan B: alternative conservative/clean plan
    const promptPlanB = `
ROLE: PLANNER
VARIANT: CANDIDATE B (ALTERNATIVE)
USER_INSTRUCTION: "${instruction}"
OBJECTIVE: ${analysis.objective}
CONSTRAINTS: ${analysis.extractedConstraints.join(", ")}
AVAILABLE_TOOLS: ${availableTools.join(", ")}
RELEVANT_CONTEXT:
- ${contextSummary}

Generate Candidate Plan B: An alternative candidate plan (e.g. fresh standalone scaffolding or minimal footprint) for comparison.
Include explicit steps with tool names, dependencies, and risk ratings.
`;

    // Run candidate generation in parallel
    const [planAResult, planBResult] = await Promise.all([
      this.provider.generateStructured(promptPlanA, candidatePlanSchema, options),
      this.provider.generateStructured(promptPlanB, candidatePlanSchema, options),
    ]);

    return [planAResult, planBResult];
  }
}
