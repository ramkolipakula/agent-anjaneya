import { io, Socket } from "socket.io-client";
import assert from "assert";

const BACKEND_URL = "http://localhost:3000";

async function runLiveE2E() {
  console.log("=== STARTING LIVE E2E CLIENT PAIRING TEST ===");

  // Step 1: Desktop requests pairing session
  console.log("Step 1: Desktop requests pairing session from /api/pairing...");
  const desktopInitRes = await fetch(`${BACKEND_URL}/api/pairing`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceName: "E2E-Ram-PC",
    }),
  });

  assert(desktopInitRes.ok, `Desktop pairing request failed: ${desktopInitRes.statusText}`);
  const desktopPairing = await desktopInitRes.json();
  console.log("✔ Desktop pairing session created:", {
    deviceId: desktopPairing.deviceId,
    pairingSessionId: desktopPairing.pairingSessionId,
  });

  // Step 2: Desktop connects to WebSocket with authenticated credentials
  console.log("Step 2: Desktop connects to Socket.IO with credentials...");
  const desktopSocket: Socket = io(BACKEND_URL, {
    auth: {
      deviceId: desktopPairing.deviceId,
      deviceSecret: desktopPairing.deviceSecret,
    },
  });

  await new Promise<void>((resolve, reject) => {
    desktopSocket.on("connect", () => {
      console.log("✔ Desktop socket connected and authenticated.");
      resolve();
    });
    desktopSocket.on("connect_error", (err) => reject(new Error("Desktop socket auth failed: " + err.message)));
  });

  // Setup desktop message listener
  let desktopReceivedTask: any = null;
  desktopSocket.on("message", (msg) => {
    console.log("[Desktop Socket Message]", msg.type);
    if (msg.type === "TASK_CREATED") {
      desktopReceivedTask = msg;
      // Reply immediately
      desktopSocket.emit("message", {
        id: Math.random().toString(36).substring(7),
        type: "TASK_COMPLETED",
        timestamp: new Date().toISOString(),
        sourceDeviceId: desktopPairing.deviceId,
        targetDeviceId: msg.sourceDeviceId,
        payload: { text: "Hello from your computer." },
      });
    }
  });

  // Step 3: Mobile scans/verifies pairing
  console.log("Step 3: Mobile verifies pairing via /api/pairing/verify...");
  const mobileVerifyRes = await fetch(`${BACKEND_URL}/api/pairing/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pairingSessionId: desktopPairing.pairingSessionId,
      pairingToken: desktopPairing.pairingToken,
      mobileDeviceName: "E2E-Phone",
    }),
  });

  assert(mobileVerifyRes.ok, `Mobile verification failed: ${mobileVerifyRes.statusText}`);
  const mobilePairing = await mobileVerifyRes.json();
  assert(mobilePairing.success, "Mobile pairing must succeed");
  console.log("✔ Mobile verified successfully:", {
    mobileDeviceId: mobilePairing.mobileDeviceId,
    desktopDeviceId: mobilePairing.desktopDeviceId,
  });

  // Step 4: Mobile connects to WebSocket with authenticated credentials
  console.log("Step 4: Mobile connects to Socket.IO with credentials...");
  const mobileSocket: Socket = io(BACKEND_URL, {
    auth: {
      deviceId: mobilePairing.mobileDeviceId,
      deviceSecret: mobilePairing.mobileDeviceSecret,
    },
  });

  await new Promise<void>((resolve, reject) => {
    mobileSocket.on("connect", () => {
      console.log("✔ Mobile socket connected and authenticated.");
      resolve();
    });
    mobileSocket.on("connect_error", (err) => reject(new Error("Mobile socket auth failed: " + err.message)));
  });

  // Step 5: Mobile sends test command: "Hello from my phone."
  console.log("Step 5: Mobile sends 'Hello from my phone.' to Desktop...");
  const sentTime = Date.now();

  const responsePromise = new Promise<{ msg: any; rtt: number }>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for Desktop response")), 5000);
    mobileSocket.on("message", (msg) => {
      console.log("[Mobile Socket Message]", msg.type);
      if (msg.type === "TASK_COMPLETED") {
        clearTimeout(timeout);
        const rtt = Date.now() - sentTime;
        resolve({ msg, rtt });
      }
    });
  });

  mobileSocket.emit("message", {
    id: Math.random().toString(36).substring(7),
    type: "TASK_CREATED",
    timestamp: new Date().toISOString(),
    sourceDeviceId: mobilePairing.mobileDeviceId,
    targetDeviceId: desktopPairing.deviceId,
    payload: { text: "Hello from my phone." },
  });

  const { msg: computerReply, rtt } = await responsePromise;
  console.log(`✔ Computer response received: "${computerReply.payload?.text}"`);
  console.log(`✔ Round-Trip Latency (RTT): ${rtt} ms`);
  assert.strictEqual(computerReply.payload?.text, "Hello from your computer.");
  assert(rtt < 500, `RTT latency (${rtt}ms) must be under 500ms`);

  // Step 6: Test Reconnect & Offline Behavior
  console.log("Step 6: Testing Desktop disconnect and Mobile status update...");
  const disconnectPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for disconnect event")), 5000);
    mobileSocket.on("message", (msg) => {
      if (msg.type === "DEVICE_DISCONNECTED" && msg.sourceDeviceId === desktopPairing.deviceId) {
        clearTimeout(timeout);
        console.log("✔ Mobile received DEVICE_DISCONNECTED for Desktop.");
        resolve();
      }
    });
  });

  desktopSocket.disconnect();
  await disconnectPromise;

  // Cleanup
  mobileSocket.disconnect();

  console.log("\n=======================================================");
  console.log("🎉 LIVE E2E CLIENT PAIRING TEST COMPLETED SUCCESSFULLY!");
  console.log("=======================================================");
  process.exit(0);
}

runLiveE2E().catch((err) => {
  console.error("❌ LIVE E2E TEST FAILED:", err);
  process.exit(1);
});
