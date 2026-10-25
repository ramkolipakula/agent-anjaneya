# Agent Anjaneya — Phase 1.1 Architecture & Setup

"Give direction from the phone. Let the computer do the work."

This repository contains the foundation for device pairing and real-time bidirectional communication between mobile and desktop clients.

---

## Architecture Overview

```
                 [ Mobile App ]
             (React Native + Expo)
                       │
             Auth WebSocket / REST
                       ▼
          [ Central Realtime Backend ]
             (Next.js + Socket.IO)
              SQLite (Prisma ORM)
                       ▲
             Auth WebSocket / REST
                       │
                [ Desktop App ]
         (Next.js UI / Bridge Preview)
```

### Security & Reliability Highlights (Phase 1.1)
- **Zero-Trust WebSocket Authentication**: Devices authenticate via cryptographic `deviceId` + `deviceSecret` during the Socket.IO handshake. Unauthenticated connections are rejected.
- **Room-Based Isolation**: Broadcasts are scoped strictly to private device rooms. No global broadcast leaks device status or private command data.
- **Message Authorization**: Every message is verified server-side against active `DeviceConnection` records. Sender spoofing is blocked.
- **Atomic Single-Use Pairing**: QR pairing verification executes within a database transaction (`prisma.$transaction`). Tokens expire in 5 minutes and cannot be reused or raced concurrently.
- **Duplicate Connection Prevention**: Database-level unique constraint (`@@unique([mobileDeviceId, desktopDeviceId])`) prevents redundant connection records.
- **Accurate Heartbeat & Liveness**: Devices send periodic heartbeats (every 10s); background reaper marks stale connections `OFFLINE` after 30s.

---

## Monorepo Structure

```
├── apps/
│   ├── backend/     # Next.js custom server + Socket.IO + Prisma SQLite
│   ├── desktop/     # Next.js desktop interface (Phase 1.1 Web/Bridge Preview)
│   └── mobile/      # React Native Expo app (Android, iOS & Web compatible)
├── packages/
│   └── protocol/    # Shared TypeScript protocol, types, and schema validators
└── package.json     # Monorepo workspaces & root scripts
```

---

## Setup & Running

### 1. Prerequisites
- **Node.js**: v20+ (tested on Node v24)
- **npm**: v10+

### 2. Install Dependencies
From the repository root:
```bash
npm install
```

### 3. Build Shared Protocol & Applications
```bash
npm run build
```

### 4. Run Automated Integration Tests
Runs the test suite verifying atomic token consumption, concurrency, expired token rejection, protocol validation, and device credentials:
```bash
npm test
```

### 5. Start Services

Open 3 terminals:

#### Terminal 1 — Realtime Backend (Port 3000):
```bash
cd apps/backend
npm run dev
# Or from root: npm run backend
```

#### Terminal 2 — Desktop Client (Port 3001):
```bash
cd apps/desktop
npm run dev
# Or from root: npm run desktop
```
Navigate to `http://localhost:3001`. The desktop client will authenticate and display the single-use pairing QR code and manual fallback code.

#### Terminal 3 — Mobile Client:
```bash
cd apps/mobile
npm run web
# Or from root: npm run mobile
```
Navigate to `http://localhost:8081`.

---

## Testing Bidirectional Communication

1. Open `http://localhost:3001` (Desktop) and `http://localhost:8081` (Mobile).
2. On Mobile, either:
   - Click **Scan Desktop QR** to scan the QR code via webcam, OR
   - Click **Enter Pairing Code Manually**, click **Copy Pairing Code** on Desktop, paste it into Mobile, and click **Pair Device**.
3. Mobile atomically verifies the token.
4. Desktop updates to **CONNECTED (ONLINE)** with "Ram's Phone".
5. Mobile shows Desktop status as **ONLINE**.
6. On Mobile, click **Send: "Hello from my phone."**.
7. Desktop immediately logs the command and replies: `"Hello from your computer."`.
8. Mobile displays the computer's response with **actual round-trip latency (RTT)** in ms.
9. If you close the Desktop tab, Mobile transitions to **OFFLINE**; re-opening the tab automatically restores status to **ONLINE**.

---

## Desktop Client Implementation Note (Honest Status)

The current desktop application in Phase 1.1 runs as a Next.js web application simulating the desktop shell.
- **Phase 1.1**: Proves secure pairing, handshake authentication, message protocol, and real-time connectivity.
- **Phase 2 Milestone**: Native Tauri shell packaging, local background daemon, permissioned execution engine, and native OS filesystem adapters.
