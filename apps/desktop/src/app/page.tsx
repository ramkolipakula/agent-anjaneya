"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { io, Socket } from "socket.io-client";
import { Device, RealtimeMessage } from "@agent-anjaneya/protocol";
import { Monitor, Smartphone, RefreshCw, Send } from "lucide-react";

export default function Home() {
  const [deviceId] = useState(() => {
    // simple device id generation
    const stored = typeof window !== 'undefined' ? localStorage.getItem("desktopDeviceId") : null;
    if (stored) return stored;
    const newId = "desktop-" + Math.random().toString(36).substring(7);
    if (typeof window !== 'undefined') localStorage.setItem("desktopDeviceId", newId);
    return newId;
  });

  const [pairingPayload, setPairingPayload] = useState<any>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<"WAITING" | "PAIRED">("WAITING");
  const [mobileDevice, setMobileDevice] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ time: string; text: string }[]>([]);

  useEffect(() => {
    const fetchPairing = async () => {
      try {
        const res = await fetch("http://localhost:3000/api/pairing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId, deviceName: "Ram-PC" })
        });
        const data = await res.json();
        setPairingPayload(data);
      } catch (err) {
        console.error("Error creating pairing session:", err);
      }
    };
    fetchPairing();
  }, [deviceId]);

  useEffect(() => {
    const newSocket = io("http://localhost:3000");
    setSocket(newSocket);

    newSocket.on("connect", () => {
      console.log("Connected to realtime server");
      newSocket.emit("register", { deviceId });
    });

    newSocket.on("message", (msg: RealtimeMessage) => {
      console.log("Desktop received:", msg);
      
      if (msg.type === "DEVICE_CONNECTED" && msg.sourceDeviceId !== deviceId) {
        setStatus("PAIRED");
        setMobileDevice(msg.sourceDeviceId);
        addMessage(`Phone connected: ${msg.sourceDeviceId}`);
      }

      if (msg.type === "DEVICE_DISCONNECTED" && msg.sourceDeviceId === mobileDevice) {
        setStatus("WAITING");
        setMobileDevice(null);
        addMessage(`Phone disconnected`);
      }

      if (msg.type === "TASK_CREATED") {
        addMessage(`Test command received: ${msg.payload?.text || "Hello"}`);
        // Respond immediately
        setTimeout(() => {
          addMessage("Response sent");
          newSocket.emit("message", {
            id: Math.random().toString(36).substring(7),
            type: "TASK_COMPLETED",
            timestamp: new Date().toISOString(),
            sourceDeviceId: deviceId,
            targetDeviceId: msg.sourceDeviceId,
            payload: { text: "Hello from your computer." }
          });
        }, 500);
      }
    });

    return () => {
      newSocket.disconnect();
    };
  }, [deviceId, mobileDevice]);

  // Heartbeat
  useEffect(() => {
    if (!socket || !mobileDevice) return;
    const interval = setInterval(() => {
      socket.emit("message", {
        id: Math.random().toString(36).substring(7),
        type: "HEARTBEAT",
        timestamp: new Date().toISOString(),
        sourceDeviceId: deviceId,
        targetDeviceId: mobileDevice,
      });
    }, 10000);
    return () => clearInterval(interval);
  }, [socket, mobileDevice, deviceId]);

  const addMessage = (text: string) => {
    setMessages((prev) => [...prev, { time: new Date().toLocaleTimeString(), text }]);
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-white p-8 font-sans flex flex-col items-center justify-center">
      <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* Left Column - Device Info & Pairing */}
        <div className="bg-[#161b22] p-8 rounded-2xl shadow-xl border border-gray-800 flex flex-col gap-6">
          <div className="flex items-center gap-4 border-b border-gray-800 pb-6">
            <Monitor size={48} className="text-blue-500" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Ram-PC</h1>
              <p className="text-gray-400 text-sm font-mono mt-1">ID: {deviceId}</p>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-gray-400 font-medium">STATUS</span>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-green-500 animate-pulse"></span>
              <span className="font-bold text-green-500 tracking-wide">ONLINE</span>
            </div>
          </div>

          <div className="flex flex-col gap-4 items-center justify-center bg-black/30 p-8 rounded-xl border border-gray-800/50 flex-grow">
            {status === "WAITING" ? (
              <>
                <p className="text-gray-400 text-sm uppercase tracking-widest font-bold mb-2">Connect your phone</p>
                {pairingPayload ? (
                  <div className="bg-white p-4 rounded-xl shadow-lg">
                    <QRCodeSVG
                      value={JSON.stringify(pairingPayload)}
                      size={200}
                      level={"H"}
                    />
                  </div>
                ) : (
                  <RefreshCw className="animate-spin text-gray-500" size={32} />
                )}
                <p className="text-gray-500 text-xs mt-4">Waiting for connection...</p>
              </>
            ) : (
              <div className="flex flex-col items-center text-center gap-4">
                <div className="w-24 h-24 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <Smartphone size={48} className="text-blue-500" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Ram's Phone</h3>
                  <div className="flex items-center gap-2 justify-center mt-2">
                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                    <span className="text-green-500 font-medium text-sm">CONNECTED</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Activity */}
        <div className="bg-[#161b22] p-8 rounded-2xl shadow-xl border border-gray-800 flex flex-col">
          <h2 className="text-lg font-bold text-gray-400 tracking-wider mb-6 flex items-center gap-2">
            <Send size={18} /> RECENT ACTIVITY
          </h2>
          
          <div className="flex-1 flex flex-col gap-4 overflow-y-auto pr-2">
            {messages.length === 0 ? (
              <p className="text-gray-600 text-sm text-center mt-10">No recent activity.</p>
            ) : (
              messages.map((m, i) => (
                <div key={i} className="flex flex-col border-l-2 border-blue-500/30 pl-4 py-1">
                  <span className="text-xs text-blue-400/70 font-mono mb-1">{m.time}</span>
                  <span className="text-gray-200">{m.text}</span>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
