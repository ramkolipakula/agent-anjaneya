const BACKEND_URL = "http://localhost:3000";

async function main() {
  console.log("=== TESTING UNPAIR BEHAVIOR ===");

  // 1. Get current active session
  const activeRes = await fetch(`${BACKEND_URL}/api/pairing`);
  const activeData = await activeRes.json();
  console.log("Current active desktop discovery:", activeData);

  // 2. Request unpair on that desktop device
  console.log("Requesting UNPAIR on desktop device:", activeData.desktopDeviceId);
  const unpairRes = await fetch(`${BACKEND_URL}/api/pairing`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceId: activeData.desktopDeviceId,
      unpair: true,
    }),
  });

  const unpairData = await unpairRes.json();
  console.log("Unpair response received:", {
    deviceId: unpairData.deviceId,
    pinCode: unpairData.pinCode,
    pairedMobile: unpairData.pairedMobile,
    pairingSessionId: unpairData.pairingSessionId,
  });

  if (unpairData.pairedMobile !== null) {
    throw new Error("FAIL: pairedMobile must be null when unpair is requested!");
  }

  // 3. Confirm active discovery returns the new session with pinCode
  const afterRes = await fetch(`${BACKEND_URL}/api/pairing`);
  const afterData = await afterRes.json();
  console.log("Active discovery after unpair:", afterData);

  if (!afterData.active || !afterData.pinCode) {
    throw new Error("FAIL: Desktop must have a fresh active pairing session with PIN code!");
  }

  console.log("✔ SUCCESS: Unpair deactivates previous connections and displays a fresh QR / PIN session permanently!");
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
