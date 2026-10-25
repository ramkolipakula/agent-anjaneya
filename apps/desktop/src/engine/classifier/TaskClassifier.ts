import { TaskClassification, taskClassificationSchema } from "@agent-anjaneya/protocol";

export class TaskClassifier {
  /**
   * Classifies a natural language instruction into a validated TaskClassification.
   * Runs locally with low latency and zero external dependencies.
   */
  public classify(inputText: string): TaskClassification {
    const text = inputText.trim();
    const lower = text.toLowerCase();

    // 1. Check for UNSAFE / BROAD DESTRUCTIVE OPERATIONS (e.g. "delete everything", "wipe", "rm -rf")
    const isBroadDestructive =
      (lower.includes("delete") || lower.includes("remove") || lower.includes("wipe") || lower.includes("erase") || lower.includes("format")) &&
      (lower.includes("everything") || lower.includes("all") || lower.includes("*") || lower.includes("entire") || lower.includes("whole"));

    const isSystemOrShellAttack =
      lower.includes("rm -rf") ||
      lower.includes("drop database") ||
      lower.includes("format c:") ||
      lower.includes("/etc/passwd") ||
      lower.includes("system32") ||
      lower.startsWith("cmd") ||
      lower.startsWith("powershell") ||
      lower.startsWith("bash");

    if (isBroadDestructive || isSystemOrShellAttack) {
      return taskClassificationSchema.parse({
        category: "UNSUPPORTED",
        intent: "UNSAFE_DESTRUCTIVE_OPERATION",
        requiredCapabilities: ["security_guardrail"],
        requiredTools: [],
        requiresContextGathering: false,
        requiresClarification: false,
        requiresApproval: false,
        isSimpleDeterministic: true,
        complexity: "HIGH",
        safetyRisk: "CRITICAL",
        reasoning:
          "Rejected unsafe broad destructive operation or arbitrary shell command. Agent Anjaneya strictly prohibits broad deletion or unrestricted shell execution.",
      });
    }

    // 2. MEDIA PROCESSING (e.g. "Trim the first 10 seconds of video.mp4")
    const isVideoTrim =
      (lower.includes("extract") || lower.includes("trim") || lower.includes("cut")) &&
      (lower.includes("second") || lower.includes("sec") || lower.includes("minute") || lower.includes("video"));

    if (isVideoTrim) {
      return taskClassificationSchema.parse({
        category: "MEDIA_PROCESSING",
        intent: "VIDEO_TRIM",
        requiredCapabilities: ["ffmpeg", "filesystem_read", "filesystem_write"],
        requiredTools: ["find_file", "trim_video", "verify_output"],
        requiresContextGathering: false, // Deterministic planner already handles this with 0 latency
        requiresClarification: false,
        requiresApproval: true,
        isSimpleDeterministic: true,
        complexity: "LOW",
        safetyRisk: "LOW",
        reasoning: "Recognized standard media processing task; maps directly to Phase 2 deterministic execution engine.",
      });
    }

    // 3. FILE OPERATIONS (e.g. "What are the folders present in D drive?", "Find video.mp4 in my Videos folder", "List allowed directories", "Get metadata")
    const isFolderListingQuery =
      ((lower.includes("folder") || lower.includes("director")) &&
        (lower.includes("what") ||
          lower.includes("list") ||
          lower.includes("show") ||
          lower.includes("which") ||
          lower.includes("present") ||
          lower.includes("all") ||
          lower.includes("get") ||
          lower.includes("display") ||
          lower.includes("allowed") ||
          lower.includes("permitted") ||
          lower.includes("in") ||
          lower.includes("on") ||
          lower.includes("drive"))) ||
      lower.includes("allowed folders") ||
      lower.includes("allowed directories");

    const isFileOperation =
      isFolderListingQuery ||
      lower.startsWith("find") ||
      lower.startsWith("search") ||
      lower.startsWith("where is") ||
      lower.includes("metadata") ||
      lower.includes("file info");

    if (isFileOperation) {
      const intent = isFolderListingQuery
        ? "LIST_DIRECTORIES"
        : lower.includes("metadata") || lower.includes("file info")
        ? "GET_METADATA"
        : "FIND_FILE";

      const tool = isFolderListingQuery
        ? "list_directories"
        : intent === "GET_METADATA"
        ? "get_file_metadata"
        : "find_file";

      return taskClassificationSchema.parse({
        category: "FILE_OPERATION",
        intent,
        requiredCapabilities: ["filesystem_read"],
        requiredTools: [tool],
        requiresContextGathering: false,
        requiresClarification: false,
        requiresApproval: false,
        isSimpleDeterministic: true,
        complexity: "LOW",
        safetyRisk: "LOW",
        reasoning: "Recognized read-only file operation; can be executed directly with zero risk.",
      });
    }

    // 4. SOFTWARE DEVELOPMENT (e.g. "Build a portfolio website using my existing projects...")
    if (
      lower.includes("portfolio") ||
      lower.includes("website") ||
      lower.includes("build") ||
      lower.includes("code") ||
      lower.includes("develop") ||
      lower.includes("deploy") ||
      lower.includes("app") ||
      lower.includes("project")
    ) {
      return taskClassificationSchema.parse({
        category: "SOFTWARE_DEVELOPMENT",
        intent: "BUILD_PORTFOLIO_OR_PROJECT",
        requiredCapabilities: ["project_inspection", "scaffolding", "build_validation", "filesystem_write"],
        requiredTools: ["inspect_project", "scaffold_project", "build_project", "verify_output"],
        requiresContextGathering: true,
        requiresClarification: false,
        requiresApproval: true,
        isSimpleDeterministic: false, // Requires multi-agent debate and planning
        complexity: "MEDIUM",
        safetyRisk: "MEDIUM",
        reasoning:
          "Complex software development task requiring context gathering of existing projects, multi-agent debate, and user approval before building.",
      });
    }

    // 5. CALENDAR & NOTIFICATION
    if (lower.includes("calendar") || lower.includes("meeting") || lower.includes("schedule")) {
      return taskClassificationSchema.parse({
        category: "CALENDAR",
        intent: "SCHEDULE_EVENT",
        requiredCapabilities: ["calendar_sync"],
        requiredTools: [],
        requiresContextGathering: true,
        requiresClarification: true,
        requiresApproval: true,
        isSimpleDeterministic: false,
        complexity: "LOW",
        safetyRisk: "LOW",
        reasoning: "Calendar scheduling request.",
      });
    }

    if (lower.includes("notify") || lower.includes("remind") || lower.includes("alert")) {
      return taskClassificationSchema.parse({
        category: "NOTIFICATION",
        intent: "SEND_NOTIFICATION",
        requiredCapabilities: ["notification_dispatch"],
        requiredTools: [],
        requiresContextGathering: false,
        requiresClarification: false,
        requiresApproval: false,
        isSimpleDeterministic: true,
        complexity: "LOW",
        safetyRisk: "LOW",
        reasoning: "Notification dispatch request.",
      });
    }

    // 6. RESEARCH & PRODUCTIVITY
    if (lower.includes("summarize") || lower.includes("research") || lower.includes("analyze") || lower.includes("report")) {
      return taskClassificationSchema.parse({
        category: lower.includes("research") ? "RESEARCH" : "PRODUCTIVITY",
        intent: "DOCUMENT_ANALYSIS",
        requiredCapabilities: ["text_analysis", "context_search"],
        requiredTools: ["find_file"],
        requiresContextGathering: true,
        requiresClarification: false,
        requiresApproval: false,
        isSimpleDeterministic: false,
        complexity: "MEDIUM",
        safetyRisk: "LOW",
        reasoning: "Productivity/research query requiring document search and contextual analysis.",
      });
    }

    // 7. DEFAULT: UNSUPPORTED or general complex task
    return taskClassificationSchema.parse({
      category: "UNSUPPORTED",
      intent: "GENERAL_UNRECOGNIZED_INTENT",
      requiredCapabilities: [],
      requiredTools: [],
      requiresContextGathering: false,
      requiresClarification: true,
      requiresApproval: false,
      isSimpleDeterministic: false,
      complexity: "HIGH",
      safetyRisk: "MEDIUM",
      reasoning: "Unrecognized instruction outside the supported desktop tool capabilities.",
    });
  }
}
