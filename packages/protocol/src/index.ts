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
  | "ERROR";

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
  intent: "VIDEO_TRIM" | "FIND_FILE" | "GET_METADATA" | "LIST_DIRECTORIES" | "UNSUPPORTED";
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
