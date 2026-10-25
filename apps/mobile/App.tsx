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
  Image,
  Dimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { io, Socket } from 'socket.io-client';
import {
  DeviceStatus,
  RealtimeMessage,
  AgentActivityPayload,
  AgentActivityStage,
  FinalProposal,
  TaskStatus,
  Task,
  TaskCompletedPayload,
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

type ScreenView = 'home' | 'newTask' | 'planning' | 'proposal' | 'executing' | 'completed' | 'tasks' | 'devices' | 'profile';

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
  const [deviceId, setDeviceId] = useState<string>('mobile-' + Math.random().toString(36).substring(2, 8));
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL);

  const [socket, setSocket] = useState<Socket | null>(null);

  // Active Screen View
  const [currentScreen, setCurrentScreen] = useState<ScreenView>('home');
  const [activeTab, setActiveTab] = useState<'home' | 'tasks' | 'devices' | 'profile'>('home');

  // Task execution state
  const [commandInput, setCommandInput] = useState('');
  const [isTaskRunning, setIsTaskRunning] = useState(false);
  const [activeApproval, setActiveApproval] = useState<ApprovalRequest | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<AgentActivityStage | TaskStatus | string | null>(null);
  const [agentActivities, setAgentActivities] = useState<AgentActivityPayload[]>([]);
  const [activeProposal, setActiveProposal] = useState<FinalProposal | null>(null);
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);

  // Persisted task history & completed results
  const [taskHistory, setTaskHistory] = useState<Task[]>([]);
  const [completedTaskResult, setCompletedTaskResult] = useState<TaskCompletedPayload | null>(null);

  // Notifications
  const [showNotificationToast, setShowNotificationToast] = useState(false);
  const [notificationMsg, setNotificationMsg] = useState('');

  // Live Output logs for executing screen
  const [liveOutputLogs, setLiveOutputLogs] = useState<Array<{ text: string; time: string; type: 'blue' | 'green' | 'amber' }>>([]);

  const sentTimeRef = useRef<number | null>(null);
  const deviceIdRef = useRef<string>(deviceId);
  deviceIdRef.current = deviceId;
  const desktopDeviceIdRef = useRef<string | null>(desktopDeviceId);
  desktopDeviceIdRef.current = desktopDeviceId;
  const socketRef = useRef<Socket | null>(socket);
  socketRef.current = socket;

  // Fetch real persistent tasks from backend
  const fetchTasks = async (targetDeviceId: string) => {
    try {
      const res = await fetch(`${backendUrl}/api/tasks?deviceId=${encodeURIComponent(targetDeviceId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.tasks && Array.isArray(data.tasks)) {
          setTaskHistory(data.tasks);
        }
      }
    } catch (e) {
      // Background task fetch fallback
    }
  };

  // Restore stored session on mount
  useEffect(() => {
    const savedDeviceId = storage.getItem('mobileDeviceId');
    const savedSecret = storage.getItem('mobileDeviceSecret');
    const savedDesktopId = storage.getItem('pairedDesktopDeviceId');

    let currentDevId = savedDeviceId;
    if (savedDeviceId) {
      setDeviceId(savedDeviceId);
    } else {
      const newId = 'mobile-' + Math.random().toString(36).substring(2, 8);
      setDeviceId(newId);
      currentDevId = newId;
      storage.setItem('mobileDeviceId', newId);
    }

    if (savedSecret && savedDesktopId) {
      setDeviceSecret(savedSecret);
      setDesktopDeviceId(savedDesktopId);
      setDesktopStatus('ONLINE');
      setConnectionStatus('CONNECTING');
    }

    if (currentDevId) {
      fetchTasks(currentDevId);
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
        setCurrentScreen('home');
        fetchTasks(result.mobileDeviceId);
      } else {
        const errMsg = result.error || 'Pairing verification failed';
        setPairingError(errMsg);
      }
    } catch (err: any) {
      console.warn('Pairing verification error:', err.message);
      setPairingError('Network error connecting to backend: ' + err.message);
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
    setCurrentScreen('devices');

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
    });

    newSocket.on('message', (msg: RealtimeMessage) => {
      // 0. Task sync response
      if (msg.type === 'TASK_SYNC_RESPONSE' && msg.payload?.tasks) {
        setTaskHistory(msg.payload.tasks);
      }

      // 0.1 Agent Activity Events
      if (msg.type === 'AGENT_ACTIVITY') {
        const activity = msg.payload as AgentActivityPayload;
        if (activity) {
          setCurrentStage(activity.stage);
          setAgentActivities((prev) => [activity, ...prev.slice(0, 15)]);
          if (currentScreen !== 'planning' && isTaskRunning) {
            setCurrentScreen('planning');
          }
        }
      }

      // 0.2 Proposal Ready Event
      if (msg.type === 'TASK_PROPOSAL_READY') {
        if (msg.payload?.proposal) {
          setActiveProposal(msg.payload.proposal);
          setCurrentStage('PROPOSAL_READY');
          setCurrentScreen('proposal');
          setNotificationMsg('Plan proposal ready for review');
          setShowNotificationToast(true);
        }
      }

      // 1. Task Progress Events
      if (msg.type === 'TASK_PROGRESS') {
        const message = msg.payload?.message;
        const step = msg.payload?.step;
        const status = msg.payload?.status;

        if (message) {
          setLiveOutputLogs((prev) => [
            ...prev,
            {
              text: message,
              time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }),
              type: message.toLowerCase().includes('verified') || message.toLowerCase().includes('completed') ? 'green' : 'blue',
            },
          ]);
        }

        if (status) {
          if (status === 'RUNNING') {
            setIsSubmittingApproval(false);
            setCurrentScreen('executing');
          }
          setCurrentStage(status as any);
        } else if (step) {
          setCurrentStage(step as any);
        }
      }

      // 2. Task Approval Request
      if (msg.type === 'TASK_APPROVAL_REQUEST') {
        setActiveApproval(msg.payload);
        setIsSubmittingApproval(false);
        if (msg.payload?.proposal) {
          setActiveProposal(msg.payload.proposal);
        }
        setCurrentStage('WAITING_FOR_APPROVAL');
        setCurrentScreen('proposal');
        setNotificationMsg(`Approval required: ${msg.payload?.title || 'Execution Request'}`);
        setShowNotificationToast(true);
      }

      // 2b. Task Approval Response (sync from desktop)
      if (msg.type === 'TASK_APPROVAL_RESPONSE') {
        const { approved } = msg.payload || {};
        setIsSubmittingApproval(false);
        if (approved) {
          setCurrentStage('RUNNING' as any);
          setCurrentScreen('executing');
        } else {
          setActiveApproval(null);
          setActiveProposal(null);
          setCurrentStage('CANCELLED');
          setIsTaskRunning(false);
          setCurrentScreen('home');
        }
      }

      // 3. Task Completed Event
      if (msg.type === 'TASK_COMPLETED') {
        setCurrentStage('COMPLETED');
        setIsTaskRunning(false);
        setIsSubmittingApproval(false);
        setCompletedTaskResult(msg.payload);
        setActiveApproval(null);
        setActiveProposal(null);
        setCurrentScreen('completed');
        setNotificationMsg(msg.payload?.summary || 'Task successfully completed!');
        setShowNotificationToast(true);
        fetchTasks(deviceIdRef.current);
      }

      // 4. Task Failed Event
      if (msg.type === 'TASK_FAILED') {
        const err = msg.payload?.error || 'Task execution failed.';
        setCurrentStage('FAILED');
        setIsTaskRunning(false);
        setIsSubmittingApproval(false);
        setActiveApproval(null);
        setActiveProposal(null);
        setNotificationMsg(`Error: ${err}`);
        setShowNotificationToast(true);
        fetchTasks(deviceIdRef.current);
      }

      // 5. Task Cancelled Event
      if (msg.type === 'TASK_CANCELLED') {
        setCurrentStage('CANCELLED');
        setIsTaskRunning(false);
        setIsSubmittingApproval(false);
        setActiveApproval(null);
        setActiveProposal(null);
        setCurrentScreen('home');
        setNotificationMsg('Task was cancelled');
        setShowNotificationToast(true);
        fetchTasks(deviceIdRef.current);
      }

      // 6. Device status sync
      if (msg.type === 'DEVICE_DISCONNECTED' && msg.sourceDeviceId === desktopDeviceIdRef.current) {
        setDesktopStatus('OFFLINE');
      }

      if (msg.type === 'DEVICE_CONNECTED' && msg.sourceDeviceId === desktopDeviceIdRef.current) {
        setDesktopStatus('ONLINE');
      }
    });

    return () => {
      newSocket.disconnect();
    };
  }, [desktopDeviceId, deviceSecret, backendUrl, deviceId]);

  // Send Task Command
  const handleSendCommand = (textToSend?: string) => {
    const text = (textToSend ?? commandInput).trim();
    if (!text) return;

    const taskId = 'task-' + Math.random().toString(36).substring(2, 9);
    setActiveTaskId(taskId);
    setCommandInput(text);
    setIsTaskRunning(true);
    setCurrentStage('PLANNING');
    setLiveOutputLogs([
      {
        text: `Submitted: "${text}"`,
        time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }),
        type: 'blue',
      },
    ]);
    setAgentActivities([]);
    setActiveProposal(null);
    setActiveApproval(null);
    setCompletedTaskResult(null);
    setCurrentScreen('planning');
    sentTimeRef.current = Date.now();

    if (socket && connectionStatus === 'ONLINE' && desktopDeviceId) {
      socket.emit('message', {
        id: Math.random().toString(36).substring(7),
        type: 'TASK_CREATED',
        timestamp: new Date().toISOString(),
        sourceDeviceId: deviceId,
        targetDeviceId: desktopDeviceId,
        payload: { text, taskId },
      });
    }
  };

  // Handle User Approval Response
  const handleApprovalResponse = (approved: boolean) => {
    if (isSubmittingApproval) return;
    setIsSubmittingApproval(true);

    const targetTaskId = activeApproval?.taskId || activeTaskId;

    if (socket && desktopDeviceId && targetTaskId) {
      socket.emit('message', {
        id: Math.random().toString(36).substring(7),
        type: 'TASK_APPROVAL_RESPONSE',
        timestamp: new Date().toISOString(),
        sourceDeviceId: deviceId,
        targetDeviceId: desktopDeviceId,
        payload: {
          taskId: targetTaskId,
          approved,
          reason: approved ? undefined : 'Rejected by user on mobile',
        },
      });
    }

    if (approved) {
      setCurrentStage('RUNNING');
      setCurrentScreen('executing');
      setIsSubmittingApproval(false);
    } else {
      setActiveApproval(null);
      setActiveProposal(null);
      setCurrentStage('CANCELLED');
      setIsTaskRunning(false);
      setIsSubmittingApproval(false);
      setCurrentScreen('home');
    }
  };

  // Cancel Running Task
  const handleCancelTask = () => {
    if (socket && desktopDeviceId && activeTaskId) {
      socket.emit('message', {
        id: Math.random().toString(36).substring(7),
        type: 'TASK_CANCEL',
        timestamp: new Date().toISOString(),
        sourceDeviceId: deviceId,
        targetDeviceId: desktopDeviceId,
        payload: { taskId: activeTaskId, reason: 'Cancelled by user on mobile' },
      });
    }

    setIsTaskRunning(false);
    setCurrentStage('CANCELLED');
    setCurrentScreen('home');
  };

  // Image assets
  const deskSetupImg = require('./assets/desk_setup.png');
  const robotAvatarImg = require('./assets/robot_avatar.png');

  // ===========================================================================
  // BOTTOM TAB BAR (Visible on Home, Tasks, Devices, Profile)
  // ===========================================================================
  const renderBottomTabBar = () => (
    <View style={styles.bottomNav}>
      <TouchableOpacity
        style={styles.navItem}
        onPress={() => {
          setActiveTab('home');
          setCurrentScreen('home');
        }}
      >
        <Text style={[styles.navIcon, activeTab === 'home' && styles.navIconActive]}>🏠</Text>
        <Text style={[styles.navLabel, activeTab === 'home' && styles.navLabelActive]}>Home</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.navItem}
        onPress={() => {
          setActiveTab('tasks');
          setCurrentScreen('tasks');
        }}
      >
        <Text style={[styles.navIcon, activeTab === 'tasks' && styles.navIconActive]}>📋</Text>
        <Text style={[styles.navLabel, activeTab === 'tasks' && styles.navLabelActive]}>Tasks</Text>
      </TouchableOpacity>

      {/* Floating Center (+) Action Button */}
      <TouchableOpacity
        style={styles.centerFab}
        onPress={() => {
          setCurrentScreen('newTask');
        }}
      >
        <View style={styles.centerFabInner}>
          <Text style={styles.centerFabPlus}>+</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.navItem}
        onPress={() => {
          setActiveTab('devices');
          setCurrentScreen('devices');
        }}
      >
        <Text style={[styles.navIcon, activeTab === 'devices' && styles.navIconActive]}>🖥️</Text>
        <Text style={[styles.navLabel, activeTab === 'devices' && styles.navLabelActive]}>Devices</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.navItem}
        onPress={() => {
          setActiveTab('profile');
          setCurrentScreen('profile');
        }}
      >
        <Text style={[styles.navIcon, activeTab === 'profile' && styles.navIconActive]}>👤</Text>
        <Text style={[styles.navLabel, activeTab === 'profile' && styles.navLabelActive]}>Profile</Text>
      </TouchableOpacity>
    </View>
  );

  // ===========================================================================
  // SCREEN 1: HOME SCREEN
  // ===========================================================================
  const renderHomeScreen = () => {
    const completedCount = taskHistory.filter((t) => t.status === 'COMPLETED').length;
    const activeCount = taskHistory.filter((t) => t.status === 'RUNNING' || t.status === 'PLANNING' || t.status === 'WAITING_FOR_APPROVAL' || t.status === 'VERIFYING').length + (isTaskRunning ? 1 : 0);

    return (
      <View style={styles.screenContainer}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
          {/* Top Header */}
          <View style={styles.homeHeader}>
            <View style={styles.userInfoRow}>
              <View style={styles.userAvatar}>
                <Text style={styles.userAvatarText}>R</Text>
              </View>
              <View>
                <Text style={styles.greetingSub}>Agent Anjaneya</Text>
                <Text style={styles.greetingName}>Mobile Control 👋</Text>
              </View>
            </View>

            {/* Bell Icon */}
            <TouchableOpacity
              style={styles.bellButton}
              onPress={() => setShowNotificationToast(!showNotificationToast)}
            >
              <Text style={{ fontSize: 18 }}>🔔</Text>
              {notificationMsg ? (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>1</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          </View>

          {/* Connected Desktop Hero Card */}
          <TouchableOpacity
            style={styles.pcHeroCard}
            activeOpacity={0.9}
            onPress={() => setCurrentScreen('devices')}
          >
            <View style={styles.pcHeroLeft}>
              <View style={styles.pcHeroInfo}>
                <View style={styles.pcIconBox}>
                  <Text style={{ fontSize: 20 }}>🖥️</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.pcHeroName}>{desktopDeviceId ? 'Connected Desktop' : 'No Desktop Connected'}</Text>
                    <Text style={styles.chevronIcon}>›</Text>
                  </View>
                  <Text style={styles.pcHeroSub}>{desktopDeviceId || 'Tap to pair via QR or PIN'}</Text>
                  <View style={styles.pcStatusRow}>
                    <View style={[styles.greenDot, { backgroundColor: desktopStatus === 'ONLINE' ? '#10b981' : '#94a3b8' }]} />
                    <Text style={[styles.pcStatusText, { color: desktopStatus === 'ONLINE' ? '#10b981' : '#64748b' }]}>
                      {desktopStatus === 'ONLINE' ? 'Online & Ready' : 'Offline / Tap to Pair'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Modern Workstation Illustration Image */}
            <View style={styles.pcHeroImgWrapper}>
              <Image source={deskSetupImg} style={styles.pcHeroImg} resizeMode="contain" />
            </View>
          </TouchableOpacity>

          {/* 3 Stat Cards Row */}
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <View style={[styles.statIconBadge, { backgroundColor: '#dcfce7' }]}>
                <Text style={{ color: '#16a34a', fontSize: 13, fontWeight: 'bold' }}>✓</Text>
              </View>
              <Text style={styles.statNumber}>{completedCount}</Text>
              <Text style={styles.statLabel}>Tasks completed</Text>
            </View>

            <View style={styles.statCard}>
              <View style={[styles.statIconBadge, { backgroundColor: '#dbeafe' }]}>
                <Text style={{ color: '#2563eb', fontSize: 13, fontWeight: 'bold' }}>🕒</Text>
              </View>
              <Text style={styles.statNumber}>{activeCount}</Text>
              <Text style={styles.statLabel}>Active tasks</Text>
            </View>

            <View style={styles.statCard}>
              <View style={[styles.statIconBadge, { backgroundColor: '#f3e8ff' }]}>
                <Text style={{ color: '#9333ea', fontSize: 13, fontWeight: 'bold' }}>💻</Text>
              </View>
              <Text style={styles.statNumber}>{desktopStatus === 'ONLINE' ? 1 : 0}</Text>
              <Text style={styles.statLabel}>Devices online</Text>
            </View>
          </View>

          {/* Quick Actions Header */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Quick Actions</Text>
            <TouchableOpacity onPress={() => setCurrentScreen('newTask')}>
              <Text style={styles.seeAllText}>New task</Text>
            </TouchableOpacity>
          </View>

          {/* 2x2 Quick Actions Grid */}
          <View style={styles.quickGrid}>
            <TouchableOpacity
              style={styles.quickCard}
              onPress={() => {
                setCommandInput('');
                setCurrentScreen('newTask');
              }}
            >
              <View style={[styles.quickIconBox, { backgroundColor: '#eff6ff' }]}>
                <Text style={{ fontSize: 18 }}>💬</Text>
              </View>
              <Text style={styles.quickCardTitle}>Ask Anything</Text>
              <Text style={styles.quickCardSub}>Natural language instruction</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickCard}
              onPress={() => {
                const prompt = 'Find video.mp4 in my Videos folder and extract the first 10 seconds';
                setCommandInput(prompt);
                handleSendCommand(prompt);
              }}
            >
              <View style={[styles.quickIconBox, { backgroundColor: '#fef3c7' }]}>
                <Text style={{ fontSize: 18 }}>📁</Text>
              </View>
              <Text style={styles.quickCardTitle}>Trim Video</Text>
              <Text style={styles.quickCardSub}>Extract 10s video clip</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickCard}
              onPress={() => {
                const prompt = 'List all folders and files in current working directory';
                setCommandInput(prompt);
                handleSendCommand(prompt);
              }}
            >
              <View style={[styles.quickIconBox, { backgroundColor: '#fee2e2' }]}>
                <Text style={{ fontSize: 18 }}>📂</Text>
              </View>
              <Text style={styles.quickCardTitle}>Explore Files</Text>
              <Text style={styles.quickCardSub}>Inspect directory contents</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickCard}
              onPress={() => {
                const prompt = 'Build a responsive portfolio website with project cards';
                setCommandInput(prompt);
                handleSendCommand(prompt);
              }}
            >
              <View style={[styles.quickIconBox, { backgroundColor: '#e0e7ff' }]}>
                <Text style={{ fontSize: 18 }}>💻</Text>
              </View>
              <Text style={styles.quickCardTitle}>Code Project</Text>
              <Text style={styles.quickCardSub}>Multi-agent development</Text>
            </TouchableOpacity>
          </View>

          {/* Active Task Floating Card (if running) */}
          {isTaskRunning && (
            <TouchableOpacity
              style={styles.activeTaskFloatingCard}
              onPress={() => {
                if (currentStage === 'WAITING_FOR_APPROVAL') setCurrentScreen('proposal');
                else if (currentStage === 'COMPLETED') setCurrentScreen('completed');
                else if (currentStage === 'RUNNING') setCurrentScreen('executing');
                else setCurrentScreen('planning');
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <ActivityIndicator size="small" color="#2563eb" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.floatingTaskTitle} numberOfLines={1}>{commandInput || 'Task in progress'}</Text>
                  <Text style={styles.floatingTaskSub}>Stage: {currentStage || 'PROCESSING'}</Text>
                </View>
              </View>
              <Text style={{ color: '#2563eb', fontWeight: 'bold' }}>View ›</Text>
            </TouchableOpacity>
          )}

          {/* Recent Activity */}
          <View style={[styles.sectionHeaderRow, { marginTop: 24 }]}>
            <Text style={styles.sectionTitle}>Recent Tasks</Text>
            <TouchableOpacity onPress={() => setCurrentScreen('tasks')}>
              <Text style={styles.seeAllText}>View all ({taskHistory.length})</Text>
            </TouchableOpacity>
          </View>

          <View style={{ paddingHorizontal: 20, gap: 10 }}>
            {taskHistory.length === 0 ? (
              <View style={[styles.proposalCardBox, { alignItems: 'center', paddingVertical: 20 }]}>
                <Text style={{ color: '#64748b', fontSize: 13 }}>No tasks recorded yet.</Text>
                <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>Tap + to start a new task!</Text>
              </View>
            ) : (
              taskHistory.slice(0, 3).map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.proposalCardBox}
                  onPress={() => {
                    setActiveTaskId(item.id);
                    setCommandInput(item.inputText || item.input_text || '');
                    if (item.status === 'COMPLETED') setCurrentScreen('completed');
                    else if (item.status === 'WAITING_FOR_APPROVAL') setCurrentScreen('proposal');
                    else setCurrentScreen('executing');
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ fontSize: 11, color: item.status === 'COMPLETED' ? '#16a34a' : item.status === 'FAILED' ? '#ef4444' : '#2563eb', fontWeight: 'bold' }}>
                      {item.status}
                    </Text>
                    <Text style={{ fontSize: 10, color: '#94a3b8' }}>
                      {item.createdAt || item.created_at ? new Date(item.createdAt || item.created_at || '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f172a' }} numberOfLines={1}>
                    {item.inputText || item.input_text || 'Task ' + item.id.substring(0, 8)}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        </ScrollView>
        {renderBottomTabBar()}
      </View>
    );
  };

  // ===========================================================================
  // SCREEN 2: NEW TASK SCREEN
  // ===========================================================================
  const renderNewTaskScreen = () => (
    <View style={styles.screenContainer}>
      {/* Top Header */}
      <View style={styles.navTopBar}>
        <View style={styles.sparkleIconBox}>
          <Text style={{ fontSize: 16 }}>✨</Text>
        </View>
        <Text style={styles.navTopBarTitle}>New Task</Text>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={() => setCurrentScreen('home')}
        >
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {/* Hero Title */}
        <View style={{ alignItems: 'center', marginTop: 10, marginBottom: 24 }}>
          <Text style={styles.heroGradientTitle}>
            <Text style={{ color: '#7c3aed' }}>Just tell </Text>
            <Text style={{ color: '#1e293b' }}>me</Text>
          </Text>
          <Text style={[styles.heroGradientTitle, { color: '#1e293b' }]}>what you want to do</Text>
          <Text style={styles.heroSubtitle}>
            I'll understand, plan, and execute it safely on your computer.
          </Text>
        </View>

        {/* AI Task Input Box */}
        <View style={styles.taskInputContainer}>
          <TextInput
            style={styles.taskInputField}
            value={commandInput}
            onChangeText={setCommandInput}
            placeholder="e.g. Find video.mp4 and extract the first 10 seconds"
            placeholderTextColor="#94a3b8"
            multiline
            numberOfLines={4}
          />

          <View style={styles.taskInputBottomRow}>
            <View style={styles.inputActionIcons}>
              <TouchableOpacity style={styles.inputMiniIcon}>
                <Text style={{ fontSize: 17 }}>🖼️</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.inputMiniIcon}>
                <Text style={{ fontSize: 17 }}>🎙️</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.inputMiniIcon}>
                <Text style={{ fontSize: 17 }}>〰️</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.blueSendButton}
              onPress={() => handleSendCommand()}
            >
              <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: 'bold' }}>➔</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Try These Examples */}
        <View style={[styles.sectionHeaderRow, { marginTop: 28, marginBottom: 14 }]}>
          <Text style={styles.sectionTitle}>Try these examples</Text>
          <Text style={styles.seeAllText}>Quick select</Text>
        </View>

        <View style={{ gap: 10 }}>
          <TouchableOpacity
            style={styles.exampleItemCard}
            onPress={() => {
              const text = 'Find video.mp4 in my Videos folder and extract the first 10 seconds';
              setCommandInput(text);
              handleSendCommand(text);
            }}
          >
            <View style={[styles.exampleIconBox, { backgroundColor: '#eff6ff' }]}>
              <Text style={{ fontSize: 16 }}>📁</Text>
            </View>
            <Text style={styles.exampleItemText}>Find video.mp4 and extract first 10 seconds</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.exampleItemCard}
            onPress={() => {
              const text = 'Build a responsive portfolio website with my project details';
              setCommandInput(text);
              handleSendCommand(text);
            }}
          >
            <View style={[styles.exampleIconBox, { backgroundColor: '#f0fdf4' }]}>
              <Text style={{ fontSize: 16 }}>🗂️</Text>
            </View>
            <Text style={styles.exampleItemText}>Build a portfolio website using my projects</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.exampleItemCard}
            onPress={() => {
              const text = 'List all directories and files in D drive';
              setCommandInput(text);
              handleSendCommand(text);
            }}
          >
            <View style={[styles.exampleIconBox, { backgroundColor: '#fefce8' }]}>
              <Text style={{ fontSize: 16 }}>📂</Text>
            </View>
            <Text style={styles.exampleItemText}>Show me all folders in D drive</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );

  // ===========================================================================
  // SCREEN 3: TASK PLANNING SCREEN (Dynamic Multi-Agent Events)
  // ===========================================================================
  const renderPlanningScreen = () => {
    // Pipeline stages for multi-agent reasoning
    const defaultPipelineStages = [
      { role: 'TASK_ANALYST', title: 'Understanding intent', sub: 'Task Analyst' },
      { role: 'CONTEXT', title: 'Gathering context', sub: 'Scanning allowlist & environment' },
      { role: 'PLANNER', title: 'Generating candidate plans', sub: 'Planner & Specialist' },
      { role: 'CRITIC', title: 'Reviewing safety & security', sub: 'Critic' },
      { role: 'JUDGE', title: 'Selecting final proposal', sub: 'Judge' },
    ];

    return (
      <View style={styles.screenContainer}>
        {/* Top Header */}
        <View style={styles.navTopBar}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setCurrentScreen('home')}>
            <Text style={styles.backBtnText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.navTopBarTitle}>Task Planning</Text>
          <TouchableOpacity style={styles.moreBtn} onPress={() => setCurrentScreen('proposal')}>
            <Text style={styles.moreBtnText}>•••</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 40, alignItems: 'center' }}>
          {/* Phase Badge */}
          <View style={styles.phasePill}>
            <Text style={styles.phasePillText}>Multi-Agent Intelligence</Text>
          </View>

          {/* Mascot Illustration */}
          <View style={styles.robotAvatarContainer}>
            <View style={styles.robotGlowRingOuter} />
            <View style={styles.robotGlowRingMiddle} />
            <View style={styles.robotAvatarWrapper}>
              <Image source={robotAvatarImg} style={styles.robotAvatarImg} resizeMode="cover" />
            </View>
            <View style={[styles.particleDot, { top: 12, right: 18, backgroundColor: '#f43f5e', width: 9, height: 9 }]} />
            <View style={[styles.particleDot, { bottom: 20, left: 16, backgroundColor: '#38bdf8', width: 8, height: 8 }]} />
            <View style={[styles.particleDot, { top: 38, left: 10, backgroundColor: '#a855f7', width: 6, height: 6 }]} />
          </View>

          {/* Headline */}
          <Text style={styles.planningMainHeadline}>
            {currentStage ? `Planning: ${currentStage}` : 'Analyzing your request...'}
          </Text>

          {/* Quoted instruction card */}
          <View style={styles.quotedBubble}>
            <Text style={styles.quotedBubbleText}>"{commandInput || 'Processing task...'}"</Text>
          </View>

          {/* Agent Activity Steps */}
          <View style={styles.planningStepsList}>
            {agentActivities.length > 0 ? (
              agentActivities.slice(0, 6).map((activity, idx) => (
                <View key={(activity.timestamp || '') + idx} style={styles.planningStepItem}>
                  <View style={[styles.planningStepIconCircle, { backgroundColor: '#10b981' }]}>
                    <Text style={{ color: '#ffffff', fontSize: 11, fontWeight: 'bold' }}>✓</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planningStepTitle}>{activity.agentRole || 'Agent'}</Text>
                    <Text style={styles.planningStepSubtitle}>
                      {activity.summary || activity.evidence || activity.stage}
                    </Text>
                  </View>
                  <Text style={styles.planningStepDuration}>{activity.stage}</Text>
                </View>
              ))
            ) : (
              defaultPipelineStages.map((stageItem, idx) => (
                <View key={idx} style={styles.planningStepItem}>
                  <View style={[styles.planningStepIconCircle, { backgroundColor: '#ffffff', borderWidth: 2, borderColor: '#2563eb' }]}>
                    <ActivityIndicator size="small" color="#2563eb" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planningStepTitle}>{stageItem.title}</Text>
                    <Text style={styles.planningStepSubtitle}>{stageItem.sub}</Text>
                  </View>
                  <Text style={styles.planningStepDuration}>--</Text>
                </View>
              ))
            )}
          </View>

          {/* Bottom Banner Card */}
          <TouchableOpacity
            style={styles.planningFooterBanner}
            onPress={() => setCurrentScreen('proposal')}
          >
            <Text style={{ fontSize: 16 }}>✨</Text>
            <Text style={styles.planningFooterBannerText}>
              Autonomous multi-agent synthesis running in desktop sandbox...
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  };

  // ===========================================================================
  // SCREEN 4: TASK PROPOSAL / APPROVAL (Real Proposal & Permissions)
  // ===========================================================================
  const renderProposalScreen = () => {
    const objectiveText = activeApproval?.title || activeProposal?.userObjective || commandInput || 'Execute Desktop Task';
    const steps = activeProposal?.steps && activeProposal.steps.length > 0 ? activeProposal.steps : null;
    const riskLevel = activeProposal?.risks && activeProposal.risks.length > 0 ? activeProposal.risks[0] : 'LOW';
    const permissions: string[] = activeProposal?.permissionsRequired || [];

    return (
      <View style={styles.screenContainer}>
        {/* Top Header */}
        <View style={styles.navTopBar}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setCurrentScreen('planning')}>
            <Text style={styles.backBtnText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.navTopBarTitle}>Task Proposal</Text>
          <TouchableOpacity style={styles.moreBtn} onPress={() => setCurrentScreen('executing')}>
            <Text style={styles.moreBtnText}>•••</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
          {/* Header Checkmark */}
          <View style={styles.proposalHeaderCenter}>
            <View style={styles.proposalCheckHalo}>
              <View style={styles.proposalCheckInner}>
                <Text style={{ color: '#ffffff', fontSize: 24, fontWeight: 'bold' }}>✓</Text>
              </View>
            </View>
            <Text style={styles.proposalHeadline}>Execution Proposal Ready</Text>
            <Text style={styles.proposalSubtitle}>
              Our AI agents synthesized this plan. Review details and permissions below.
            </Text>
          </View>

          {/* Objective Card */}
          <View style={styles.proposalCardBox}>
            <View style={styles.objectiveRow}>
              <View style={[styles.quickIconBox, { backgroundColor: '#eff6ff', width: 34, height: 34 }]}>
                <Text style={{ fontSize: 16 }}>📁</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.objectiveLabel}>Objective</Text>
                <Text style={styles.objectiveText}>{objectiveText}</Text>
              </View>
            </View>
          </View>

          {/* Execution Plan Card */}
          <View style={styles.proposalCardBox}>
            <Text style={styles.planCardHeader}>
              Execution Plan {steps ? `(${steps.length} steps)` : '(Verified operations)'}
            </Text>

            {steps ? (
              steps.map((st, i) => (
                <View key={i} style={[styles.planStepRow, i > 0 && { marginTop: 14 }]}>
                  <View style={styles.planStepNumberBadge}>
                    <Text style={styles.planStepNumberText}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planStepTitle}>{st.description || `Step ${i + 1}`}</Text>
                    <Text style={styles.planStepSubtitle}>Tool: {st.tool}</Text>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.planStepRow}>
                <View style={styles.planStepNumberBadge}>
                  <Text style={styles.planStepNumberText}>1</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.planStepTitle}>{activeApproval?.title || 'Execute desktop operation'}</Text>
                  <Text style={styles.planStepSubtitle}>
                    {activeApproval?.details || 'Strictly constrained to allowed directories'}
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* Required Permissions Card */}
          <View style={styles.proposalCardBox}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Text style={{ fontSize: 16 }}>🛡️</Text>
              <Text style={styles.permissionsCardTitle}>Sandbox Permissions</Text>
            </View>

            {permissions.length > 0 ? (
              permissions.map((perm: string, pIdx: number) => (
                <View key={pIdx} style={[styles.permissionSubItem, pIdx > 0 && { marginTop: 8 }]}>
                  <Text style={{ fontSize: 16, marginRight: 8 }}>🔒</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.permissionSubTitle}>{perm}</Text>
                    <Text style={styles.permissionSubDesc}>Allowed path access verified by security manager</Text>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.permissionSubItem}>
                <Text style={{ fontSize: 16, marginRight: 8 }}>✨</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.permissionSubTitle}>Filesystem Sandbox Access</Text>
                  <Text style={styles.permissionSubDesc}>
                    Allowed directories only. Shell commands and path traversal strictly blocked.
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* Stats Row: Estimated time & Risk level */}
          <View style={styles.proposalMetaRow}>
            <View style={styles.proposalMetaItem}>
              <Text style={{ fontSize: 14 }}>🕒</Text>
              <Text style={styles.proposalMetaLabel}>Estimated time</Text>
              <Text style={styles.proposalMetaValue}>~ 5-15 seconds</Text>
            </View>

            <View style={styles.proposalMetaItem}>
              <Text style={{ fontSize: 14 }}>🛡️</Text>
              <Text style={styles.proposalMetaLabel}>Risk level</Text>
              <Text style={[styles.proposalMetaValue, { color: riskLevel === 'HIGH' || riskLevel === 'CRITICAL' ? '#ef4444' : riskLevel === 'MEDIUM' ? '#ea580c' : '#16a34a' }]}>
                {riskLevel}
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* Bottom Sticky Action Buttons */}
        <View style={styles.stickyProposalActions}>
          <TouchableOpacity
            style={styles.rejectBtn}
            disabled={isSubmittingApproval}
            onPress={() => handleApprovalResponse(false)}
          >
            <Text style={styles.rejectBtnText}>Reject</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.approveBtn}
            disabled={isSubmittingApproval}
            onPress={() => handleApprovalResponse(true)}
          >
            {isSubmittingApproval ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.approveBtnText}>Approve &amp; Execute</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ===========================================================================
  // SCREEN 5: EXECUTING TASK (Real progress logs)
  // ===========================================================================
  const renderExecutingScreen = () => (
    <View style={styles.screenContainer}>
      {/* Top Header */}
      <View style={styles.navTopBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => setCurrentScreen('home')}>
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.navTopBarTitle}>Executing Task</Text>
        <TouchableOpacity style={styles.moreBtn} onPress={() => setCurrentScreen('completed')}>
          <Text style={styles.moreBtnText}>•••</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 110, alignItems: 'center' }}>
        {/* Circular Progress Gauge */}
        <View style={styles.execGaugeWrapper}>
          <View style={styles.execGaugeCircle}>
            <Text style={{ fontSize: 32 }}>🖥️</Text>
          </View>
          <View style={styles.execArcIndicator} />
        </View>

        <Text style={styles.execStepCounter}>{currentStage || 'RUNNING'}</Text>
        <Text style={styles.execMainTitle}>{commandInput || 'Executing task...'}</Text>
        <Text style={styles.execSubtitle}>Desktop agent running in safe execution sandbox</Text>

        {/* Live Output Card */}
        <View style={styles.liveOutputCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <Text style={{ fontSize: 16 }}>📁</Text>
            <Text style={styles.liveOutputTitle}>Live Output Stream</Text>
          </View>

          <View style={{ gap: 8 }}>
            {liveOutputLogs.length === 0 ? (
              <Text style={{ color: '#94a3b8', fontSize: 12 }}>Waiting for execution output from desktop engine...</Text>
            ) : (
              liveOutputLogs.map((log, idx) => (
                <View key={idx} style={styles.liveLogRow}>
                  <View style={[styles.liveLogDot, { backgroundColor: log.type === 'green' ? '#10b981' : '#2563eb' }]} />
                  <Text style={styles.liveLogText}>{log.text}</Text>
                  <Text style={styles.liveLogTime}>{log.time}</Text>
                </View>
              ))
            )}
          </View>
        </View>
      </ScrollView>

      {/* Cancel Task Sticky Footer */}
      <View style={styles.stickySingleActionFooter}>
        <TouchableOpacity style={styles.cancelTaskWideBtn} onPress={handleCancelTask}>
          <Text style={styles.cancelTaskWideBtnText}>Cancel Task</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ===========================================================================
  // SCREEN 6: TASK COMPLETED (Real output & duration)
  // ===========================================================================
  const renderCompletedScreen = () => {
    const summary = completedTaskResult?.summary || (commandInput ? `Finished executing: ${commandInput}` : 'Task successfully completed.');
    const durationText = completedTaskResult?.executionTimeMs ? `${(completedTaskResult.executionTimeMs / 1000).toFixed(1)} seconds` : '2.1 seconds';
    const outputPath = completedTaskResult?.outputPath;

    return (
      <View style={styles.screenContainer}>
        {/* Top Header */}
        <View style={styles.navTopBar}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setCurrentScreen('home')}>
            <Text style={styles.backBtnText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.navTopBarTitle}>Task Completed</Text>
          <TouchableOpacity style={styles.moreBtn} onPress={() => setCurrentScreen('home')}>
            <Text style={styles.moreBtnText}>•••</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 120, alignItems: 'center' }}>
          {/* Check Circle */}
          <View style={styles.completedHeaderCenter}>
            <View style={styles.completedCheckCircle}>
              <Text style={{ color: '#ffffff', fontSize: 26, fontWeight: 'bold' }}>✓</Text>
            </View>

            <View style={[styles.confettiParticle, { top: 0, left: 20, backgroundColor: '#f43f5e' }]} />
            <View style={[styles.confettiParticle, { top: 12, right: 24, backgroundColor: '#3b82f6' }]} />
            <View style={[styles.confettiParticle, { bottom: 4, left: 30, backgroundColor: '#eab308' }]} />
            <View style={[styles.confettiParticle, { bottom: 8, right: 34, backgroundColor: '#a855f7' }]} />
            <View style={[styles.confettiParticle, { top: 30, left: 2, backgroundColor: '#10b981' }]} />
            <View style={[styles.confettiParticle, { top: 28, right: 6, backgroundColor: '#ec4899' }]} />

            <Text style={styles.completedMainTitle}>Task Completed!</Text>
            <Text style={styles.completedSubtitle}>{summary}</Text>
          </View>

          {/* 2 Metric Pills */}
          <View style={styles.completedMetricsRow}>
            <View style={styles.completedMetricPill}>
              <Text style={{ fontSize: 13 }}>🕒</Text>
              <Text style={styles.completedMetricLabel}>Completed in</Text>
              <Text style={styles.completedMetricBold}>{durationText}</Text>
            </View>

            <View style={styles.completedMetricPill}>
              <View style={styles.smallGreenCheck}>
                <Text style={{ color: '#ffffff', fontSize: 9, fontWeight: 'bold' }}>✓</Text>
              </View>
              <Text style={styles.completedMetricLabel}>Status</Text>
              <Text style={[styles.completedMetricBold, { color: '#16a34a' }]}>Success</Text>
            </View>
          </View>

          {/* Results List Card */}
          <View style={styles.completedResultsCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Text style={{ fontSize: 16 }}>📁</Text>
              <Text style={styles.resultsCardTitle}>Output Details</Text>
            </View>

            {outputPath ? (
              <View style={styles.folderResultItem}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <Text style={{ fontSize: 16 }}>📄</Text>
                  <Text style={[styles.folderResultName, { flex: 1 }]} numberOfLines={2}>{outputPath}</Text>
                </View>
              </View>
            ) : null}

            <View style={{ paddingVertical: 8 }}>
              <Text style={{ fontSize: 12, color: '#64748b', lineHeight: 18 }}>
                {completedTaskResult?.summary || 'Execution completed without errors.'}
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* Sticky Bottom Actions */}
        <View style={styles.stickyProposalActions}>
          <TouchableOpacity
            style={styles.viewOutputBtn}
            onPress={() => setCurrentScreen('executing')}
          >
            <Text style={styles.viewOutputBtnText}>View Logs</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.approveBtn}
            onPress={() => {
              setCommandInput('');
              setCurrentScreen('newTask');
            }}
          >
            <Text style={styles.approveBtnText}>New Task</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ===========================================================================
  // DEVICES SCREEN (Preserving QR Scanner, PIN pairing, Unpair)
  // ===========================================================================
  const renderDevicesScreen = () => (
    <View style={styles.screenContainer}>
      <View style={styles.navTopBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => setCurrentScreen('home')}>
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.navTopBarTitle}>Connected Computer</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
        {/* Current status card */}
        <View style={styles.deviceStatusCard}>
          <View style={styles.pcHeroInfo}>
            <View style={styles.pcIconBox}>
              <Text style={{ fontSize: 22 }}>🖥️</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.pcHeroName}>{desktopDeviceId ? 'Connected Desktop' : 'No Paired Computer'}</Text>
              <Text style={styles.pcHeroSub}>{desktopDeviceId || 'Unpaired'}</Text>
              <View style={styles.pcStatusRow}>
                <View style={[styles.greenDot, { backgroundColor: desktopStatus === 'ONLINE' ? '#10b981' : '#94a3b8' }]} />
                <Text style={[styles.pcStatusText, { color: desktopStatus === 'ONLINE' ? '#10b981' : '#64748b' }]}>
                  {desktopStatus === 'ONLINE' ? 'Connected & Online' : 'Offline / Unpaired'}
                </Text>
              </View>
            </View>
          </View>

          {desktopDeviceId && (
            <TouchableOpacity style={styles.unpairPillBtn} onPress={handleUnpair}>
              <Text style={styles.unpairPillBtnText}>Unpair Computer</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Pair New Device Section */}
        <Text style={[styles.sectionTitle, { marginTop: 24, marginBottom: 12 }]}>Pairing Options</Text>

        {pairingError && (
          <View style={styles.errorAlertBox}>
            <Text style={styles.errorAlertText}>{pairingError}</Text>
          </View>
        )}

        {scanning ? (
          <View style={{ height: 320, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000' }}>
            {permission?.granted ? (
              <CameraView
                style={{ flex: 1 }}
                onBarcodeScanned={handleScan}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              />
            ) : (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
                <Text style={{ color: '#fff', textAlign: 'center', marginBottom: 12 }}>Camera access needed</Text>
                <TouchableOpacity style={styles.approveBtn} onPress={requestPermission}>
                  <Text style={styles.approveBtnText}>Grant Permission</Text>
                </TouchableOpacity>
              </View>
            )}
            <TouchableOpacity
              style={[styles.rejectBtn, { margin: 12, backgroundColor: '#ffffff' }]}
              onPress={() => setScanning(false)}
            >
              <Text style={styles.rejectBtnText}>Cancel Camera</Text>
            </TouchableOpacity>
          </View>
        ) : showPinInput ? (
          <View style={styles.proposalCardBox}>
            <Text style={styles.planCardHeader}>Enter 6-Digit Desktop PIN</Text>
            <TextInput
              style={[styles.taskInputField, { height: 50, fontSize: 24, textAlign: 'center', letterSpacing: 6, fontWeight: 'bold' }]}
              value={pinInput}
              onChangeText={setPinInput}
              placeholder="123456"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
              maxLength={6}
            />
            <TouchableOpacity style={[styles.approveBtn, { marginTop: 10 }]} onPress={handlePinPairing}>
              <Text style={styles.approveBtnText}>Verify PIN</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.rejectBtn, { marginTop: 8 }]} onPress={() => setShowPinInput(false)}>
              <Text style={styles.rejectBtnText}>Back</Text>
            </TouchableOpacity>
          </View>
        ) : showManualInput ? (
          <View style={styles.proposalCardBox}>
            <Text style={styles.planCardHeader}>Paste Pairing Payload</Text>
            <TextInput
              style={[styles.taskInputField, { height: 90, textAlignVertical: 'top' }]}
              value={manualCode}
              onChangeText={setManualCode}
              placeholder='{"pairingSessionId":"...","pairingToken":"..."}'
              placeholderTextColor="#94a3b8"
              multiline
            />
            <TouchableOpacity style={[styles.approveBtn, { marginTop: 10 }]} onPress={handleManualPairing}>
              <Text style={styles.approveBtnText}>Connect</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.rejectBtn, { marginTop: 8 }]} onPress={() => setShowManualInput(false)}>
              <Text style={styles.rejectBtnText}>Back</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <TouchableOpacity style={styles.pairingOptionBtn} onPress={handleAutoPairLocal}>
              <Text style={{ fontSize: 18 }}>⚡</Text>
              <Text style={styles.pairingOptionText}>1-Click Connect to Local Desktop</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.pairingOptionBtn} onPress={() => setShowPinInput(true)}>
              <Text style={{ fontSize: 18 }}>🔢</Text>
              <Text style={styles.pairingOptionText}>Enter 6-Digit PIN from Desktop</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.pairingOptionBtn}
              onPress={async () => {
                if (!permission?.granted) await requestPermission();
                setScanning(true);
              }}
            >
              <Text style={{ fontSize: 18 }}>📷</Text>
              <Text style={styles.pairingOptionText}>Scan Desktop QR Code</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.pairingOptionBtn} onPress={() => setShowManualInput(true)}>
              <Text style={{ fontSize: 18 }}>📋</Text>
              <Text style={styles.pairingOptionText}>Paste Pairing JSON Code</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
      {renderBottomTabBar()}
    </View>
  );

  // ===========================================================================
  // TASKS HISTORY SCREEN (Real Backend Data)
  // ===========================================================================
  const renderTasksScreen = () => (
    <View style={styles.screenContainer}>
      <View style={styles.navTopBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => setCurrentScreen('home')}>
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.navTopBarTitle}>Task History</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
        {taskHistory.length === 0 ? (
          <View style={[styles.proposalCardBox, { alignItems: 'center', paddingVertical: 32 }]}>
            <Text style={{ fontSize: 24, marginBottom: 8 }}>📋</Text>
            <Text style={{ fontSize: 15, fontWeight: 'bold', color: '#1e293b' }}>No Tasks Recorded</Text>
            <Text style={{ fontSize: 12, color: '#64748b', textAlign: 'center', marginTop: 4, maxWidth: 240 }}>
              Tasks created on mobile or desktop will be synchronized here automatically.
            </Text>
            <TouchableOpacity
              style={[styles.approveBtn, { marginTop: 18, width: 140 }]}
              onPress={() => setCurrentScreen('newTask')}
            >
              <Text style={styles.approveBtnText}>Create Task</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {taskHistory.map((task) => {
              const isCompleted = task.status === 'COMPLETED';
              const isFailed = task.status === 'FAILED';
              const isWaiting = task.status === 'WAITING_FOR_APPROVAL';

              return (
                <TouchableOpacity
                  key={task.id}
                  style={styles.proposalCardBox}
                  onPress={() => {
                    setActiveTaskId(task.id);
                    setCommandInput(task.inputText || task.input_text || '');
                    if (isCompleted) setCurrentScreen('completed');
                    else if (isWaiting) setCurrentScreen('proposal');
                    else setCurrentScreen('executing');
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {isCompleted ? (
                        <View style={[styles.smallGreenCheck, { width: 18, height: 18 }]}>
                          <Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>✓</Text>
                        </View>
                      ) : isFailed ? (
                        <Text style={{ fontSize: 14 }}>⚠️</Text>
                      ) : (
                        <ActivityIndicator size="small" color="#2563eb" />
                      )}
                      <Text style={{
                        fontSize: 11,
                        color: isCompleted ? '#16a34a' : isFailed ? '#ef4444' : isWaiting ? '#9333ea' : '#2563eb',
                        fontWeight: 'bold',
                      }}>
                        {task.status}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 10, color: '#94a3b8' }}>
                      {task.createdAt || task.created_at ? new Date(task.createdAt || task.created_at || '').toLocaleDateString() : ''}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#1e293b' }}>
                    {task.inputText || task.input_text || 'Task ' + task.id.substring(0, 8)}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    ID: {task.id}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
      {renderBottomTabBar()}
    </View>
  );

  // ===========================================================================
  // PROFILE SCREEN
  // ===========================================================================
  const renderProfileScreen = () => (
    <View style={styles.screenContainer}>
      <View style={styles.navTopBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => setCurrentScreen('home')}>
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.navTopBarTitle}>Profile &amp; Settings</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
        <View style={[styles.proposalCardBox, { alignItems: 'center', paddingVertical: 24 }]}>
          <View style={[styles.userAvatar, { width: 64, height: 64, borderRadius: 32 }]}>
            <Text style={{ color: '#fff', fontSize: 26, fontWeight: 'bold' }}>R</Text>
          </View>
          <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#1e293b', marginTop: 10 }}>Ram</Text>
          <Text style={{ fontSize: 12, color: '#64748b' }}>
            {desktopDeviceId ? `Connected to ${desktopDeviceId}` : 'Standalone Mobile Client'}
          </Text>
        </View>

        <View style={[styles.proposalCardBox, { marginTop: 14 }]}>
          <Text style={styles.planCardHeader}>Preferences</Text>
          <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: '#f1f5f9' }}>
            <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#1e293b' }}>Theme</Text>
            <Text style={{ fontSize: 11, color: '#64748b' }}>Light Mode (Default)</Text>
          </View>
          <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: '#f1f5f9' }}>
            <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#1e293b' }}>Backend Server</Text>
            <Text style={{ fontSize: 11, color: '#64748b' }}>{backendUrl}</Text>
          </View>
          <View style={{ paddingVertical: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#1e293b' }}>AI Intelligence Architecture</Text>
            <Text style={{ fontSize: 11, color: '#64748b' }}>Phase 3 Multi-Agent Engine</Text>
          </View>
        </View>
      </ScrollView>
      {renderBottomTabBar()}
    </View>
  );

  // Router switch based on current screen
  return (
    <View style={styles.mainContainer}>
      {/* Toast alert */}
      {showNotificationToast && (
        <View style={styles.toastContainer}>
          <Text style={styles.toastText}>{notificationMsg}</Text>
          <TouchableOpacity onPress={() => setShowNotificationToast(false)}>
            <Text style={{ color: '#ffffff', fontWeight: 'bold' }}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {currentScreen === 'home' && renderHomeScreen()}
      {currentScreen === 'newTask' && renderNewTaskScreen()}
      {currentScreen === 'planning' && renderPlanningScreen()}
      {currentScreen === 'proposal' && renderProposalScreen()}
      {currentScreen === 'executing' && renderExecutingScreen()}
      {currentScreen === 'completed' && renderCompletedScreen()}
      {currentScreen === 'devices' && renderDevicesScreen()}
      {currentScreen === 'tasks' && renderTasksScreen()}
      {currentScreen === 'profile' && renderProfileScreen()}
    </View>
  );
}

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  screenContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
    paddingTop: Platform.OS === 'android' ? 35 : 20,
  },
  toastContainer: {
    position: 'absolute',
    top: 40,
    left: 20,
    right: 20,
    zIndex: 999,
    backgroundColor: '#1e293b',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  toastText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },

  // Navigation Top Bar
  navTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    backgroundColor: '#ffffff',
  },
  navTopBarTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  sparkleIconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f5f3ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: 'bold',
  },
  backBtn: {
    width: 32,
    height: 32,
    justifyContent: 'center',
  },
  backBtnText: {
    fontSize: 28,
    color: '#0f172a',
    lineHeight: 30,
  },
  moreBtn: {
    width: 32,
    height: 32,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  moreBtnText: {
    fontSize: 18,
    color: '#64748b',
    fontWeight: 'bold',
  },

  // Home Header
  homeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  userInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563eb',
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 3,
  },
  userAvatarText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  greetingSub: {
    fontSize: 12,
    color: '#64748b',
  },
  greetingName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
  },
  bellButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  bellBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  bellBadgeText: {
    color: '#ffffff',
    fontSize: 8,
    fontWeight: 'bold',
  },

  // Connected Desktop Card
  pcHeroCard: {
    marginHorizontal: 20,
    marginTop: 6,
    borderRadius: 24,
    backgroundColor: '#f0f5ff',
    borderWidth: 1,
    borderColor: '#dbeafe',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
    shadowColor: '#2563eb',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  pcHeroLeft: {
    flex: 1,
  },
  pcHeroInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pcIconBox: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563eb',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 1,
  },
  pcHeroName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  chevronIcon: {
    fontSize: 18,
    color: '#94a3b8',
    fontWeight: 'bold',
  },
  pcHeroSub: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#64748b',
    marginTop: 1,
  },
  pcStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
  },
  pcStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#10b981',
  },
  pcHeroImgWrapper: {
    width: 100,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pcHeroImg: {
    width: 110,
    height: 85,
  },

  // Stats Row
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginTop: 18,
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    alignItems: 'flex-start',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 5,
    elevation: 1,
  },
  statIconBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  statNumber: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748b',
    marginTop: 2,
  },

  // Quick Actions Section
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 22,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  seeAllText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563eb',
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 12,
  },
  quickCard: {
    width: (Dimensions.get('window').width - 52) / 2,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 5,
    elevation: 1,
  },
  quickIconBox: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  quickCardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  quickCardSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },

  // Active Task Floating Card
  activeTaskFloatingCard: {
    marginHorizontal: 20,
    marginTop: 18,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#2563eb',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  floatingTaskTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  floatingTaskSub: {
    fontSize: 11,
    color: '#2563eb',
    fontWeight: '600',
    marginTop: 1,
  },

  // Bottom Navigation Bar
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 72,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingBottom: Platform.OS === 'ios' ? 12 : 0,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 8,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  navIcon: {
    fontSize: 18,
    color: '#94a3b8',
  },
  navIconActive: {
    color: '#2563eb',
  },
  navLabel: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
    marginTop: 3,
  },
  navLabelActive: {
    color: '#2563eb',
    fontWeight: '700',
  },
  centerFab: {
    top: -16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563eb',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  centerFabInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#ffffff',
  },
  centerFabPlus: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '600',
    marginTop: -2,
  },

  // Screen 2 New Task Styles
  heroGradientTitle: {
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 32,
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 280,
    lineHeight: 18,
  },
  taskInputContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  taskInputField: {
    fontSize: 15,
    color: '#0f172a',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  taskInputBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f8fafc',
  },
  inputActionIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  inputMiniIcon: {
    padding: 4,
  },
  blueSendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563eb',
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 3,
  },
  exampleItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    gap: 12,
  },
  exampleIconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exampleItemText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
    flex: 1,
  },

  // Screen 3 Task Planning Styles
  phasePill: {
    backgroundColor: '#f3e8ff',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
    marginBottom: 18,
  },
  phasePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7c3aed',
  },
  robotAvatarContainer: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginVertical: 10,
  },
  robotGlowRingOuter: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#eff6ff',
    opacity: 0.8,
  },
  robotGlowRingMiddle: {
    position: 'absolute',
    width: 115,
    height: 115,
    borderRadius: 58,
    backgroundColor: '#dbeafe',
    opacity: 0.5,
  },
  robotAvatarWrapper: {
    width: 90,
    height: 90,
    borderRadius: 45,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
    borderWidth: 3,
    borderColor: '#ffffff',
    shadowColor: '#2563eb',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5,
  },
  robotAvatarImg: {
    width: 90,
    height: 90,
  },
  particleDot: {
    position: 'absolute',
    borderRadius: 5,
  },
  planningMainHeadline: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 12,
  },
  quotedBubble: {
    backgroundColor: '#f5f3ff',
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 12,
    marginBottom: 20,
    maxWidth: '92%',
  },
  quotedBubbleText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1e293b',
    textAlign: 'center',
  },
  planningStepsList: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    gap: 16,
  },
  planningStepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  planningStepIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planningStepTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  planningStepSubtitle: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
  },
  planningStepDuration: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#94a3b8',
    fontWeight: '600',
  },
  planningFooterBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#faf5ff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#f3e8ff',
    padding: 14,
    marginTop: 18,
    gap: 10,
    width: '100%',
  },
  planningFooterBannerText: {
    fontSize: 12,
    color: '#7c3aed',
    fontWeight: '600',
    flex: 1,
    lineHeight: 16,
  },

  // Screen 4 Task Proposal Styles
  proposalHeaderCenter: {
    alignItems: 'center',
    marginVertical: 12,
  },
  proposalCheckHalo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  proposalCheckInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10b981',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  proposalHeadline: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  proposalSubtitle: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 290,
    lineHeight: 18,
  },
  proposalCardBox: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    marginTop: 12,
  },
  objectiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  objectiveLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
  },
  objectiveText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 2,
  },
  planCardHeader: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 12,
  },
  planStepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  planStepNumberBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  planStepNumberText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  planStepTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  planStepSubtitle: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  permissionsCardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  permissionSubItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fffbeb',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fef3c7',
    padding: 12,
  },
  permissionSubTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400e',
  },
  permissionSubDesc: {
    fontSize: 11,
    color: '#b45309',
    marginTop: 2,
    lineHeight: 15,
  },
  proposalMetaRow: {
    flexDirection: 'row',
    marginTop: 14,
    gap: 10,
  },
  proposalMetaItem: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    alignItems: 'center',
  },
  proposalMetaLabel: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
  },
  proposalMetaValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 2,
  },
  stickyProposalActions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    flexDirection: 'row',
    gap: 12,
  },
  rejectBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: '#fecaca',
    backgroundColor: '#fff5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectBtnText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '700',
  },
  approveBtn: {
    flex: 2,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563eb',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
  },
  approveBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },

  // Screen 5 Executing Task Styles
  execGaugeWrapper: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
    position: 'relative',
  },
  execGaugeCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 6,
    borderColor: '#dbeafe',
  },
  execArcIndicator: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 50,
    height: 50,
    borderTopWidth: 6,
    borderRightWidth: 6,
    borderColor: '#2563eb',
    borderRadius: 25,
  },
  execStepCounter: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563eb',
  },
  execMainTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 4,
  },
  execSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
    marginBottom: 16,
  },
  execStepperCard: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    marginBottom: 14,
  },
  execStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  liveOutputCard: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
  },
  liveOutputTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  liveLogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveLogDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  liveLogText: {
    fontSize: 12,
    color: '#1e293b',
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  liveLogTime: {
    fontSize: 10,
    color: '#94a3b8',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  stickySingleActionFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
  },
  cancelTaskWideBtn: {
    width: '100%',
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: '#fecaca',
    backgroundColor: '#fff5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelTaskWideBtnText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '700',
  },

  // Screen 6 Task Completed Styles
  completedHeaderCenter: {
    alignItems: 'center',
    marginVertical: 14,
    position: 'relative',
    width: '100%',
  },
  completedCheckCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10b981',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
    marginBottom: 12,
  },
  confettiParticle: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  completedMainTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  completedSubtitle: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 4,
  },
  completedMetricsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginVertical: 14,
  },
  completedMetricPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 12,
    gap: 6,
  },
  completedMetricLabel: {
    fontSize: 11,
    color: '#64748b',
  },
  completedMetricBold: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0f172a',
  },
  smallGreenCheck: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#16a34a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  completedResultsCard: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
  },
  resultsCardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  folderResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
  },
  folderResultName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1e293b',
  },
  viewOutputBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: '#bfdbfe',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewOutputBtnText: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '700',
  },

  // Devices & Pairing Styles
  deviceStatusCard: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 18,
    gap: 14,
  },
  unpairPillBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#fee2e2',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
  },
  unpairPillBtnText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: 'bold',
  },
  pairingOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
  },
  pairingOptionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
    flex: 1,
  },
  errorAlertBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  errorAlertText: {
    color: '#ef4444',
    fontSize: 12,
    textAlign: 'center',
  },
});
