import { z } from "zod";
import { TaskPlan } from "@agent-anjaneya/protocol";

export const taskPlanSchema = z.object({
  taskId: z.string(),
  intent: z.enum(["VIDEO_TRIM", "FIND_FILE", "GET_METADATA", "LIST_DIRECTORIES", "UNSUPPORTED"]),
  title: z.string(),
  sourceFile: z.string().optional(),
  targetDirectory: z.string().optional(),
  operation: z.object({
    type: z.string(),
  }).passthrough(),
  outputFile: z.string().optional(),
  requiresApproval: z.boolean(),
  toolName: z.string(),
  toolInput: z.record(z.string(), z.any()),
  verification: z.object({
    expectedDuration: z.number().optional(),
    expectedMinSize: z.number().optional(),
    durationTolerance: z.number().optional(),
  }).optional(),
});

export interface LLMProvider {
  name: string;
  generatePlan(prompt: string, taskId: string): Promise<TaskPlan | null>;
}

export class TaskPlanner {
  private llmProvider: LLMProvider | null = null;

  constructor(llmProvider?: LLMProvider) {
    if (llmProvider) {
      this.llmProvider = llmProvider;
    }
  }

  public setLLMProvider(provider: LLMProvider | null): void {
    this.llmProvider = provider;
  }

  /**
   * Plans a natural language instruction into a structured, validated TaskPlan.
   * Simple and well-defined commands are deterministically parsed with zero latency.
   */
  public async plan(prompt: string, taskId: string): Promise<TaskPlan> {
    const trimmed = prompt.trim();

    // 1. First try deterministic pattern matching
    const deterministicPlan = this.parseDeterministic(trimmed, taskId);
    if (deterministicPlan) {
      return taskPlanSchema.parse(deterministicPlan);
    }

    // 2. If deterministic parsing didn't match and an LLM provider is present, try LLM
    if (this.llmProvider) {
      try {
        const llmPlan = await this.llmProvider.generatePlan(trimmed, taskId);
        if (llmPlan) {
          return taskPlanSchema.parse(llmPlan);
        }
      } catch (err) {
        console.warn("[TaskPlanner] LLM planning failed, falling back to UNSUPPORTED:", err);
      }
    }

    // 3. Fallback: Unsupported operation
    return taskPlanSchema.parse({
      taskId,
      intent: "UNSUPPORTED",
      title: "Unsupported Operation",
      operation: { type: "UNKNOWN", rawInput: trimmed },
      requiresApproval: false,
      toolName: "unsupported",
      toolInput: { rawInput: trimmed },
    });
  }

  /**
   * Deterministic Natural Language Understanding (NLU) parser.
   */
  public parseDeterministic(text: string, taskId: string): TaskPlan | null {
    const lower = text.toLowerCase();

    // ----------------------------------------------------
    // Pattern 1: Video Trim / Extraction
    // Examples:
    // - "Find video.mp4 in my Videos folder and extract the first 10 seconds"
    // - "Find video.mp4 in Videos and extract the first 10 seconds"
    // - "Find video.mp4 and extract the first 10 seconds"
    // - "Extract the first 10 seconds of video.mp4"
    // - "Trim the first 10 seconds of video.mp4"
    // - "Trim video.mp4 for 10 seconds"
    // ----------------------------------------------------
    const isVideoTrim =
      (lower.includes("extract") || lower.includes("trim") || lower.includes("cut")) &&
      (lower.includes("second") || lower.includes("sec") || lower.includes("s") || lower.includes("minute"));

    if (isVideoTrim) {
      // 1. Extract duration
      let durationSeconds = 10; // default
      const secMatch = lower.match(/(?:first|for|duration of)?\s*(\d+(?:\.\d+)?)\s*(?:seconds|second|secs|sec|s\b)/);
      if (secMatch) {
        durationSeconds = parseFloat(secMatch[1]);
      } else {
        const minMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:minutes|minute|mins|min|m\b)/);
        if (minMatch) {
          durationSeconds = parseFloat(minMatch[1]) * 60;
        }
      }

      // 2. Extract start time (if specified, e.g. "from 5 seconds" or "starting at 10s")
      let startSeconds = 0;
      const startMatch = lower.match(/(?:from|starting at|start at|after)\s*(\d+(?:\.\d+)?)\s*(?:seconds|second|secs|sec|s\b)?/);
      if (startMatch && !lower.includes("first")) {
        startSeconds = parseFloat(startMatch[1]);
      }

      // 3. Extract filename (e.g. video.mp4, sample.mov, etc.)
      let sourceFile = "video.mp4";
      const fileMatch = text.match(/([a-zA-Z0-9_\-\.]+\.(mp4|mkv|mov|avi|webm|flv|wmv|m4v))/i);
      if (fileMatch) {
        sourceFile = fileMatch[1];
      }

      // 4. Extract target directory if mentioned
      let targetDirectory: string | undefined;
      const dirMatch = text.match(/(?:in my|in the|in)\s+([a-zA-Z0-9_\-]+)(?:\s+folder|\s+directory)?/i);
      if (dirMatch && !dirMatch[1].includes(".")) {
        targetDirectory = dirMatch[1];
      }

      // Output naming
      const ext = sourceFile.includes(".") ? sourceFile.slice(sourceFile.lastIndexOf(".")) : ".mp4";
      const base = sourceFile.includes(".") ? sourceFile.slice(0, sourceFile.lastIndexOf(".")) : sourceFile;
      const outputFile = "output.mp4"; // Canonical Phase 2 requirement example

      return {
        taskId,
        intent: "VIDEO_TRIM",
        title: `Trim ${sourceFile}`,
        sourceFile,
        targetDirectory,
        operation: {
          type: "TRIM",
          startSeconds,
          durationSeconds,
        },
        outputFile,
        requiresApproval: true,
        toolName: "trim_video",
        toolInput: {
          sourcePath: sourceFile,
          startSeconds,
          durationSeconds,
          outputFilename: outputFile,
          outputDirectory: targetDirectory,
        },
        verification: {
          expectedDuration: durationSeconds,
          expectedMinSize: 1024,
          durationTolerance: 1.5,
        },
      };
    }

    // ----------------------------------------------------
    // Pattern 2: List Allowed Directories
    // Examples: "List allowed directories", "List folders", "What folders are permitted"
    // ----------------------------------------------------
    if (
      lower.includes("list") &&
      (lower.includes("directories") || lower.includes("directory") || lower.includes("folders") || lower.includes("folder"))
    ) {
      return {
        taskId,
        intent: "LIST_DIRECTORIES",
        title: "List Allowed Directories",
        operation: { type: "LIST" },
        requiresApproval: false,
        toolName: "list_allowed_directories",
        toolInput: {},
      };
    }

    // ----------------------------------------------------
    // Pattern 3: Get File Metadata
    // Examples: "Get metadata of video.mp4", "File info for doc.pdf"
    // ----------------------------------------------------
    if (lower.includes("metadata") || lower.includes("file info") || lower.includes("file stats")) {
      const fileMatch = text.match(/([a-zA-Z0-9_\-\.]+\.[a-zA-Z0-9]{2,5})/i);
      const filename = fileMatch ? fileMatch[1] : text.split(" ").pop() || "";

      return {
        taskId,
        intent: "GET_METADATA",
        title: `Get metadata of ${filename}`,
        sourceFile: filename,
        operation: { type: "METADATA", filename },
        requiresApproval: false,
        toolName: "get_file_metadata",
        toolInput: { filePath: filename },
      };
    }

    // ----------------------------------------------------
    // Pattern 4: Find File
    // Examples: "Find video.mp4 in my Videos folder", "Find video.mp4", "Search for sample.txt"
    // ----------------------------------------------------
    if (lower.startsWith("find") || lower.startsWith("search") || lower.startsWith("where is") || lower.includes("locate")) {
      const fileMatch = text.match(/([a-zA-Z0-9_\-\.]+\.[a-zA-Z0-9]{2,5})/i);
      const filename = fileMatch ? fileMatch[1] : text.replace(/^(find|search for|locate|where is)\s+/i, "").trim();

      let targetDirectory: string | undefined;
      const dirMatch = text.match(/(?:in my|in the|in)\s+([a-zA-Z0-9_\-]+)(?:\s+folder|\s+directory)?/i);
      if (dirMatch && !dirMatch[1].includes(".")) {
        targetDirectory = dirMatch[1];
      }

      return {
        taskId,
        intent: "FIND_FILE",
        title: `Find ${filename}`,
        sourceFile: filename,
        targetDirectory,
        operation: { type: "FIND", filename, targetDirectory },
        requiresApproval: false,
        toolName: "find_file",
        toolInput: { filename, directory: targetDirectory },
      };
    }

    return null;
  }
}
