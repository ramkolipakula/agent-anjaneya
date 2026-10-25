import { AgentAnalysis, agentAnalysisSchema } from "@agent-anjaneya/protocol";
import { AIModelProvider, ProviderOptions, ProviderResult } from "../providers/AIModelProvider";

export class TaskAnalystAgent {
  public readonly role = "TASK_ANALYST";
  private provider: AIModelProvider;

  constructor(provider: AIModelProvider) {
    this.provider = provider;
  }

  public async analyze(
    instruction: string,
    taskId: string,
    options?: ProviderOptions
  ): Promise<ProviderResult<AgentAnalysis>> {
    const prompt = `
ROLE: TASK_ANALYST
TASK_ID: ${taskId}
USER_INSTRUCTION: "${instruction}"

Analyze the user's instruction thoroughly.
1. Identify the actual underlying objective.
2. Extract all constraints (permissions, formats, targets).
3. Identify any missing information or ambiguities.
4. Determine if clarification is required before proceeding.
5. Identify which context domains are relevant (e.g., allowedDirectories, existingProjects, userPreferences).
6. Estimate complexity (LOW, MEDIUM, HIGH).

Return structured JSON conforming to the AgentAnalysis schema.
`;

    const result = await this.provider.generateStructured(prompt, agentAnalysisSchema, options);
    result.data.taskId = taskId;
    return result;
  }
}
