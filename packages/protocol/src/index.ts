export type DeviceType = "MOBILE" | "DESKTOP";

export type DeviceStatus = "ONLINE" | "OFFLINE" | "CONNECTING" | "RECONNECTING";

export type PairingSessionStatus = "ACTIVE" | "USED" | "EXPIRED" | "CANCELLED";

export type TaskStatus =
  | "CREATED"
  | "QUEUED"
  | "RECEIVED"
  | "RUNNING"
  | "WAITING_FOR_USER"
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
  | "TASK_PROGRESS"
  | "TASK_COMPLETED"
  | "TASK_FAILED"
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
  user_id: string;
  desktop_device_id: string;
  created_by_device_id: string;
  input_text: string;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

export interface TaskEvent {
  id: string;
  task_id: string;
  event_type: string;
  payload?: any;
  source_device_id: string;
  created_at: string;
}

export const ALLOWED_MESSAGE_TYPES: ReadonlyArray<MessageType> = [
  "DEVICE_CONNECTED",
  "DEVICE_DISCONNECTED",
  "PING",
  "PONG",
  "TASK_CREATED",
  "TASK_RECEIVED",
  "TASK_PROGRESS",
  "TASK_COMPLETED",
  "TASK_FAILED",
  "HEARTBEAT",
  "PAIRING_SUCCESSFUL",
  "ERROR",
];

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
