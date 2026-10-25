import { TechnicalSpecialistReview, technicalSpecialistReviewSchema, AgentAnalysis } from "@agent-anjaneya/protocol";
import { AIModelProvider, ProviderOptions, ProviderResult } from "../providers/AIModelProvider";
import { AggregatedContext } from "../context/ContextAggregator";

export class TechnicalSpecialistAgent {
  public readonly role = "TECHNICAL_SPECIALIST";
  private provider: AIModelProvider;

  constructor(provider: AIModelProvider) {
    this.provider = provider;
  }

  public async reviewTechnicalFeasibility(
    instruction: string,
    analysis: AgentAnalysis,
    context: AggregatedContext,
    availableTools: string[],
    options?: ProviderOptions
  ): Promise<ProviderResult<TechnicalSpecialistReview>> {
    const prompt = `
ROLE: TECHNICAL_SPECIALIST
USER_INSTRUCTION: "${instruction}"
OBJECTIVE: ${analysis.objective}
AVAILABLE_TOOLS: ${availableTools.join(", ")}
CONTEXT_FACTS:
- ${context.summaries.join("\n- ")}

Analyze the task from a rigorous technical perspective:
1. Identify implementation details and best practices.
2. Recommend suitable tools from the available tool registry.
3. Identify potential compatibility issues or filesystem constraints.
4. Verify that no unrestricted shell commands or dangerous operations are required.
5. Provide technical recommendation for the execution strategy.

Return structured JSON matching the TechnicalSpecialistReview schema.
`;

    return this.provider.generateStructured(prompt, technicalSpecialistReviewSchema, options);
  }
}
