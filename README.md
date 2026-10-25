# Agent Anjaneya Phase 1

This is the foundational Phase 1 of the autonomous productivity system, focusing on real-time device pairing and communication.

## Architecture

- **Backend**: Next.js custom server with `socket.io` for realtime communication, and SQLite + Prisma for the database.
- **Desktop**: Next.js (simulating Tauri UI layer) that displays QR code and connects to backend via WebSocket.
- **Mobile**: React Native + Expo app that scans the QR code, verifies token, and connects via WebSocket.
- **Protocol**: Shared TypeScript types for messages, devices, and tasks.

## Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Initialize Database**:
   ```bash
   cd apps/backend
   npm run prisma
   # Prisma generate and db push have already been run. dev.db is created.
   ```

3. **Start the Backend**:
   ```bash
   cd apps/backend
   npm run dev
   # Runs on http://localhost:3000
   ```

4. **Start the Desktop App**:
   ```bash
   cd apps/desktop
   npm run dev
   # Runs on http://localhost:3001
   ```

5. **Start the Mobile App**:
   ```bash
   cd apps/mobile
   npm start
   # Or npm run web to run in browser for easy webcam QR scanning
   ```

## Testing Flow

1. Open `http://localhost:3001` in your browser. You will see the "Connect your phone" screen and a QR Code.
2. Open the Expo mobile app (or run `npm run web` for the mobile app and open the provided URL).
3. Ensure the Backend URL on the mobile app is correct (e.g. `http://localhost:3000` or your local IP if on a physical device).
4. Click "Scan QR" on the mobile app and scan the QR code displayed on the desktop screen.
5. The mobile app will verify the pairing token via the backend and connect to the WebSocket.
6. The desktop app will show "Ram's Phone CONNECTED".
7. Click "Send Test Command" on the mobile app. The desktop will receive it and automatically reply. Both interfaces will show the real-time messages.
