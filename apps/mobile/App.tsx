import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Platform, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { io, Socket } from 'socket.io-client';
import { DeviceStatus, RealtimeMessage } from '@agent-anjaneya/protocol';

const DEFAULT_BACKEND_URL = Platform.OS === 'web' ? 'http://localhost:3000' : 'http://10.0.2.2:3000';

const storage = {
  getItem: (key: string): string | null => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch (e) {}
    return null;
  },
  setItem: (key: string, value: string) => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    } catch (e) {}
  },
  removeItem: (key: string) => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch (e) {}
  },
};

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [showPinInput, setShowPinInput] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [isPairingLoading, setIsPairingLoading] = useState(false);

  const [connectionStatus, setConnectionStatus] = useState<DeviceStatus>('OFFLINE');
  const [desktopStatus, setDesktopStatus] = useState<'ONLINE' | 'OFFLINE'>('OFFLINE');
  const [desktopDeviceId, setDesktopDeviceId] = useState<string | null>(null);
  const [deviceSecret, setDeviceSecret] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string>('mobile-init');
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL);

  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<{ time: string; text: string; sender: 'user' | 'system'; latency?: number }[]>([]);
  const sentTimeRef = useRef<number | null>(null);
  const deviceIdRef = useRef<string>(deviceId);
  deviceIdRef.current = deviceId;
  const desktopDeviceIdRef = useRef<string | null>(desktopDeviceId);
  desktopDeviceIdRef.current = desktopDeviceId;

  const addMessage = (text: string, sender: 'user' | 'system' = 'system', latency?: number) => {
    setMessages(prev => [...prev, { time: new Date().toLocaleTimeString(), text, sender, latency }]);
  };

  // Restore stored session on mount
  useEffect(() => {
    const savedDeviceId = storage.getItem('mobileDeviceId');
    const savedSecret = storage.getItem('mobileDeviceSecret');
    const savedDesktopId = storage.getItem('pairedDesktopDeviceId');

    if (savedDeviceId) {
      setDeviceId(savedDeviceId);
    } else {
      const newId = 'mobile-' + Math.random().toString(36).substring(7);
      setDeviceId(newId);
      storage.setItem('mobileDeviceId', newId);
    }

    if (savedSecret && savedDesktopId) {
      setDeviceSecret(savedSecret);
      setDesktopDeviceId(savedDesktopId);
      addMessage(`Restored pairing with ${savedDesktopId}`, 'system');
    }
  }, []);

  // Perform Pairing Verification
  const executePairing = async (payload: {
    pairingSessionId?: string;
    pairingToken?: string;
    pinCode?: string;
    autoPairLocal?: boolean;
    serverUrl?: string;
  }) => {
    setIsPairingLoading(true);
    setPairingError(null);

    const targetUrl = payload.serverUrl || backendUrl;

    try {
      addMessage('Verifying pairing with server...', 'system');
      const res = await fetch(`${targetUrl}/api/pairing/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingSessionId: payload.pairingSessionId,
          pairingToken: payload.pairingToken,
          pinCode: payload.pinCode,
          autoPairLocal: payload.autoPairLocal,
          mobileDeviceId: deviceId,
          mobileDeviceName: "Ram's Phone",
          mobileDeviceSecret: deviceSecret || undefined,
        }),
      });

      const result = await res.json();
      if (result.success) {
        setDesktopDeviceId(result.desktopDeviceId);
        setDeviceSecret(result.mobileDeviceSecret);
        setDeviceId(result.mobileDeviceId);

        storage.setItem('mobileDeviceId', result.mobileDeviceId);
        storage.setItem('mobileDeviceSecret', result.mobileDeviceSecret);
        storage.setItem('pairedDesktopDeviceId', result.desktopDeviceId);

        setDesktopStatus('ONLINE');
        setScanning(false);
        setShowManualInput(false);
        setShowPinInput(false);
        addMessage(`Securely paired to ${result.desktopDeviceId}`, 'system');
      } else {
        const errMsg = result.error || 'Pairing verification failed';
        setPairingError(errMsg);
        addMessage(`Pairing failed: ${errMsg}`, 'system');
      }
    } catch (err: any) {
      console.error('Pairing error:', err);
      const errMsg = `Network error connecting to ${targetUrl}`;
      setPairingError(errMsg);
      addMessage(errMsg, 'system');
    } finally {
      setIsPairingLoading(false);
    }
  };

  const handleScan = async ({ data }: { data: string }) => {
    if (isPairingLoading) return;
    try {
      const trimmed = data.trim();
      if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
        return;
      }
      const payload = JSON.parse(trimmed);
      if (!payload.pairingSessionId || !payload.pairingToken) {
        setPairingError('QR code missing pairing token/session.');
        return;
      }
      await executePairing(payload);
    } catch (e) {
      // ignore non-json frames
    }
  };

  const handleManualPairing = async () => {
    try {
      const trimmed = manualCode.trim();
      if (trimmed.startsWith('{')) {
        const payload = JSON.parse(trimmed);
        await executePairing(payload);
      } else {
        setPairingError('Please paste the complete JSON pairing code.');
      }
    } catch (e) {
      setPairingError('Invalid JSON format in pairing code.');
    }
  };

  const handlePinPairing = async () => {
    const cleanPin = pinInput.trim().replace(/\D/g, '');
    if (cleanPin.length !== 6) {
      setPairingError('PIN must be 6 digits (e.g. 123456).');
      return;
    }
    await executePairing({ pinCode: cleanPin });
  };

  const handleAutoPairLocal = async () => {
    await executePairing({ autoPairLocal: true });
  };

  const handleUnpair = async () => {
    storage.removeItem('pairedDesktopDeviceId');
    storage.removeItem('mobileDeviceSecret');
    setDesktopDeviceId(null);
    setDeviceSecret(null);
    setDesktopStatus('OFFLINE');
    setConnectionStatus('OFFLINE');
    if (socket) socket.disconnect();
    setSocket(null);
    addMessage('Device unpaired. You can now pair with a computer.', 'system');

    try {
      await fetch(`${backendUrl}/api/pairing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          deviceSecret,
          unpair: true,
        }),
      });
    } catch (e) {
      // non-blocking
    }
  };

  // Establish Authenticated Socket.io Connection once paired
  useEffect(() => {
    if (!desktopDeviceId || !deviceSecret || !backendUrl) return;

    setConnectionStatus('CONNECTING');

    const newSocket = io(backendUrl, {
      auth: {
        deviceId,
        deviceSecret,
      },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
    });

    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('[Socket] Mobile connected to server');
      setConnectionStatus('ONLINE');
      addMessage('Mobile authenticated and connected to server.', 'system');
    });

    newSocket.on('connect_error', (err) => {
      console.warn('[Socket] Mobile connect error:', err.message);
      setConnectionStatus('RECONNECTING');
    });

    newSocket.on('disconnect', (reason) => {
      console.log('[Socket] Mobile disconnected:', reason);
      setConnectionStatus('OFFLINE');
      addMessage('Disconnected from server.', 'system');
    });

    newSocket.on('message', (msg: RealtimeMessage) => {
      console.log('[Socket] Mobile received:', msg);

      if (msg.type === 'TASK_COMPLETED') {
        let latency: number | undefined;
        if (sentTimeRef.current) {
          latency = Date.now() - sentTimeRef.current;
          sentTimeRef.current = null;
        }
        addMessage(`Computer: "${msg.payload?.text}"`, 'system', latency);
      }

      if (msg.type === 'DEVICE_DISCONNECTED' && msg.sourceDeviceId === desktopDeviceIdRef.current) {
        setDesktopStatus('OFFLINE');
        addMessage('Computer went OFFLINE.', 'system');
      }

      if (msg.type === 'DEVICE_CONNECTED' && msg.sourceDeviceId === desktopDeviceIdRef.current) {
        setDesktopStatus('ONLINE');
        addMessage('Computer is now ONLINE.', 'system');
      }

      if (msg.type === 'ERROR') {
        addMessage(`Server Error: ${msg.payload?.message || msg.payload?.code}`, 'system');
      }
    });

    return () => {
      newSocket.disconnect();
    };
  }, [desktopDeviceId, deviceSecret, backendUrl, deviceId]);

  const sendTestCommand = () => {
    if (!socket || connectionStatus !== 'ONLINE' || !desktopDeviceId) return;

    const text = 'Hello from my phone.';
    sentTimeRef.current = Date.now();
    addMessage(text, 'user');

    socket.emit('message', {
      id: Math.random().toString(36).substring(7),
      type: 'TASK_CREATED',
      timestamp: new Date().toISOString(),
      sourceDeviceId: deviceId,
      targetDeviceId: desktopDeviceId,
      payload: { text },
    });
  };

  // Pre-pairing screen
  if (!desktopDeviceId) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Agent Anjaneya</Text>
          <Text style={styles.subtitle}>Connect your computer to begin</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.inputLabel}>Backend Server URL</Text>
          <TextInput
            style={styles.input}
            value={backendUrl}
            onChangeText={setBackendUrl}
            placeholder="http://localhost:3000"
            placeholderTextColor="#8b949e"
          />

          {pairingError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{pairingError}</Text>
            </View>
          )}

          {scanning ? (
            <View style={styles.cameraWrapper}>
              {permission?.granted ? (
                <CameraView
                  style={styles.camera}
                  onBarcodeScanned={handleScan}
                  barcodeScannerSettings={{
                    barcodeTypes: ['qr'],
                  }}
                />
              ) : (
                <View style={styles.permissionBox}>
                  <Text style={styles.infoText}>Camera permission is required to scan QR code.</Text>
                  <TouchableOpacity style={styles.buttonSecondary} onPress={requestPermission}>
                    <Text style={styles.buttonText}>Grant Permission</Text>
                  </TouchableOpacity>
                </View>
              )}
              <TouchableOpacity
                style={[styles.buttonSecondary, { marginTop: 12 }]}
                onPress={() => setScanning(false)}
              >
                <Text style={styles.buttonText}>Cancel Scanner</Text>
              </TouchableOpacity>
            </View>
          ) : showPinInput ? (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.inputLabel}>Enter 6-Digit Desktop PIN</Text>
              <TextInput
                style={[styles.input, { fontSize: 24, textAlign: 'center', letterSpacing: 8, fontWeight: '700' }]}
                value={pinInput}
                onChangeText={setPinInput}
                placeholder="123456"
                placeholderTextColor="#8b949e"
                keyboardType="numeric"
                maxLength={6}
              />
              <TouchableOpacity
                style={styles.buttonPrimary}
                onPress={handlePinPairing}
                disabled={isPairingLoading}
              >
                {isPairingLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Connect with PIN</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.buttonSecondary, { marginTop: 8 }]}
                onPress={() => setShowPinInput(false)}
              >
                <Text style={styles.buttonText}>Back</Text>
              </TouchableOpacity>
            </View>
          ) : showManualInput ? (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.inputLabel}>Paste Pairing JSON Code</Text>
              <TextInput
                style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
                value={manualCode}
                onChangeText={setManualCode}
                placeholder='{"pairingSessionId":"...","pairingToken":"..."}'
                placeholderTextColor="#8b949e"
                multiline
              />
              <TouchableOpacity
                style={styles.buttonPrimary}
                onPress={handleManualPairing}
                disabled={isPairingLoading}
              >
                {isPairingLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Pair Device</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.buttonSecondary, { marginTop: 8 }]}
                onPress={() => setShowManualInput(false)}
              >
                <Text style={styles.buttonText}>Back</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ gap: 10, marginTop: 12 }}>
              {/* 1-Click Fast Connect for same-machine testing */}
              <TouchableOpacity
                style={[styles.buttonPrimary, { backgroundColor: '#1f6feb' }]}
                onPress={handleAutoPairLocal}
                disabled={isPairingLoading}
              >
                {isPairingLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>⚡ Quick Connect to Local PC (1-Click)</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.buttonPrimary}
                onPress={() => {
                  setPairingError(null);
                  setShowPinInput(true);
                }}
              >
                <Text style={styles.buttonText}>🔢 Enter 6-Digit PIN from Desktop</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.buttonSecondary}
                onPress={async () => {
                  setPairingError(null);
                  if (!permission?.granted) await requestPermission();
                  setScanning(true);
                }}
              >
                <Text style={styles.buttonText}>📷 Scan Desktop QR Code</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.buttonSecondary}
                onPress={() => {
                  setPairingError(null);
                  setShowManualInput(true);
                }}
              >
                <Text style={styles.buttonText}>📋 Paste Pairing Code</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  }

  // Paired Main Screen
  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Ram-PC</Text>
          <Text style={styles.headerSub}>ID: {desktopDeviceId}</Text>
        </View>
        <View style={styles.statusGroup}>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: desktopStatus === 'ONLINE' ? '#10B98122' : '#EF444422' },
            ]}
          >
            <View
              style={[
                styles.dot,
                { backgroundColor: desktopStatus === 'ONLINE' ? '#10B981' : '#EF4444' },
              ]}
            />
            <Text
              style={[
                styles.badgeText,
                { color: desktopStatus === 'ONLINE' ? '#10B981' : '#EF4444' },
              ]}
            >
              PC: {desktopStatus}
            </Text>
          </View>

          <TouchableOpacity style={styles.unpairBadge} onPress={handleUnpair}>
            <Text style={styles.unpairBadgeText}>Unpair</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.chatArea} contentContainerStyle={{ padding: 16 }}>
        {messages.map((m, i) => (
          <View
            key={i}
            style={[
              styles.messageBubble,
              m.sender === 'user' ? styles.userBubble : styles.systemBubble,
            ]}
          >
            <Text style={styles.messageText}>{m.text}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaTime}>{m.time}</Text>
              {m.latency !== undefined && (
                <Text style={styles.metaLatency}>RTT: {m.latency}ms</Text>
              )}
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.actionButton,
            (connectionStatus !== 'ONLINE' || desktopStatus !== 'ONLINE') && styles.buttonDisabled,
          ]}
          onPress={sendTestCommand}
          disabled={connectionStatus !== 'ONLINE' || desktopStatus !== 'ONLINE'}
        >
          <Text style={styles.actionButtonText}>
            {desktopStatus === 'ONLINE' ? 'Send: "Hello from my phone."' : 'Computer is OFFLINE'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
    paddingTop: Platform.OS === 'android' ? 40 : 20,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: '#8b949e',
    marginTop: 4,
  },
  card: {
    marginHorizontal: 16,
    backgroundColor: '#161b22',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8b949e',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 14,
    marginBottom: 12,
  },
  buttonPrimary: {
    backgroundColor: '#238636',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSecondary: {
    backgroundColor: '#21262d',
    borderWidth: 1,
    borderColor: '#30363d',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  errorBox: {
    backgroundColor: 'rgba(248, 81, 73, 0.1)',
    borderWidth: 1,
    borderColor: '#f85149',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  errorText: {
    color: '#f85149',
    fontSize: 12,
    textAlign: 'center',
  },
  cameraWrapper: {
    height: 300,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 10,
  },
  camera: {
    flex: 1,
  },
  permissionBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0d1117',
    padding: 20,
  },
  infoText: {
    color: '#8b949e',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 14,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#161b22',
    borderBottomWidth: 1,
    borderBottomColor: '#30363d',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  headerSub: {
    fontSize: 11,
    color: '#8b949e',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 2,
  },
  statusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  unpairBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#21262d',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  unpairBadgeText: {
    color: '#f85149',
    fontSize: 11,
    fontWeight: '600',
  },
  chatArea: {
    flex: 1,
  },
  messageBubble: {
    maxWidth: '85%',
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#1f6feb',
    borderBottomRightRadius: 2,
  },
  systemBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#21262d',
    borderWidth: 1,
    borderColor: '#30363d',
    borderBottomLeftRadius: 2,
  },
  messageText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  metaTime: {
    fontSize: 10,
    color: '#8b949e',
  },
  metaLatency: {
    fontSize: 10,
    color: '#7ee787',
    fontWeight: '700',
  },
  footer: {
    padding: 16,
    backgroundColor: '#161b22',
    borderTopWidth: 1,
    borderTopColor: '#30363d',
  },
  actionButton: {
    backgroundColor: '#238636',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  buttonDisabled: {
    backgroundColor: '#21262d',
    opacity: 0.6,
  },
});
