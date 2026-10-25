import { z } from "zod";

export type DeviceType = "MOBILE" | "DESKTOP";

export type DeviceStatus = "ONLINE" | "OFFLINE" | "CONNECTING" | "RECONNECTING";

export type PairingSessionStatus = "ACTIVE" | "USED" | "EXPIRED" | "CANCELLED";


export type TaskStatus =
  | "CREATED"
  | "QUEUED"
  | "RECEIVED"
  | "PLANNING"
  | "WAITING_FOR_APPROVAL"
  | "APPROVED"
  | "RUNNING"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type MessageType =
  | "DEVICE_CONNECTED"
  | "DEVICE_DISCONNECTED"
  | "PING"
  | "PONG"
  | "TASK_CREATED"
  | "TASK_RECEIVED"
  | "TASK_PLANNING"
  | "TASK_APPROVAL_REQUEST"
  | "TASK_APPROVAL_RESPONSE"
  | "TASK_PROGRESS"
  | "TASK_VERIFYING"
  | "TASK_COMPLETED"
  | "TASK_FAILED"
  | "TASK_CANCEL"
  | "TASK_CANCELLED"
  | "TASK_SYNC"
  | "TASK_SYNC_RESPONSE"
  | "HEARTBEAT"
  | "PAIRING_SUCCESSFUL"
  | "ERROR"
  | "AGENT_ACTIVITY"
  | "TASK_PROPOSAL_READY";

export interface RealtimeMessage<T = any> {
  id: string;
  type: MessageType;
  timestamp: string;
  sourceDeviceId: string;
  targetDeviceId: string;
  payload?: T;
}

export interface DeviceAuthCredentials {
  deviceId: string;
  deviceSecret: string;
}

export interface PairingQRPayload {
  pairingSessionId: string;
  pairingToken: string;
  desktopDeviceId: string;
  serverUrl?: string;
  expiresAt: string;
}

export interface Device {
  id: string;
  user_id: string;
  device_type: DeviceType;
  device_name: string;
  platform: string;
  app_version: string;
  status: DeviceStatus;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface PairingSession {
  id: string;
  desktop_device_id: string;
  token_hash: string;
  status: PairingSessionStatus;
  expires_at: string;
  used_at?: string;
  created_at: string;
}

export interface DeviceConnection {
  id: string;
  userId: string;
  mobileDeviceId: string;
  desktopDeviceId: string;
  status: "ACTIVE" | "REVOKED";
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  user_id?: string;
  userId?: string;
  desktop_device_id?: string;
  desktopDeviceId?: string;
  created_by_device_id?: string;
  createdByDeviceId?: string;
  input_text?: string;
  inputText?: string;
  status: TaskStatus;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  events?: TaskEvent[];
}

export interface TaskEvent {
  id: string;
  task_id?: string;
  taskId?: string;
  event_type?: string;
  eventType?: string;
  payload?: any;
  source_device_id?: string;
  sourceDeviceId?: string;
  created_at?: string;
  createdAt?: string;
}

export interface TaskPlan {
  taskId: string;
  intent:
    | "VIDEO_TRIM"
    | "FIND_FILE"
    | "GET_METADATA"
    | "LIST_DIRECTORIES"
    | "SOFTWARE_DEVELOPMENT"
    | "MULTI_AGENT_PROPOSAL"
    | "UNSUPPORTED";
  title: string;
  sourceFile?: string;
  targetDirectory?: string;
  operation: {
    type: string;
    [key: string]: any;
  };
  outputFile?: string;
  requiresApproval: boolean;
  toolName: string;
  toolInput: Record<string, any>;
  proposal?: FinalProposal;
  verification?: {
    expectedDuration?: number;
    expectedMinSize?: number;
    durationTolerance?: number;
  };
}

export interface TaskApprovalRequestPayload {
  taskId: string;
  title: string;
  intent: string;
  operation: Record<string, any>;
  sourceFile?: string;
  outputFile?: string;
  details?: string;
  requiresApproval: true;
  proposal?: FinalProposal;
  timestamp: string;
}

export interface TaskApprovalResponsePayload {
  taskId: string;
  approved: boolean;
  reason?: string;
  timestamp: string;
}

export interface TaskProgressPayload {
  taskId: string;
  status: TaskStatus;
  step: string;
  message: string;
  progressPercent?: number;
  metadata?: Record<string, any>;
  timestamp: string;
}

export interface TaskCompletedPayload {
  taskId: string;
  status: "COMPLETED";
  outputPath?: string;
  metadata?: Record<string, any>;
  summary: string;
  executionTimeMs?: number;
  latencyMetrics?: {
    mobileSentAt?: string;
    backendReceivedAt?: string;
    desktopReceivedAt?: string;
    planningStartedAt?: string;
    planningDurationMs?: number;
    approvalRequestedAt?: string;
    approvalReceivedAt?: string;
    approvalWaitMs?: number;
    executionStartedAt?: string;
    executionDurationMs?: number;
    verificationDurationMs?: number;
    totalRoundTripMs?: number;
  };
  timestamp: string;
}

export interface TaskFailedPayload {
  taskId: string;
  status: "FAILED";
  error: string;
  code?: string;
  step?: string;
  timestamp: string;
}

export interface TaskCancelPayload {
  taskId: string;
  reason?: string;
  timestamp: string;
}

export const ALLOWED_MESSAGE_TYPES: ReadonlyArray<MessageType> = [
  "DEVICE_CONNECTED",
  "DEVICE_DISCONNECTED",
  "PING",
  "PONG",
  "TASK_CREATED",
  "TASK_RECEIVED",
  "TASK_PLANNING",
  "TASK_APPROVAL_REQUEST",
  "TASK_APPROVAL_RESPONSE",
  "TASK_PROGRESS",
  "TASK_VERIFYING",
  "TASK_COMPLETED",
  "TASK_FAILED",
  "TASK_CANCEL",
  "TASK_CANCELLED",
  "TASK_SYNC",
  "TASK_SYNC_RESPONSE",
  "HEARTBEAT",
  "PAIRING_SUCCESSFUL",
  "ERROR",
  "AGENT_ACTIVITY",
  "TASK_PROPOSAL_READY",
];

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  CREATED: ["QUEUED", "RECEIVED", "CANCELLED", "FAILED"],
  QUEUED: ["RECEIVED", "CANCELLED", "FAILED"],
  RECEIVED: ["PLANNING", "CANCELLED", "FAILED"],
  PLANNING: ["WAITING_FOR_APPROVAL", "APPROVED", "RUNNING", "CANCELLED", "FAILED"],
  WAITING_FOR_APPROVAL: ["APPROVED", "CANCELLED", "FAILED"],
  APPROVED: ["RUNNING", "CANCELLED", "FAILED"],
  RUNNING: ["VERIFYING", "COMPLETED", "FAILED", "CANCELLED"],
  VERIFYING: ["COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function isValidTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
}

export function canCancelTask(status: TaskStatus): boolean {
  return !isTerminalTaskStatus(status);
}

export function isValidMessageType(type: any): type is MessageType {
  return typeof type === "string" && ALLOWED_MESSAGE_TYPES.includes(type as MessageType);
}

export function validateRealtimeMessage(data: any): { valid: boolean; error?: string } {
  if (!data || typeof data !== "object") {
    return { valid: false, error: "Message must be an object" };
  }
  if (!data.id || typeof data.id !== "string") {
    return { valid: false, error: "Message id must be a string" };
  }
  if (!isValidMessageType(data.type)) {
    return { valid: false, error: `Invalid message type: ${data.type}` };
  }
  if (!data.timestamp || typeof data.timestamp !== "string") {
    return { valid: false, error: "Message timestamp is required" };
  }
  if (!data.targetDeviceId || typeof data.targetDeviceId !== "string") {
    return { valid: false, error: "targetDeviceId is required" };
  }
  return { valid: true };
}

// ============================================================================
// PHASE 3: MULTI-AGENT INTELLIGENCE & AUTONOMOUS PLANNING SCHEMAS & TYPES
// ============================================================================

export type TaskCategory =
  | "FILE_OPERATION"
  | "MEDIA_PROCESSING"
  | "SOFTWARE_DEVELOPMENT"
  | "RESEARCH"
  | "PRODUCTIVITY"
  | "CALENDAR"
  | "NOTIFICATION"
  | "UNSUPPORTED";

export const taskCategorySchema = z.enum([
  "FILE_OPERATION",
  "MEDIA_PROCESSING",
  "SOFTWARE_DEVELOPMENT",
  "RESEARCH",
  "PRODUCTIVITY",
  "CALENDAR",
  "NOTIFICATION",
  "UNSUPPORTED",
]);

export const taskClassificationSchema = z.object({
  category: taskCategorySchema,
  intent: z.string(),
  requiredCapabilities: z.array(z.string()),
  requiredTools: z.array(z.string()),
  requiresContextGathering: z.boolean(),
  requiresClarification: z.boolean(),
  requiresApproval: z.boolean(),
  isSimpleDeterministic: z.boolean(),
  complexity: z.enum(["LOW", "MEDIUM", "HIGH"]),
  safetyRisk: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  reasoning: z.string(),
});
export type TaskClassification = z.infer<typeof taskClassificationSchema>;

export type AgentRole =
  | "TASK_ANALYST"
  | "PLANNER"
  | "TECHNICAL_SPECIALIST"
  | "CRITIC"
  | "JUDGE";

export const agentRoleSchema = z.enum([
  "TASK_ANALYST",
  "PLANNER",
  "TECHNICAL_SPECIALIST",
  "CRITIC",
  "JUDGE",
]);

export const agentAnalysisSchema = z.object({
  role: z.literal("TASK_ANALYST"),
  taskId: z.string(),
  objective: z.string(),
  extractedConstraints: z.array(z.string()),
  missingInformation: z.array(z.string()),
  requiresClarification: z.boolean(),
  clarificationQuestion: z.string().optional(),
  relevantContextKeys: z.array(z.string()),
  estimatedComplexity: z.enum(["LOW", "MEDIUM", "HIGH"]),
  reasoning: z.string(),
});
export type AgentAnalysis = z.infer<typeof agentAnalysisSchema>;

export const candidatePlanStepSchema = z.object({
  stepId: z.string(),
  tool: z.string(),
  description: z.string(),
  input: z.record(z.string(), z.any()).optional(),
  dependencies: z.array(z.string()),
  risk: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
});
export type CandidatePlanStep = z.infer<typeof candidatePlanStepSchema>;

export const candidatePlanSchema = z.object({
  planId: z.string(),
  title: z.string(),
  objective: z.string(),
  steps: z.array(candidatePlanStepSchema),
  estimatedComplexity: z.enum(["LOW", "MEDIUM", "HIGH"]),
  requiresApproval: z.boolean(),
  expectedOutputs: z.array(z.string()),
  rationale: z.string(),
});
export type CandidatePlan = z.infer<typeof candidatePlanSchema>;

export const technicalSpecialistReviewSchema = z.object({
  role: z.literal("TECHNICAL_SPECIALIST"),
  compatibleTools: z.array(z.string()),
  implementationDetails: z.array(z.string()),
  potentialIssues: z.array(z.string()),
  executionConstraints: z.array(z.string()),
  recommendedApproach: z.string(),
});
export type TechnicalSpecialistReview = z.infer<typeof technicalSpecialistReviewSchema>;

export const critiqueIssueSchema = z.object({
  type: z.enum([
    "LOGICAL_ERROR",
    "SECURITY_RISK",
    "UNNECESSARY_OPERATION",
    "MISSING_STEP",
    "UNSUPPORTED_ASSUMPTION",
  ]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  targetPlanId: z.string(),
  stepId: z.string().optional(),
  description: z.string(),
  recommendation: z.string(),
});
export type CritiqueIssue = z.infer<typeof critiqueIssueSchema>;

export const critiqueSchema = z.object({
  role: z.literal("CRITIC"),
  evaluatedPlanIds: z.array(z.string()),
  issues: z.array(critiqueIssueSchema),
  overallVerdict: z.enum(["ACCEPTABLE", "NEEDS_REVISION", "REJECTED_UNSAFE"]),
  summary: z.string(),
});
export type Critique = z.infer<typeof critiqueSchema>;

export const planEvaluationSchema = z.object({
  planId: z.string(),
  score: z.number().min(0).max(100),
  isSafe: z.boolean(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  verdict: z.enum(["RECOMMENDED", "VIABLE", "REJECTED"]),
});
export type PlanEvaluation = z.infer<typeof planEvaluationSchema>;

export const finalProposalStepSchema = z.object({
  stepId: z.string(),
  tool: z.string(),
  description: z.string(),
  dependencies: z.array(z.string()),
  risk: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  requiresApproval: z.boolean(),
  input: z.record(z.string(), z.any()).optional(),
});
export type FinalProposalStep = z.infer<typeof finalProposalStepSchema>;

export const finalProposalSchema = z.object({
  proposalId: z.string(),
  taskId: z.string(),
  userObjective: z.string(),
  relevantContextSummary: z.string(),
  proposedApproach: z.string(),
  steps: z.array(finalProposalStepSchema),
  requiredTools: z.array(z.string()),
  expectedOutputs: z.array(z.string()),
  risks: z.array(z.string()),
  permissionsRequired: z.array(z.string()),
  requiresApproval: z.boolean(),
  estimatedComplexity: z.enum(["LOW", "MEDIUM", "HIGH"]),
  conciseSummary: z.string(),
  status: z.enum(["PROPOSED", "APPROVED", "REJECTED", "EXECUTING", "COMPLETED", "FAILED"]).default("PROPOSED"),
});
export type FinalProposal = z.infer<typeof finalProposalSchema>;

export type AgentActivityStage =
  | "ANALYZING"
  | "GATHERING_CONTEXT"
  | "PLANNING"
  | "CRITIQUING"
  | "EVALUATING"
  | "PROPOSAL_READY"
  | "WAITING_FOR_APPROVAL"
  | "EXECUTING"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface AgentActivityPayload {
  taskId: string;
  stage: AgentActivityStage;
  agentRole?: AgentRole;
  summary: string;
  evidence?: string;
  debateRound?: number;
  metrics?: {
    tokensUsed?: number;
    costUsd?: number;
    latencyMs?: number;
  };
  timestamp: string;
}

export interface ProposalReadyPayload {
  taskId: string;
  proposal: FinalProposal;
  timestamp: string;
}

export interface PlanningLatencyMetrics {
  classificationMs: number;
  contextGatheringMs: number;
  plannerMs: number;
  specialistMs: number;
  criticMs: number;
  judgeMs: number;
  totalPlanningMs: number;
  debateRounds: number;
  tokensUsed: number;
  estimatedCostUsd: number;
}
