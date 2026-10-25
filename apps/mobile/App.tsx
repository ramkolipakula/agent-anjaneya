import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { io, Socket } from 'socket.io-client';
import {
  DeviceStatus,
  RealtimeMessage,
  AgentActivityPayload,
  AgentActivityStage,
  FinalProposal,
} from '@agent-anjaneya/protocol';

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

interface ApprovalRequest {
  taskId: string;
  title: string;
  intent: string;
  operation: any;
  sourceFile?: string;
  outputFile?: string;
  details?: string;
  proposal?: FinalProposal;
}

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
  const [messages, setMessages] = useState<{
    id: string;
    time: string;
    text: string;
    sender: 'user' | 'agent' | 'system';
    latency?: number;
    step?: string;
    outputPath?: string;
    isError?: boolean;
    isSuccess?: boolean;
  }[]>([]);

  // Task execution state
  const [commandInput, setCommandInput] = useState('');
  const [isTaskRunning, setIsTaskRunning] = useState(false);
  const [activeApproval, setActiveApproval] = useState<ApprovalRequest | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<AgentActivityStage | null>(null);
  const [agentActivities, setAgentActivities] = useState<AgentActivityPayload[]>([]);
  const [activeProposal, setActiveProposal] = useState<FinalProposal | null>(null);

  const sentTimeRef = useRef<number | null>(null);
  const deviceIdRef = useRef<string>(deviceId);
  deviceIdRef.current = deviceId;
  const desktopDeviceIdRef = useRef<string | null>(desktopDeviceId);
  desktopDeviceIdRef.current = desktopDeviceId;
  const socketRef = useRef<Socket | null>(socket);
  socketRef.current = socket;

  const addMessage = (
    text: string,
    sender: 'user' | 'agent' | 'system' = 'system',
    opts?: { latency?: number; step?: string; outputPath?: string; isError?: boolean; isSuccess?: boolean }
  ) => {
    setMessages((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).substring(7),
        time: new Date().toLocaleTimeString(),
        text,
        sender,
        ...opts,
      },
    ]);
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
      if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return;
      const payload = JSON.parse(trimmed);
      if (!payload.pairingSessionId || !payload.pairingToken) {
        setPairingError('QR code missing pairing token/session.');
        return;
      }
      await executePairing(payload);
    } catch (e) {}
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
        body: JSON.stringify({ deviceId, deviceSecret, unpair: true }),
      });
    } catch (e) {}
  };

  // Establish Authenticated Socket.io Connection once paired
  useEffect(() => {
    if (!desktopDeviceId || !deviceSecret || !backendUrl) return;

    setConnectionStatus('CONNECTING');

    const newSocket = io(backendUrl, {
      auth: { deviceId, deviceSecret },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
    });

    setSocket(newSocket);

    newSocket.on('connect', () => {
      setConnectionStatus('ONLINE');
      addMessage('Mobile authenticated and connected.', 'system');

      // Request task sync on connect/reconnect
      newSocket.emit('message', {
        id: Math.random().toString(36).substring(7),
        type: 'TASK_SYNC',
        timestamp: new Date().toISOString(),
        sourceDeviceId: deviceId,
        targetDeviceId: desktopDeviceId,
      });
    });

    newSocket.on('connect_error', () => {
      setConnectionStatus('RECONNECTING');
    });

    newSocket.on('disconnect', () => {
      setConnectionStatus('OFFLINE');
      addMessage('Disconnected from server.', 'system');
    });

    newSocket.on('message', (msg: RealtimeMessage) => {
      console.log('[Socket] Mobile received message:', msg);

      // 0. Agent Activity Events (Phase 3 Multi-Agent Visibility)
      if (msg.type === 'AGENT_ACTIVITY') {
        const activity = msg.payload as AgentActivityPayload;
        if (activity) {
          setCurrentStage(activity.stage);
          setAgentActivities((prev) => [activity, ...prev.slice(0, 15)]);
          const prefix = activity.agentRole ? `[${activity.agentRole}] ` : '';
          addMessage(`${prefix}${activity.summary}`, 'agent', { step: activity.stage });
        }
      }

      // 0.1 Proposal Ready Event
      if (msg.type === 'TASK_PROPOSAL_READY') {
        if (msg.payload?.proposal) {
          setActiveProposal(msg.payload.proposal);
          setCurrentStage('PROPOSAL_READY');
        }
      }

      // 1. Task Progress Events
      if (msg.type === 'TASK_PROGRESS') {
        const message = msg.payload?.message;
        const step = msg.payload?.step;
        if (step && typeof step === 'string') {
          setCurrentStage(step as AgentActivityStage);
        }
        if (message) {
          addMessage(`"${message}"`, 'agent', { step: msg.payload?.step });
        }
      }

      // 2. Task Approval Request
      if (msg.type === 'TASK_APPROVAL_REQUEST') {
        setActiveApproval(msg.payload);
        if (msg.payload?.proposal) {
          setActiveProposal(msg.payload.proposal);
        }
        setCurrentStage('WAITING_FOR_APPROVAL');
        addMessage(`Approval requested for: ${msg.payload?.title || 'Task'}`, 'system');
      }

      // 3. Task Completed Event
      if (msg.type === 'TASK_COMPLETED') {
        let latency: number | undefined;
        if (sentTimeRef.current) {
          latency = Date.now() - sentTimeRef.current;
          sentTimeRef.current = null;
        }

        const summary = msg.payload?.summary || msg.payload?.text || 'Task completed successfully.';
        const outPath = msg.payload?.outputPath;
        addMessage(summary, 'agent', {
          latency,
          outputPath: outPath,
          isSuccess: true,
        });

        setCurrentStage('COMPLETED');
        setIsTaskRunning(false);
        setActiveApproval(null);
        setActiveProposal(null);
      }

      // 4. Task Failed Event
      if (msg.type === 'TASK_FAILED') {
        const err = msg.payload?.error || 'Task execution failed.';
        addMessage(`Error: ${err}`, 'agent', { isError: true });
        setCurrentStage('FAILED');
        setIsTaskRunning(false);
        setActiveApproval(null);
        setActiveProposal(null);
      }

      // 5. Task Cancelled Event
      if (msg.type === 'TASK_CANCELLED') {
        const reason = msg.payload?.reason || 'Task was cancelled.';
        addMessage(`Notice: ${reason}`, 'system');
        setCurrentStage('CANCELLED');
        setIsTaskRunning(false);
        setActiveApproval(null);
        setActiveProposal(null);
      }

      // 6. Device status sync
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

  // Send Natural Language Task Command
  const handleSendCommand = (textToSend?: string) => {
    const text = (textToSend ?? commandInput).trim();
    if (!text || !socket || connectionStatus !== 'ONLINE' || !desktopDeviceId) return;

    const taskId = 'task-' + Math.random().toString(36).substring(2, 9);
    setActiveTaskId(taskId);
    setIsTaskRunning(true);
    sentTimeRef.current = Date.now();

    addMessage(text, 'user');
    setCommandInput('');

    socket.emit('message', {
      id: Math.random().toString(36).substring(7),
      type: 'TASK_CREATED',
      timestamp: new Date().toISOString(),
      sourceDeviceId: deviceId,
      targetDeviceId: desktopDeviceId,
      payload: { text, taskId },
    });
  };

  // Handle User Approval Response
  const handleApprovalResponse = (approved: boolean) => {
    if (!socket || !desktopDeviceId || !activeApproval) return;

    addMessage(approved ? 'Approved execution.' : 'Cancelled task.', 'user');

    socket.emit('message', {
      id: Math.random().toString(36).substring(7),
      type: 'TASK_APPROVAL_RESPONSE',
      timestamp: new Date().toISOString(),
      sourceDeviceId: deviceId,
      targetDeviceId: desktopDeviceId,
      payload: {
        taskId: activeApproval.taskId,
        approved,
        reason: approved ? undefined : 'Rejected by user on phone',
      },
    });

    setActiveApproval(null);
  };

  // Cancel Running Task
  const handleCancelTask = () => {
    if (!socket || !desktopDeviceId || !activeTaskId) return;

    socket.emit('message', {
      id: Math.random().toString(36).substring(7),
      type: 'TASK_CANCEL',
      timestamp: new Date().toISOString(),
      sourceDeviceId: deviceId,
      targetDeviceId: desktopDeviceId,
      payload: { taskId: activeTaskId, reason: 'Cancelled by user on mobile' },
    });

    addMessage('Requesting task cancellation...', 'user');
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
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
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
                {isPairingLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Connect with PIN</Text>}
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
                {isPairingLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Pair Device</Text>}
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

  // Paired Main Screen with Natural Language Execution
  return (
    <View style={styles.container}>
      {/* Top Header */}
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

      {/* Suggestion Chips */}
      <View style={styles.chipsContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <TouchableOpacity
            style={styles.chip}
            onPress={() => handleSendCommand('Build a portfolio website using my existing projects. Make it look professional, deploy it, and send me the link.')}
            disabled={isTaskRunning || desktopStatus !== 'ONLINE'}
          >
            <Text style={styles.chipText}>🌐 Build portfolio from projects</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.chip}
            onPress={() => handleSendCommand('Find video.mp4 in my Videos folder and extract the first 10 seconds')}
            disabled={isTaskRunning || desktopStatus !== 'ONLINE'}
          >
            <Text style={styles.chipText}>🎬 Trim first 10s of video.mp4</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.chip}
            onPress={() => handleSendCommand('List allowed folders')}
            disabled={isTaskRunning || desktopStatus !== 'ONLINE'}
          >
            <Text style={styles.chipText}>📁 List allowed folders</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Stage Status Pipeline */}
      {currentStage && (
        <View style={styles.stageBar}>
          <View style={styles.stageIndicator}>
            <ActivityIndicator size="small" color="#58a6ff" />
            <Text style={styles.stageTitle}>STAGE: {currentStage}</Text>
          </View>
        </View>
      )}

      {/* Chat / Timeline Area */}
      <ScrollView style={styles.chatArea} contentContainerStyle={{ padding: 16 }}>
        {messages.map((m) => (
          <View
            key={m.id}
            style={[
              styles.messageBubble,
              m.sender === 'user'
                ? styles.userBubble
                : m.sender === 'agent'
                ? m.isError
                  ? styles.errorBubble
                  : m.isSuccess
                  ? styles.successBubble
                  : styles.agentBubble
                : styles.systemBubble,
            ]}
          >
            {m.sender === 'agent' && (
              <Text style={styles.agentPrefix}>Agent Anjaneya</Text>
            )}
            <Text style={styles.messageText}>{m.text}</Text>

            {m.outputPath && (
              <View style={styles.outputBox}>
                <Text style={styles.outputLabel}>OUTPUT PATH:</Text>
                <Text style={styles.outputPathText} selectable>
                  {m.outputPath}
                </Text>
              </View>
            )}

            <View style={styles.metaRow}>
              <Text style={styles.metaTime}>{m.time}</Text>
              {m.latency !== undefined && (
                <Text style={styles.metaLatency}>Round-Trip: {m.latency}ms</Text>
              )}
            </View>
          </View>
        ))}

        {/* Interactive Multi-Agent Proposal Card */}
        {activeApproval && (
          <View style={styles.approvalCard}>
            <View style={styles.approvalHeader}>
              <Text style={styles.approvalTitle}>
                {activeApproval.proposal ? '🤖 Multi-Agent Execution Proposal' : '⚠️ Task Approval Requested'}
              </Text>
            </View>

            {activeApproval.proposal ? (
              <View style={styles.proposalBody}>
                <View style={styles.proposalObjectiveRow}>
                  <Text style={styles.proposalObjectiveLabel}>OBJECTIVE:</Text>
                  <Text style={styles.proposalObjectiveText}>{activeApproval.proposal.userObjective}</Text>
                </View>

                <View style={styles.proposalBadgeRow}>
                  <View style={styles.complexityBadge}>
                    <Text style={styles.complexityBadgeText}>Complexity: {activeApproval.proposal.estimatedComplexity}</Text>
                  </View>
                  <View style={styles.toolsBadge}>
                    <Text style={styles.toolsBadgeText}>Tools: {activeApproval.proposal.requiredTools.join(', ')}</Text>
                  </View>
                </View>

                {activeApproval.proposal.relevantContextSummary ? (
                  <View style={styles.proposalSection}>
                    <Text style={styles.proposalSectionLabel}>CONTEXT:</Text>
                    <Text style={styles.proposalSectionText}>{activeApproval.proposal.relevantContextSummary}</Text>
                  </View>
                ) : null}

                <View style={styles.proposalSection}>
                  <Text style={styles.proposalSectionLabel}>EXECUTION PLAN:</Text>
                  {activeApproval.proposal.steps.map((st, idx) => (
                    <View key={st.stepId} style={styles.stepItemRow}>
                      <Text style={styles.stepNumberBadge}>{idx + 1}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.stepDescriptionText}>{st.description}</Text>
                        <Text style={styles.stepToolText}>tool: {st.tool} • risk: {st.risk}</Text>
                      </View>
                    </View>
                  ))}
                </View>

                {activeApproval.proposal.risks.length > 0 && (
                  <View style={styles.riskAlertBox}>
                    <Text style={styles.riskAlertText}>Risks: {activeApproval.proposal.risks.join(' • ')}</Text>
                  </View>
                )}
              </View>
            ) : (
              <View>
                <Text style={styles.approvalTaskName}>{activeApproval.title}</Text>
                {activeApproval.details && (
                  <Text style={styles.approvalDetails}>{activeApproval.details}</Text>
                )}
                {activeApproval.outputFile && (
                  <Text style={styles.approvalOutput}>Target Output: {activeApproval.outputFile}</Text>
                )}
              </View>
            )}

            <View style={styles.approvalActions}>
              <TouchableOpacity
                style={styles.approveButton}
                onPress={() => handleApprovalResponse(true)}
              >
                <Text style={styles.approveButtonText}>Approve Execution</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.rejectButton}
                onPress={() => handleApprovalResponse(false)}
              >
                <Text style={styles.rejectButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Task Input Footer */}
      <View style={styles.footer}>
        {isTaskRunning && (
          <View style={styles.runningBanner}>
            <ActivityIndicator size="small" color="#58a6ff" />
            <Text style={styles.runningBannerText}>Computer is executing task...</Text>
            <TouchableOpacity onPress={handleCancelTask} style={styles.cancelRunButton}>
              <Text style={styles.cancelRunButtonText}>Stop</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.inputRow}>
          <TextInput
            style={styles.commandInput}
            value={commandInput}
            onChangeText={setCommandInput}
            placeholder={
              desktopStatus === 'ONLINE'
                ? 'Type command (e.g. Find video.mp4 and extract 10s)...'
                : 'Computer is OFFLINE'
            }
            placeholderTextColor="#8b949e"
            editable={desktopStatus === 'ONLINE'}
            onSubmitEditing={() => handleSendCommand()}
            returnKeyType="send"
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              (!commandInput.trim() || desktopStatus !== 'ONLINE') && styles.buttonDisabled,
            ]}
            onPress={() => handleSendCommand()}
            disabled={!commandInput.trim() || desktopStatus !== 'ONLINE'}
          >
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
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
  chipsContainer: {
    backgroundColor: '#161b22',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
  },
  chip: {
    backgroundColor: '#21262d',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: {
    color: '#c9d1d9',
    fontSize: 12,
    fontWeight: '500',
  },
  chatArea: {
    flex: 1,
  },
  messageBubble: {
    maxWidth: '88%',
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#1f6feb',
    borderBottomRightRadius: 2,
  },
  agentBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    borderBottomLeftRadius: 2,
  },
  successBubble: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(46, 160, 67, 0.15)',
    borderWidth: 1,
    borderColor: '#2ea043',
    borderBottomLeftRadius: 2,
  },
  errorBubble: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(248, 81, 73, 0.15)',
    borderWidth: 1,
    borderColor: '#f85149',
    borderBottomLeftRadius: 2,
  },
  systemBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#21262d',
    borderWidth: 1,
    borderColor: '#30363d',
    borderBottomLeftRadius: 2,
  },
  agentPrefix: {
    fontSize: 10,
    fontWeight: '700',
    color: '#58a6ff',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  messageText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
  },
  outputBox: {
    marginTop: 8,
    padding: 8,
    backgroundColor: '#0d1117',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  outputLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#7ee787',
    marginBottom: 2,
  },
  outputPathText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 11,
    color: '#e6edf3',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
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
  approvalCard: {
    backgroundColor: '#1f242c',
    borderWidth: 1,
    borderColor: '#d29922',
    borderRadius: 14,
    padding: 14,
    marginVertical: 8,
  },
  approvalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  approvalTitle: {
    color: '#e3b341',
    fontWeight: '700',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  approvalTaskName: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  approvalDetails: {
    color: '#8b949e',
    fontSize: 13,
    marginBottom: 4,
  },
  approvalOutput: {
    color: '#58a6ff',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginBottom: 12,
  },
  approvalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  approveButton: {
    flex: 1,
    backgroundColor: '#238636',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  approveButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  rejectButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#21262d',
    borderWidth: 1,
    borderColor: '#da3633',
    borderRadius: 8,
    alignItems: 'center',
  },
  rejectButtonText: {
    color: '#f85149',
    fontWeight: '600',
    fontSize: 13,
  },
  footer: {
    padding: 12,
    backgroundColor: '#161b22',
    borderTopWidth: 1,
    borderTopColor: '#30363d',
  },
  runningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0d1117',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f6feb',
    marginBottom: 8,
  },
  runningBannerText: {
    color: '#58a6ff',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
    marginLeft: 8,
  },
  cancelRunButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#21262d',
    borderRadius: 6,
  },
  cancelRunButtonText: {
    color: '#f85149',
    fontSize: 11,
    fontWeight: '600',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  commandInput: {
    flex: 1,
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 14,
  },
  sendButton: {
    backgroundColor: '#238636',
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  stageBar: {
    backgroundColor: '#161b22',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#30363d',
  },
  stageIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stageTitle: {
    color: '#58a6ff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  proposalBody: {
    marginTop: 8,
  },
  proposalObjectiveRow: {
    marginBottom: 8,
  },
  proposalObjectiveLabel: {
    color: '#8b949e',
    fontSize: 11,
    fontWeight: '700',
  },
  proposalObjectiveText: {
    color: '#f0f6fc',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  proposalBadgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  complexityBadge: {
    backgroundColor: '#23863622',
    borderWidth: 1,
    borderColor: '#238636',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  complexityBadgeText: {
    color: '#3fb950',
    fontSize: 11,
    fontWeight: '700',
  },
  toolsBadge: {
    backgroundColor: '#1f6feb22',
    borderWidth: 1,
    borderColor: '#1f6feb',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  toolsBadgeText: {
    color: '#58a6ff',
    fontSize: 11,
    fontWeight: '600',
  },
  proposalSection: {
    marginBottom: 10,
  },
  proposalSectionLabel: {
    color: '#8b949e',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  proposalSectionText: {
    color: '#c9d1d9',
    fontSize: 12,
    lineHeight: 16,
  },
  stepItemRow: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#0d1117',
    padding: 8,
    borderRadius: 6,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  stepNumberBadge: {
    backgroundColor: '#1f6feb',
    color: '#ffffff',
    width: 20,
    height: 20,
    borderRadius: 10,
    textAlign: 'center',
    lineHeight: 20,
    fontSize: 11,
    fontWeight: '700',
  },
  stepDescriptionText: {
    color: '#f0f6fc',
    fontSize: 12,
    fontWeight: '600',
  },
  stepToolText: {
    color: '#8b949e',
    fontSize: 10,
    marginTop: 2,
  },
  riskAlertBox: {
    backgroundColor: '#d2992222',
    borderColor: '#d29922',
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    marginTop: 4,
    marginBottom: 8,
  },
  riskAlertText: {
    color: '#e3b341',
    fontSize: 11,
    fontWeight: '600',
  },
});
