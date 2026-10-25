import { Critique, critiqueSchema, CandidatePlan, AgentAnalysis } from "@agent-anjaneya/protocol";
import { AIModelProvider, ProviderOptions, ProviderResult } from "../providers/AIModelProvider";
import { AggregatedContext } from "../context/ContextAggregator";

export class CriticAgent {
  public readonly role = "CRITIC";
  private provider: AIModelProvider;

  constructor(provider: AIModelProvider) {
    this.provider = provider;
  }

  public async evaluatePlans(
    candidatePlans: CandidatePlan[],
    analysis: AgentAnalysis,
    context: AggregatedContext,
    options?: ProviderOptions
  ): Promise<ProviderResult<Critique>> {
    const plansJson = JSON.stringify(candidatePlans, null, 2);
    const contextSummary = context.summaries.join("\n- ");

    const prompt = `
ROLE: CRITIC
OBJECTIVE: ${analysis.objective}
CONSTRAINTS: ${analysis.extractedConstraints.join(", ")}
VERIFIED_CONTEXT:
- ${contextSummary}

CANDIDATE_PLANS_TO_EVALUATE:
${plansJson}

Independently critique the proposed candidate plans:
1. Identify logical errors or step dependency flaws.
2. Identify unnecessary operations or duplicate tasks.
3. Identify security risks (e.g. broad file access, arbitrary process calls, missing approval).
4. Identify missing steps (e.g. output verification, dependency checks).
5. Challenge unsupported assumptions (e.g. assuming files exist without checking).
6. Issue an overall verdict: "ACCEPTABLE", "NEEDS_REVISION", or "REJECTED_UNSAFE".

Return structured JSON conforming to the Critique schema.
`;

    return this.provider.generateStructured(prompt, critiqueSchema, options);
  }
}
