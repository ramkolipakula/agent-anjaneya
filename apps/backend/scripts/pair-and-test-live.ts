import { io, Socket } from "socket.io-client";

const BACKEND_URL = "http://localhost:3000";

async function pairLiveDesktop() {
  console.log("=== EXECUTING LIVE PAIRING LOOP ===");

  // Step 1: Discover active desktop pairing session
  console.log("1. Checking active desktop session from /api/pairing...");
  const discoveryRes = await fetch(`${BACKEND_URL}/api/pairing`);
  const discoveryData = await discoveryRes.json();
  console.log("Active Desktop Discovery:", discoveryData);

  if (!discoveryData.active) {
    throw new Error("No active desktop pairing session found!");
  }

  const { pinCode, desktopDeviceId } = discoveryData;
  console.log(`✔ Found Desktop ${desktopDeviceId} with PIN: ${pinCode}`);

  // Step 2: Simulate Mobile Pairing using PIN
  console.log(`2. Simulating Mobile Pairing with PIN ${pinCode}...`);
  const mobileDeviceId = "mobile-ram-phone";
  const mobileVerifyRes = await fetch(`${BACKEND_URL}/api/pairing/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pinCode,
      mobileDeviceId,
      mobileDeviceName: "Ram's Phone (Mobile Web)",
    }),
  });

  const mobileVerifyData = await mobileVerifyRes.json();
  console.log("Mobile Pairing Result:", mobileVerifyData);

  if (!mobileVerifyData.success) {
    throw new Error(`Pairing verification failed: ${JSON.stringify(mobileVerifyData)}`);
  }

  const { mobileDeviceSecret } = mobileVerifyData;
  console.log("✔ Mobile credentials received.");

  // Step 3: Connect Mobile to Socket.IO with authenticated credentials
  console.log("3. Connecting Mobile Socket.IO...");
  const mobileSocket: Socket = io(BACKEND_URL, {
    auth: {
      deviceId: mobileDeviceId,
      deviceSecret: mobileDeviceSecret,
    },
  });

  await new Promise<void>((resolve, reject) => {
    mobileSocket.on("connect", () => {
      console.log("✔ Mobile Socket connected and authenticated!");
      resolve();
    });
    mobileSocket.on("connect_error", (err) => reject(new Error("Mobile socket connect error: " + err.message)));
  });

  // Step 4: Listen for response from Desktop
  const responsePromise = new Promise<{ text: string; rtt: number }>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for Desktop response")), 8000);
    const startTime = Date.now();

    mobileSocket.on("message", (msg) => {
      console.log("[Mobile Received Event]", msg.type, msg.payload || "");
      if (msg.type === "TASK_COMPLETED") {
        clearTimeout(timeout);
        const rtt = Date.now() - startTime;
        resolve({ text: msg.payload?.text, rtt });
      }
    });
  });

  // Step 5: Send "Hello from my phone." to the Desktop
  console.log("4. Sending message to Desktop: 'Hello from my phone.'...");
  mobileSocket.emit("message", {
    id: Math.random().toString(36).substring(7),
    type: "TASK_CREATED",
    timestamp: new Date().toISOString(),
    sourceDeviceId: mobileDeviceId,
    targetDeviceId: desktopDeviceId,
    payload: { text: "Hello from my phone." },
  });

  const { text, rtt } = await responsePromise;
  console.log(`\n=======================================================`);
  console.log(`🎉 SUCCESS: DESKTOP AND MOBILE CONNECTED!`);
  console.log(`✔ Message from Desktop: "${text}"`);
  console.log(`✔ Round-Trip Latency: ${rtt} ms`);
  console.log(`=======================================================\n`);

  // Leave connection active for a few seconds to let Desktop UI display it
  await new Promise((r) => setTimeout(r, 4000));
  mobileSocket.disconnect();
}

pairLiveDesktop().catch((err) => {
  console.error("Pairing Loop Error:", err);
  process.exit(1);
});
