import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Platform, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { io, Socket } from 'socket.io-client';
import { DeviceStatus, RealtimeMessage } from '@agent-anjaneya/protocol';

const DEFAULT_BACKEND_URL = Platform.OS === 'web' ? 'http://localhost:3000' : 'http://10.0.2.2:3000';

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [isPairingLoading, setIsPairingLoading] = useState(false);

  const [connectionStatus, setConnectionStatus] = useState<DeviceStatus>('OFFLINE');
  const [desktopStatus, setDesktopStatus] = useState<'ONLINE' | 'OFFLINE'>('OFFLINE');
  const [desktopDeviceId, setDesktopDeviceId] = useState<string | null>(null);
  const [deviceSecret, setDeviceSecret] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string>(() => 'mobile-' + Math.random().toString(36).substring(7));
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL);

  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<{ time: string; text: string; sender: 'user' | 'system'; latency?: number }[]>([]);
  const sentTimeRef = useRef<number | null>(null);

  const addMessage = (text: string, sender: 'user' | 'system' = 'system', latency?: number) => {
    setMessages(prev => [...prev, { time: new Date().toLocaleTimeString(), text, sender, latency }]);
  };

  // Perform Pairing Verification
  const executePairing = async (payload: { pairingSessionId: string; pairingToken: string; serverUrl?: string }) => {
    setIsPairingLoading(true);
    setPairingError(null);

    const targetUrl = payload.serverUrl || backendUrl;

    try {
      addMessage('Verifying pairing token with server...', 'system');
      const res = await fetch(`${targetUrl}/api/pairing/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingSessionId: payload.pairingSessionId,
          pairingToken: payload.pairingToken,
          mobileDeviceId: deviceId,
          mobileDeviceName: "Ram's Phone",
          mobileDeviceSecret: deviceSecret || undefined,
        }),
      });

      const result = await res.json();
      if (result.success) {
        setDesktopDeviceId(result.desktopDeviceId);
        setDeviceSecret(result.mobileDeviceSecret);
        setDesktopStatus('ONLINE');
        setScanning(false);
        setShowManualInput(false);
        addMessage(`Securely paired to ${result.desktopDeviceId}`, 'system');
      } else {
        setPairingError(result.error || 'Pairing verification failed');
        addMessage(`Pairing failed: ${result.error}`, 'system');
      }
    } catch (err: any) {
      console.error('Pairing error:', err);
      setPairingError(`Network error connecting to ${targetUrl}`);
      addMessage('Network error connecting to backend.', 'system');
    } finally {
      setIsPairingLoading(false);
    }
  };

  const handleScan = async ({ data }: { data: string }) => {
    if (isPairingLoading) return;
    try {
      const trimmed = data.trim();
      if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
        // Not a JSON payload, ignore frame silently without breaking
        return;
      }
      const payload = JSON.parse(trimmed);
      if (!payload.pairingSessionId || !payload.pairingToken) {
        setPairingError('QR code missing pairing token/session.');
        return;
      }
      await executePairing(payload);
    } catch (e) {
      // Ignore invalid frame parsing
    }
  };

  const handleManualPairing = async () => {
    try {
      const trimmed = manualCode.trim();
      let payload: any;
      if (trimmed.startsWith('{')) {
        payload = JSON.parse(trimmed);
      } else {
        setPairingError('Please paste the complete JSON pairing code or scan the QR code.');
        return;
      }
      await executePairing(payload);
    } catch (e) {
      setPairingError('Invalid JSON format in pairing code.');
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
      setDesktopStatus('ONLINE');
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

      if (msg.type === 'DEVICE_DISCONNECTED' && msg.sourceDeviceId === desktopDeviceId) {
        setDesktopStatus('OFFLINE');
        addMessage('Computer went OFFLINE.', 'system');
      }

      if (msg.type === 'DEVICE_CONNECTED' && msg.sourceDeviceId === desktopDeviceId) {
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
                <Text style={styles.buttonText}>Back to Scanner</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ gap: 10, marginTop: 12 }}>
              <TouchableOpacity
                style={styles.buttonPrimary}
                onPress={async () => {
                  setPairingError(null);
                  if (!permission?.granted) await requestPermission();
                  setScanning(true);
                }}
              >
                <Text style={styles.buttonText}>📷 Scan Desktop QR</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.buttonSecondary}
                onPress={() => {
                  setPairingError(null);
                  setShowManualInput(true);
                }}
              >
                <Text style={styles.buttonText}>⌨️ Enter Pairing Code Manually</Text>
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
        <View>
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
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 24,
    paddingBottom: 20,
    alignItems: 'center',
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
    margin: 20,
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
    color: '#ffffff',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#30363d',
    fontSize: 14,
    marginBottom: 10,
  },
  errorBox: {
    backgroundColor: '#441616',
    borderWidth: 1,
    borderColor: '#b91c1c',
    borderRadius: 8,
    padding: 10,
    marginVertical: 8,
  },
  errorText: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: '500',
  },
  cameraWrapper: {
    height: 320,
    borderRadius: 14,
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
    padding: 20,
    backgroundColor: '#0d1117',
  },
  infoText: {
    color: '#c9d1d9',
    textAlign: 'center',
    marginBottom: 16,
  },
  buttonPrimary: {
    backgroundColor: '#238636',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonSecondary: {
    backgroundColor: '#21262d',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#30363d',
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  headerBar: {
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#30363d',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#161b22',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  headerSub: {
    color: '#8b949e',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  statusGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginRight: 6,
  },
  badgeText: {
    fontWeight: '700',
    fontSize: 11,
  },
  chatArea: {
    flex: 1,
  },
  messageBubble: {
    maxWidth: '85%',
    padding: 14,
    borderRadius: 16,
    marginBottom: 12,
  },
  userBubble: {
    backgroundColor: '#1f6feb',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  systemBubble: {
    backgroundColor: '#161b22',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  messageText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  metaTime: {
    color: '#8b949e',
    fontSize: 10,
  },
  metaLatency: {
    color: '#34d399',
    fontSize: 10,
    fontWeight: '700',
  },
  footer: {
    padding: 20,
    backgroundColor: '#161b22',
    borderTopWidth: 1,
    borderTopColor: '#30363d',
  },
  actionButton: {
    backgroundColor: '#238636',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#30363d',
    opacity: 0.6,
  },
  actionButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
});
