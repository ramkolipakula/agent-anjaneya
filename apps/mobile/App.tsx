import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { io, Socket } from 'socket.io-client';
import { RealtimeMessage } from '@agent-anjaneya/protocol';

// Replace this with your computer's local IP address when testing on a physical device
const DEFAULT_BACKEND_URL = Platform.OS === 'web' ? 'http://localhost:3000' : 'http://10.0.2.2:3000';

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<"DISCONNECTED" | "CONNECTING" | "ONLINE" | "RECONNECTING">("DISCONNECTED");
  const [desktopDeviceId, setDesktopDeviceId] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<{ time: string; text: string; sender: 'user' | 'system' }[]>([]);
  
  const [deviceId] = useState(() => "mobile-" + Math.random().toString(36).substring(7));
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL);

  const addMessage = (text: string, sender: 'user' | 'system' = 'system') => {
    setMessages(prev => [...prev, { time: new Date().toLocaleTimeString(), text, sender }]);
  };

  useEffect(() => {
    if (!desktopDeviceId || !backendUrl) return;

    setStatus("CONNECTING");
    const newSocket = io(backendUrl);
    setSocket(newSocket);

    newSocket.on("connect", () => {
      setStatus("ONLINE");
      newSocket.emit("register", { deviceId });
      addMessage("Connected to server.");
    });

    newSocket.on("disconnect", () => {
      setStatus("RECONNECTING");
      addMessage("Disconnected from server.");
    });

    newSocket.on("message", (msg: RealtimeMessage) => {
      if (msg.type === "TASK_COMPLETED") {
        addMessage(`Computer responded: ${msg.payload?.text}`, 'system');
      }
      if (msg.type === "DEVICE_DISCONNECTED" && msg.sourceDeviceId === desktopDeviceId) {
        setStatus("DISCONNECTED");
        addMessage("Computer went offline.", 'system');
      }
      if (msg.type === "DEVICE_CONNECTED" && msg.sourceDeviceId === desktopDeviceId) {
        setStatus("ONLINE");
        addMessage("Computer is back online.", 'system');
      }
    });

    return () => {
      newSocket.disconnect();
    };
  }, [desktopDeviceId, backendUrl, deviceId]);

  const handleScan = async ({ data }: { data: string }) => {
    setScanning(false);
    try {
      const payload = JSON.parse(data);
      if (!payload.pairingSessionId || !payload.pairingToken) {
        alert("Invalid QR Code");
        return;
      }
      addMessage("Verifying pairing...", "system");
      
      const res = await fetch(`${backendUrl}/api/pairing/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pairingSessionId: payload.pairingSessionId,
          pairingToken: payload.pairingToken,
          mobileDeviceId: deviceId,
          mobileDeviceName: "Ram's Phone"
        })
      });

      const result = await res.json();
      if (result.success) {
        setDesktopDeviceId(result.desktopDeviceId);
        addMessage(`Connected to ${result.desktopDeviceId}`, "system");
      } else {
        alert(result.error || "Pairing failed");
        addMessage("Pairing failed.", "system");
      }
    } catch (e) {
      alert("Failed to parse QR code or connect.");
    }
  };

  const sendTestCommand = () => {
    if (!socket || status !== "ONLINE" || !desktopDeviceId) return;
    
    addMessage("Hello from my phone.", "user");
    socket.emit("message", {
      id: Math.random().toString(36).substring(7),
      type: "TASK_CREATED",
      timestamp: new Date().toISOString(),
      sourceDeviceId: deviceId,
      targetDeviceId: desktopDeviceId,
      payload: { text: "Hello from my phone." }
    });
    addMessage("Test command sent.", "system");
  };

  if (!desktopDeviceId) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Connect your computer</Text>
        <TextInput 
          style={styles.input} 
          value={backendUrl}
          onChangeText={setBackendUrl}
          placeholder="Backend URL (e.g. http://192.168.1.10:3000)"
        />
        
        {scanning ? (
          <View style={styles.cameraContainer}>
            {permission?.granted ? (
              <CameraView 
                style={styles.camera}
                onBarcodeScanned={handleScan}
                barcodeScannerSettings={{
                  barcodeTypes: ["qr"],
                }}
              />
            ) : (
              <Text style={{ color: 'white' }}>No camera permission</Text>
            )}
            <TouchableOpacity style={styles.button} onPress={() => setScanning(false)}>
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.button} onPress={async () => {
            if (!permission?.granted) await requestPermission();
            setScanning(true);
          }}>
            <Text style={styles.buttonText}>Scan QR</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Connected</Text>
        <View style={styles.statusBadge}>
          <View style={[styles.statusDot, { backgroundColor: status === 'ONLINE' ? '#10B981' : '#EF4444' }]} />
          <Text style={styles.statusText}>{status}</Text>
        </View>
      </View>

      <ScrollView style={styles.chatArea} contentContainerStyle={{ padding: 16 }}>
        {messages.map((m, i) => (
          <View key={i} style={[
            styles.messageBubble, 
            m.sender === 'user' ? styles.userMessage : styles.systemMessage
          ]}>
            <Text style={styles.messageText}>{m.text}</Text>
            <Text style={styles.messageTime}>{m.time}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.inputArea}>
        <TouchableOpacity style={styles.sendButton} onPress={sendTestCommand} disabled={status !== 'ONLINE'}>
          <Text style={styles.buttonText}>Send Test Command</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
    paddingTop: 50,
  },
  header: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#30363d',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  title: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center'
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
  },
  input: {
    backgroundColor: '#161b22',
    color: 'white',
    padding: 15,
    margin: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#30363d'
  },
  button: {
    backgroundColor: '#238636',
    padding: 15,
    marginHorizontal: 20,
    marginTop: 20,
    borderRadius: 10,
    alignItems: 'center'
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16
  },
  cameraContainer: {
    flex: 1,
    margin: 20,
    borderRadius: 20,
    overflow: 'hidden'
  },
  camera: {
    flex: 1,
  },
  chatArea: {
    flex: 1,
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 15,
    borderRadius: 20,
    marginBottom: 10,
  },
  userMessage: {
    backgroundColor: '#238636',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 5,
  },
  systemMessage: {
    backgroundColor: '#161b22',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 5,
    borderWidth: 1,
    borderColor: '#30363d'
  },
  messageText: {
    color: 'white',
    fontSize: 16,
  },
  messageTime: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    marginTop: 5,
    textAlign: 'right'
  },
  inputArea: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#30363d',
  },
  sendButton: {
    backgroundColor: '#1f6feb',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center'
  }
});
