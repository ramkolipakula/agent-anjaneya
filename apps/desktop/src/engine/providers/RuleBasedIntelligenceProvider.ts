import { z } from "zod";
import { AIModelProvider, ProviderOptions, ProviderResult, calculateTokenCost } from "./AIModelProvider";

export class RuleBasedIntelligenceProvider implements AIModelProvider {
  public readonly id = "rule-based";
  public readonly name = "Rule-Based Deterministic Intelligence";
  public readonly defaultModel = "rule-based-fast";

  public async generateStructured<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: ProviderOptions
  ): Promise<ProviderResult<T>> {
    const start = Date.now();

    if (options?.signal?.aborted) {
      throw new Error("OPERATION_CANCELLED: Agent execution aborted by signal");
    }

    // Rough token calculation based on prompt length
    const promptTokens = Math.ceil(prompt.length / 4);
    let outputObj: any;

    const lower = prompt.toLowerCase();

    // 1. Task Analyst Prompt handling
    if (lower.includes("role: task_analyst") || lower.includes("agent 1 — task analyst")) {
      const isPortfolio = lower.includes("portfolio") || lower.includes("website");
      outputObj = {
        role: "TASK_ANALYST",
        taskId: "task-auto",
        objective: isPortfolio
          ? "Build and deploy a professional portfolio website highlighting existing projects"
          : "Execute requested desktop operation safely",
        extractedConstraints: [
          "Use only permitted filesystem directories",
          "Ensure production-grade styling and verification",
          "Require explicit user approval before writing files",
        ],
        missingInformation: [],
        requiresClarification: false,
        relevantContextKeys: ["existingProjects", "allowedDirectories", "userPreferences"],
        estimatedComplexity: isPortfolio ? "MEDIUM" : "LOW",
        reasoning: "Task objective is well-defined. Permitted directories should be inspected for existing artifacts.",
      };
    }
    // 2. Planner Prompt handling (produces candidate plan or multiple plans)
    else if (lower.includes("role: planner") || lower.includes("agent 2 — planner")) {
      const isPortfolio = lower.includes("portfolio") || lower.includes("website");
      if (isPortfolio) {
        // Generates Plan A or Plan B
        const isPlanB = lower.includes("candidate b") || lower.includes("alternative");
        if (isPlanB) {
          outputObj = {
            planId: "plan-candidate-b",
            title: "Plan B: Create Fresh Clean Portfolio Project",
            objective: "Scaffold a new dedicated portfolio project from scratch",
            steps: [
              {
                stepId: "step-1",
                tool: "scaffold_project",
                description: "Scaffold clean portfolio site in allowed folder",
                input: { projectName: "my-portfolio", template: "portfolio" },
                dependencies: [],
                risk: "MEDIUM",
              },
              {
                stepId: "step-2",
                tool: "build_project",
                description: "Build and prepare static production assets",
                input: { projectPath: "my-portfolio", target: "static" },
                dependencies: ["step-1"],
                risk: "LOW",
              },
              {
                stepId: "step-3",
                tool: "verify_output",
                description: "Verify index.html exists and meets size threshold",
                input: { expectedMinSize: 500 },
                dependencies: ["step-2"],
                risk: "LOW",
              },
            ],
            estimatedComplexity: "LOW",
            requiresApproval: true,
            expectedOutputs: ["index.html", "dist/build-manifest.json"],
            rationale: "Clean slate avoids legacy build conflicts and dependency baggage.",
          };
        } else {
          outputObj = {
            planId: "plan-candidate-a",
            title: "Plan A: Inspect Existing Projects & Build Unified Showcase",
            objective: "Discover existing project repositories, extract highlights, and generate an integrated portfolio",
            steps: [
              {
                stepId: "step-1",
                tool: "inspect_project",
                description: "Inspect available project repositories in permitted folders",
                input: { projectPath: "projects" },
                dependencies: [],
                risk: "LOW",
              },
              {
                stepId: "step-2",
                tool: "scaffold_project",
                description: "Generate showcase portfolio highlighting discovered projects",
                input: { projectName: "portfolio-showcase", template: "portfolio" },
                dependencies: ["step-1"],
                risk: "MEDIUM",
              },
              {
                stepId: "step-3",
                tool: "build_project",
                description: "Compile and prepare production preview package",
                input: { projectPath: "portfolio-showcase", target: "production" },
                dependencies: ["step-2"],
                risk: "LOW",
              },
              {
                stepId: "step-4",
                tool: "verify_output",
                description: "Verify built website bundle and manifest",
                input: { expectedMinSize: 1024 },
                dependencies: ["step-3"],
                risk: "LOW",
              },
            ],
            estimatedComplexity: "MEDIUM",
            requiresApproval: true,
            expectedOutputs: ["portfolio-showcase/index.html", "dist/build-manifest.json"],
            rationale: "Maximizes project showcase fidelity by pulling metadata directly from user's real projects.",
          };
        }
      } else {
        outputObj = {
          planId: "plan-default",
          title: "Single-Step Execution Plan",
          objective: "Execute validated desktop command",
          steps: [
            {
              stepId: "step-1",
              tool: "find_file",
              description: "Locate target file in allowed directory",
              dependencies: [],
              risk: "LOW",
            },
          ],
          estimatedComplexity: "LOW",
          requiresApproval: false,
          expectedOutputs: ["file_metadata"],
          rationale: "Simple direct file lookup.",
        };
      }
    }
    // 3. Technical Specialist Prompt handling
    else if (lower.includes("role: technical_specialist") || lower.includes("agent 3 — technical specialist")) {
      outputObj = {
        role: "TECHNICAL_SPECIALIST",
        compatibleTools: ["inspect_project", "scaffold_project", "build_project", "verify_output"],
        implementationDetails: [
          "Use standard HTML5 + modern CSS tokens for optimal loading performance",
          "Ensure manifest conforms to static export specifications",
          "Verify disk space before writing build artifacts",
        ],
        potentialIssues: [
          "Potential lock if target directory already has uncommitted git changes",
        ],
        executionConstraints: [
          "Strictly no arbitrary shell execution",
          "Write operations restricted to allowlisted folders",
        ],
        recommendedApproach: "Inspect existing repositories first to populate portfolio dynamic cards, then build static bundle.",
      };
    }
    // 4. Critic Prompt handling
    else if (lower.includes("role: critic") || lower.includes("agent 4 — critic")) {
      // Check if candidate plan contains unsafe operations or delete everything
      const hasUnsafeOperation = lower.includes("delete everything") || lower.includes("rm -rf") || lower.includes("wipe");
      if (hasUnsafeOperation) {
        outputObj = {
          role: "CRITIC",
          evaluatedPlanIds: ["plan-unsafe"],
          issues: [
            {
              type: "SECURITY_RISK",
              severity: "CRITICAL",
              targetPlanId: "plan-unsafe",
              description: "Attempted broad deletion of user directories without explicit scope.",
              recommendation: "Reject plan completely. Destructive mass deletions are strictly prohibited.",
            },
          ],
          overallVerdict: "REJECTED_UNSAFE",
          summary: "Plan rejected due to critical security and data-loss risk.",
        };
      } else {
        // Plan A vs Plan B critique
        outputObj = {
          role: "CRITIC",
          evaluatedPlanIds: ["plan-candidate-a", "plan-candidate-b"],
          issues: [
            {
              type: "UNNECESSARY_OPERATION",
              severity: "LOW",
              targetPlanId: "plan-candidate-b",
              stepId: "step-1",
              description: "Plan B ignores existing projects and creates empty placeholder cards instead.",
              recommendation: "Prefer Plan A because it satisfies the user's explicit request to 'use my existing projects'.",
            },
          ],
          overallVerdict: "ACCEPTABLE",
          summary: "Plan A is well-structured, safe, and directly fulfills user intent. Low risk.",
        };
      }
    }
    // 5. Judge Prompt handling (produces FinalProposal)
    else if (lower.includes("role: judge") || lower.includes("agent 5 — judge")) {
      const isCriticRejection = lower.includes("rejected_unsafe") || lower.includes("critical");
      if (isCriticRejection) {
        outputObj = {
          proposalId: "proposal-rejected",
          taskId: "task-auto",
          userObjective: "Reject unsafe operation",
          relevantContextSummary: "Critic flagged critical safety violations.",
          proposedApproach: "Operation halted by Judge due to security policy violations.",
          steps: [],
          requiredTools: [],
          expectedOutputs: [],
          risks: ["CRITICAL: Mass data loss or unauthorized deletion."],
          permissionsRequired: [],
          requiresApproval: false,
          estimatedComplexity: "HIGH",
          conciseSummary: "The requested operation was evaluated and rejected for safety violations.",
          status: "REJECTED",
        };
      } else {
        outputObj = {
          proposalId: "proposal-portfolio-" + Math.random().toString(36).substring(7),
          taskId: "task-auto",
          userObjective: "Build and deploy a portfolio website using existing projects",
          relevantContextSummary: "Found existing project repositories in allowed folders.",
          proposedApproach: "1. Inspect repositories -> 2. Scaffold portfolio UI -> 3. Build & package -> 4. Verify output",
          steps: [
            {
              stepId: "1",
              tool: "inspect_project",
              description: "Inspect existing project repositories in permitted folders",
              dependencies: [],
              risk: "LOW",
              requiresApproval: false,
              input: { projectPath: "projects" },
            },
            {
              stepId: "2",
              tool: "scaffold_project",
              description: "Scaffold portfolio showcasing your projects",
              dependencies: ["1"],
              risk: "MEDIUM",
              requiresApproval: true,
              input: { targetDirectory: "Projects", projectName: "portfolio-showcase", template: "portfolio" },
            },
            {
              stepId: "3",
              tool: "build_project",
              description: "Build static production bundle and manifest",
              dependencies: ["2"],
              risk: "LOW",
              requiresApproval: false,
              input: { projectPath: "portfolio-showcase", target: "production" },
            },
            {
              stepId: "4",
              tool: "verify_output",
              description: "Verify generated website bundle",
              dependencies: ["3"],
              risk: "LOW",
              requiresApproval: false,
              input: { expectedMinSize: 500 },
            },
          ],
          requiredTools: ["inspect_project", "scaffold_project", "build_project", "verify_output"],
          expectedOutputs: ["portfolio-showcase/index.html", "dist/build-manifest.json"],
          risks: ["MEDIUM: Creates files in allowed portfolio directory."],
          permissionsRequired: ["Filesystem Read/Write in allowed directory"],
          requiresApproval: true,
          estimatedComplexity: "MEDIUM",
          conciseSummary:
            "I found your existing projects. My proposal:\n1. Inspect existing repositories\n2. Scaffold portfolio website\n3. Build production bundle\n4. Verify results\n\nEstimated complexity: Medium.\nApprove to continue.",
          status: "PROPOSED",
        };
      }
    } else {
      // Default fallback
      outputObj = {
        error: "Unrecognized agent prompt",
      };
    }

    // Validate structured output with Zod
    const parsedData = schema.parse(outputObj);
    const completionTokens = Math.ceil(JSON.stringify(parsedData).length / 4);
    const totalTokens = promptTokens + completionTokens;
    const latencyMs = Math.max(Date.now() - start, 1);

    return {
      data: parsedData,
      metrics: {
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd: calculateTokenCost(this.defaultModel, promptTokens, completionTokens),
      },
      latencyMs,
      providerId: this.id,
      modelId: options?.model || this.defaultModel,
    };
  }
}
