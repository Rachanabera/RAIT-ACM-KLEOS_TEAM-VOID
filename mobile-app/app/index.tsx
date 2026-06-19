import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Vibration, Animated, Dimensions, TextInput, Alert, ActivityIndicator, FlatList, Keyboard, Switch, Image, ScrollView, RefreshControl } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import CustomMap from '../components/CustomMap';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import { useApp } from './context/AppContext';
import { BACKEND_URL, apiPost, apiGet, calculateConfidence, isNightTime, SOS_THRESHOLD, checkBackendHealth } from './utils/api';
import MapView, { PROVIDER_DEFAULT, Polyline, Marker } from 'react-native-maps';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;

export default function App() {
  const {
    user, setUser, token, setToken, sosActive, setSosActive,
    sentinelMode, setSentinelMode, shadowMode, setShadowMode,
    confidenceScore, setConfidenceScore, signals, setSignals,
    location, setLocation, liveTranscript, setLiveTranscript,
    audioLogs, setAudioLogs, offlineQueue, setOfflineQueue,
    isOffline, setIsOffline,
    emergencyContacts, setEmergencyContacts,
    connectionStatus, setConnectionStatus,
    backendUrl, setBackendUrlState
  } = useApp();

  const [currentScreen, setCurrentScreen] = useState('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);

  // AUTHENTICATION
  const [authMode, setAuthMode] = useState('login');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [signupData, setSignupData] = useState({ name: '', email: '', password: '', phone: '', gender: '' });

  // MAP & HEATMAP & SAFE PATH
  const mapRef = useRef<any>(null);
  const [destination, setDestination] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [safeZones, setSafeZones] = useState<any[]>([]);
  const [routeSteps, setRouteSteps] = useState<any[]>([]);
  const [heatmapIncidents, setHeatmapIncidents] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showHeatmapOnly, setShowHeatmapOnly] = useState(false);

  // SHADOW STEALTH
  const [stealthNotes, setStealthNotes] = useState('');
  const [shadowETA, setShadowETA] = useState(7);
  const [shadowSafeZone, setShadowSafeZone] = useState('Safety Hub - Dadar');

  // PASSIVE MONITORING (FITNESS TRACKER STYLE)
  const [passiveTracking, setPassiveTracking] = useState(true);
  const [isPopupVisible, setIsPopupVisible] = useState(false);
  const popupTimer = useRef<any>(null);
  const [popupCountdown, setPopupCountdown] = useState(7);
  const countdownIntervalRef = useRef<any>(null);

  // ADMIN STATE
  const [adminStats, setAdminStats] = useState<any>(null);
  const [adminAlerts, setAdminAlerts] = useState<any[]>([]);
  const [refreshingAdmin, setRefreshingAdmin] = useState(false);

  // EMERGENCY CONTACTS & SETTINGS EDITORS
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newContactRelation, setNewContactRelation] = useState('Friend');
  const [isSavingContacts, setIsSavingContacts] = useState(false);

  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileGender, setProfileGender] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [tempBackendUrl, setTempBackendUrl] = useState(backendUrl);

  // AUDIO RECORDING LOOP REFS & MUTEX
  const recordingRef = useRef<any>(null);
  const isSentinelActive = useRef(false);
  const audioLoopIdRef = useRef(0);

  // ANIMATIONS
  const sidebarAnim = useRef(new Animated.Value(-SCREEN_WIDTH)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;
  const bgPulseAnim = useRef(new Animated.Value(0)).current;

  // REFS FOR ACCELEROMETER CLOSURE PROTECTION
  const sosActiveRef = useRef(sosActive);
  const sentinelModeRef = useRef(sentinelMode);
  const accelSubscriptionRef = useRef<any>(null);
  const currentGForceRef = useRef(1.0);
  const isTrackingRunRef = useRef(false);
  const runSpikesRef = useRef(0);

  // GUARDIAN AI SOS DETAILS
  const [sosNarrative, setSosNarrative] = useState('');
  const [notifiedGuardians, setNotifiedGuardians] = useState<any[]>([]);
  const [popupScore, setPopupScore] = useState(0);
  const [activeEventId, setActiveEventId] = useState<number | null>(null);
  const [safetyPopupIgnored, setSafetyPopupIgnored] = useState(false);
  const sosStartTime = useRef<number | null>(null);

  useEffect(() => {
    sosActiveRef.current = sosActive;
  }, [sosActive]);

  useEffect(() => {
    sentinelModeRef.current = sentinelMode;
  }, [sentinelMode]);

  // Sync profile details and emergency contacts when user state changes
  useEffect(() => {
    if (user) {
      setProfileName(user.name || '');
      setProfilePhone(user.phone || '');
      setProfileGender(user.gender || '');
      if (user.emergency_contacts) {
        setEmergencyContacts(user.emergency_contacts);
      }
    } else {
      setProfileName('');
      setProfilePhone('');
      setProfileGender('');
      setEmergencyContacts([]);
    }
  }, [user]);

  // Sync temp backend url state when backendUrl changes
  useEffect(() => {
    setTempBackendUrl(backendUrl);
  }, [backendUrl]);

  // INITIALIZE FLOATING EFFECT AND HARDWARE
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(floatAnim, { toValue: -8, duration: 2000, useNativeDriver: true }),
      Animated.timing(floatAnim, { toValue: 8, duration: 2000, useNativeDriver: true })
    ])).start();
    initializeHardware();

    return () => {
      if (accelSubscriptionRef.current) {
        accelSubscriptionRef.current.remove();
      }
    };
  }, []);

  // PERIODIC BACKEND HEALTH CHECKER
  useEffect(() => {
    const runHealthCheck = async () => {
      setConnectionStatus('checking');
      const isHealthy = await checkBackendHealth();
      setConnectionStatus(isHealthy ? 'connected' : 'disconnected');
    };
    runHealthCheck();
    const timer = setInterval(runHealthCheck, 15000);
    return () => clearInterval(timer);
  }, [backendUrl]);

  // SOS RED SCREEN PULSING TRANSITION
  useEffect(() => {
    if (sosActive) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(bgPulseAnim, { toValue: 1, duration: 500, useNativeDriver: false }),
          Animated.timing(bgPulseAnim, { toValue: 0, duration: 500, useNativeDriver: false })
        ])
      ).start();
    } else {
      bgPulseAnim.setValue(0);
    }
  }, [sosActive]);

  // ACTIVE SOS RESOLUTION AND TIMEOUT POLLING (30 MINS OR ADMIN RESOLVED)
  useEffect(() => {
    if (!sosActive) return;

    const interval = setInterval(() => {
      const now = Date.now();

      // 1. Auto-disarm after 30 minutes
      if (sosStartTime.current && now - sosStartTime.current > 30 * 60 * 1000) {
        console.log("SOS Alert auto-disarmed: 30 minutes elapsed.");
        disarmSOS();
        Alert.alert("Sentinel Safe", "Alert automatically disarmed after 30 minutes.");
        return;
      }

      // 2. Query backend to see if admin resolved or dismissed the alert
      if (activeEventId) {
        apiGet(`/api/v1/sos/status/${activeEventId}`)
          .then(res => {
            if (res && (res.status === 'resolved' || res.status === 'false_alarm')) {
              console.log(`SOS Alert resolved/dismissed by admin. Status: ${res.status}`);
              disarmSOS();
              Alert.alert("Sentinel Safe", `Emergency resolved by system admin. Status: ${res.status}`);
            }
          })
          .catch(err => {
            console.warn("Error polling SOS status:", err);
          });
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [sosActive, activeEventId]);

  const interpolatedBg = bgPulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#09090B', '#9F1239'] // Changed #FDF2F8 (Pink) to #09090B (Dark Charcoal)
  });

  // AUDIO NLP CONTINUOUS LOOP TRIGGER
  // AUDIO NLP CONTINUOUS LOOP TRIGGER
  useEffect(() => {
    console.log("--- Sentinel Mode Switched to:", sentinelMode, "---");
    isSentinelActive.current = sentinelMode;

    if (sentinelMode) {
      activateKeepAwakeAsync();
      const currentLoopId = ++audioLoopIdRef.current;
      console.log("Kicking off new Audio Loop ID:", currentLoopId);
      startContinuousAudioLoop(currentLoopId);
    } else {
      deactivateKeepAwake();
      audioLoopIdRef.current++; // Invalidate active loop timeouts
      stopRecordingGracefully();
      setLiveTranscript("System Disarmed");
    }
  }, [sentinelMode]);

  // AUTO-ARM PERMANENTLY (24/7)
  useEffect(() => {
    setSentinelMode(true);
  }, []);

  const initializeHardware = async () => {
    await Notifications.requestPermissionsAsync();
    let { status: locStatus } = await Location.requestForegroundPermissionsAsync();
    if (locStatus === 'granted') {
      let loc = await Location.getCurrentPositionAsync({});
      setLocation(loc.coords);
      Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 5 }, (res) => {
        setLocation(res.coords);
        if (token && res.coords) {
          apiPost('/api/v1/user/location', { lat: res.coords.latitude, lng: res.coords.longitude }, token);
        }
      });
    }
    const audioPerm = await Audio.requestPermissionsAsync();
    console.log("Microphone Permission Status:", audioPerm.status);
    if (audioPerm.status !== 'granted') {
      Alert.alert("Mic Denied", "Sentinel cannot track audio without microphone permissions.");
    }

    // ACCELEROMETER HARDWARE DETECTOR WITH REF CLOSURE PROTECTION AND CLEANUP
    Accelerometer.setUpdateInterval(100);
    let lastG = 1.0;
    accelSubscriptionRef.current = Accelerometer.addListener(({ x, y, z }) => {
      const gForce = Math.sqrt(x * x + y * y + z * z);
      currentGForceRef.current = gForce;

      // If we are currently tracking post-impact running, count high-g readings as spikes
      if (isTrackingRunRef.current && gForce > 1.8) {
        runSpikesRef.current += 1;
      }

      const threshold = sentinelModeRef.current ? 5.0 : 6.5;

      // Only detect a new impact if we aren't currently tracking a post-impact run
      if (gForce > threshold && !sosActiveRef.current && !isTrackingRunRef.current) {
        addSignal('impact', 'Sudden physical drop/impact');
        Vibration.vibrate(200);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

        isTrackingRunRef.current = true;
        runSpikesRef.current = 0;

        // Check for sudden running after impact (accel pattern continues high)
        setTimeout(() => {
          isTrackingRunRef.current = false;
          // If we saw at least 3 high-G readings during the 1.5 seconds, trigger running
          if (runSpikesRef.current >= 3 && sentinelModeRef.current) {
            addSignal('running', 'Rapid movement/running post-impact');
          }
          runSpikesRef.current = 0;
        }, 1500);
      }
      lastG = gForce;
    });
  };

  // EVALUATE SCORE ENGINE & DECIDE IF SOS TRIGGER IS REQUIRED
  const addSignal = (type: string, detail: string) => {
    setSignals(prev => {
      // Avoid duplicate active signals
      if (prev.some(s => s.type === type)) return prev;
      return [...prev, { type, detail, timestamp: Date.now() }];
    });
  };

  useEffect(() => {
    const evaluate = async () => {
      if (signals.length === 0) {
        setConfidenceScore(0);
        setSafetyPopupIgnored(false);
        return;
      }

      const evaluation = calculateConfidence(signals);
      setConfidenceScore(evaluation.score);

      // If score is elevated (e.g. >= 50 but not triggered), trigger "Are you ok?" safety check
      if (evaluation.score >= 50 && !evaluation.triggered && !sosActive && !isPopupVisible && !safetyPopupIgnored) {
        triggerSafetyPopupCheck(evaluation.score);
      }

      if (evaluation.triggered && !sosActive) {
        const hasNoResponse = signals.some(s => s.type === 'no_response');
        const reason = hasNoResponse ? "Unresponsive Safety Check" : "Sentinel Automatic Confidence SOS";
        triggerEmergency(reason, evaluation.score, signals);
      }
    };

    evaluate();
  }, [signals, safetyPopupIgnored]);

  // SIGNAL DECAY EFFECT (EXPIRATION AFTER 15 SECONDS)
  useEffect(() => {
    if (signals.length === 0 || sosActive || safetyPopupIgnored) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const validSignals = signals.filter(s => {
        // Night and manual signals do not decay/expire
        if (s.type === 'night' || s.type === 'manual') return true;
        return now - s.timestamp < 15000; // 15 seconds duration
      });

      if (validSignals.length !== signals.length) {
        setSignals(validSignals);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [signals, sosActive, safetyPopupIgnored]);

  // FITNESS-TRACKER STYLE POPUP TIMEOUT WITH VISUAL COUNTDOWN
  const triggerSafetyPopupCheck = (score: number) => {
    setPopupScore(score);
    setIsPopupVisible(true);
    setPopupCountdown(7);
    Vibration.vibrate([100, 200, 100]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

    if (popupTimer.current) clearTimeout(popupTimer.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);

    countdownIntervalRef.current = setInterval(() => {
      setPopupCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownIntervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    popupTimer.current = setTimeout(() => {
      setIsPopupVisible(false);
      setSafetyPopupIgnored(true);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    }, 7000);
  };

  const handleDismissPopup = () => {
    if (popupTimer.current) clearTimeout(popupTimer.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    setIsPopupVisible(false);
    setSafetyPopupIgnored(false);
    // User is safe, reset confidence scores/signals
    setSignals([]);
    setConfidenceScore(0);
    Alert.alert("Sentinel Safe", "Alert dismissed. System remains armed.");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // AUDIO RECORDING LOOP WITH RACE CONDITION MUTEX PROTECTION
  // AUDIO RECORDING LOOP WITH EXTREME LOGGING & STABLE INIT
  const startContinuousAudioLoop = async (loopId: number) => {
    try {
      console.log(`[Loop ${loopId}] 1. Starting loop validation`);
      if (!isSentinelActive.current || sosActive || loopId !== audioLoopIdRef.current) return;

      console.log(`[Loop ${loopId}] 2. Checking permissions`);
      const perm = await Audio.getPermissionsAsync();
      if (perm.status !== 'granted') {
        console.log(`[Loop ${loopId}] Waiting for mic permission...`);
        setLiveTranscript("Waiting for mic permission...");
        setTimeout(() => {
          if (loopId === audioLoopIdRef.current) startContinuousAudioLoop(loopId);
        }, 2000);
        return;
      }

      console.log(`[Loop ${loopId}] 3. Cleaning up old recording if it exists`);
      if (recordingRef.current) {
        try { await recordingRef.current.stopAndUnloadAsync(); } catch (e) { }
        recordingRef.current = null;
      }

      console.log(`[Loop ${loopId}] 4. Setting Audio Mode`);
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true
      });

      console.log(`[Loop ${loopId}] 5. Preparing recording object`);
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);

      console.log(`[Loop ${loopId}] 6. Starting recording engine`);
      await recording.startAsync();

      if (loopId !== audioLoopIdRef.current) {
        console.log(`[Loop ${loopId}] Loop ID changed, aborting`);
        try { await recording.stopAndUnloadAsync(); } catch (e) { }
        return;
      }

      recordingRef.current = recording;
      setLiveTranscript("Analyzing audio...");
      console.log(`[Loop ${loopId}] 7. Recording active! Waiting 4 seconds...`);

      setTimeout(async () => {
        console.log(`[Loop ${loopId}] 8. 4 seconds passed. Stopping recording...`);
        if (loopId === audioLoopIdRef.current && isSentinelActive.current && recordingRef.current) {
          let uri = null;
          try {
            await recordingRef.current.stopAndUnloadAsync();
            uri = recordingRef.current.getURI();
            console.log(`[Loop ${loopId}] 9. Audio saved at: ${uri}`);
          } catch (e) {
            console.error(`[Loop ${loopId}] Unload error:`, e);
          } finally {
            recordingRef.current = null;
          }

          if (uri) {
            console.log(`[Loop ${loopId}] 10. Sending to Python Backend`);
            analyzeAudioWithPython(uri);
          }
          startContinuousAudioLoop(loopId);
        }
      }, 4000);

    } catch (err: any) {
      console.error(`[Loop ${loopId}] CRITICAL CRASH:`, err);
      setLiveTranscript(`Crash: ${err.message}`);
      Alert.alert("Microphone Crash Detected", err.message || "Unknown Audio Error");
      recordingRef.current = null;

      setTimeout(() => {
        if (isSentinelActive.current && !sosActive && loopId === audioLoopIdRef.current) {
          startContinuousAudioLoop(loopId);
        }
      }, 4000);
    }
  };

  const analyzeAudioWithPython = async (uri: string) => {
    if (isOffline) {
      setLiveTranscript("[Offline] Speech locally saved");
      return;
    }
    let formData = new FormData();
    formData.append('file', { uri: uri, type: 'audio/wav', name: 'audio.wav' } as any);

    try {
      let res = await fetch(`${backendUrl}/api/v1/sos/analyze-audio`, {
        method: 'POST', body: formData, headers: { 'Content-Type': 'multipart/form-data' }
      });
      let json = await res.json();

      // FIX: Actually display Python errors on the screen if the file format fails!
      if (json.error) {
        console.warn("Python Backend Error:", json.error);
        setLiveTranscript(`Format Error: ${json.error.substring(0, 20)}...`);
        return;
      }

      if (json.transcript && json.transcript !== "[Silence]") {
        setLiveTranscript(json.transcript);
        setAudioLogs(prev => [{ id: Date.now().toString(), uri, date: new Date().toLocaleTimeString(), text: json.transcript }, ...prev]);
      } else {
        setLiveTranscript("Listening...");
      }

      if (json.danger_detected) {
        addSignal('keyword', `Heard distress word: "${json.transcript}"`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    } catch (e) {
      setLiveTranscript("Connecting to core...");
    }
  };

  const stopRecordingGracefully = async () => {
    if (recordingRef.current) {
      try {
        await recordingRef.current.stopAndUnloadAsync();
      } catch (e) { }
      recordingRef.current = null;
    }
  };

  const playAudio = async (uri: string) => {
    try {
      const { sound } = await Audio.Sound.createAsync({ uri });
      await sound.playAsync();
    } catch (e) {
      Alert.alert("Error", "Could not play audio snippet.");
    }
  };

  // SOS TRIGGER - MULTIPART DISPATCH WITH NARRATIVE
  const triggerEmergency = async (reason: string, score = 100, currentSignals: any[] = []) => {
    if (sosActive) return;
    setSosActive(true);
    sosStartTime.current = Date.now();
    setSentinelMode(false);
    setShadowMode(false);
    setCurrentScreen('home');

    let finalSignals = currentSignals;
    let finalScore = score;
    if (reason === "Manual Dashboard SOS") {
      finalScore = 100;
      setConfidenceScore(100);
      setSignals(prev => {
        if (prev.some(s => s.type === 'manual')) return prev;
        return [...prev, { type: 'manual', detail: 'User pressed physical panic button', timestamp: Date.now() }];
      });
      finalSignals = [...currentSignals, { type: 'manual', detail: 'User pressed physical panic button', timestamp: Date.now() }];
    }

    Vibration.vibrate([500, 500, 500, 500, 500], true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

    await Notifications.scheduleNotificationAsync({
      content: { title: "🚨 SENTINEL SOS DISPATCH", body: `Action triggered: ${reason} (Conf: ${finalScore}%)`, sound: 'default', color: '#E11D48' },
      trigger: null,
    });

    const payload = {
      user_id: user ? user.id : null,
      user_name: user ? user.name : "Guest User",
      trigger_type: reason,
      lat: location?.latitude || 19.0760,
      lng: location?.longitude || 72.8777,
      battery_level: 85,
      speed: 0,
      confidence_score: finalScore,
      signal_chain: finalSignals
    };

    if (isOffline) {
      // OFFLINE DISASTER MESH BROADCAST Simulation
      setOfflineQueue(prev => [...prev, payload]);
      Alert.alert(
        "Offline SOS Broadcasted",
        "⚠️ No internet connection! SOS transmitted to 3 nearby Sentinel mesh users via Bluetooth Direct.",
        [{ text: "OK" }]
      );
      return;
    }

    try {
      const res = await apiPost('/api/v1/sos/trigger', payload);
      if (res) {
        if (res.event_id) {
          setActiveEventId(res.event_id);
        }
        if (res.narrative) {
          setSosNarrative(res.narrative);
        }
        if (res.guardians_notified) {
          setNotifiedGuardians(res.guardians_notified);
        }
      }
    } catch (e: any) {
      setOfflineQueue(prev => [...prev, payload]);
      Alert.alert(
        "Network Alert",
        `Error: ${e?.message || e}. Endpoint: ${backendUrl}/api/v1/sos/trigger`,
        [{ text: "OK" }]
      );
    }
  };

  const disarmSOS = () => {
    setSosActive(false);
    Vibration.cancel();
    setSignals([]);
    setConfidenceScore(0);
    setSosNarrative('');
    setNotifiedGuardians([]);
    setActiveEventId(null);
    setSafetyPopupIgnored(false);
    sosStartTime.current = null;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // SYNC OFFLINE EVENTS
  const syncOfflineQueue = async () => {
    if (offlineQueue.length === 0) {
      Alert.alert("Offline Sync", "No pending offline events to synchronize.");
      return;
    }
    try {
      const res = await apiPost('/api/v1/offline/sync', { events: offlineQueue }, token);
      if (res && res.synced_count) {
        Alert.alert("Sync Successful", `Successfully pushed ${res.synced_count} offline events to Sentinel servers!`);
        setOfflineQueue([]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e) {
      Alert.alert("Sync Error", "Could not connect to backend server.");
    }
  };

  // SHADOW TRACKING MODE (Stealth Calculator UI / Safest Zones)
  // SHADOW TRACKING MODE (Auto-Route & 200m Geofence Broadcast)
  const activateShadowMode = async () => {
    // 1. Force the screen change immediately
    setCurrentScreen('map');
    setShadowMode(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    // Provide a strict fallback if GPS is delayed
    const currentLat = location?.latitude || 19.0760;
    const currentLng = location?.longitude || 72.8777;

    try {
      // 2. Find Nearest Safe Zone (Police/Hospital) via Overpass
      const overpassQuery = `[out:json];node(around:2500,${currentLat},${currentLng})["amenity"~"police|hospital"];out 1;`;
      const res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`);
      const data = await res.json();

      if (data.elements && data.elements.length > 0) {
        const targetNode = data.elements[0];
        const placeName = targetNode.tags.name || "Nearest Safe Zone";

        setDestination(placeName); // Auto-fill the search bar

        // 3. Fetch the actual route geometry to draw on the map
        // 3. Fetch the actual route geometry AND steps to draw on the map
        const routeRes = await fetch(`http://router.project-osrm.org/route/v1/foot/${currentLng},${currentLat};${targetNode.lon},${targetNode.lat}?overview=full&geometries=geojson&steps=true`);
        const routeData = await routeRes.json();

        if (routeData.routes && routeData.routes.length > 0) {
          const formattedRoutes = [{
            id: 'shadow-escape-route',
            coords: routeData.routes[0].geometry.coordinates.map((c: any) => ({ latitude: c[1], longitude: c[0] })),
            isSafest: true
          }];
          setRoutes(formattedRoutes);

          // Save the turn-by-turn steps
          if (routeData.routes[0].legs && routeData.routes[0].legs[0].steps) {
            setRouteSteps(routeData.routes[0].legs[0].steps);
          }
          // FIX: Give React 500ms to mount the MapView component before trying to zoom into the coordinates
          setTimeout(() => {
            if (mapRef.current) {
              mapRef.current.fitToCoordinates(formattedRoutes[0].coords, {
                edgePadding: { top: 100, right: 50, bottom: 100, left: 50 },
                animated: true
              });
            }
          }, 500);
        }
      }
    } catch (e) {
      console.warn("Routing failed.", e);
    }

    // 4. Trigger Backend Geofence Broadcast (200m radius)
    try {
      const payload = {
        user_id: user ? user.id : null,
        user_name: user ? user.name : "Guest",
        lat: currentLat,
        lng: currentLng,
        radius: 200
      };

      const res = await apiPost('/api/v1/shadow/activate-and-broadcast', payload);

      if (res && res.nearby_users_alerted !== undefined) {
        Alert.alert(
          "Stealth Broadcast Active 📡",
          `Shadow mode routed successfully. Geofence alert sent to ${res.nearby_users_alerted} nearby Sentinel users within 200 meters.`
        );
      }
    } catch (e) {
      console.warn("Backend broadcast failed.");
    }
  };

  const deactivateShadowMode = () => {
    setShadowMode(false);
    setCurrentScreen('home');
    setRoutes([]);
    setSafeZones([]);
    setDestination('');
    setRouteSteps([]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // SEARCH MAP ROUTING & HEATMAP OVERLAY
  const fetchHeatmapData = async () => {
    try {
      const res = await apiGet('/api/v1/heatmap/incidents');
      if (res && res.incidents) {
        setHeatmapIncidents(res.incidents);
      }
    } catch (e) { }
  };

  const calculateMultiRoutes = async (destItem: any) => {
    Keyboard.dismiss();
    setDestination(destItem.display_name);
    setSuggestions([]);
    setRoutes([]);
    setSafeZones([]);
    setIsSearching(true);
    const dLat = parseFloat(destItem.lat);
    const dLon = parseFloat(destItem.lon);

    try {
      // 1. Fetch paths
      const routeRes = await fetch(`http://router.project-osrm.org/route/v1/foot/${location.longitude},${location.latitude};${dLon},${dLat}?overview=full&geometries=geojson&alternatives=3`);
      const routeData = await routeRes.json();
      if (routeData.routes && routeData.routes.length > 0) {
        const formattedRoutes = routeData.routes.map((r: any, index: number) => ({ id: index, coords: r.geometry.coordinates.map((c: any) => ({ latitude: c[1], longitude: c[0] })), isSafest: index === 0 }));
        setRoutes(formattedRoutes);
        if (mapRef.current && typeof mapRef.current.fitToCoordinates === 'function') mapRef.current.fitToCoordinates(formattedRoutes[0].coords, { edgePadding: { top: 150, right: 50, bottom: 150, left: 50 }, animated: true });
      }

      // 2. Fetch safety amenities
      const midLat = (location.latitude + dLat) / 2;
      const midLon = (location.longitude + dLon) / 2;
      const overpassQuery = `[out:json];node(around:1500,${midLat},${midLon})["amenity"~"cafe|restaurant|bank|police|mall"];out 15;`;
      const zoneRes = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`);
      const zoneData = await zoneRes.json();
      if (zoneData.elements) setSafeZones(zoneData.elements.map((e: any) => ({ id: e.id.toString(), latitude: e.lat, longitude: e.lon, name: e.tags.name || "Safe Area" })));

    } catch (e) { }
    setIsSearching(false);
  };

  const fetchSuggestions = async (text: string) => {
    setDestination(text);
    if (text.length < 3) { setSuggestions([]); return; }
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${text}&limit=4`);
      const data = await res.json();
      setSuggestions(data);
    } catch (e) { }
  };

  // LOAD ADMIN COMMANDS
  const fetchAdminStats = async () => {
    try {
      const res = await apiGet('/api/v1/admin/dashboard', token);
      if (res) {
        setAdminStats(res.stats);
        setAdminAlerts(res.active_alerts);
      }
    } catch (e) { }
  };

  const adminResolveAlert = async (id: number) => {
    try {
      await apiPost(`/api/v1/admin/resolve/${id}`, {}, token);
      fetchAdminStats();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) { }
  };

  const adminDismissAlert = async (id: number) => {
    try {
      await apiPost(`/api/v1/admin/false-alarm/${id}`, {}, token);
      fetchAdminStats();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) { }
  };

  // SIDEBAR CONTROL
  const toggleMenu = () => {
    Animated.timing(sidebarAnim, { toValue: menuOpen ? -SCREEN_WIDTH : 0, duration: 300, useNativeDriver: true }).start();
    setMenuOpen(!menuOpen);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // AUTH ACTIONS
  const handleAuthSubmit = async () => {
    if (authMode === 'signup') {
      if (!signupData.name || !signupData.email || !signupData.password) return Alert.alert("Missing Fields", "Please fill in all details.");
      try {
        const res = await apiPost('/api/v1/auth/signup', signupData);
        if (res.token) {
          setToken(res.token);
          setUser(res.user);
          setCurrentScreen('home');
          Alert.alert("Account Created", `Welcome to Sentinel, ${res.user.name}!`);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          Alert.alert("Error", res.detail || "Registration failed");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      } catch (e) {
        Alert.alert("Connection Error", "Could not connect to security network.");
      }
    } else {
      if (!loginEmail || !loginPassword) return Alert.alert("Missing Fields", "Please enter credentials.");
      try {
        const res = await apiPost('/api/v1/auth/login', { email: loginEmail, password: loginPassword });
        if (res.token) {
          setToken(res.token);
          setUser(res.user);
          setIsAdminMode(res.user.is_admin || false);
          setCurrentScreen('home');
          Alert.alert("Access Granted", `Welcome back, ${res.user.name}!`);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          Alert.alert("Denied", res.detail || "Invalid credentials");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      } catch (e) {
        Alert.alert("Connection Error", "Could not connect to security network.");
      }
    }
  };

  const handleLogout = () => {
    setUser(null);
    setToken('');
    setIsAdminMode(false);
    toggleMenu();
    setCurrentScreen('auth');
    Alert.alert("Signed Out", "You have signed out securely.");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // PROFILE AND CONTACT ACTIONS
  const handleAddContact = () => {
    if (!newContactName || !newContactPhone) {
      Alert.alert("Missing Fields", "Please enter contact name and phone number.");
      return;
    }
    const newContact = { name: newContactName, phone: newContactPhone, relation: newContactRelation };
    setEmergencyContacts(prev => [...prev, newContact]);
    setNewContactName('');
    setNewContactPhone('');
    setNewContactRelation('Friend');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleDeleteContact = (index: number) => {
    setEmergencyContacts(prev => prev.filter((_, idx) => idx !== index));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleSaveContacts = async () => {
    if (!token) {
      Alert.alert("Authentication Required", "Please login to synchronize emergency contacts with the remote command center.");
      return;
    }
    setIsSavingContacts(true);
    try {
      const res = await apiPost('/api/v1/user/contacts', { contacts: emergencyContacts }, token);
      if (res && res.status === 'updated') {
        setUser(prev => {
          if (!prev) return null;
          return { ...prev, emergency_contacts: emergencyContacts };
        });
        Alert.alert("Contacts Updated", "Your emergency contacts have been securely uploaded to the Sentinel network.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert("Update Failed", res.detail || "Could not save contacts.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (e) {
      Alert.alert("Network Error", "Could not reach Sentinel server.");
    } finally {
      setIsSavingContacts(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!token) {
      Alert.alert("Authentication Required", "Please login to update your profile.");
      return;
    }
    setIsSavingProfile(true);
    try {
      const res = await apiPost('/api/v1/user/profile', {
        name: profileName,
        phone: profilePhone,
        gender: profileGender
      }, token);

      if (res && res.status === 'updated') {
        setUser(prev => {
          if (!prev) return null;
          return { ...prev, name: profileName, phone: profilePhone, gender: profileGender };
        });
        Alert.alert("Profile Updated", "Your personal details have been updated successfully.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert("Update Failed", res.detail || "Could not update profile.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (e) {
      Alert.alert("Error", "Could not save profile details.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSaveSettings = () => {
    if (!tempBackendUrl) return;
    setBackendUrlState(tempBackendUrl);
    Alert.alert("Settings Saved", `Backend URL updated to ${tempBackendUrl}`);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const onRefreshAdmin = async () => {
    setRefreshingAdmin(true);
    await fetchAdminStats();
    setRefreshingAdmin(false);
  };

  const getStepInstruction = (step: any) => {
    const type = step.maneuver?.type;
    const modifier = step.maneuver?.modifier;
    const name = step.name ? `onto ${step.name}` : 'ahead';
    if (type === 'depart') return `Head ${modifier || 'straight'} ${name}`;
    if (type === 'arrive') return `Arrive at destination`;
    if (modifier && modifier.includes('left')) return `Turn left ${name}`;
    if (modifier && modifier.includes('right')) return `Turn right ${name}`;
    if (modifier === 'straight') return `Continue straight ${name}`;
    return `Continue ${name}`;
  };

  const getStepIcon = (modifier: string) => {
    if (!modifier) return 'arrow-up';
    if (modifier.includes('left')) return 'arrow-undo';
    if (modifier.includes('right')) return 'arrow-redo';
    return 'arrow-up';
  };

  return (
    <View style={styles.container}>
      {/* GLOBAL HEADER */}
      {currentScreen !== 'map' && currentScreen !== 'shadow' && (
        <View style={[styles.header, sosActive && { backgroundColor: '#7F1D1D', borderBottomColor: '#7F1D1D' }]}>
          <TouchableOpacity onPress={toggleMenu} style={styles.menuIconBox}>
            <Ionicons name="menu" size={30} color={sosActive ? "#FFF" : "#E11D48"} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, sosActive && { color: '#FFF' }]}>
            {currentScreen === 'logs' ? 'EVIDENCE' :
              currentScreen === 'auth' ? 'ACCOUNT' :
                currentScreen === 'admin' ? 'COMMAND' :
                  currentScreen === 'contacts' ? 'GUARDIANS' :
                    currentScreen === 'settings' ? 'SETTINGS' : 'SENTINEL'}
          </Text>
          <TouchableOpacity onPress={() => setCurrentScreen('home')} style={styles.menuIconBox}>
            <Image
              source={require('../assets/logo.jpeg')}
              style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: sosActive ? '#FFF' : '#FDA4AF' }}
            />
          </TouchableOpacity>
        </View>
      )}

      {/* POPUP CONFIDENCE WARNING */}
      {isPopupVisible && (
        <View style={styles.emergencyPopup}>
          <Ionicons name="warning" size={40} color="#E11D48" />
          <Text style={styles.popupTitle}>Sentinel Active Check</Text>
          <Text style={styles.popupDesc}>Elevated confidence score ({popupScore}/100) detected. Are you okay?</Text>
          <TouchableOpacity style={styles.popupOkBtn} onPress={handleDismissPopup}>
            <Text style={{ color: '#FFF', fontWeight: 'bold' }}>I AM SAFE (DISMISS)</Text>
          </TouchableOpacity>
          <Text style={styles.popupCounter}>Closing safety check in {popupCountdown} seconds...</Text>
        </View>
      )}

      {/* SIDEBAR BACKDROP */}
      {menuOpen && (
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={toggleMenu}
        />
      )}

      {/* SOS DASHBOARD SCREEN */}
      {currentScreen === 'home' && (
        <Animated.View style={[styles.container, { backgroundColor: interpolatedBg, flex: 1 }]}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 20 }}>

            {/* CONFIDENCE DIAL */}
            <View style={[styles.gaugeRing, sosActive && { borderColor: 'rgba(255, 255, 255, 0.4)' }]}>
              <View style={[
                styles.gaugeFillArc,
                {
                  borderColor:
                    confidenceScore >= 60 ? '#EF4444' :
                      confidenceScore >= 40 ? '#F59E0B' : '#10B981'
                },
                sosActive && { borderColor: '#FFF' }
              ]}>
                <Text style={[styles.gaugeLabel, sosActive && { color: '#FFF' }]}>RISK LEVEL</Text>
                <Text style={[styles.gaugeVal, {
                  color:
                    confidenceScore >= 60 ? '#EF4444' :
                      confidenceScore >= 40 ? '#F59E0B' : '#10B981'
                }, sosActive && { color: '#FFF' }]}>
                  {confidenceScore}%
                </Text>
                <Text style={[styles.gaugeStatusText, sosActive && { color: '#FFF' }]}>
                  {confidenceScore >= 60 ? 'CRITICAL THREAT' :
                    confidenceScore >= 40 ? 'ELEVATED RISK' : 'SECURE'}
                </Text>
              </View>
            </View>

            {/* ACTIVE SIGNALS LIST */}
            {signals.length > 0 && (
              <View style={styles.signalsContainer}>
                {signals.map((s, i) => (
                  <Text key={i} style={styles.signalBubble}>
                    {s.type.toUpperCase()}: {s.detail}
                  </Text>
                ))}
              </View>
            )}

            <Animated.View style={{ transform: [{ translateY: floatAnim }], zIndex: 2, marginTop: 10 }}>
              <TouchableOpacity
                onLongPress={() => triggerEmergency("Manual Dashboard SOS")}
                style={[styles.sosButton, sosActive && { backgroundColor: '#E11D48', shadowColor: '#000', elevation: 25 }]}
              >
                <View style={[styles.sosInner, sosActive && { backgroundColor: '#FFF', borderColor: '#FFF' }]}>
                  <Text style={[styles.sosText, sosActive && { color: '#BE123C' }]}>{sosActive ? "SENT" : "SOS"}</Text>
                </View>
              </TouchableOpacity>
            </Animated.View>

            <Text style={[styles.statusText, sosActive && { color: '#FFF', fontSize: 16, letterSpacing: 2 }]}>
              {sosActive ? "EMERGENCY BROADCAST LIVE" : "HOLD SOS BUTTON TO EMERGE"}
            </Text>

            {/* STEALTH/FOLLOWED TOGGLE */}
            <TouchableOpacity style={styles.stealthTrigger} onPress={activateShadowMode}>
              <Ionicons name="map-outline" size={20} color="#FFF" style={{ marginRight: 8 }} />
              <Text style={{ color: '#FFF', fontWeight: '900' }}>Safety Routes near me</Text>
            </TouchableOpacity>



            {sosActive && (
              <TouchableOpacity onPress={disarmSOS} style={styles.cancelSOSBtn}>
                <Ionicons name="close-circle" size={20} color="#FFF" style={{ marginRight: 8 }} />
                <Text style={{ color: '#FFF', fontWeight: '900' }}>DISARM EMERGENCY</Text>
              </TouchableOpacity>
            )}

          </ScrollView>
        </Animated.View>
      )}

      {/* SHADOW STEALTH MODE SCREEN */}
      {currentScreen === 'shadow' && (
        <View style={styles.stealthContainer}>
          <View style={styles.stealthHeader}>
            <Ionicons name="calculator-outline" size={24} color="#FFF" />
            <Text style={styles.stealthTitle}>Secret Notepad v1.4</Text>
            <TouchableOpacity onPress={deactivateShadowMode}>
              <Ionicons name="checkmark-circle" size={28} color="#10B981" />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1, padding: 15 }}>
            <Text style={styles.stealthInfoLabel}>⚠️ SENTINEL STEALTH SECURITY SHADOW ACTIVE</Text>
            <View style={styles.safeZoneBox}>
              <Text style={{ color: '#8888a0', fontSize: 12 }}>NEAREST SAFE RETREAT ZONE</Text>
              <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 18, marginTop: 4 }}>{shadowSafeZone}</Text>
              <Text style={{ color: '#10B981', fontSize: 13, marginTop: 2 }}>⏱️ Calculated Transit ETA: {shadowETA} minutes</Text>
            </View>
            <TextInput
              multiline
              style={styles.stealthInput}
              placeholder="Start typing personal notes here..."
              placeholderTextColor="#555"
              value={stealthNotes}
              onChangeText={setStealthNotes}
            />
          </ScrollView>
        </View>
      )}

      {/* MAP AND HEATMAP SCREEN */}
      {currentScreen === 'map' && (
        <View style={{ flex: 1 }}>

          {/* Hide Search Bar when in Shadow Mode */}
          {!shadowMode && (
            <View style={styles.searchOverlay}>
              <TouchableOpacity onPress={toggleMenu} style={styles.menuIconOverlay}>
                <Ionicons name="menu" size={28} color="#E11D48" />
              </TouchableOpacity>
              <TextInput style={styles.searchInput} placeholder="Search Destination..." value={destination} onChangeText={fetchSuggestions} placeholderTextColor="#FCA5A5" />
              {destination.length > 0 && <TouchableOpacity onPress={() => { setDestination(''); setSuggestions([]); }} style={styles.clearIconOverlay}><Ionicons name="close-circle" size={22} color="#FDA4AF" /></TouchableOpacity>}
            </View>
          )}

          {!shadowMode && suggestions.length > 0 && (
            <View style={styles.suggestionsBox}>
              <FlatList data={suggestions} keyExtractor={(item, idx) => idx.toString()} renderItem={({ item }) => (
                <TouchableOpacity style={styles.suggestionItem} onPress={() => calculateMultiRoutes(item)}>
                  <Ionicons name="location" size={20} color="#FDA4AF" style={{ marginRight: 10 }} />
                  <Text numberOfLines={1} style={{ flex: 1, color: '#1F2937' }}>{item.display_name}</Text>
                </TouchableOpacity>
              )} />
            </View>
          )}

          {/* DUAL MODE MAP TOGGLES */}
          {!shadowMode && (
            <View style={[styles.sentinelToggleContainer, { top: 125 }]}>
              <Text style={{ fontWeight: 'bold', color: '#BE123C' }}>Incident Heatmap</Text>
              <Switch value={showHeatmapOnly} onValueChange={(val) => { setShowHeatmapOnly(val); if (val) fetchHeatmapData(); }} />
            </View>
          )}

          {/* SPLIT SCREEN MAP LOGIC: Half screen if shadow mode, full screen otherwise */}
          <View style={{ flex: shadowMode ? 0.5 : 1 }}>
            {location && (
              <MapView ref={mapRef} style={styles.map} provider={PROVIDER_DEFAULT} initialRegion={{ latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.015, longitudeDelta: 0.015 }} showsUserLocation={true}>
                {routes.map(route => (
                  <Polyline key={route.id} coordinates={route.coords} strokeWidth={route.isSafest ? 7 : 4} strokeColor={route.isSafest ? "#E11D48" : "#FBCFE8"} />
                ))}
                {safeZones.map(zone => (
                  <Marker key={zone.id} coordinate={{ latitude: zone.latitude, longitude: zone.longitude }} title={zone.name} pinColor="#10B981" />
                ))}
                {!shadowMode && showHeatmapOnly && heatmapIncidents.map((inc, i) => (
                  <Marker key={i} coordinate={{ latitude: inc.latitude, longitude: inc.longitude }} title={inc.incident_type} description={inc.description}>
                    <View style={[styles.heatmapMarker, { backgroundColor: inc.severity >= 4 ? '#E11D48' : '#F59E0B' }]} />
                  </Marker>
                ))}
              </MapView>
            )}
          </View>

          {/* TACTICAL NAVIGATION PANEL (Bottom Half) */}
          {shadowMode && (
            <View style={styles.tacticalPanel}>
              <View style={styles.tacticalHeader}>
                <Ionicons name="shield-checkmark" size={24} color="#10B981" />
                <Text style={styles.tacticalTitle}>Secure Route to {destination}</Text>
              </View>

              <FlatList
                data={routeSteps}
                keyExtractor={(item, idx) => idx.toString()}
                style={styles.stepsList}
                renderItem={({ item }) => (
                  <View style={styles.stepItem}>
                    <View style={styles.stepIconBox}>
                      <Ionicons name={getStepIcon(item.maneuver?.modifier)} size={20} color="#FAFAFA" />
                    </View>
                    <Text style={styles.stepText}>{getStepInstruction(item)}</Text>
                  </View>
                )}
              />

              <TouchableOpacity style={styles.disarmRouteBtn} onPress={() => {
                setRoutes([]);
                setSafeZones([]);
                setDestination('');
                setRouteSteps([]);
                setShadowMode(false);
                setCurrentScreen('home'); // Returns you to dashboard
              }}>
                <Text style={{ color: '#FFF', fontWeight: '900', fontSize: 16 }}>DISARM & RETURN TO DASHBOARD</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Standard Close Route (for normal map usage) */}
          {!shadowMode && routes.length > 0 && (
            <View style={styles.bottomControls}>
              <TouchableOpacity style={styles.endRouteBtn} onPress={() => { setRoutes([]); setSafeZones([]); setDestination(''); }}>
                <Text style={{ color: '#FFF', fontWeight: '800' }}>CLOSE ROUTE</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* AUDIO VAULT EVIDENCE SCREEN */}
      {currentScreen === 'logs' && (
        <View style={styles.logsContainer}>
          <Text style={styles.logsSubtitle}>Digital Blackbox Vault (Secured Telemetry)</Text>
          {audioLogs.length === 0 ? (
            <View style={styles.emptyStateContainer}>
              <Ionicons name="shield-checkmark" size={64} color="#FDA4AF" />
              <Text style={styles.emptyStateTitle}>Vault Secured</Text>
              <Text style={styles.emptyStateDesc}>No threat records. System is actively listening for distress signals and suspicious telemetry.</Text>
            </View>
          ) : (
            <FlatList data={audioLogs} keyExtractor={(item, i) => i.toString()} renderItem={({ item }) => (
              <View style={styles.logItem}>
                <View style={{ flex: 1, marginRight: 15 }}>
                  <Text style={{ fontWeight: '900', color: '#BE123C' }}>{item.date}</Text>
                  <Text style={{ color: '#1F2937', fontSize: 13, fontStyle: 'italic' }}>"{item.text}"</Text>
                </View>
                <TouchableOpacity onPress={() => playAudio(item.uri)} style={styles.playBtn}>
                  <Ionicons name="play" size={20} color="#FFF" />
                </TouchableOpacity>
              </View>
            )} />
          )}
        </View>
      )}

      {/* AUTH SCREEN */}
      {currentScreen === 'auth' && (
        <ScrollView contentContainerStyle={styles.authContainer}>
          <Text style={styles.authTitle}>{authMode === 'login' ? 'WELCOME TO SENTINEL' : 'JOIN SECURITY NETWORK'}</Text>
          {authMode === 'signup' && (
            <>
              <Text style={styles.label}>FULL NAME</Text>
              <TextInput style={styles.input} placeholder="Name" value={signupData.name} onChangeText={t => setSignupData({ ...signupData, name: t })} />
              <Text style={styles.label}>PHONE NUMBER</Text>
              <TextInput style={styles.input} placeholder="Phone" value={signupData.phone} onChangeText={t => setSignupData({ ...signupData, phone: t })} />
            </>
          )}
          <Text style={styles.label}>EMAIL ADDRESS</Text>
          <TextInput style={styles.input} autoCapitalize="none" placeholder="Email" value={authMode === 'login' ? loginEmail : signupData.email} onChangeText={t => authMode === 'login' ? setLoginEmail(t) : setSignupData({ ...signupData, email: t })} />
          <Text style={styles.label}>PASSWORD</Text>
          <TextInput secureTextEntry style={styles.input} placeholder="Password" value={authMode === 'login' ? loginPassword : signupData.password} onChangeText={t => authMode === 'login' ? setLoginPassword(t) : setSignupData({ ...signupData, password: t })} />

          <TouchableOpacity style={styles.submitBtn} onPress={handleAuthSubmit}>
            <Text style={styles.submitBtnText}>{authMode === 'login' ? 'LOGIN' : 'SIGN UP'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}>
            <Text style={styles.switchAuthText}>{authMode === 'login' ? "Need an account? Sign Up" : "Have account? Log In"}</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ADMIN CONTROL PANEL SCREEN (INSIDE APP) */}
      {currentScreen === 'admin' && (
        <ScrollView
          style={styles.adminContainer}
          refreshControl={
            <RefreshControl refreshing={refreshingAdmin} onRefresh={onRefreshAdmin} colors={['#E11D48']} />
          }
        >
          <Text style={styles.adminSectionTitle}>Live Security Alerts ({adminAlerts.length})</Text>
          <TouchableOpacity style={styles.refreshBtn} onPress={fetchAdminStats}>
            <Text style={{ color: '#FFF', fontWeight: 'bold' }}>REFRESH DISPATCH STATUS</Text>
          </TouchableOpacity>

          {adminAlerts.map(a => (
            <View key={a.id} style={styles.adminAlertCard}>
              <Text style={styles.adminAlertUser}>🚨 USER IN DISTRESS: {a.user_name}</Text>
              <Text style={styles.adminAlertScore}>Confidence Score: {a.confidence_score}%</Text>
              <Text style={styles.adminAlertDetail}>{a.narrative || a.trigger_type}</Text>
              <View style={{ flexDirection: 'row', marginTop: 10 }}>
                <TouchableOpacity style={styles.adminActionBtn} onPress={() => adminResolveAlert(a.id)}>
                  <Text style={{ color: '#FFF', fontWeight: 'bold' }}>Resolve</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.adminActionBtn, { backgroundColor: '#7F1D1D' }]} onPress={() => adminDismissAlert(a.id)}>
                  <Text style={{ color: '#FFF', fontWeight: 'bold' }}>False Alarm</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* EMERGENCY CONTACTS SCREEN */}
      {currentScreen === 'contacts' && (
        <ScrollView contentContainerStyle={styles.contactsContainer}>
          <Text style={styles.contactsSubtitle}>Manage Trusted Emergency Guardians</Text>

          {/* Add Contact Form */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Add Emergency Guardian</Text>

            <Text style={styles.inputLabel}>FULL NAME</Text>
            <TextInput
              style={styles.inputField}
              placeholder="e.g. John Doe"
              placeholderTextColor="#9CA3AF"
              value={newContactName}
              onChangeText={setNewContactName}
            />

            <Text style={styles.inputLabel}>PHONE NUMBER</Text>
            <TextInput
              style={styles.inputField}
              placeholder="e.g. +1234567890"
              placeholderTextColor="#9CA3AF"
              keyboardType="phone-pad"
              value={newContactPhone}
              onChangeText={setNewContactPhone}
            />

            <Text style={styles.inputLabel}>RELATIONSHIP</Text>
            <View style={styles.relationSelector}>
              {['Friend', 'Spouse', 'Parent', 'Sibling', 'Other'].map(rel => (
                <TouchableOpacity
                  key={rel}
                  style={[styles.relationBtn, newContactRelation === rel && styles.relationBtnActive]}
                  onPress={() => {
                    setNewContactRelation(rel);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                >
                  <Text style={[styles.relationText, newContactRelation === rel && styles.relationTextActive]}>{rel}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={styles.addContactBtn} onPress={handleAddContact}>
              <Ionicons name="person-add" size={18} color="#FFF" style={{ marginRight: 6 }} />
              <Text style={styles.addContactBtnText}>Add To List</Text>
            </TouchableOpacity>
          </View>

          {/* List of Contacts */}
          <Text style={styles.sectionHeader}>Active Guardians ({emergencyContacts.length})</Text>
          {emergencyContacts.length === 0 ? (
            <View style={styles.emptyContactsCard}>
              <Ionicons name="people-outline" size={40} color="#FDA4AF" />
              <Text style={styles.emptyContactsText}>No Guardians Added Yet</Text>
              <Text style={styles.emptyContactsDesc}>Add contacts above. In an emergency, Sentinel will automatically dispatch SMS notifications and real-time incident URLs to these trusted contacts.</Text>
            </View>
          ) : (
            <View style={{ width: '100%' }}>
              {emergencyContacts.map((c, index) => (
                <View key={index} style={styles.contactItemCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.contactName}>{c.name}</Text>
                    <Text style={styles.contactPhone}>{c.phone}</Text>
                    <Text style={styles.contactRelation}>{c.relation.toUpperCase()}</Text>
                  </View>
                  <TouchableOpacity onPress={() => handleDeleteContact(index)} style={styles.deleteContactBtn}>
                    <Ionicons name="trash-outline" size={20} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              ))}

              <TouchableOpacity
                style={[styles.saveContactsBtn, isSavingContacts && { opacity: 0.7 }]}
                onPress={handleSaveContacts}
                disabled={isSavingContacts}
              >
                {isSavingContacts ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={20} color="#FFF" style={{ marginRight: 8 }} />
                    <Text style={styles.saveContactsBtnText}>Sync Guardians With Server</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      )}

      {/* SETTINGS & PROFILE SCREEN */}
      {currentScreen === 'settings' && (
        <ScrollView contentContainerStyle={styles.settingsContainer}>
          <Text style={styles.contactsSubtitle}>System Configuration & Account Profile</Text>

          {/* Connection Status Card */}
          <View style={[
            styles.statusCard,
            connectionStatus === 'connected' ? styles.statusCardConnected :
              connectionStatus === 'disconnected' ? styles.statusCardDisconnected : styles.statusCardChecking
          ]}>
            <View style={styles.statusRow}>
              <View style={[
                styles.statusDot,
                connectionStatus === 'connected' ? styles.statusDotConnected :
                  connectionStatus === 'disconnected' ? styles.statusDotDisconnected : styles.statusDotChecking
              ]} />
              <Text style={styles.statusCardTitle}>
                {connectionStatus === 'connected' ? 'CONNECTED TO SENTINEL CORE' :
                  connectionStatus === 'disconnected' ? 'DISCONNECTED (MESH MODE)' : 'VERIFYING CONNECTION...'}
              </Text>
            </View>
            <Text style={styles.statusCardDesc}>
              {connectionStatus === 'connected' ? 'You are securely connected to the Sentinel AI threat network. Live telemetry is synced.' :
                connectionStatus === 'disconnected' ? 'Sentinel backend is currently unreachable. Outbound SOS will utilize Bluetooth Mesh simulation.' :
                  'Checking network path and establishing handshake...'}
            </Text>
          </View>

          {/* Profile Form (Only if logged in) */}
          {user ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Account Profile Details</Text>

              <Text style={styles.inputLabel}>FULL NAME</Text>
              <TextInput
                style={styles.inputField}
                value={profileName}
                onChangeText={setProfileName}
              />

              <Text style={styles.inputLabel}>PHONE NUMBER</Text>
              <TextInput
                style={styles.inputField}
                value={profilePhone}
                onChangeText={setProfilePhone}
                keyboardType="phone-pad"
              />

              <Text style={styles.inputLabel}>GENDER</Text>
              <View style={styles.relationSelector}>
                {['Male', 'Female', 'Non-Binary', 'Prefer Not To Say'].map(gen => (
                  <TouchableOpacity
                    key={gen}
                    style={[styles.relationBtn, profileGender === gen && styles.relationBtnActive]}
                    onPress={() => {
                      setProfileGender(gen);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                  >
                    <Text style={[styles.relationText, profileGender === gen && styles.relationTextActive]}>{gen}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[styles.saveProfileBtn, isSavingProfile && { opacity: 0.7 }]}
                onPress={handleSaveProfile}
                disabled={isSavingProfile}
              >
                {isSavingProfile ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={20} color="#FFF" style={{ marginRight: 6 }} />
                    <Text style={{ color: '#FFF', fontWeight: 'bold' }}>Save Profile Changes</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Account Profile</Text>
              <Text style={styles.noUserText}>You are currently acting as a Guest User.</Text>
              <TouchableOpacity style={styles.authLinkBtn} onPress={() => setCurrentScreen('auth')}>
                <Text style={{ color: '#E11D48', fontWeight: 'bold' }}>Login or Register to Enable Sync</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Server Settings Card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sentinel Server Settings</Text>
            <Text style={styles.inputLabel}>SENTINEL BACKEND ENDPOINT</Text>
            <TextInput
              style={styles.inputField}
              autoCapitalize="none"
              placeholder="http://localhost:8000"
              placeholderTextColor="#9CA3AF"
              value={tempBackendUrl}
              onChangeText={setTempBackendUrl}
            />

            <TouchableOpacity style={styles.saveSettingsBtn} onPress={handleSaveSettings}>
              <Ionicons name="save-outline" size={20} color="#FFF" style={{ marginRight: 6 }} />
              <Text style={{ color: '#FFF', fontWeight: 'bold' }}>Apply Server Endpoint</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* MENU SIDEBAR */}
      <Animated.View style={[styles.sidebar, { transform: [{ translateX: sidebarAnim }] }]}>
        <View style={styles.sidebarContent}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={45} color="#E11D48" />
          </View>
          <Text style={{ textAlign: 'center', fontWeight: '900', fontSize: 18, color: '#BE123C' }}>{user ? user.name : 'Guest User'}</Text>

          {/* OFFLINE TOGGLE */}
          <View style={styles.offlineBox}>
            <Text style={{ fontWeight: 'bold', color: isOffline ? '#E11D48' : '#10B981' }}>
              {isOffline ? '🔴 Offline mesh active' : '🟢 Internet Online'}
            </Text>
            <Switch value={isOffline} onValueChange={(val) => { setIsOffline(val); if (!val) syncOfflineQueue(); }} />
          </View>

          {isOffline && offlineQueue.length > 0 && (
            <TouchableOpacity style={styles.syncBtn} onPress={syncOfflineQueue}>
              <Text style={{ color: '#FFF', fontWeight: 'bold' }}>Sync Queue ({offlineQueue.length})</Text>
            </TouchableOpacity>
          )}

          {/* ACTIVE SETTINGS */}
          {/* ACTIVE SETTINGS (LOCKED ON) */}
          <View style={{ marginVertical: 10, borderBottomWidth: 1, borderColor: '#FCE7F3', paddingBottom: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 4 }}>
              <Text style={{ color: '#BE123C', fontWeight: 'bold', fontSize: 12 }}>Sentinel Watch</Text>
              <Text style={{ color: '#10B981', fontWeight: 'bold', fontSize: 10 }}>ACTIVE 24/7</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.menuItem} onPress={() => { setCurrentScreen('home'); toggleMenu(); }}>
            <Text style={styles.menuText}>SOS Dashboard</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={() => { setCurrentScreen('map'); toggleMenu(); }}>
            <Text style={styles.menuText}>Safety Route Map</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={() => { setCurrentScreen('logs'); toggleMenu(); }}>
            <Text style={styles.menuText}>Evidence Audio</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={() => { setCurrentScreen('contacts'); toggleMenu(); }}>
            <Text style={styles.menuText}>Emergency Guardians</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={() => { setCurrentScreen('settings'); toggleMenu(); }}>
            <Text style={styles.menuText}>Settings & Profile</Text>
          </TouchableOpacity>

          {isAdminMode && (
            <TouchableOpacity style={[styles.menuItem, { backgroundColor: '#FFF1F2' }]} onPress={() => { setCurrentScreen('admin'); toggleMenu(); fetchAdminStats(); }}>
              <Text style={[styles.menuText, { color: '#E11D48' }]}>Admin Control</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={{ marginTop: 'auto' }} onPress={() => { user ? handleLogout() : (() => { setCurrentScreen('auth'); toggleMenu(); })(); }}>
            <Text style={{ color: '#BE123C', fontWeight: 'bold' }}>{user ? 'Sign Out' : 'Login / Signup'}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  header: { height: 110, paddingTop: 45, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, backgroundColor: '#09090B', borderBottomWidth: 1, borderBottomColor: '#27272A', zIndex: 10 },
  headerTitle: { color: '#FAFAFA', fontSize: 20, fontWeight: '900', letterSpacing: 2 },
  menuIconBox: { padding: 5 },
  centerStage: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  sosButton: { width: 200, height: 200, borderRadius: 100, backgroundColor: '#18181B', justifyContent: 'center', alignItems: 'center', elevation: 15, shadowColor: '#000' },
  sosInner: { width: 150, height: 150, borderRadius: 75, backgroundColor: '#E11D48', justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: '#27272A' },
  sosText: { color: '#FAFAFA', fontSize: 40, fontWeight: '900' },
  statusText: { marginTop: 25, color: '#A1A1AA', fontWeight: '800', fontSize: 12 },
  nlpDemoContainer: { alignItems: 'center', marginTop: 15, width: '85%' },
  sentinelActiveBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#18181B', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#27272A', marginBottom: 10 },
  pulsingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#E11D48' },
  transcriptBox: { width: '100%', minHeight: 60, backgroundColor: '#18181B', borderWidth: 1, borderColor: '#27272A', borderRadius: 12, padding: 12, justifyContent: 'center', alignItems: 'center' },
  transcriptText: { color: '#FAFAFA', fontSize: 14, fontStyle: 'italic', textAlign: 'center', fontWeight: 'bold' },
  cancelSOSBtn: { flexDirection: 'row', alignItems: 'center', marginTop: 30, paddingHorizontal: 20, paddingVertical: 12, borderWidth: 2, borderColor: '#FAFAFA', borderRadius: 25 },
  stealthTrigger: { backgroundColor: '#27272A', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 25, flexDirection: 'row', alignItems: 'center', marginTop: 20, elevation: 4 },

  // POPUP STYLE
  emergencyPopup: { position: 'absolute', top: '25%', left: '10%', right: '10%', backgroundColor: '#18181B', borderRadius: 20, padding: 25, alignItems: 'center', elevation: 20, shadowColor: '#000', zIndex: 1000, borderWidth: 2, borderColor: '#E11D48' },
  popupTitle: { fontSize: 20, fontWeight: 'bold', color: '#E11D48', marginTop: 10 },
  popupDesc: { fontSize: 14, textAlign: 'center', color: '#A1A1AA', marginVertical: 12 },
  popupOkBtn: { backgroundColor: '#10B981', paddingHorizontal: 25, paddingVertical: 12, borderRadius: 10 },
  popupCounter: { fontSize: 12, color: '#E11D48', marginTop: 10, fontWeight: 'bold' },

  // STEALTH VIEW
  stealthContainer: { flex: 1, backgroundColor: '#0A0A0F', paddingTop: 50 },
  stealthHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 15, borderBottomWidth: 1, borderColor: '#27272A', alignItems: 'center' },
  stealthTitle: { color: '#FAFAFA', fontSize: 16, fontWeight: 'bold' },
  stealthInput: { flex: 1, color: '#FAFAFA', fontSize: 16, marginTop: 20, textAlignVertical: 'top' },
  stealthInfoLabel: { color: '#A1A1AA', fontSize: 11, fontWeight: 'bold', textAlign: 'center', marginBottom: 15 },
  safeZoneBox: { backgroundColor: '#18181B', padding: 15, borderRadius: 10, marginVertical: 10 },

  // CONFIDENCE DIAL
  gaugeRing: { width: 170, height: 170, borderRadius: 85, borderWidth: 4, borderColor: '#27272A', justifyContent: 'center', alignItems: 'center', marginBottom: 25, backgroundColor: '#18181B', elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
  gaugeFillArc: { width: 154, height: 154, borderRadius: 77, borderWidth: 8, justifyContent: 'center', alignItems: 'center' },
  gaugeLabel: { fontSize: 9, color: '#A1A1AA', fontWeight: 'bold', letterSpacing: 1 },
  gaugeVal: { fontSize: 32, fontWeight: '900', marginVertical: 2 },
  gaugeStatusText: { fontSize: 9, fontWeight: 'bold', color: '#A1A1AA', marginTop: 2, letterSpacing: 1 },
  signalsContainer: { width: '85%', marginBottom: 15 },
  signalBubble: { backgroundColor: 'rgba(225, 29, 72, 0.1)', color: '#E11D48', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, fontSize: 11, fontWeight: 'bold', marginVertical: 3, alignSelf: 'center', borderWidth: 1, borderColor: 'rgba(225, 29, 72, 0.2)' },

  // MAP
  map: { flex: 1 },
  searchOverlay: { position: 'absolute', top: 55, left: 20, right: 20, zIndex: 10, flexDirection: 'row', backgroundColor: '#18181B', borderRadius: 25, alignItems: 'center', height: 50, borderWidth: 1, borderColor: '#27272A', paddingHorizontal: 10 },
  menuIconOverlay: { paddingHorizontal: 5 },
  searchInput: { flex: 1, height: '100%', fontSize: 15, color: '#FAFAFA' },
  clearIconOverlay: { paddingHorizontal: 5 },
  suggestionsBox: { position: 'absolute', top: 115, left: 20, right: 20, zIndex: 20, backgroundColor: '#18181B', borderRadius: 15, maxHeight: 200, borderWidth: 1, borderColor: '#27272A' },
  suggestionItem: { padding: 15, borderBottomWidth: 1, borderColor: '#27272A', flexDirection: 'row', alignItems: 'center' },
  sentinelToggleContainer: { position: 'absolute', right: 20, zIndex: 5, backgroundColor: '#18181B', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#27272A' },
  bottomControls: { position: 'absolute', bottom: 30, left: 0, right: 0, zIndex: 5, alignItems: 'center' },
  endRouteBtn: { backgroundColor: '#E11D48', paddingHorizontal: 25, paddingVertical: 12, borderRadius: 25 },
  heatmapMarker: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#18181B' },

  // LOGS & VAULT & EMPTY STATE
  logsContainer: { flex: 1, padding: 20, backgroundColor: '#09090B' },
  logsSubtitle: { color: '#A1A1AA', marginBottom: 15, fontWeight: 'bold', fontSize: 11 },
  logItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#18181B', padding: 15, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#27272A' },
  playBtn: { backgroundColor: '#E11D48', width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  emptyStateContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 30 },
  emptyStateTitle: { fontSize: 20, fontWeight: 'bold', color: '#FAFAFA', marginTop: 15 },
  emptyStateDesc: { fontSize: 14, color: '#A1A1AA', textAlign: 'center', marginTop: 10, lineHeight: 20 },

  // AUTH
  authContainer: { padding: 30, justifyContent: 'center', flexGrow: 1, backgroundColor: '#09090B' },
  authTitle: { fontSize: 22, fontWeight: '900', color: '#FAFAFA', marginBottom: 30, textAlign: 'center' },
  label: { fontSize: 10, fontWeight: 'bold', color: '#A1A1AA', marginBottom: 5 },
  input: { width: '100%', height: 50, backgroundColor: '#18181B', color: '#FAFAFA', borderRadius: 12, paddingHorizontal: 15, marginBottom: 20, borderWidth: 1, borderColor: '#27272A' },
  submitBtn: { width: '100%', height: 50, backgroundColor: '#E11D48', borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  submitBtnText: { color: '#FAFAFA', fontWeight: '900' },
  switchAuthText: { marginTop: 20, color: '#A1A1AA', textAlign: 'center' },

  // SIDEBAR & BACKDROP
  sidebar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: SCREEN_WIDTH * 0.75, backgroundColor: '#18181B', zIndex: 100, elevation: 20 },
  sidebarContent: { flex: 1, padding: 25, paddingTop: 60 },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#27272A', alignSelf: 'center', justifyContent: 'center', alignItems: 'center', marginBottom: 10, borderWidth: 1, borderColor: '#27272A' },
  offlineBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 10, backgroundColor: '#27272A', padding: 10, borderRadius: 8 },
  syncBtn: { backgroundColor: '#E11D48', padding: 8, borderRadius: 6, alignItems: 'center', marginBottom: 10 },
  menuItem: { paddingVertical: 15, borderBottomWidth: 1, borderColor: '#27272A' },
  menuText: { fontSize: 16, color: '#FAFAFA', fontWeight: 'bold' },
  backdrop: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0, 0, 0, 0.7)', zIndex: 99 },

  // ADMIN
  adminContainer: { flex: 1, padding: 20, backgroundColor: '#09090B' },
  adminSectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#FAFAFA', marginBottom: 15 },
  refreshBtn: { backgroundColor: '#E11D48', padding: 12, borderRadius: 8, alignItems: 'center', marginBottom: 15 },
  adminAlertCard: { backgroundColor: '#18181B', padding: 15, borderRadius: 12, marginBottom: 15, borderWidth: 1, borderColor: '#27272A' },
  adminAlertUser: { fontWeight: 'bold', fontSize: 15, color: '#E11D48' },
  adminAlertScore: { fontSize: 13, color: '#A1A1AA', marginVertical: 2 },
  adminAlertDetail: { fontSize: 14, color: '#FAFAFA' },
  adminActionBtn: { backgroundColor: '#10B981', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 6, marginRight: 10 },

  // EMERGENCY CONTACTS & SETTINGS VIEWS
  contactsContainer: { padding: 20, backgroundColor: '#09090B', flexGrow: 1 },
  contactsSubtitle: { fontSize: 12, color: '#A1A1AA', fontWeight: 'bold', marginBottom: 20 },
  card: { backgroundColor: '#18181B', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#27272A', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, marginBottom: 25 },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: '#FAFAFA', marginBottom: 15 },
  inputLabel: { fontSize: 10, fontWeight: 'bold', color: '#A1A1AA', marginBottom: 6 },
  inputField: { backgroundColor: '#09090B', borderWidth: 1, borderColor: '#27272A', borderRadius: 10, paddingHorizontal: 12, height: 45, color: '#FAFAFA', marginBottom: 15, fontSize: 14 },
  relationSelector: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  relationBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#27272A', backgroundColor: '#09090B' },
  relationBtnActive: { backgroundColor: '#E11D48', borderColor: '#E11D48' },
  relationText: { fontSize: 12, color: '#A1A1AA', fontWeight: 'bold' },
  relationTextActive: { color: '#FAFAFA' },
  addContactBtn: { backgroundColor: '#10B981', height: 45, borderRadius: 10, justifyContent: 'center', alignItems: 'center', flexDirection: 'row' },
  addContactBtnText: { color: '#FAFAFA', fontWeight: 'bold', fontSize: 14 },
  sectionHeader: { fontSize: 14, fontWeight: 'bold', color: '#FAFAFA', marginBottom: 12 },
  emptyContactsCard: { backgroundColor: '#18181B', borderWidth: 1, borderStyle: 'dashed', borderColor: '#27272A', padding: 25, borderRadius: 16, alignItems: 'center' },
  emptyContactsText: { fontSize: 16, fontWeight: 'bold', color: '#FAFAFA', marginTop: 10 },
  emptyContactsDesc: { fontSize: 12, color: '#A1A1AA', textAlign: 'center', marginTop: 8, lineHeight: 18 },
  contactItemCard: { flexDirection: 'row', backgroundColor: '#18181B', padding: 15, borderRadius: 12, borderLeftWidth: 4, borderLeftColor: '#E11D48', borderWidth: 1, borderColor: '#27272A', marginBottom: 10, alignItems: 'center' },
  contactName: { fontSize: 16, fontWeight: 'bold', color: '#FAFAFA' },
  contactPhone: { fontSize: 13, color: '#A1A1AA', marginTop: 2 },
  contactRelation: { fontSize: 10, fontWeight: '900', color: '#E11D48', marginTop: 4, letterSpacing: 0.5 },
  deleteContactBtn: { padding: 10 },
  saveContactsBtn: { backgroundColor: '#E11D48', height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', marginTop: 15, elevation: 3 },
  saveContactsBtnText: { color: '#FAFAFA', fontWeight: 'bold', fontSize: 15 },

  settingsContainer: { padding: 20, backgroundColor: '#09090B', flexGrow: 1 },
  statusCard: { padding: 15, borderRadius: 12, marginBottom: 25, borderWidth: 1 },
  statusCardConnected: { backgroundColor: 'rgba(16, 185, 129, 0.1)', borderColor: '#10B981' },
  statusCardDisconnected: { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: '#EF4444' },
  statusCardChecking: { backgroundColor: 'rgba(59, 130, 246, 0.1)', borderColor: '#3B82F6' },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  statusDotConnected: { backgroundColor: '#10B981' },
  statusDotDisconnected: { backgroundColor: '#EF4444' },
  statusDotChecking: { backgroundColor: '#3B82F6' },
  statusCardTitle: { fontWeight: 'bold', fontSize: 13, color: '#FAFAFA' },
  statusCardDesc: { fontSize: 11, color: '#A1A1AA', lineHeight: 16 },
  noUserText: { fontSize: 14, color: '#A1A1AA', textAlign: 'center', marginBottom: 15 },
  authLinkBtn: { borderWidth: 1, borderColor: '#27272A', height: 45, borderRadius: 10, justifyContent: 'center', alignItems: 'center', backgroundColor: '#18181B' },
  saveProfileBtn: { backgroundColor: '#E11D48', height: 45, borderRadius: 10, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', marginTop: 10 },
  saveSettingsBtn: { backgroundColor: '#27272A', height: 45, borderRadius: 10, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', marginTop: 5 },

  // TACTICAL NAVIGATION PANEL
  tacticalPanel: { flex: 0.5, backgroundColor: '#09090B', borderTopWidth: 2, borderColor: '#27272A', padding: 15 },
  tacticalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 15, borderBottomWidth: 1, borderColor: '#27272A', paddingBottom: 10 },
  tacticalTitle: { color: '#FAFAFA', fontSize: 16, fontWeight: 'bold', marginLeft: 10 },
  stepsList: { flex: 1, marginBottom: 15 },
  stepItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#18181B', padding: 15, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: '#27272A' },
  stepIconBox: { backgroundColor: '#27272A', width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  stepText: { color: '#FAFAFA', fontSize: 15, fontWeight: '600', flex: 1 },
  disarmRouteBtn: { backgroundColor: '#E11D48', paddingVertical: 15, borderRadius: 12, alignItems: 'center', elevation: 5 },
  guardianAlertCard: {
    backgroundColor: '#18181B',
    borderRadius: 16,
    padding: 16,
    width: '85%',
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#EF4444',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  guardianAlertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  guardianAlertTitle: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginLeft: 4,
  },
  guardianAlertNarrative: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  guardianNotifiedContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#27272A',
  },
  guardianNotifiedHeader: {
    color: '#A1A1AA',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 6,
  },
  guardianNotifiedText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '700',
    marginVertical: 2,
  },
});