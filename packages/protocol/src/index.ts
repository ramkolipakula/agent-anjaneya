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
  | "HEARTBEAT";

export interface RealtimeMessage<T = any> {
  id: string;
  type: MessageType;
  timestamp: string;
  sourceDeviceId: string;
  targetDeviceId: string;
  payload?: T;
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
