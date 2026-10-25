"use client";

import { useEffect, useState, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { io, Socket } from "socket.io-client";
import { DeviceStatus, RealtimeMessage, TaskStatus } from "@agent-anjaneya/protocol";
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

export default function Home() {
  const [isMounted, setIsMounted] = useState(false);
  const [deviceId, setDeviceId] = useState<string>("");
  const [deviceSecret, setDeviceSecret] = useState<string>("");
  const [pairingPayload, setPairingPayload] = useState<any>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  const [connectionStatus, setConnectionStatus] = useState<DeviceStatus>("CONNECTING");
  const [pairingStatus, setPairingStatus] = useState<"WAITING" | "PAIRED">("WAITING");
  const [pairedMobileId, setPairedMobileId] = useState<string | null>(null);
  const [pairedMobileName, setPairedMobileName] = useState<string>("Ram's Phone");
  const [pairedMobileStatus, setPairedMobileStatus] = useState<"ONLINE" | "OFFLINE">("OFFLINE");

  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Engine state
  const [activeTask, setActiveTask] = useState<ActiveTaskState | null>(null);
  const [taskHistory, setTaskHistory] = useState<ActiveTaskState[]>([]);
  const [allowedFolders, setAllowedFolders] = useState<AllowedFolder[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderPath, setNewFolderPath] = useState("");
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [activeTab, setActiveTab] = useState<"history" | "audit">("history");

  // Keep refs to avoid stale closures in socket handlers
  const deviceIdRef = useRef(deviceId);
  deviceIdRef.current = deviceId;
  const pairedMobileIdRef = useRef(pairedMobileId);
  pairedMobileIdRef.current = pairedMobileId;
  const socketRef = useRef<Socket | null>(socket);
  socketRef.current = socket;
  const activeTaskRef = useRef<ActiveTaskState | null>(activeTask);
  activeTaskRef.current = activeTask;

  // Fetch allowed directories and tasks
  const refreshEngineData = async () => {
    try {
      const res = await fetch("/api/tasks");
      if (res.ok) {
        const data = await res.json();
        if (data.directories) setAllowedFolders(data.directories);
        if (data.auditLogs) setAuditLogs(data.auditLogs);
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
        setPairedMobileName(data.pairedMobile.deviceName || "Ram's Phone");
        setPairedMobileStatus(data.pairedMobile.status || "OFFLINE");
      } else {
        setPairingStatus("WAITING");
        setPairedMobileId(null);
        setPairedMobileStatus("OFFLINE");
      }
    } catch (err: any) {
      console.error("Error creating pairing session:", err);
      setConnectionStatus("OFFLINE");
    } finally {
      setIsRefreshing(false);
    }
  };

  // Execute task via engine streaming endpoint
  const executeTaskWithEngine = async (taskId: string, inputText: string, targetDeviceId: string) => {
    const startedAt = new Date().toISOString();
    const newTask: ActiveTaskState = {
      id: taskId,
      inputText,
      status: "RECEIVED",
      steps: [
        {
          step: "RECEIVED",
          message: `Received command: "${inputText}"`,
          status: "RECEIVED",
          timestamp: new Date().toLocaleTimeString(),
        },
      ],
      startedAt,
    };

    setActiveTask(newTask);

    try {
      const response = await fetch("/api/tasks/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          inputText,
          mobileDeviceId: targetDeviceId,
          desktopDeviceId: deviceIdRef.current,
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
              timestamp: new Date().toLocaleTimeString(),
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
    if (socketRef.current) {
      socketRef.current.emit("message", {
        id: Math.random().toString(36).substring(7),
        type,
        timestamp: new Date().toISOString(),
        sourceDeviceId: deviceIdRef.current,
        targetDeviceId,
        payload,
      });
    }

    // Update desktop state
    setActiveTask((prev) => {
      if (!prev || prev.id !== payload.taskId) return prev;

      const newSteps = [...prev.steps];
      if (payload.message) {
        newSteps.push({
          step: payload.step || type,
          message: payload.message,
          status: payload.status || prev.status,
          timestamp: new Date().toLocaleTimeString(),
          progressPercent: payload.progressPercent,
        });
      }

      const updated: ActiveTaskState = {
        ...prev,
        status: payload.status || prev.status,
        steps: newSteps,
        result: payload.outputPath ? payload : prev.result,
        error: payload.error || prev.error,
        latencyMetrics: payload.latencyMetrics || prev.latencyMetrics,
        completedAt: payload.status === "COMPLETED" || payload.status === "FAILED" ? new Date().toISOString() : prev.completedAt,
      };

      if (payload.status === "COMPLETED" || payload.status === "FAILED" || payload.status === "CANCELLED") {
        setTaskHistory((hist) => [updated, ...hist.slice(0, 19)]);
      }

      return updated;
    });
  };

  // Initialize client credentials on mount
  useEffect(() => {
    setIsMounted(true);
    const storedId = localStorage.getItem("desktopDeviceId") || "";
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
        setPairedMobileName(msg.payload?.mobileDeviceName || "Ram's Phone");
        setPairedMobileStatus("ONLINE");
      }

      if (msg.type === "DEVICE_CONNECTED" && msg.sourceDeviceId !== deviceIdRef.current) {
        setPairingStatus("PAIRED");
        setPairedMobileId(msg.sourceDeviceId);
        setPairedMobileStatus("ONLINE");
      }

      if (msg.type === "DEVICE_DISCONNECTED" && msg.sourceDeviceId === pairedMobileIdRef.current) {
        setPairedMobileStatus("OFFLINE");
      }

      if (msg.type === "TASK_CREATED") {
        const text = msg.payload?.text || "Find video.mp4 and extract the first 10 seconds";
        const taskId = msg.payload?.taskId || msg.id;
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
    if (!activeTask) return;
    try {
      await fetch(`/api/tasks/${activeTask.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved }),
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
    } catch (e) {
      console.error("Failed to approve task from desktop:", e);
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
        setShowAddFolder(false);
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

  if (!isMounted) {
    return <div className="min-h-screen bg-[#090d16]" />;
  }

  const getStatusBadge = (status: TaskStatus) => {
    switch (status) {
      case "COMPLETED":
        return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5"><CheckCircle2 size={13} /> COMPLETED</span>;
      case "RUNNING":
        return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30 flex items-center gap-1.5"><RefreshCw size={13} className="animate-spin" /> RUNNING</span>;
      case "WAITING_FOR_APPROVAL":
        return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center gap-1.5"><AlertTriangle size={13} /> WAITING APPROVAL</span>;
      case "VERIFYING":
        return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/30 flex items-center gap-1.5"><FileCheck size={13} /> VERIFYING</span>;
      case "PLANNING":
        return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 flex items-center gap-1.5"><Cpu size={13} /> PLANNING</span>;
      case "CANCELLED":
        return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-gray-500/10 text-gray-400 border border-gray-500/30 flex items-center gap-1.5"><XCircle size={13} /> CANCELLED</span>;
      case "FAILED":
      default:
        return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-red-500/10 text-red-400 border border-red-500/30 flex items-center gap-1.5"><XCircle size={13} /> FAILED</span>;
    }
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 p-4 md:p-6 font-sans">
      <div className="max-w-7xl mx-auto flex flex-col gap-5">

        {/* Top Header Banner */}
        <header className="bg-[#111726] border border-slate-800/80 rounded-2xl p-4 md:p-5 flex flex-wrap items-center justify-between gap-4 shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Cpu size={24} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white">Agent Anjaneya</h1>
                <span className="bg-blue-500/20 text-blue-400 border border-blue-500/30 text-[11px] font-mono px-2 py-0.5 rounded-full font-semibold">
                  Phase 2 Engine
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Desktop Task Execution &amp; Permissioned Security Boundary</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Phone Status Badge */}
            <div className="flex items-center gap-2 bg-slate-900/80 border border-slate-800 px-3 py-1.5 rounded-xl text-xs">
              <Smartphone size={15} className={pairedMobileStatus === "ONLINE" ? "text-emerald-400" : "text-slate-500"} />
              <span className="text-slate-300 font-medium">{pairedMobileName}</span>
              <span className={`w-2 h-2 rounded-full ${pairedMobileStatus === "ONLINE" ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
            </div>

            {/* Server Connection Badge */}
            <div className="flex items-center gap-2 bg-slate-900/80 border border-slate-800 px-3 py-1.5 rounded-xl text-xs">
              <Activity size={15} className={connectionStatus === "ONLINE" ? "text-emerald-400" : "text-amber-400"} />
              <span className="text-slate-300 font-medium">Server: {connectionStatus}</span>
            </div>

            <button
              onClick={() => {
                fetchPairingSession();
                refreshEngineData();
              }}
              disabled={isRefreshing}
              className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl transition text-slate-300 hover:text-white"
              title="Refresh"
            >
              <RefreshCw size={15} className={isRefreshing ? "animate-spin text-blue-400" : ""} />
            </button>
          </div>
        </header>

        {/* 3-Column Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

          {/* Left Column (4 cols): Device Pairing & Allowed Folders */}
          <div className="lg:col-span-4 flex flex-col gap-5">
            {/* Pairing / Device Card */}
            <div className="bg-[#111726] border border-slate-800/80 rounded-2xl p-5 shadow-xl flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
                <div className="flex items-center gap-2.5">
                  <Monitor size={18} className="text-blue-400" />
                  <span className="text-sm font-bold tracking-wide text-slate-200 uppercase">Desktop Identity</span>
                </div>
                {pairingStatus === "PAIRED" && (
                  <button
                    onClick={handleUnpair}
                    className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 hover:underline transition"
                  >
                    <Unlink size={12} /> Unpair
                  </button>
                )}
              </div>

              {pairingStatus === "WAITING" ? (
                <div className="flex flex-col items-center justify-center p-3 text-center gap-3">
                  <p className="text-xs text-slate-400">Scan QR or enter PIN from your mobile device</p>
                  {pairingPayload ? (
                    <div className="bg-white p-3 rounded-xl shadow-lg">
                      <QRCodeSVG value={JSON.stringify(pairingPayload)} size={150} level="M" />
                    </div>
                  ) : (
                    <RefreshCw className="animate-spin text-slate-600" size={32} />
                  )}

                  {pairingPayload?.pinCode && (
                    <div className="bg-slate-900 border border-blue-500/30 px-4 py-2 rounded-xl text-center w-full">
                      <span className="text-[10px] uppercase font-bold text-blue-400 tracking-wider">Fast PIN Code</span>
                      <p className="text-lg font-mono font-bold text-white tracking-widest">
                        {pairingPayload.pinCode.slice(0, 3)}-{pairingPayload.pinCode.slice(3)}
                      </p>
                    </div>
                  )}

                  <button
                    onClick={copyPairingCode}
                    className="w-full flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 py-1.5 px-3 rounded-lg border border-slate-700/50 transition"
                  >
                    {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    <span>{copied ? "Copied Payload" : "Copy Fallback Code"}</span>
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5 bg-slate-900/60 p-3.5 rounded-xl border border-slate-800/60">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Computer Name:</span>
                    <span className="font-semibold text-white">Ram-PC</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Device ID:</span>
                    <span className="font-mono text-[11px] text-slate-300 truncate max-w-[150px]">{deviceId}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Paired Mobile:</span>
                    <span className="font-semibold text-emerald-400">{pairedMobileName}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Allowed Directories Manager Card */}
            <div className="bg-[#111726] border border-slate-800/80 rounded-2xl p-5 shadow-xl flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
                <div className="flex items-center gap-2.5">
                  <FolderLock size={18} className="text-blue-400" />
                  <span className="text-sm font-bold tracking-wide text-slate-200 uppercase">Allowed Folders</span>
                </div>
                <button
                  onClick={() => setShowAddFolder(!showAddFolder)}
                  className="p-1 hover:bg-slate-800 rounded-lg text-blue-400 hover:text-blue-300 transition"
                  title="Add Folder"
                >
                  <FolderPlus size={16} />
                </button>
              </div>

              {showAddFolder && (
                <div className="bg-slate-900 p-3 rounded-xl border border-blue-500/30 flex flex-col gap-2">
                  <span className="text-[11px] font-bold text-blue-400 uppercase">Authorize New Folder</span>
                  <input
                    type="text"
                    placeholder="Folder Name (e.g. Projects)"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  />
                  <input
                    type="text"
                    placeholder="Absolute Path (e.g. C:/Projects)"
                    value={newFolderPath}
                    onChange={(e) => setNewFolderPath(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                  />
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={handleAddFolder}
                      className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold py-1.5 rounded-lg transition"
                    >
                      Authorize
                    </button>
                    <button
                      onClick={() => setShowAddFolder(false)}
                      className="px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2 overflow-y-auto max-h-[260px] pr-1">
                {allowedFolders.map((folder) => (
                  <div
                    key={folder.id}
                    className="flex items-center justify-between bg-slate-900/70 border border-slate-800/80 p-2.5 rounded-xl hover:border-slate-700 transition"
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-white">{folder.name}</span>
                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded font-mono uppercase ${
                            folder.readOnly ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400"
                          }`}
                        >
                          {folder.readOnly ? "Read-Only" : "Read/Write"}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono truncate mt-0.5">{folder.path}</span>
                    </div>
                    {!folder.isDefault && (
                      <button
                        onClick={() => handleRemoveFolder(folder.id)}
                        className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Center Column (5 cols): Active Task Execution Engine */}
          <div className="lg:col-span-5 flex flex-col gap-5">
            <div className="bg-[#111726] border border-slate-800/80 rounded-2xl p-5 shadow-xl flex flex-col flex-1 min-h-[500px]">
              <div className="flex items-center justify-between border-b border-slate-800/60 pb-3 mb-4">
                <div className="flex items-center gap-2.5">
                  <Cpu size={18} className="text-indigo-400" />
                  <span className="text-sm font-bold tracking-wide text-slate-200 uppercase">Task Execution Engine</span>
                </div>
                {activeTask && getStatusBadge(activeTask.status)}
              </div>

              {!activeTask ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-3 text-slate-500">
                  <Play size={40} className="text-slate-700 animate-pulse" />
                  <p className="text-sm font-semibold text-slate-400">Awaiting Commands</p>
                  <p className="text-xs text-slate-500 max-w-xs">
                    Issue a command from your mobile app:
                    <br />
                    <span className="font-mono text-slate-400 italic">
                      "Find video.mp4 in my Videos folder and extract the first 10 seconds."
                    </span>
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-4 flex-1">
                  {/* Prompt Card */}
                  <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-xl">
                    <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Instruction</span>
                    <p className="text-sm font-medium text-white mt-1">"{activeTask.inputText}"</p>
                    <span className="text-[10px] text-slate-500 font-mono mt-1 block">Task ID: {activeTask.id}</span>
                  </div>

                  {/* Approval Prompt Box (if WAITING_FOR_APPROVAL) */}
                  {activeTask.status === "WAITING_FOR_APPROVAL" && (
                    <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl flex flex-col gap-3 animate-pulse">
                      <div className="flex items-center gap-2 text-amber-400">
                        <AlertTriangle size={18} />
                        <span className="text-xs font-bold uppercase tracking-wider">Approval Required</span>
                      </div>
                      <p className="text-xs text-slate-300">
                        Phone approval requested for video extraction. You may also authorize or cancel directly from desktop:
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDesktopApproval(true)}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2 rounded-lg transition"
                        >
                          Approve Operation
                        </button>
                        <button
                          onClick={() => handleDesktopApproval(false)}
                          className="px-4 bg-slate-800 hover:bg-slate-700 text-red-400 text-xs font-bold py-2 rounded-lg transition"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Progress Timeline */}
                  <div className="flex-1 bg-slate-950/60 border border-slate-900 p-3.5 rounded-xl overflow-y-auto max-h-[250px] flex flex-col gap-2.5">
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Execution Timeline</span>
                    {activeTask.steps.map((step, idx) => (
                      <div key={idx} className="flex items-start gap-2.5 text-xs">
                        <span className="text-[10px] font-mono text-slate-500 min-w-[55px] pt-0.5">{step.timestamp}</span>
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                        <div className="flex-1">
                          <span className="text-slate-200">{step.message}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Result & Latency Card */}
                  {activeTask.status === "COMPLETED" && (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 p-4 rounded-xl flex flex-col gap-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                          <CheckCircle2 size={16} /> Output Successfully Verified
                        </span>
                        {activeTask.result?.sizeBytes && (
                          <span className="text-[11px] font-mono text-slate-400">
                            {(activeTask.result.sizeBytes / 1024).toFixed(1)} KB
                          </span>
                        )}
                      </div>

                      {activeTask.result?.outputPath && (
                        <div className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-lg flex items-center justify-between text-xs font-mono">
                          <span className="text-slate-300 truncate">{activeTask.result.outputPath}</span>
                          <button
                            onClick={() => navigator.clipboard.writeText(activeTask.result.outputPath)}
                            className="p-1 hover:text-white text-slate-400 ml-2"
                            title="Copy Path"
                          >
                            <Copy size={13} />
                          </button>
                        </div>
                      )}

                      {/* Measured Latency Breakdown */}
                      {activeTask.latencyMetrics && (
                        <div className="grid grid-cols-3 gap-2 mt-1 pt-2 border-t border-emerald-500/20 text-[10px]">
                          <div>
                            <span className="text-slate-500 block">Planning:</span>
                            <span className="font-mono text-slate-300 font-bold">
                              {activeTask.latencyMetrics.planningDurationMs || 0}ms
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block">Execution:</span>
                            <span className="font-mono text-slate-300 font-bold">
                              {activeTask.latencyMetrics.executionDurationMs || 0}ms
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block">Round-Trip:</span>
                            <span className="font-mono text-emerald-400 font-bold">
                              {activeTask.latencyMetrics.totalRoundTripMs || 0}ms
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Failure Card */}
                  {activeTask.status === "FAILED" && (
                    <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl flex flex-col gap-1.5">
                      <span className="text-xs font-bold text-red-400 flex items-center gap-1.5">
                        <XCircle size={15} /> Task Failed
                      </span>
                      <p className="text-xs text-slate-300">{activeTask.error || "Unknown execution error"}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Column (3 cols): Task History & Security Audit */}
          <div className="lg:col-span-3 flex flex-col gap-5">
            <div className="bg-[#111726] border border-slate-800/80 rounded-2xl p-5 shadow-xl flex flex-col flex-1 min-h-[500px]">
              {/* Tab Selector */}
              <div className="flex items-center gap-2 border-b border-slate-800/60 pb-3 mb-3">
                <button
                  onClick={() => setActiveTab("history")}
                  className={`text-xs font-bold uppercase tracking-wider pb-1 transition flex items-center gap-1.5 ${
                    activeTab === "history" ? "text-blue-400 border-b-2 border-blue-500" : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Clock size={14} /> History
                </button>
                <button
                  onClick={() => setActiveTab("audit")}
                  className={`text-xs font-bold uppercase tracking-wider pb-1 transition flex items-center gap-1.5 ${
                    activeTab === "audit" ? "text-blue-400 border-b-2 border-blue-500" : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Terminal size={14} /> Audit Log
                </button>
              </div>

              {activeTab === "history" ? (
                <div className="flex flex-col gap-2.5 overflow-y-auto max-h-[420px] pr-1">
                  {taskHistory.length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-10">No recent tasks completed yet</p>
                  ) : (
                    taskHistory.map((task, idx) => (
                      <div
                        key={idx}
                        className="bg-slate-900/60 border border-slate-800 p-2.5 rounded-xl flex flex-col gap-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono text-slate-500">
                            {new Date(task.startedAt).toLocaleTimeString()}
                          </span>
                          {getStatusBadge(task.status)}
                        </div>
                        <span className="text-xs text-slate-200 line-clamp-2">"{task.inputText}"</span>
                        {task.result?.outputPath && (
                          <span className="text-[10px] text-emerald-400/80 font-mono truncate">
                            {task.result.outputPath}
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2 overflow-y-auto max-h-[420px] pr-1 font-mono text-[11px]">
                  {auditLogs.length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-10">No security audit logs yet</p>
                  ) : (
                    auditLogs.map((log) => (
                      <div
                        key={log.id}
                        className={`p-2 rounded-lg border ${
                          log.status === "DENIED" || log.status === "FAILURE"
                            ? "bg-red-500/10 border-red-500/30 text-red-300"
                            : "bg-slate-900/60 border-slate-800/80 text-slate-300"
                        }`}
                      >
                        <div className="flex items-center justify-between text-[9px] text-slate-500">
                          <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                          <span className="font-bold">{log.status}</span>
                        </div>
                        <p className="text-xs font-sans mt-0.5">{log.action}</p>
                        {log.error && <p className="text-[10px] text-red-400 mt-0.5">{log.error}</p>}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
