"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { io, Socket } from "socket.io-client";
import {
  DeviceStatus,
  RealtimeMessage,
  TaskStatus,
  AgentActivityPayload,
  AgentRole,
  FinalProposal,
  isTerminalTaskStatus,
} from "@agent-anjaneya/protocol";
import {
  Monitor,
  Smartphone,
  RefreshCw,
  Send,
  ShieldCheck,
  Copy,
  Check,
  Unlink,
  FolderLock,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  FileCheck,
  AlertTriangle,
  FolderPlus,
  Trash2,
  Activity,
  Cpu,
  Layers,
  Terminal,
  Search,
  Sparkles,
  Bell,
  ChevronDown,
  ChevronRight,
  Folder,
  Music,
  Video,
  Image as ImageIcon,
  FileText,
  Settings,
  LayoutDashboard,
  ListTodo,
  ExternalLink,
  ShieldAlert,
  Sliders,
  Scale,
  Brain,
  Wrench,
  X,
  Plus,
} from "lucide-react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

interface TaskProgressStep {
  step: string;
  message: string;
  status: TaskStatus;
  timestamp: string;
  progressPercent?: number;
}

interface ActiveTaskState {
  id: string;
  inputText: string;
  status: TaskStatus;
  plan?: any;
  steps: TaskProgressStep[];
  result?: any;
  error?: string;
  startedAt: string;
  completedAt?: string;
  latencyMetrics?: any;
}

interface AllowedFolder {
  id: string;
  name: string;
  path: string;
  readOnly: boolean;
  isDefault?: boolean;
}

interface AuditEntry {
  id: string;
  timestamp: string;
  eventType: string;
  action: string;
  status: string;
  toolName?: string;
  error?: string;
}

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  time: string;
  type: "success" | "warning" | "info";
}

export default function Home() {
  const [isMounted, setIsMounted] = useState(false);
  const [deviceId, setDeviceId] = useState<string>("");
  const [deviceSecret, setDeviceSecret] = useState<string>("");
  const [pairingPayload, setPairingPayload] = useState<any>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  const [connectionStatus, setConnectionStatus] = useState<DeviceStatus>("CONNECTING");
  const [pairingStatus, setPairingStatus] = useState<"WAITING" | "PAIRED">("WAITING");
  const [pairedMobileId, setPairedMobileId] = useState<string | null>(null);
  const [pairedMobileName, setPairedMobileName] = useState<string>("");
  const [pairedMobileStatus, setPairedMobileStatus] = useState<"ONLINE" | "OFFLINE">("OFFLINE");

  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Command input bar state
  const [desktopCommandInput, setDesktopCommandInput] = useState("");

  // Engine state: real active task (null by default until started or resumed)
  const [activeTask, setActiveTask] = useState<ActiveTaskState | null>(null);
  const [taskHistory, setTaskHistory] = useState<ActiveTaskState[]>([]);
  const [agentActivities, setAgentActivities] = useState<AgentActivityPayload[]>([]);

  const [allowedFolders, setAllowedFolders] = useState<AllowedFolder[]>([
    { id: "dir-1", name: "Desktop", path: "C:\\Users\\Ramk\\Desktop", readOnly: false, isDefault: true },
    { id: "dir-2", name: "Documents", path: "C:\\Users\\Ramk\\Documents", readOnly: false, isDefault: true },
    { id: "dir-3", name: "Downloads", path: "C:\\Users\\Ramk\\Downloads", readOnly: false, isDefault: true },
    { id: "dir-4", name: "Videos", path: "C:\\Users\\Ramk\\Videos", readOnly: false, isDefault: true },
    { id: "dir-5", name: "D:\\ Drive Root", path: "D:\\", readOnly: true, isDefault: false },
  ]);

  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderPath, setNewFolderPath] = useState("");

  // Modals & Panels
  const [showPairingModal, setShowPairingModal] = useState(false);
  const [showFilesModal, setShowFilesModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [activeNavTab, setActiveNavTab] = useState<"dashboard" | "tasks" | "devices" | "files" | "settings">("dashboard");

  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const executedTaskIdsRef = useRef<Set<string>>(new Set());

  // Elapsed time counter - only runs while an active task is running/planning
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!activeTask || isTerminalTaskStatus(activeTask.status)) return;
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [activeTask?.status, activeTask?.id]);

  // Notifications list (populated by real events)
  const [notifications, setNotifications] = useState<NotificationItem[]>([
    {
      id: "n-init",
      title: "Agent Anjaneya Ready",
      message: "Desktop execution engine and security policies active.",
      time: "Just now",
      type: "info",
    },
  ]);

  // Keep refs to avoid stale closures in socket handlers
  const deviceIdRef = useRef(deviceId);
  deviceIdRef.current = deviceId;
  const pairedMobileIdRef = useRef(pairedMobileId);
  pairedMobileIdRef.current = pairedMobileId;
  const socketRef = useRef<Socket | null>(socket);
  socketRef.current = socket;
  const activeTaskRef = useRef<ActiveTaskState | null>(activeTask);
  activeTaskRef.current = activeTask;

  // Auto-scroll logs
  useEffect(() => {
    if (autoScrollLogs && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [activeTask?.steps, autoScrollLogs]);

  // Fetch allowed directories and tasks
  const refreshEngineData = async () => {
    try {
      const res = await fetch("/api/tasks");
      if (res.ok) {
        const data = await res.json();
        if (data.directories && data.directories.length > 0) {
          setAllowedFolders(data.directories);
        }
        if (data.auditLogs) setAuditLogs(data.auditLogs);
        if (data.tasks && data.tasks.length > 0) {
          const formattedTasks: ActiveTaskState[] = data.tasks.map((t: any) => ({
            id: t.id,
            inputText: t.inputText,
            status: t.status,
            plan: t.plan,
            steps: t.steps || [],
            result: t.result,
            error: t.error,
            startedAt: t.createdAt,
            completedAt: t.updatedAt,
            latencyMetrics: t.latencyMetrics,
          }));
          setTaskHistory(formattedTasks);
          // If no active task currently selected, pick running/waiting task if available
          const inProgress = formattedTasks.find((t) => !isTerminalTaskStatus(t.status));
          if (inProgress && !activeTaskRef.current) {
            setActiveTask(inProgress);
          }
        }
      }
    } catch (e) {
      console.warn("Failed to fetch engine data:", e);
    }
  };

  // Fetch / bootstrap pairing session
  const fetchPairingSession = async (currentDeviceId?: string, currentSecret?: string, forceUnpair = false) => {
    setIsRefreshing(true);
    try {
      const idToUse = currentDeviceId ?? (typeof window !== "undefined" ? localStorage.getItem("desktopDeviceId") || undefined : undefined);
      const secretToUse = currentSecret ?? (typeof window !== "undefined" ? localStorage.getItem("desktopDeviceSecret") || undefined : undefined);

      const res = await fetch(`${BACKEND_URL}/api/pairing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: idToUse,
          deviceSecret: secretToUse,
          deviceName: "Ram-PC",
          unpair: forceUnpair,
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed to initialize pairing: ${res.statusText}`);
      }

      const data = await res.json();
      setDeviceId(data.deviceId);
      setDeviceSecret(data.deviceSecret);
      localStorage.setItem("desktopDeviceId", data.deviceId);
      localStorage.setItem("desktopDeviceSecret", data.deviceSecret);

      const qrData = {
        pairingSessionId: data.pairingSessionId,
        pairingToken: data.pairingToken,
        pinCode: data.pinCode,
        desktopDeviceId: data.deviceId,
        serverUrl: BACKEND_URL,
        expiresAt: data.expiresAt,
      };
      setPairingPayload(qrData);

      if (data.pairedMobile && !forceUnpair) {
        setPairingStatus("PAIRED");
        setPairedMobileId(data.pairedMobile.deviceId);
        setPairedMobileName(data.pairedMobile.deviceName || "Mobile Device");
        setPairedMobileStatus(data.pairedMobile.status || "ONLINE");
      } else {
        setPairingStatus("WAITING");
        setPairedMobileId(null);
        setPairedMobileName("");
        setPairedMobileStatus("OFFLINE");
      }
    } catch (err: any) {
      console.warn("Backend pairing check (offline mode fallback):", err.message);
      // Fallback local credentials so the desktop runs smoothly even before backend starts
      const localId = currentDeviceId || localStorage.getItem("desktopDeviceId") || "desktop-h4b648";
      setDeviceId(localId);
      setConnectionStatus("ONLINE");
    } finally {
      setIsRefreshing(false);
    }
  };

  // Execute task via engine streaming endpoint
  const executeTaskWithEngine = async (taskId: string, inputText: string, targetDeviceId: string) => {
    const startedAt = new Date().toISOString();
    setElapsedSeconds(0);
    setAgentActivities([]);
    const newTask: ActiveTaskState = {
      id: taskId,
      inputText,
      status: "PLANNING",
      steps: [
        {
          step: "RECEIVED",
          message: `Received command: "${inputText}"`,
          status: "RECEIVED",
          timestamp: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }),
        },
        {
          step: "PLANNING",
          message: "Analyzing task instruction...",
          status: "PLANNING",
          timestamp: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }),
        },
      ],
      startedAt,
    };

    setActiveTask(newTask);

    // Notify backend & paired mobile about TASK_CREATED
    if (socketRef.current) {
      socketRef.current.emit("message", {
        id: Math.random().toString(36).substring(7),
        type: "TASK_CREATED",
        timestamp: startedAt,
        sourceDeviceId: deviceIdRef.current || "desktop-client",
        targetDeviceId: targetDeviceId || pairedMobileIdRef.current || "mobile-client",
        payload: { taskId, text: inputText },
      });
    }

    try {
      const response = await fetch("/api/tasks/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          inputText,
          mobileDeviceId: targetDeviceId,
          desktopDeviceId: deviceIdRef.current || "desktop-client",
          mobileSentAt: startedAt,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Engine execution failed: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            handleEngineEvent(event, targetDeviceId);
          } catch (e) {
            console.error("Failed to parse engine stream event:", e);
          }
        }
      }
    } catch (err: any) {
      console.error("Error executing task:", err);
      setActiveTask((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          status: "FAILED",
          error: err.message,
          steps: [
            ...prev.steps,
            {
              step: "FAILED",
              message: err.message,
              status: "FAILED",
              timestamp: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }),
            },
          ],
        };
      });

      if (socketRef.current) {
        socketRef.current.emit("message", {
          id: Math.random().toString(36).substring(7),
          type: "TASK_FAILED",
          timestamp: new Date().toISOString(),
          sourceDeviceId: deviceIdRef.current,
          targetDeviceId,
          payload: { taskId, status: "FAILED", error: err.message },
        });
      }
    } finally {
      refreshEngineData();
    }
  };

  const handleEngineEvent = (event: { type: string; payload: any }, targetDeviceId: string) => {
    const { type, payload } = event;

    // Forward event to mobile via authenticated WebSocket
    if (socketRef.current && pairedMobileIdRef.current) {
      socketRef.current.emit("message", {
        id: Math.random().toString(36).substring(7),
        type,
        timestamp: new Date().toISOString(),
        sourceDeviceId: deviceIdRef.current,
        targetDeviceId: targetDeviceId || pairedMobileIdRef.current,
        payload,
      });
    }

    if (type === "AGENT_ACTIVITY") {
      setAgentActivities((prev) => [...prev, payload]);
    }

    if (type === "TASK_APPROVAL_REQUEST") {
      setNotifications((prev) => [
        {
          id: `n-${Date.now()}`,
          title: "Approval Needed",
          message: payload.title || "Plan ready for approval",
          time: "Just now",
          type: "warning",
        },
        ...prev.slice(0, 9),
      ]);
    }

    if (type === "TASK_COMPLETED") {
      setNotifications((prev) => [
        {
          id: `n-${Date.now()}`,
          title: "Task Completed",
          message: payload.summary || "Task executed successfully",
          time: "Just now",
          type: "success",
        },
        ...prev.slice(0, 9),
      ]);
    }

    if (type === "TASK_FAILED") {
      setNotifications((prev) => [
        {
          id: `n-${Date.now()}`,
          title: "Task Failed",
          message: payload.error || "Task encountered an error",
          time: "Just now",
          type: "warning",
        },
        ...prev.slice(0, 9),
      ]);
    }

    // Update desktop state
    setActiveTask((prev) => {
      if (!prev || (payload.taskId && prev.id !== payload.taskId)) return prev;

      const newSteps = [...prev.steps];
      if (payload.message) {
        newSteps.push({
          step: payload.step || type,
          message: payload.message,
          status: payload.status || prev.status,
          timestamp: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }),
          progressPercent: payload.progressPercent,
        });
      }

      const updated: ActiveTaskState = {
        ...prev,
        status: payload.status || (type === "TASK_APPROVAL_REQUEST" ? "WAITING_FOR_APPROVAL" : prev.status),
        plan: payload.proposal ? { ...prev.plan, proposal: payload.proposal, ...payload } : (payload.plan || payload.operation ? { ...prev.plan, ...payload } : prev.plan),
        steps: newSteps,
        result: payload.outputPath || payload.metadata || payload.summary ? payload : prev.result,
        error: payload.error || prev.error,
        latencyMetrics: payload.latencyMetrics || prev.latencyMetrics,
        completedAt: payload.status === "COMPLETED" || payload.status === "FAILED" || payload.status === "CANCELLED" ? new Date().toISOString() : prev.completedAt,
      };

      if (payload.status === "COMPLETED" || payload.status === "FAILED" || payload.status === "CANCELLED") {
        setTaskHistory((hist) => [updated, ...hist.filter(h => h.id !== updated.id).slice(0, 19)]);
      }

      return updated;
    });
  };

  // Submit task directly from desktop input bar
  const handleDesktopSubmitCommand = (customPrompt?: string) => {
    const promptText = (customPrompt || desktopCommandInput).trim();
    if (!promptText) return;

    const newTaskId = "task-" + Math.random().toString(36).substring(2, 9);
    setDesktopCommandInput("");
    executeTaskWithEngine(newTaskId, promptText, pairedMobileId || "mobile-client");
  };

  // Initialize client credentials on mount
  useEffect(() => {
    setIsMounted(true);
    const storedId = localStorage.getItem("desktopDeviceId") || "desktop-h4b648";
    const storedSecret = localStorage.getItem("desktopDeviceSecret") || "";
    setDeviceId(storedId);
    setDeviceSecret(storedSecret);

    fetchPairingSession(storedId, storedSecret);
    refreshEngineData();
  }, []);

  // Establish Authenticated Socket.io Connection
  useEffect(() => {
    if (!deviceId || !deviceSecret) return;

    setConnectionStatus("CONNECTING");

    const newSocket = io(BACKEND_URL, {
      auth: { deviceId, deviceSecret },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
    });

    setSocket(newSocket);

    newSocket.on("connect", () => {
      setConnectionStatus("ONLINE");
    });

    newSocket.on("connect_error", () => {
      setConnectionStatus("RECONNECTING");
    });

    newSocket.on("disconnect", () => {
      setConnectionStatus("OFFLINE");
    });

    newSocket.on("message", (msg: RealtimeMessage) => {
      if (msg.type === "PAIRING_SUCCESSFUL") {
        setPairingStatus("PAIRED");
        const mobileId = msg.payload?.mobileDeviceId || msg.sourceDeviceId;
        setPairedMobileId(mobileId);
        setPairedMobileName(msg.payload?.mobileDeviceName || "Mobile Device");
        setPairedMobileStatus("ONLINE");
        setNotifications((prev) => [
          {
            id: `n-${Date.now()}`,
            title: "Device Paired",
            message: `Mobile phone paired successfully (${mobileId}).`,
            time: "Just now",
            type: "success",
          },
          ...prev.slice(0, 9),
        ]);
      }

      if (msg.type === "DEVICE_CONNECTED" && msg.sourceDeviceId !== deviceIdRef.current) {
        setPairingStatus("PAIRED");
        setPairedMobileId(msg.sourceDeviceId);
        setPairedMobileStatus("ONLINE");
        setNotifications((prev) => [
          {
            id: `n-${Date.now()}`,
            title: "Device Online",
            message: `Mobile device (${msg.sourceDeviceId}) is connected.`,
            time: "Just now",
            type: "info",
          },
          ...prev.slice(0, 9),
        ]);
      }

      if (msg.type === "DEVICE_DISCONNECTED" && msg.sourceDeviceId === pairedMobileIdRef.current) {
        setPairedMobileStatus("OFFLINE");
        setNotifications((prev) => [
          {
            id: `n-${Date.now()}`,
            title: "Device Disconnected",
            message: `Mobile device disconnected.`,
            time: "Just now",
            type: "warning",
          },
          ...prev.slice(0, 9),
        ]);
      }

      if (msg.type === "TASK_CREATED") {
        const text = msg.payload?.text || "What are the folders present in D drive?";
        const taskId = msg.payload?.taskId || msg.id;
        if (executedTaskIdsRef.current.has(taskId)) {
          console.warn(`[Desktop] Duplicate TASK_CREATED received for ${taskId}. Skipping duplicate execution.`);
          return;
        }
        executedTaskIdsRef.current.add(taskId);
        setNotifications((prev) => [
          {
            id: `n-${Date.now()}`,
            title: "Task Received",
            message: `Command from mobile: "${text}"`,
            time: "Just now",
            type: "info",
          },
          ...prev.slice(0, 9),
        ]);
        executeTaskWithEngine(taskId, text, msg.sourceDeviceId);
      }

      if (msg.type === "TASK_APPROVAL_RESPONSE") {
        const { taskId, approved, reason } = msg.payload || {};
        if (taskId) {
          fetch(`/api/tasks/${taskId}/approve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ approved, reason }),
          }).catch(console.error);

          setActiveTask((prev) => {
            if (!prev || prev.id !== taskId) return prev;
            return {
              ...prev,
              status: approved ? "APPROVED" : "CANCELLED",
              steps: [
                ...prev.steps,
                {
                  step: "APPROVAL",
                  message: approved ? "Approved remotely by mobile user." : `Rejected by mobile user: ${reason || "User rejected"}`,
                  status: approved ? "APPROVED" : "CANCELLED",
                  timestamp: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }),
                },
              ],
            };
          });
        }
      }

      if (msg.type === "TASK_CANCEL") {
        const { taskId, reason } = msg.payload || {};
        if (taskId) {
          fetch(`/api/tasks/${taskId}/cancel`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason }),
          }).catch(console.error);
          setActiveTask((prev) => {
            if (!prev || prev.id !== taskId) return prev;
            return { ...prev, status: "CANCELLED" };
          });
        }
      }
    });

    return () => {
      newSocket.disconnect();
    };
  }, [deviceId, deviceSecret]);

  // Periodic heartbeat
  useEffect(() => {
    if (!socket || connectionStatus !== "ONLINE" || !deviceId) return;

    const interval = setInterval(() => {
      socket.emit("message", {
        id: Math.random().toString(36).substring(7),
        type: "HEARTBEAT",
        timestamp: new Date().toISOString(),
        sourceDeviceId: deviceId,
        targetDeviceId: pairedMobileId || "server",
      });
    }, 10000);

    return () => clearInterval(interval);
  }, [socket, connectionStatus, deviceId, pairedMobileId]);

  // Handle local approval from desktop
  const handleDesktopApproval = async (approved: boolean) => {
    if (!activeTask || activeTask.status !== "WAITING_FOR_APPROVAL" || isSubmittingApproval) return;
    setIsSubmittingApproval(true);
    setApprovalError(null);
    try {
      const res = await fetch(`/api/tasks/${activeTask.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Approval failed with HTTP ${res.status}`);
      }

      // Optimistic update
      setActiveTask((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          status: approved ? "APPROVED" : "CANCELLED",
          steps: [
            ...prev.steps,
            {
              step: "APPROVAL",
              message: approved ? "Task approved by desktop user." : "Task rejected by desktop user.",
              status: approved ? "APPROVED" : "CANCELLED",
              timestamp: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }),
            },
          ],
        };
      });

      if (socketRef.current && pairedMobileIdRef.current) {
        socketRef.current.emit("message", {
          id: Math.random().toString(36).substring(7),
          type: "TASK_APPROVAL_RESPONSE",
          timestamp: new Date().toISOString(),
          sourceDeviceId: deviceIdRef.current,
          targetDeviceId: pairedMobileIdRef.current,
          payload: { taskId: activeTask.id, approved },
        });
      }
    } catch (e: any) {
      console.error("Failed to approve task from desktop:", e);
      setApprovalError(e.message || "Failed to submit approval response.");
    } finally {
      setIsSubmittingApproval(false);
    }
  };

  const handleDesktopCancel = async () => {
    if (!activeTask) return;
    try {
      await fetch(`/api/tasks/${activeTask.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Cancelled by desktop user" }),
      });
      setActiveTask((prev) => (prev ? { ...prev, status: "CANCELLED" } : null));
    } catch (e) {
      console.error("Failed to cancel task:", e);
    }
  };

  const handleAddFolder = async () => {
    if (!newFolderName.trim() || !newFolderPath.trim()) return;
    try {
      const res = await fetch("/api/directories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFolderName.trim(), path: newFolderPath.trim() }),
      });
      if (res.ok) {
        setNewFolderName("");
        setNewFolderPath("");
        refreshEngineData();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to add folder");
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleRemoveFolder = async (id: string) => {
    try {
      await fetch(`/api/directories?id=${id}`, { method: "DELETE" });
      refreshEngineData();
    } catch (e) {
      console.error(e);
    }
  };

  const copyPairingCode = () => {
    if (!pairingPayload) return;
    navigator.clipboard.writeText(JSON.stringify(pairingPayload));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUnpair = async () => {
    setPairingStatus("WAITING");
    setPairedMobileId(null);
    setPairedMobileStatus("OFFLINE");
    await fetchPairingSession(undefined, undefined, true);
  };


  // Multi-step progress nodes matching desktop reference image
  const stepperStages = [
    { key: "ANALYZING", label: "Analyzing" },
    { key: "CONTEXT", label: "Gathering Context" },
    { key: "PLANNING", label: "Planning" },
    { key: "REVIEWING", label: "Reviewing" },
    { key: "FINALIZING", label: "Finalizing" },
    { key: "WAITING_APPROVAL", label: "Waiting Approval" },
    { key: "EXECUTING", label: "Executing" },
    { key: "COMPLETED", label: "Completed" },
  ];

  // Derive current active stage index
  const getActiveStepperIndex = (): number => {
    if (!activeTask) return 0;
    switch (activeTask.status) {
      case "RECEIVED":
        return 0;
      case "PLANNING":
        return 2; // Planning active
      case "WAITING_FOR_APPROVAL":
        return 5;
      case "APPROVED":
      case "RUNNING":
      case "VERIFYING":
        return 6;
      case "COMPLETED":
        return 7;
      default:
        return 2;
    }
  };

  const currentStepperIdx = getActiveStepperIndex();

  const agentRolesConfig = [
    {
      role: "TASK_ANALYST" as const,
      name: "Task Analyst",
      icon: Brain,
      bg: "bg-purple-50",
      color: "text-purple-600",
      defaultDesc: "Analyzes user intent, constraints, and objective.",
    },
    {
      role: "CONTEXT" as const,
      name: "Context Layer",
      icon: Folder,
      bg: "bg-cyan-50",
      color: "text-cyan-600",
      defaultDesc: "Gathers permitted filesystem and workspace context.",
    },
    {
      role: "PLANNER" as const,
      name: "Planner Agent",
      icon: Layers,
      bg: "bg-purple-50",
      color: "text-purple-600",
      defaultDesc: "Generates multi-step candidate execution plans.",
    },
    {
      role: "TECHNICAL_SPECIALIST" as const,
      name: "Technical Specialist",
      icon: Wrench,
      bg: "bg-blue-50",
      color: "text-blue-600",
      defaultDesc: "Validates tool compatibility and execution feasibility.",
    },
    {
      role: "CRITIC" as const,
      name: "Critic Agent",
      icon: ShieldAlert,
      bg: "bg-red-50",
      color: "text-red-600",
      defaultDesc: "Audits plans for security, permissions, and logic errors.",
    },
    {
      role: "JUDGE" as const,
      name: "Judge Agent",
      icon: Scale,
      bg: "bg-amber-50",
      color: "text-amber-600",
      defaultDesc: "Evaluates alternatives and selects the winning proposal.",
    },
  ];

  const getAgentRoleStatus = (role: string) => {
    let act: AgentActivityPayload | undefined;
    if (role === "CONTEXT") {
      act = agentActivities.find((a) => a.stage === "GATHERING_CONTEXT" || a.summary?.includes("Context"));
    } else {
      act = [...agentActivities].reverse().find((a) => a.agentRole === role);
    }

    if (act) {
      return {
        state: "COMPLETED",
        summary: act.summary,
      };
    }

    if (!activeTask || isTerminalTaskStatus(activeTask.status)) {
      return { state: "STANDBY", summary: undefined };
    }

    const currentIdx = currentStepperIdx;
    let isActive = false;
    if (role === "TASK_ANALYST" && currentIdx === 0) isActive = true;
    else if (role === "CONTEXT" && currentIdx === 1) isActive = true;
    else if (role === "PLANNER" && currentIdx === 2) isActive = true;
    else if (role === "TECHNICAL_SPECIALIST" && currentIdx === 2) isActive = true;
    else if (role === "CRITIC" && currentIdx === 3) isActive = true;
    else if (role === "JUDGE" && currentIdx === 4) isActive = true;

    return {
      state: isActive ? "RUNNING" : "PENDING",
      summary: isActive ? "Processing..." : undefined,
    };
  };

  return (
    <div className="min-h-screen bg-[#f4f6fb] text-slate-800 font-sans flex flex-col antialiased">
      {/* ========================================================================= */}
      {/* 1. TOP HEADER BAR */}
      {/* ========================================================================= */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-5 py-2.5 flex items-center justify-between gap-4 shadow-xs">
        {/* Left: Window Controls + Brand */}
        <div className="flex items-center gap-4 min-w-[240px]">
          {/* macOS window dots */}
          <div className="flex items-center gap-1.5 pr-2">
            <span className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] cursor-pointer hover:opacity-80" />
            <span className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] cursor-pointer hover:opacity-80" />
            <span className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] cursor-pointer hover:opacity-80" />
          </div>

          {/* Logo + Brand Name */}
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20">
              <Cpu size={20} />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-tight text-slate-900 leading-tight">Agent Anjaneya</span>
              <span className="text-[11px] font-medium text-slate-400 leading-tight">Desktop Agent</span>
            </div>
          </div>
        </div>

        {/* Middle: Natural Language Task Input Bar */}
        <div className="flex-1 max-w-xl mx-auto">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleDesktopSubmitCommand();
            }}
            className="relative flex items-center w-full"
          >
            <div className="w-full bg-white border border-slate-200 hover:border-slate-300 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 rounded-full shadow-xs px-4 py-1.5 flex items-center gap-2.5 transition-all">
              <Sparkles size={17} className="text-indigo-500 shrink-0" />
              <input
                type="text"
                value={desktopCommandInput}
                onChange={(e) => setDesktopCommandInput(e.target.value)}
                placeholder="Ask me to do anything on your computer..."
                className="w-full bg-transparent text-xs md:text-sm text-slate-800 placeholder-slate-400 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!desktopCommandInput.trim()}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition shrink-0 ${
                  desktopCommandInput.trim()
                    ? "bg-blue-600 hover:bg-blue-700 text-white shadow-xs cursor-pointer active:scale-95"
                    : "bg-blue-500/80 text-white cursor-pointer"
                }`}
                title="Send Command"
              >
                <Send size={13} className="translate-x-[-0.5px] translate-y-[-0.5px]" />
              </button>
            </div>
          </form>
        </div>

        {/* Right: Connection Status + Notifications + User Avatar */}
        <div className="flex items-center gap-3 min-w-[240px] justify-end">
          {/* Server Connection Status Pill */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
              connectionStatus === "ONLINE"
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-amber-50 text-amber-700 border-amber-200"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                connectionStatus === "ONLINE" ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
              }`}
            />
            <span>Connected to Server</span>
          </div>

          {/* Notifications Bell */}
          <div className="relative">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition relative"
              title="Notifications"
            >
              <Bell size={15} />
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white">
                3
              </span>
            </button>

            {/* Notifications Dropdown */}
            {showNotifications && (
              <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-xl border border-slate-200 p-3 z-50 animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                  <span className="text-xs font-bold text-slate-800">Notifications</span>
                  <span className="text-[11px] text-blue-600 font-semibold cursor-pointer hover:underline">Mark read</span>
                </div>
                <div className="flex flex-col gap-2">
                  {notifications.map((n) => (
                    <div key={n.id} className="p-2 rounded-xl bg-slate-50 hover:bg-slate-100/80 transition flex flex-col gap-0.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-slate-800">{n.title}</span>
                        <span className="text-slate-400 text-[10px]">{n.time}</span>
                      </div>
                      <span className="text-slate-500 text-[11px] leading-tight">{n.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* User Profile Avatar with dropdown */}
          <div className="flex items-center gap-1.5 cursor-pointer pl-1">
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-semibold text-xs flex items-center justify-center shadow-xs">
              R
            </div>
            <ChevronDown size={14} className="text-slate-400" />
          </div>

          {/* Window Control Buttons (minimize, maximize, close) */}
          <div className="hidden lg:flex items-center gap-2 pl-2 text-slate-400 border-l border-slate-200 ml-1">
            <span className="w-3 h-0.5 bg-slate-400 rounded-full cursor-pointer hover:bg-slate-600" />
            <span className="w-2.5 h-2.5 border border-slate-400 rounded-xs cursor-pointer hover:border-slate-600" />
            <X size={13} className="cursor-pointer hover:text-slate-700" />
          </div>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. THREE-COLUMN DASHBOARD LAYOUT */}
      {/* ========================================================================= */}
      <div className="flex-1 p-4 md:p-5 max-w-[1600px] w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* ======================================================================= */}
        {/* LEFT COLUMN: Sidebar Navigation + Device Info + Storage Usage */}
        {/* ======================================================================= */}
        <aside className="lg:col-span-2 flex flex-col gap-4">
          {/* Navigation Menu */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-2 shadow-xs flex flex-col gap-1">
            <button
              onClick={() => setActiveNavTab("dashboard")}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs md:text-sm font-semibold transition text-left ${
                activeNavTab === "dashboard"
                  ? "bg-purple-100/70 text-indigo-700"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
              }`}
            >
              <LayoutDashboard size={17} className={activeNavTab === "dashboard" ? "text-indigo-600" : "text-slate-500"} />
              <span>Dashboard</span>
            </button>

            <button
              onClick={() => setActiveNavTab("tasks")}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs md:text-sm font-medium transition text-left ${
                activeNavTab === "tasks"
                  ? "bg-purple-100/70 text-indigo-700 font-semibold"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
              }`}
            >
              <div className="flex items-center gap-3">
                <ListTodo size={17} className="text-slate-500" />
                <span>Tasks</span>
              </div>
              <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[11px] font-bold flex items-center justify-center">
                3
              </span>
            </button>

            <button
              onClick={() => setShowPairingModal(true)}
              className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs md:text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition text-left"
            >
              <Smartphone size={17} className="text-slate-500" />
              <span>Devices</span>
            </button>

            <button
              onClick={() => setShowFilesModal(true)}
              className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs md:text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition text-left"
            >
              <Folder size={17} className="text-slate-500" />
              <span>Files</span>
            </button>

            <button
              onClick={() => setShowFilesModal(true)}
              className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs md:text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition text-left"
            >
              <Settings size={17} className="text-slate-500" />
              <span>Settings</span>
            </button>
          </div>

          {/* Desktop Identity Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-3.5 shadow-xs flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Monitor size={22} />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-bold text-slate-900 leading-tight">Ram-PC</span>
              <span className="text-[11px] text-slate-400 font-mono leading-tight truncate">
                {deviceId || "desktop-h4b648"}
              </span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-[11px] font-semibold text-emerald-600">Online</span>
              </div>
            </div>
          </div>

          {/* Storage Usage Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col gap-2.5">
            <span className="text-xs font-bold text-slate-800">Storage Usage</span>
            <span className="text-xs font-semibold text-slate-700">C: 145 GB / 237 GB</span>

            {/* Segmented Progress Bar */}
            <div className="w-full h-2 rounded-full bg-slate-100 flex overflow-hidden">
              <div className="bg-blue-600 h-full" style={{ width: "20%" }} />
              <div className="bg-cyan-500 h-full" style={{ width: "10%" }} />
              <div className="bg-amber-400 h-full" style={{ width: "8%" }} />
              <div className="bg-orange-400 h-full" style={{ width: "42%" }} />
            </div>

            {/* Storage Breakdown Dots */}
            <div className="grid grid-cols-2 gap-y-1.5 gap-x-2 pt-1 text-[11px]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />
                  <span className="text-slate-500">Videos</span>
                </div>
                <span className="font-semibold text-slate-700">28 GB</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-cyan-500 shrink-0" />
                  <span className="text-slate-500">Documents</span>
                </div>
                <span className="font-semibold text-slate-700">12 GB</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                  <span className="text-slate-500">Downloads</span>
                </div>
                <span className="font-semibold text-slate-700">8 GB</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0" />
                  <span className="text-slate-500">Others</span>
                </div>
                <span className="font-semibold text-slate-700">97 GB</span>
              </div>
            </div>
          </div>
        </aside>

        {/* ======================================================================= */}
        {/* CENTER COLUMN: Main Workspace Area */}
        {/* ======================================================================= */}
        <main className="lg:col-span-7 flex flex-col gap-4">
          {/* Welcome Banner Card with 4 Quick Actions */}
          <div className="bg-gradient-to-r from-purple-50/70 via-indigo-50/40 to-blue-50/30 border border-indigo-100/60 rounded-2xl p-5 shadow-xs flex flex-col">
            <h2 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">Hello Ram! 👋</h2>
            <p className="text-xs md:text-sm text-slate-500 mt-0.5 mb-4">Your AI desktop agent is ready to help.</p>

            {/* 4 Shortcut Action Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Find Files */}
              <button
                onClick={() => handleDesktopSubmitCommand("Find video.mp4 and extract the first 10 seconds")}
                className="bg-white border border-slate-200/80 hover:border-blue-300 hover:shadow-sm rounded-xl p-3 flex items-center gap-2.5 transition text-left cursor-pointer group"
              >
                <div className="w-9 h-9 rounded-xl bg-blue-50 group-hover:bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 transition">
                  <Folder size={18} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold text-slate-800 leading-tight">Find Files</span>
                  <span className="text-[10px] text-slate-400 leading-tight truncate">Search anything</span>
                </div>
              </button>

              {/* Process Media */}
              <button
                onClick={() => handleDesktopSubmitCommand("Process video.mp4 in my Videos folder")}
                className="bg-white border border-slate-200/80 hover:border-purple-300 hover:shadow-sm rounded-xl p-3 flex items-center gap-2.5 transition text-left cursor-pointer group"
              >
                <div className="w-9 h-9 rounded-xl bg-purple-50 group-hover:bg-purple-100 text-purple-600 flex items-center justify-center shrink-0 transition">
                  <Video size={18} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold text-slate-800 leading-tight">Process Media</span>
                  <span className="text-[10px] text-slate-400 leading-tight truncate">Videos, audio, images</span>
                </div>
              </button>

              {/* Build & Run */}
              <button
                onClick={() => handleDesktopSubmitCommand("Build a portfolio website using my projects")}
                className="bg-white border border-slate-200/80 hover:border-emerald-300 hover:shadow-sm rounded-xl p-3 flex items-center gap-2.5 transition text-left cursor-pointer group"
              >
                <div className="w-9 h-9 rounded-xl bg-emerald-50 group-hover:bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0 transition">
                  <Cpu size={18} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold text-slate-800 leading-tight">Build &amp; Run</span>
                  <span className="text-[10px] text-slate-400 leading-tight truncate">Programming tasks</span>
                </div>
              </button>

              {/* Manage System */}
              <button
                onClick={() => handleDesktopSubmitCommand("What are the folders present in D drive?")}
                className="bg-white border border-slate-200/80 hover:border-amber-300 hover:shadow-sm rounded-xl p-3 flex items-center gap-2.5 transition text-left cursor-pointer group"
              >
                <div className="w-9 h-9 rounded-xl bg-amber-50 group-hover:bg-amber-100 text-amber-600 flex items-center justify-center shrink-0 transition">
                  <Settings size={18} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold text-slate-800 leading-tight">Manage System</span>
                  <span className="text-[10px] text-slate-400 leading-tight truncate">Apps, files, settings</span>
                </div>
              </button>
            </div>
          </div>

          {/* Current Task Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col gap-4">
            {activeTask ? (
              <>
                {/* Header: Title + Phase Badge + Elapsed Timer + Cancel Button */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                      <Layers size={15} />
                    </div>
                    <span className="text-sm font-bold text-slate-800">Current Task</span>
                    <span className="bg-purple-100 text-purple-700 border border-purple-200/60 text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
                      Phase 3 • Multi-Agent
                    </span>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <div className="flex items-center gap-1.5 text-xs text-slate-400">
                      <Clock size={13} />
                      <span>{elapsedSeconds}s elapsed</span>
                    </div>
                    {!isTerminalTaskStatus(activeTask.status) && (
                      <button
                        onClick={handleDesktopCancel}
                        className="bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 text-xs font-semibold px-3 py-1 rounded-full transition cursor-pointer"
                      >
                        Cancel Task
                      </button>
                    )}
                  </div>
                </div>

                {/* Robot Avatar + Task Title + Stage Message */}
                <div className="flex items-center gap-4 py-1">
                  <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
                    <div className="absolute inset-0 rounded-full bg-blue-100/60 animate-ping opacity-25" />
                    <div className="absolute inset-[-4px] rounded-full bg-gradient-to-tr from-blue-200 via-purple-100 to-indigo-100 opacity-60" />
                    <div className="relative w-14 h-14 rounded-full overflow-hidden shadow-sm border-2 border-white bg-slate-900 flex items-center justify-center">
                      <Image
                        src="/robot_avatar.png"
                        alt="Agent Avatar"
                        width={56}
                        height={56}
                        className="object-cover"
                        priority
                      />
                    </div>
                  </div>

                  <div className="flex flex-col min-w-0">
                    <h3 className="text-base font-bold text-slate-900 tracking-tight leading-snug">
                      {activeTask.inputText}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {activeTask.status === "WAITING_FOR_APPROVAL"
                        ? "Execution plan generated. Awaiting your approval to proceed..."
                        : activeTask.status === "RUNNING"
                        ? "Executing approved operations on your PC..."
                        : activeTask.status === "COMPLETED"
                        ? "Task execution completed successfully."
                        : activeTask.status === "FAILED"
                        ? `Task failed: ${activeTask.error || "Unknown error"}`
                        : activeTask.status === "CANCELLED"
                        ? "Task cancelled by user."
                        : "Analyzing your request and creating the best plan..."}
                    </p>
                  </div>
                </div>

                {/* Horizontal Stepper (8 Stages) */}
                <div className="pt-2 pb-1 overflow-x-auto">
                  <div className="flex items-center justify-between min-w-[560px] relative">
                    <div className="absolute top-2.5 left-4 right-4 h-0.5 bg-slate-200 -z-0" />
                    <div
                      className="absolute top-2.5 left-4 h-0.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 -z-0 transition-all duration-500"
                      style={{
                        width: `${Math.min(100, Math.max(0, (currentStepperIdx / (stepperStages.length - 1)) * 100))}%`,
                      }}
                    />

                    {stepperStages.map((stage, idx) => {
                      const isCompleted = idx < currentStepperIdx || activeTask.status === "COMPLETED";
                      const isActive = idx === currentStepperIdx && activeTask.status !== "COMPLETED";

                      return (
                        <div key={stage.key} className="flex flex-col items-center gap-1.5 relative z-10">
                          {isCompleted ? (
                            <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] shadow-xs">
                              <Check size={11} strokeWidth={3} />
                            </div>
                          ) : isActive ? (
                            <div className="w-5 h-5 rounded-full bg-purple-600 text-white flex items-center justify-center ring-4 ring-purple-100 shadow-xs animate-pulse">
                              <span className="w-1.5 h-1.5 rounded-full bg-white" />
                            </div>
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-white border-2 border-slate-300 flex items-center justify-center">
                              <span className="w-1 h-1 rounded-full bg-slate-300" />
                            </div>
                          )}
                          <span
                            className={`text-[10px] font-medium leading-tight text-center ${
                              isActive
                                ? "text-purple-700 font-bold"
                                : isCompleted
                                ? "text-blue-600 font-semibold"
                                : "text-slate-400"
                            }`}
                          >
                            {stage.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Approval Box: displayed when task WAITING_FOR_APPROVAL */}
                {activeTask.status === "WAITING_FOR_APPROVAL" && (
                  <div className="mt-2 bg-amber-50/80 border border-amber-200/80 rounded-2xl p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-amber-800">
                        <AlertTriangle size={18} className="text-amber-600" />
                        <span className="text-xs font-bold uppercase tracking-wider">User Authorization Required</span>
                      </div>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                        Risk: {activeTask.plan?.proposal?.risks?.length ? "Medium" : "Low"}
                      </span>
                    </div>

                    <div className="bg-white/90 border border-amber-200/60 rounded-xl p-3 text-xs flex flex-col gap-1.5">
                      <div className="flex items-center gap-2 text-slate-800 font-semibold">
                        <span>Proposed Action:</span>
                        <span className="text-blue-600 font-mono">
                          {activeTask.plan?.title || activeTask.plan?.proposal?.proposedApproach || activeTask.inputText}
                        </span>
                      </div>
                      <p className="text-slate-500 text-[11px]">
                        Permissions: {activeTask.plan?.proposal?.permissionsRequired?.join(", ") || (activeTask.plan?.intent === "VIDEO_TRIM" ? "Write permissions to output directory" : "Read-only access to authorized directories")}
                      </p>
                    </div>

                    {approvalError && (
                      <div className="p-2 bg-red-100 border border-red-300 rounded-lg text-red-700 text-xs">
                        {approvalError}
                      </div>
                    )}

                    <div className="flex items-center gap-3 pt-1">
                      <button
                        disabled={isSubmittingApproval}
                        onClick={() => handleDesktopApproval(true)}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow-xs transition flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {isSubmittingApproval ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                        <span>Approve &amp; Execute</span>
                      </button>
                      <button
                        disabled={isSubmittingApproval}
                        onClick={() => handleDesktopApproval(false)}
                        className="px-5 bg-white hover:bg-red-50 text-red-600 border border-red-200 text-xs font-bold py-2.5 rounded-xl transition cursor-pointer"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                )}

                {/* Completed Output Card */}
                {activeTask.status === "COMPLETED" && (
                  <div className="mt-2 bg-emerald-50/80 border border-emerald-200/80 rounded-2xl p-4 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                        <CheckCircle2 size={16} className="text-emerald-600" /> Task Execution Verified
                      </span>
                      <span className="text-[11px] font-mono text-emerald-700 font-semibold">
                        {activeTask.result?.summary ? "Success" : "Completed in 2.3s"}
                      </span>
                    </div>
                    {activeTask.result?.summary && (
                      <p className="text-xs text-slate-700 font-medium">{activeTask.result.summary}</p>
                    )}
                    {activeTask.result?.outputPath && (
                      <div className="bg-white border border-emerald-200 px-3 py-2 rounded-xl flex items-center justify-between text-xs font-mono">
                        <span className="text-slate-700 truncate">{activeTask.result.outputPath}</span>
                        <button
                          onClick={() => navigator.clipboard.writeText(activeTask.result.outputPath)}
                          className="p-1 hover:text-blue-600 text-slate-400 ml-2 cursor-pointer"
                          title="Copy"
                        >
                          <Copy size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-4 py-2">
                <div className="w-14 h-14 rounded-full overflow-hidden shadow-sm border-2 border-white bg-slate-900 flex items-center justify-center shrink-0">
                  <Image
                    src="/robot_avatar.png"
                    alt="Agent Avatar"
                    width={56}
                    height={56}
                    className="object-cover"
                    priority
                  />
                </div>
                <div className="flex flex-col min-w-0">
                  <h3 className="text-base font-bold text-slate-900 tracking-tight leading-snug">
                    AI Desktop Agent Ready
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Enter a natural-language task in the search bar above or click a shortcut card to start.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Under Current Task: 2 Side-by-Side Columns */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: Live Execution Log */}
            <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col h-[280px]">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-2.5">
                <div className="flex items-center gap-2">
                  <Terminal size={15} className="text-slate-600" />
                  <span className="text-xs font-bold text-slate-800">Live Execution Log</span>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <label className="flex items-center gap-1.5 text-slate-500 cursor-pointer">
                    <span className="text-[11px]">Auto-scroll</span>
                    <input
                      type="checkbox"
                      checked={autoScrollLogs}
                      onChange={(e) => setAutoScrollLogs(e.target.checked)}
                      className="rounded accent-blue-600 cursor-pointer w-3.5 h-3.5"
                    />
                  </label>
                  <button
                    onClick={() => {
                      if (activeTask) {
                        setActiveTask({ ...activeTask, steps: [] });
                      }
                    }}
                    className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 transition"
                  >
                    <Trash2 size={12} />
                    <span>Clear</span>
                  </button>
                </div>
              </div>

              {/* Log Stream */}
              <div ref={logsContainerRef} className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2 font-mono text-[11px]">
                {activeTask && activeTask.steps.length > 0 ? (
                  activeTask.steps.map((st, idx) => {
                    let badgeText = "SYSTEM";
                    let badgeColor = "bg-blue-50 text-blue-600 border-blue-200";
                    let dotColor = "bg-blue-500";

                    if (st.message.includes("Context Layer") || st.step === "GATHERING_CONTEXT") {
                      badgeText = "CONTEXT";
                      badgeColor = "bg-emerald-50 text-emerald-600 border-emerald-200";
                      dotColor = "bg-emerald-500";
                    } else if (st.message.includes("classified") || st.step === "ANALYZING") {
                      badgeText = "ANALYSIS";
                      badgeColor = "bg-indigo-50 text-indigo-600 border-indigo-200";
                      dotColor = "bg-indigo-500";
                    } else if (st.message.includes("Planner:") || st.step === "PLANNING") {
                      badgeText = "PLANNING";
                      badgeColor = "bg-purple-50 text-purple-600 border-purple-200";
                      dotColor = "bg-purple-500";
                    } else if (st.message.includes("Verification:") || st.message.includes("Checking")) {
                      badgeText = "SECURITY";
                      badgeColor = "bg-amber-50 text-amber-700 border-amber-200";
                      dotColor = "bg-amber-500";
                    } else if (st.message.includes("approval") || st.step === "APPROVAL") {
                      badgeText = "APPROVAL";
                      badgeColor = "bg-red-50 text-red-600 border-red-200";
                      dotColor = "bg-red-500";
                    } else if (st.message.includes("Analyst:")) {
                      badgeText = "AGENT";
                      badgeColor = "bg-blue-50 text-blue-600 border-blue-200";
                      dotColor = "bg-blue-500";
                    }

                    return (
                      <div key={idx} className="flex items-center justify-between gap-2 leading-relaxed">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] text-slate-400 shrink-0">{st.timestamp}</span>
                          <span className={`w-1.5 h-1.5 rounded-full ${dotColor} shrink-0`} />
                          <span className="text-slate-700 truncate font-sans text-xs">{st.message}</span>
                        </div>
                        <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border font-mono shrink-0 ${badgeColor}`}>
                          {badgeText}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400 text-xs font-sans">
                    Waiting for task execution...
                  </div>
                )}
              </div>
            </div>

            {/* Right: Agent Activity */}
            <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col h-[280px]">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-2.5">
                <div className="flex items-center gap-2">
                  <Brain size={16} className="text-indigo-600" />
                  <span className="text-xs font-bold text-slate-800">Agent Activity</span>
                </div>
                <span className="text-[11px] font-semibold text-slate-400">
                  {activeTask ? "Active Debate" : "Standby"}
                </span>
              </div>

              {/* 6 Multi-Agent Activities */}
              <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2.5">
                {agentRolesConfig.map((cfg) => {
                  const status = getAgentRoleStatus(cfg.role);
                  const Icon = cfg.icon;

                  return (
                    <div key={cfg.role} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-7 h-7 rounded-lg ${cfg.bg} ${cfg.color} flex items-center justify-center shrink-0`}>
                          <Icon size={14} />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-bold text-slate-800 leading-tight">{cfg.name}</span>
                          <span className="text-[10px] text-slate-400 leading-tight truncate">
                            {status.summary || cfg.defaultDesc}
                          </span>
                        </div>
                      </div>

                      {status.state === "COMPLETED" ? (
                        <div className="w-4 h-4 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center shrink-0">
                          <Check size={10} strokeWidth={3} />
                        </div>
                      ) : status.state === "RUNNING" ? (
                        <RefreshCw size={14} className="text-blue-600 animate-spin shrink-0" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-slate-200 shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </main>

        {/* ======================================================================= */}
        {/* RIGHT COLUMN: Connected Devices + Quick Access + Recent Tasks */}
        {/* ======================================================================= */}
        <aside className="lg:col-span-3 flex flex-col gap-4">
          {/* Connected Devices Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity size={15} className="text-blue-600" />
                <span className="text-xs font-bold text-slate-800">Connected Devices</span>
              </div>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                  pairedMobileStatus === "ONLINE" && pairingStatus === "PAIRED"
                    ? "text-emerald-600 bg-emerald-50 border-emerald-200"
                    : "text-slate-500 bg-slate-50 border-slate-200"
                }`}
              >
                {pairedMobileStatus === "ONLINE" && pairingStatus === "PAIRED" ? "1 online" : "0 online"}
              </span>
            </div>

            {/* Device Item */}
            {pairingStatus === "PAIRED" && pairedMobileId ? (
              <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50/80 hover:bg-slate-100 transition cursor-pointer">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-blue-100/70 text-blue-600 flex items-center justify-center shrink-0">
                    <Smartphone size={16} />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-bold text-slate-800 leading-tight truncate">
                      {pairedMobileName || "Mobile Device"}
                    </span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-slate-400 font-mono truncate">
                        {pairedMobileId}
                      </span>
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          pairedMobileStatus === "ONLINE" ? "bg-emerald-500 animate-pulse" : "bg-slate-300"
                        }`}
                      />
                      <span
                        className={`text-[10px] font-semibold ${
                          pairedMobileStatus === "ONLINE" ? "text-emerald-600" : "text-slate-400"
                        }`}
                      >
                        {pairedMobileStatus === "ONLINE" ? "Online" : "Offline"}
                      </span>
                    </div>
                  </div>
                </div>
                <ChevronRight size={14} className="text-slate-400 shrink-0" />
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center flex flex-col items-center gap-1">
                <Smartphone size={18} className="text-slate-400" />
                <span className="text-xs font-medium text-slate-600">No mobile device paired</span>
                <span className="text-[10px] text-slate-400">Scan QR or enter PIN to link phone</span>
              </div>
            )}

            {/* Pair New Device Button */}
            <button
              onClick={() => setShowPairingModal(true)}
              className="w-full bg-blue-50/70 hover:bg-blue-100 text-blue-600 text-xs font-semibold py-2 rounded-xl border border-blue-100 flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <Plus size={14} />
              <span>Pair New Device</span>
            </button>
          </div>

          {/* Quick Access Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Folder size={15} className="text-amber-500" />
              <span className="text-xs font-bold text-slate-800">Quick Access</span>
            </div>

            {/* 2-Column Grid of 6 Folders */}
            <div className="grid grid-cols-2 gap-2">
              {/* Desktop */}
              <div
                onClick={() => handleDesktopSubmitCommand("Show me files in Desktop")}
                className="p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100/80 transition flex items-center gap-2 cursor-pointer"
              >
                <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                  <Folder size={14} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold text-slate-800 leading-tight">Desktop</span>
                  <span className="text-[10px] text-slate-400 leading-tight">Open folder</span>
                </div>
              </div>

              {/* Documents */}
              <div
                onClick={() => handleDesktopSubmitCommand("Show me files in Documents")}
                className="p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100/80 transition flex items-center gap-2 cursor-pointer"
              >
                <div className="w-7 h-7 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center shrink-0">
                  <FileText size={14} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold text-slate-800 leading-tight">Documents</span>
                  <span className="text-[10px] text-slate-400 leading-tight">Open folder</span>
                </div>
              </div>

              {/* Downloads */}
              <div
                onClick={() => handleDesktopSubmitCommand("Show me files in Downloads")}
                className="p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100/80 transition flex items-center gap-2 cursor-pointer"
              >
                <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                  <Folder size={14} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold text-slate-800 leading-tight">Downloads</span>
                  <span className="text-[10px] text-slate-400 leading-tight">Open folder</span>
                </div>
              </div>

              {/* Videos */}
              <div
                onClick={() => handleDesktopSubmitCommand("Show me files in Videos")}
                className="p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100/80 transition flex items-center gap-2 cursor-pointer"
              >
                <div className="w-7 h-7 rounded-lg bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                  <Video size={14} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold text-slate-800 leading-tight">Videos</span>
                  <span className="text-[10px] text-slate-400 leading-tight">Open folder</span>
                </div>
              </div>

              {/* Pictures */}
              <div
                onClick={() => handleDesktopSubmitCommand("Show me files in Pictures")}
                className="p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100/80 transition flex items-center gap-2 cursor-pointer"
              >
                <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
                  <ImageIcon size={14} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold text-slate-800 leading-tight">Pictures</span>
                  <span className="text-[10px] text-slate-400 leading-tight">Open folder</span>
                </div>
              </div>

              {/* Music */}
              <div
                onClick={() => handleDesktopSubmitCommand("Show me files in Music")}
                className="p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100/80 transition flex items-center gap-2 cursor-pointer"
              >
                <div className="w-7 h-7 rounded-lg bg-pink-100 text-pink-600 flex items-center justify-center shrink-0">
                  <Music size={14} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold text-slate-800 leading-tight">Music</span>
                  <span className="text-[10px] text-slate-400 leading-tight">Open folder</span>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Tasks Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={15} className="text-slate-600" />
                <span className="text-xs font-bold text-slate-800">Recent Tasks</span>
              </div>
              <span className="text-[11px] text-blue-600 font-semibold cursor-pointer hover:underline">
                {taskHistory.length} total
              </span>
            </div>

            {/* List of Recent Tasks */}
            <div className="flex flex-col gap-2">
              {taskHistory.length > 0 ? (
                taskHistory.slice(0, 4).map((task) => (
                  <div
                    key={task.id}
                    onClick={() => {
                      setActiveTask(task);
                    }}
                    className={`p-2.5 rounded-xl border transition flex items-center justify-between gap-2 cursor-pointer ${
                      activeTask?.id === task.id
                        ? "bg-blue-50/60 border-blue-200 shadow-xs"
                        : "bg-slate-50/80 border-transparent hover:bg-slate-100"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {task.status === "COMPLETED" ? (
                        <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                          <Check size={13} strokeWidth={2.5} />
                        </div>
                      ) : task.status === "PLANNING" || task.status === "RUNNING" ? (
                        <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                          <RefreshCw size={13} className="animate-spin" />
                        </div>
                      ) : task.status === "APPROVED" || task.status === "WAITING_FOR_APPROVAL" ? (
                        <div className="w-7 h-7 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center shrink-0">
                          <Clock size={13} />
                        </div>
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                          <XCircle size={13} />
                        </div>
                      )}
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-semibold text-slate-800 leading-tight truncate">
                          {task.inputText}
                        </span>
                        <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-0.5">
                          <span className="font-semibold text-slate-500">{task.status}</span>
                          <span>•</span>
                          <span>
                            {task.startedAt
                              ? new Date(task.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                              : "Recent"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <ChevronRight size={14} className="text-slate-400 shrink-0" />
                  </div>
                ))
              ) : (
                <div className="p-3 text-center text-xs text-slate-400">
                  No tasks recorded yet. Submit a task above.
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* ========================================================================= */}
      {/* 3. DEVICE PAIRING MODAL */}
      {/* ========================================================================= */}
      {showPairingModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 flex flex-col gap-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Smartphone size={18} className="text-blue-600" />
                <h3 className="text-sm font-bold text-slate-800">Pair Mobile Device</h3>
              </div>
              <button
                onClick={() => setShowPairingModal(false)}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex flex-col items-center justify-center text-center gap-3 py-2">
              <p className="text-xs text-slate-500 max-w-xs">
                Scan this QR code with the Agent Anjaneya mobile application to link your phone.
              </p>

              {pairingPayload ? (
                <div className="p-3 bg-white rounded-2xl border-2 border-slate-100 shadow-sm">
                  <QRCodeSVG value={JSON.stringify(pairingPayload)} size={160} level="M" />
                </div>
              ) : (
                <div className="w-40 h-40 flex items-center justify-center bg-slate-50 rounded-2xl">
                  <RefreshCw className="animate-spin text-slate-400" size={32} />
                </div>
              )}

              {pairingPayload?.pinCode && (
                <div className="bg-blue-50 border border-blue-200 px-5 py-2.5 rounded-2xl w-full text-center">
                  <span className="text-[10px] uppercase font-bold text-blue-600 tracking-wider">Fast 6-Digit PIN Code</span>
                  <p className="text-xl font-mono font-bold text-slate-900 tracking-widest mt-0.5">
                    {pairingPayload.pinCode.slice(0, 3)}-{pairingPayload.pinCode.slice(3)}
                  </p>
                </div>
              )}

              <div className="flex gap-2 w-full pt-1">
                <button
                  onClick={copyPairingCode}
                  className="flex-1 flex items-center justify-center gap-1.5 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 py-2.5 px-3 rounded-xl font-semibold transition"
                >
                  {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  <span>{copied ? "Copied" : "Copy Payload"}</span>
                </button>

                {pairingStatus === "PAIRED" && (
                  <button
                    onClick={handleUnpair}
                    className="flex items-center justify-center gap-1 text-xs text-red-600 bg-red-50 hover:bg-red-100 py-2.5 px-4 rounded-xl font-semibold transition"
                  >
                    <Unlink size={13} />
                    <span>Unpair</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. ALLOWED FOLDERS & PERMISSIONS MODAL */}
      {/* ========================================================================= */}
      {showFilesModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 flex flex-col gap-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FolderLock size={18} className="text-blue-600" />
                <h3 className="text-sm font-bold text-slate-800">Allowed Folders &amp; Permissions</h3>
              </div>
              <button
                onClick={() => setShowFilesModal(false)}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500"
              >
                <X size={14} />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              The AI agent can only read, search, and process files in explicitly authorized directories.
            </p>

            {/* Add New Directory Form */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 flex flex-col gap-2">
              <span className="text-[11px] font-bold text-slate-700 uppercase">Authorize New Folder</span>
              <input
                type="text"
                placeholder="Folder Name (e.g. Projects)"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
              />
              <input
                type="text"
                placeholder="Absolute Path (e.g. C:\Projects)"
                value={newFolderPath}
                onChange={(e) => setNewFolderPath(e.target.value)}
                className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 font-mono focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={handleAddFolder}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-2 rounded-xl transition cursor-pointer mt-1"
              >
                Authorize Location
              </button>
            </div>

            {/* Allowed Directories List */}
            <div className="flex flex-col gap-2 overflow-y-auto max-h-[220px] pr-1">
              {allowedFolders.map((folder) => (
                <div
                  key={folder.id}
                  className="flex items-center justify-between bg-slate-50/80 border border-slate-200 p-2.5 rounded-xl hover:bg-slate-100 transition"
                >
                  <div className="flex flex-col min-w-0 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-800">{folder.name}</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded font-mono uppercase font-semibold ${
                          folder.readOnly ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {folder.readOnly ? "Read-Only" : "Read/Write"}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 font-mono truncate mt-0.5">{folder.path}</span>
                  </div>
                  {!folder.isDefault && (
                    <button
                      onClick={() => handleRemoveFolder(folder.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
