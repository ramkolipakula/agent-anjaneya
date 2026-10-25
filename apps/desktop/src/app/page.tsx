"use client";

import { useEffect, useState, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { io, Socket } from "socket.io-client";
import { DeviceStatus, RealtimeMessage } from "@agent-anjaneya/protocol";
import { Monitor, Smartphone, RefreshCw, Send, ShieldCheck, Copy, Check, Unlink } from "lucide-react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

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
  const [messages, setMessages] = useState<{ time: string; text: string }[]>([]);
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Keep ref to avoid stale closures in socket handlers
  const deviceIdRef = useRef(deviceId);
  deviceIdRef.current = deviceId;
  const pairedMobileIdRef = useRef(pairedMobileId);
  pairedMobileIdRef.current = pairedMobileId;

  const addMessage = (text: string) => {
    setMessages((prev) => [...prev, { time: new Date().toLocaleTimeString(), text }]);
  };

  // Fetch / bootstrap pairing session
  const fetchPairingSession = async (currentDeviceId?: string, currentSecret?: string) => {
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

      if (data.pairedMobile) {
        setPairingStatus("PAIRED");
        setPairedMobileId(data.pairedMobile.deviceId);
        setPairedMobileName(data.pairedMobile.deviceName || "Ram's Phone");
        setPairedMobileStatus(data.pairedMobile.status || "OFFLINE");
        addMessage(`Restored pairing with phone: ${data.pairedMobile.deviceName}`);
      }
    } catch (err: any) {
      console.error("Error creating pairing session:", err);
      setConnectionStatus("OFFLINE");
      addMessage("Failed to connect to backend server.");
    } finally {
      setIsRefreshing(false);
    }
  };

  // Initialize client credentials on mount
  useEffect(() => {
    setIsMounted(true);
    const storedId = localStorage.getItem("desktopDeviceId") || "";
    const storedSecret = localStorage.getItem("desktopDeviceSecret") || "";
    setDeviceId(storedId);
    setDeviceSecret(storedSecret);

    fetchPairingSession(storedId, storedSecret);
  }, []);

  // Establish Authenticated Socket.io Connection
  useEffect(() => {
    if (!deviceId || !deviceSecret) return;

    setConnectionStatus("CONNECTING");

    const newSocket = io(BACKEND_URL, {
      auth: {
        deviceId,
        deviceSecret,
      },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
    });

    setSocket(newSocket);

    newSocket.on("connect", () => {
      console.log("[Socket] Desktop connected successfully to server");
      setConnectionStatus("ONLINE");
      addMessage("Desktop connected to realtime server.");
    });

    newSocket.on("connect_error", (err) => {
      console.warn("[Socket] Desktop connection error:", err.message);
      setConnectionStatus("RECONNECTING");
    });

    newSocket.on("disconnect", (reason) => {
      console.log("[Socket] Desktop disconnected:", reason);
      setConnectionStatus("OFFLINE");
      addMessage("Desktop disconnected from server.");
    });

    newSocket.on("message", (msg: RealtimeMessage) => {
      console.log("[Socket] Desktop received message:", msg);

      if (msg.type === "PAIRING_SUCCESSFUL") {
        setPairingStatus("PAIRED");
        const mobileId = msg.payload?.mobileDeviceId || msg.sourceDeviceId;
        setPairedMobileId(mobileId);
        setPairedMobileName(msg.payload?.mobileDeviceName || "Ram's Phone");
        setPairedMobileStatus("ONLINE");
        addMessage(`Phone securely paired: ${msg.payload?.mobileDeviceName || mobileId}`);
      }

      if (msg.type === "DEVICE_CONNECTED" && msg.sourceDeviceId !== deviceIdRef.current) {
        setPairingStatus("PAIRED");
        setPairedMobileId(msg.sourceDeviceId);
        setPairedMobileStatus("ONLINE");
        addMessage(`Phone connected: ${msg.sourceDeviceId}`);
      }

      if (msg.type === "DEVICE_DISCONNECTED" && msg.sourceDeviceId === pairedMobileIdRef.current) {
        setPairedMobileStatus("OFFLINE");
        addMessage("Phone disconnected (OFFLINE).");
      }

      if (msg.type === "TASK_CREATED") {
        const text = msg.payload?.text || "Test command";
        addMessage(`Command received from phone: "${text}"`);

        // Acknowledge immediately
        setTimeout(() => {
          addMessage("Response sent: 'Hello from your computer.'");
          newSocket.emit("message", {
            id: Math.random().toString(36).substring(7),
            type: "TASK_COMPLETED",
            timestamp: new Date().toISOString(),
            sourceDeviceId: deviceIdRef.current,
            targetDeviceId: msg.sourceDeviceId,
            payload: { text: "Hello from your computer." },
          });
        }, 200);
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

  // Auto-refresh pairing session when close to expiring (every 4 minutes)
  useEffect(() => {
    if (pairingStatus !== "WAITING") return;

    const interval = setInterval(() => {
      fetchPairingSession();
    }, 4 * 60 * 1000);

    return () => clearInterval(interval);
  }, [pairingStatus]);

  const copyPairingCode = () => {
    if (!pairingPayload) return;
    navigator.clipboard.writeText(JSON.stringify(pairingPayload));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUnpair = () => {
    setPairingStatus("WAITING");
    setPairedMobileId(null);
    setPairedMobileStatus("OFFLINE");
    addMessage("Unpaired phone. Ready to pair new device.");
    fetchPairingSession();
  };

  if (!isMounted) {
    return <div className="min-h-screen bg-[#0d1117]" />;
  }

  const getStatusColor = (status: DeviceStatus) => {
    switch (status) {
      case "ONLINE":
        return "bg-green-500 text-green-400";
      case "CONNECTING":
      case "RECONNECTING":
        return "bg-yellow-500 text-yellow-400";
      case "OFFLINE":
      default:
        return "bg-red-500 text-red-400";
    }
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-white p-6 font-sans flex flex-col items-center justify-center">
      <div className="max-w-4xl w-full flex flex-col gap-6">
        
        {/* Architecture Notice Banner */}
        <div className="bg-[#161b22] border border-blue-900/40 p-3.5 rounded-xl flex items-center justify-between text-xs text-gray-300">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="text-blue-400" size={18} />
            <span>
              <strong>Phase 1.1 Foundation:</strong> Desktop Client (Bridge / Preview). Authenticated WebSocket &amp; Atomic QR Pairing active.
            </span>
          </div>
          <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded font-mono">
            Tauri Native Wrap: Phase 2
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left Column - Device Info & Pairing */}
          <div className="bg-[#161b22] p-6 rounded-2xl shadow-xl border border-gray-800 flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-gray-800 pb-5">
              <div className="flex items-center gap-4">
                <Monitor size={42} className="text-blue-500" />
                <div>
                  <h1 className="text-xl font-bold tracking-tight">Ram-PC</h1>
                  <p className="text-gray-400 text-xs font-mono mt-0.5 truncate max-w-[200px]">
                    ID: {deviceId || "Initializing..."}
                  </p>
                </div>
              </div>
              <button
                onClick={() => fetchPairingSession()}
                disabled={isRefreshing}
                className="p-2 hover:bg-slate-800 rounded-lg transition text-slate-400 hover:text-white"
                title="Refresh Pairing Code"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin text-blue-400" : ""}`} />
              </button>
            </div>

            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-400 font-medium">SERVER STATUS</span>
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    connectionStatus === "ONLINE" ? "bg-green-500 animate-pulse" : "bg-red-500"
                  }`}
                />
                <span className={`font-bold tracking-wide text-xs ${getStatusColor(connectionStatus).split(" ")[1]}`}>
                  {connectionStatus}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 items-center justify-center bg-black/40 p-6 rounded-xl border border-gray-800/60 flex-grow min-h-[320px]">
              {pairingStatus === "WAITING" ? (
                <>
                  <p className="text-gray-400 text-xs uppercase tracking-widest font-bold mb-1">
                    Connect your phone
                  </p>
                  {pairingPayload ? (
                    <div className="bg-white p-3.5 rounded-xl shadow-lg">
                      <QRCodeSVG value={JSON.stringify(pairingPayload)} size={180} level={"M"} />
                    </div>
                  ) : (
                    <RefreshCw className="animate-spin text-gray-500" size={32} />
                  )}
                  
                  {pairingPayload?.pinCode && (
                    <div className="bg-gray-800/80 px-4 py-2 rounded-xl border border-blue-500/30 text-center my-1 w-full">
                      <p className="text-[10px] uppercase tracking-wider text-blue-400 font-bold">Pairing PIN</p>
                      <p className="text-xl font-mono font-bold tracking-widest text-white">
                        {pairingPayload.pinCode.slice(0, 3)}-{pairingPayload.pinCode.slice(3)}
                      </p>
                    </div>
                  )}

                  <div className="w-full mt-1 flex flex-col gap-2">
                    <button
                      onClick={copyPairingCode}
                      className="flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-white bg-gray-800/60 hover:bg-gray-800 py-1.5 px-3 rounded-lg border border-gray-700/50 transition"
                    >
                      {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                      <span>{copied ? "Copied Pairing Payload" : "Copy Pairing Code (Fallback)"}</span>
                    </button>
                    <p className="text-gray-500 text-[11px] text-center">
                      Scan QR, enter PIN, or click 1-Click Connect on mobile
                    </p>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center text-center gap-4 py-4 w-full">
                  <div className="w-20 h-20 rounded-full bg-blue-500/10 flex items-center justify-center border border-blue-500/30">
                    <Smartphone size={40} className="text-blue-500" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">{pairedMobileName}</h3>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">{pairedMobileId}</p>
                    <div className="flex items-center gap-2 justify-center mt-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          pairedMobileStatus === "ONLINE" ? "bg-green-500 animate-pulse" : "bg-red-500"
                        }`}
                      />
                      <span
                        className={`text-xs font-semibold ${
                          pairedMobileStatus === "ONLINE" ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {pairedMobileStatus === "ONLINE" ? "CONNECTED (ONLINE)" : "DISCONNECTED (OFFLINE)"}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={handleUnpair}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-400 bg-gray-800/60 hover:bg-gray-800 py-1.5 px-3 rounded-lg border border-gray-700/50 transition mt-2"
                  >
                    <Unlink size={13} />
                    <span>Unpair / Pair New Phone</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Recent Activity */}
          <div className="bg-[#161b22] p-6 rounded-2xl shadow-xl border border-gray-800 flex flex-col">
            <h2 className="text-sm font-bold text-gray-400 tracking-wider mb-4 flex items-center gap-2">
              <Send size={16} /> RECENT ACTIVITY
            </h2>

            <div className="flex-1 flex flex-col gap-3 overflow-y-auto max-h-[360px] pr-2">
              {messages.length === 0 ? (
                <p className="text-gray-600 text-xs text-center mt-12">No activity yet. Pair mobile phone to begin.</p>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className="flex flex-col border-l-2 border-blue-500/40 pl-3 py-1">
                    <span className="text-[11px] text-blue-400/80 font-mono">{m.time}</span>
                    <span className="text-gray-200 text-xs mt-0.5">{m.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
