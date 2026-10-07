import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
  TextInput,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Modal,
  Linking,
  ActivityIndicator,
  Vibration,
} from 'react-native';
import * as Location from 'expo-location';
import { haversineDistance } from '../../services/geofenceService';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  HistoryStackParamList,
  TreeRecord,
  TreeCondition,
  TREE_CONDITION_OPTIONS,
  MONITORING_ROUNDS,
  getMonitoringRoundInfo,
  Coordinates,
} from '../../types';
import { useAuthStore } from '../../store/authStore';
import { useTaskStore } from '../../store/taskStore';
import { useTreeStore } from '../../store/treeStore';
import { useProjectRefreshStore } from '../../store/projectRefreshStore';
import { completeTask } from '../../services/taskService';
import {
  fetchTreeById,
  fetchTreeMonitoringRecords,
  fetchUserProfile,
  updateTree,
} from '../../services/treeService';
import {
  submitAudit,
  getAuditStatus,
  getDueLabel,
  formatDateFriendly,
} from '../../services/auditService';
import { useCamera } from '../../hooks/useCamera';
import { resolveTreeId } from '../../utils/treeId';
import MapPreview from '../../components/MapPreview';

type Nav = NativeStackNavigationProp<HistoryStackParamList, 'UpdateTree'>;
type Route = RouteProp<HistoryStackParamList, 'UpdateTree'>;

const CONDITION_COLORS: Record<string, string> = {
  Healthy: '#22c55e',
  Stressed: '#f59e0b',
  Diseased: '#ef4444',
  Dead: '#6b7280',
};

const SURVIVAL_OPTIONS = [
  { label: 'Alive', value: 'alive' as const, color: '#22c55e', icon: 'checkmark-circle' },
  { label: 'Dead', value: 'dead' as const, color: '#ef4444', icon: 'close-circle' },
  { label: 'Missing', value: 'missing' as const, color: '#f59e0b', icon: 'help-circle' },
];

export default function UpdateTreeScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { treeId, treeIdDisplay, currentRound } = route.params;
  const { user, activeProjectId } = useAuthStore();
  const [permission, requestPermission] = useCameraPermissions();
  const {
    cameraRef,
    flash,
    facing,
    setIsReady,
    takePicture,
    toggleFlash,
    toggleFacing,
  } = useCamera();

  const [tree, setTree] = useState<TreeRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<number>(Math.min(currentRound, 4));
  const [monitoringHistory, setMonitoringHistory] = useState<any[]>([]);

  // Form state
  const [dbhCm, setDbhCm] = useState('');
  const [heightM, setHeightM] = useState('');
  const [crownDiam, setCrownDiam] = useState('');
  const [treeCondition, setTreeCondition] = useState<TreeCondition>('Healthy');
  const [survivalStatus, setSurvivalStatus] = useState<'alive' | 'dead' | 'missing'>('alive');
  const [notes, setNotes] = useState('');
  const [surveyor, setSurveyor] = useState(user?.full_name ?? '');
  const [surveyDate, setSurveyDate] = useState(new Date().toISOString().split('T')[0]);

  // Nearest tree-specific proximity fencing (under-tree zone)
  const TREE_FENCE_RADIUS_METERS = 15;
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [locating, setLocating] = useState<boolean>(true);
  const [locationPermissionDenied, setLocationPermissionDenied] = useState<boolean>(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [distanceToTree, setDistanceToTree] = useState<number | null>(null);
  const [isFenceDetached, setIsFenceDetached] = useState<boolean>(false);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);

  const hasTreeCoords = Boolean(tree?.latitude && tree?.longitude);
  const effectiveRadius = hasTreeCoords ? Math.max(TREE_FENCE_RADIUS_METERS, Math.round((tree?.crown_diameter_m || 0) + 5)) : TREE_FENCE_RADIUS_METERS;
  const isUnderTreeFencing = isFenceDetached || !hasTreeCoords || (distanceToTree !== null && distanceToTree <= effectiveRadius);

  const applyLocationFix = useCallback((lat: number, lng: number, accuracy?: number | null) => {
    const coords: Coordinates = {
      latitude: lat,
      longitude: lng,
      accuracy: accuracy ?? undefined,
    };
    setUserLocation(coords);
    setLocationError(null);
    setLocating(false);

    if (tree?.latitude && tree?.longitude) {
      const d = haversineDistance(lat, lng, tree.latitude, tree.longitude);
      setDistanceToTree(d);
    }
  }, [tree?.latitude, tree?.longitude]);

  const startProximityTracking = useCallback(async () => {
    setLocating(true);
    setLocationError(null);
    try {
      // 1. Check if location services (GPS hardware switch) are enabled on the phone
      try {
        const providerStatus = await Location.getProviderStatusAsync();
        if (!providerStatus.locationServicesEnabled) {
          if (Platform.OS === 'android') {
            try {
              await Location.enableNetworkProviderAsync();
            } catch {
              setLocationError('Phone GPS is turned OFF. Please turn on Location in quick settings.');
            }
          } else {
            setLocationError('Phone GPS is turned OFF. Please turn on Location in Settings.');
          }
        }
      } catch (e) {
        console.warn('[TreeApp] Provider status check error:', e);
      }

      // 2. Check permissions
      let { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        const req = await Location.requestForegroundPermissionsAsync();
        status = req.status;
      }
      if (status !== 'granted') {
        setLocationPermissionDenied(true);
        setLocationError('Location permission denied. Please allow location access.');
        setLocating(false);
        return;
      }
      setLocationPermissionDenied(false);

      // 3. Fast-path: Instant cached location (returns in 0-10ms, works indoors)
      try {
        const lastKnown = await Location.getLastKnownPositionAsync({});
        if (lastKnown?.coords) {
          applyLocationFix(lastKnown.coords.latitude, lastKnown.coords.longitude, lastKnown.coords.accuracy);
        }
      } catch (err) {
        console.warn('[TreeApp] Last known position error:', err);
      }

      // 4. Remove previous watcher
      if (locationSubRef.current) {
        locationSubRef.current.remove();
        locationSubRef.current = null;
      }

      // 5. Navigation-grade stream. Updates while standing still so the
      //    fix tightens instead of waiting for the user to walk.
      try {
        locationSubRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            distanceInterval: 0,
            timeInterval: 250,
          },
          (loc) => {
            if (loc?.coords) {
              applyLocationFix(loc.coords.latitude, loc.coords.longitude, loc.coords.accuracy);
            }
          }
        );
      } catch (watchErr: any) {
        console.warn('[TreeApp] watchPositionAsync error:', watchErr);
      }

      // 6. Navigation-grade one-shot. Balanced is only a backup if GPS
      //    has not produced a first fix yet.
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
        mayShowUserSettingsDialog: true,
      })
        .then((loc) => {
          if (loc?.coords) {
            applyLocationFix(loc.coords.latitude, loc.coords.longitude, loc.coords.accuracy);
          }
        })
        .catch(async () => {
          try {
            const backupFix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            if (backupFix?.coords) {
              applyLocationFix(backupFix.coords.latitude, backupFix.coords.longitude, backupFix.coords.accuracy);
            }
          } catch (backupErr: any) {
            console.warn('[TreeApp] Balanced accuracy fallback error:', backupErr);
            setLocationError(backupErr?.message || 'Unable to acquire GPS fix. Tap "Detach Fence" or check GPS settings.');
          }
        });

    } catch (err: any) {
      console.warn('[TreeApp] Proximity tracking error:', err);
      setLocationError(err?.message || 'GPS initialization error');
    } finally {
      setTimeout(() => setLocating(false), 2000);
    }
  }, [applyLocationFix]);

  useEffect(() => {
    startProximityTracking();

    return () => {
      if (locationSubRef.current) {
        locationSubRef.current.remove();
        locationSubRef.current = null;
      }
    };
  }, [startProximityTracking]);

  const handleOpenMapToTree = () => {
    if (!tree?.latitude || !tree?.longitude) return;
    const navParams = {
      focusTreeId: tree.id,
      focusLat: Number(tree.latitude),
      focusLng: Number(tree.longitude),
    };
    try {
      (navigation as any).navigate('Map', navParams);
      return;
    } catch {}
    try {
      (navigation.getParent() as any)?.navigate('Map', navParams);
      return;
    } catch {}
    const url = `https://www.google.com/maps/dir/?api=1&destination=${tree.latitude},${tree.longitude}&travelmode=walking`;
    Linking.openURL(url).catch(() => {});
  };

  const handleToggleDetachFence = () => {
    if (!isFenceDetached) {
      setIsFenceDetached(true);
      // Immediately buzz mobile to confirm arrival under tree!
      try {
        Vibration.vibrate([0, 250, 150, 350]);
      } catch (e) {
        console.warn('[TreeApp] Vibration error:', e);
      }
    } else {
      setIsFenceDetached(false);
      startProximityTracking();
    }
  };

  const handleSyncTreeToMyLocation = () => {
    if (!userLocation) {
      Alert.alert(
        'No GPS Position Yet',
        'Your phone is still acquiring GPS coordinates. Please wait a second or make sure Location is enabled on your phone.'
      );
      return;
    }

    Alert.alert(
      'Sync Tree Location',
      `Set this tree's coordinates to your current live location?\n\nLatitude: ${userLocation.latitude.toFixed(6)}\nLongitude: ${userLocation.longitude.toFixed(6)}\n\nThis will lock your location as the tree's position and enable the audit.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sync Location',
          onPress: () => {
            if (!tree) return;
            const updatedTree: TreeRecord = {
              ...tree,
              latitude: userLocation.latitude,
              longitude: userLocation.longitude,
            };
            setTree(updatedTree);
            setDistanceToTree(0);
            setIsFenceDetached(false);

            // Double pulse buzz!
            try {
              Vibration.vibrate([0, 250, 150, 350]);
            } catch (e) {
              console.warn('[TreeApp] Vibration error:', e);
            }

            // Save to database
            updateTree(tree.id, {
              latitude: userLocation.latitude,
              longitude: userLocation.longitude,
            }).catch(() => {});

            Alert.alert('Tree Location Synced', 'Tree coordinates updated to your current position. Audit is now unlocked!');
          },
        },
      ]
    );
  };

  // Haptic vibration feedback: vibrate mobile when under/near tree fencing area
  const prevUnderFencingRef = useRef<boolean>(false);
  const hasInitialVibratedRef = useRef<boolean>(false);

  useEffect(() => {
    if (isUnderTreeFencing && (distanceToTree !== null || isFenceDetached)) {
      if (!prevUnderFencingRef.current || !hasInitialVibratedRef.current) {
        hasInitialVibratedRef.current = true;
        try {
          // Double buzz vibration pattern: wait 0ms, buzz 250ms, wait 150ms, buzz 350ms
          Vibration.vibrate([0, 250, 150, 350]);
        } catch (e) {
          console.warn('[TreeApp] Vibration error:', e);
        }
      }
    }
    prevUnderFencingRef.current = isUnderTreeFencing;
  }, [isUnderTreeFencing, distanceToTree, isFenceDetached]);

  const handleTestVibrate = () => {
    try {
      Vibration.vibrate([0, 250, 150, 350]);
    } catch (e) {
      console.warn('[TreeApp] Vibration error:', e);
    }
  };

  const scrollRef = useRef<ScrollView>(null);
  const notesFieldRef = useRef<TextInput>(null);
  const windowHRef = useRef(Dimensions.get('window').height);
  const scrollOffsetRef = useRef(0);

  useEffect(() => {
    let active = true;
    (async () => {
      const state = useAuthStore.getState();
      const sessionUser = state.session?.user;
      const metadata = sessionUser?.user_metadata || {};
      const userId = user?.id || sessionUser?.id;
      let name = String(
        user?.full_name || metadata.full_name || metadata.name || metadata.display_name || ''
      ).trim();
      if (userId) {
        const profileRes = await fetchUserProfile(userId);
        const profile = profileRes.data as any;
        name = String(
          profile?.display_name || profile?.full_name || profile?.name || name || ''
        ).trim();
      }
      if (!name) {
        const email = user?.email || sessionUser?.email || '';
        name = email.includes('@') ? email.split('@')[0] : email;
      }
      if (active && name) setSurveyor(name);
    })();
    return () => {
      active = false;
    };
  }, [user?.id, user?.full_name, user?.email]);

  // Init: repair the tree's ID to the active project's format FIRST, then load
  // the tree + monitoring rounds using the tree's real tree_id (never the stale
  // route param, which may predate a migration).
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      setLoading(true);
      try {
        // 1) Make sure this tree carries the active project's ID format
        if (cancelled) return;

        // Load the tree and its monitoring rounds from the database.
        const { data: treeData } = await fetchTreeById(treeId);
        if (cancelled) return;

        const records = await fetchTreeMonitoringRecords(treeId);
        if (cancelled) return;

        if (treeData) {
          setTree(treeData);
          // Pre-fill from existing tree data for round 1 (planting baseline)
          setDbhCm(treeData.dbh_cm?.toString() ?? '');
          setHeightM(treeData.height_m?.toString() ?? '');
          setCrownDiam(treeData.crown_diameter_m?.toString() ?? '');
          setTreeCondition(treeData.tree_condition ?? 'Healthy');
        }

        setMonitoringHistory(records.data ?? []);

        // Auto-detect: set active tab to the NEXT audit to fill
        const status = getAuditStatus(treeData, records.data ?? []);
        setActiveTab(status.currentRound);
      } catch (err) {
        console.warn('[TreeApp] UpdateTree load error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [treeId, treeIdDisplay, activeProjectId]);

  // ── Audit photos: array of 3 (mandatory for audit submission) ───────────────
  const AUDIT_PHOTO_COUNT = 3;
  const [auditPhotoUris, setAuditPhotoUris] = useState<(string | null)[]>([null, null, null]);
  const [activeCameraSlot, setActiveCameraSlot] = useState<number>(-1); // -1 = camera closed
  const [cameraOpen, setCameraOpen] = useState(false);

  // Legacy single-photo for backward compatibility
  const newPhotoUri = auditPhotoUris[0] ?? null;

  const handleOpenCamera = async (slot: number) => {
    if (hasTreeCoords && !isUnderTreeFencing) {
      const distStr =
        distanceToTree != null
          ? distanceToTree >= 1000
            ? `${(distanceToTree / 1000).toFixed(1)} km`
            : `${Math.round(distanceToTree)}m`
          : 'calculating...';
      Alert.alert(
        'Outside Tree Fencing Area',
        `Audit photos can only be taken while standing directly under or near the tree (within ${effectiveRadius}m).\n\nYour current distance: ${distStr}.\n\nPlease walk closer to the tree to enable audit photo capture.`,
        [
          { text: 'View on Map', onPress: handleOpenMapToTree },
          { text: 'OK', style: 'cancel' },
        ]
      );
      return;
    }

    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res?.granted) {
        Alert.alert('Permission Required', 'Camera access is needed to capture the audit photo.');
        return;
      }
    }
    setActiveCameraSlot(slot);
    setCameraOpen(true);
  };

  const handleTakePhoto = async () => {
    try {
      const uri = await takePicture();
      if (uri) {
        setAuditPhotoUris((prev) => {
          const next = [...prev];
          next[activeCameraSlot] = uri;
          return next;
        });
        setCameraOpen(false);
        setActiveCameraSlot(-1);
      } else {
        Alert.alert('Error', 'Failed to capture photo. Try again.');
      }
    } catch {
      Alert.alert('Error', 'Camera error. Try again.');
    }
  };

  const handleClearNewPhoto = (slot: number) => {
    setAuditPhotoUris((prev) => {
      const next = [...prev];
      next[slot] = null;
      return next;
    });
  };

  const scrollToInput = (ref: React.RefObject<TextInput>) => {
    const scroll = scrollRef.current;
    const input = ref.current;
    if (!scroll || !input) return;
    input.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      const winH = Dimensions.get('window').height;
      const kbHeight = 300;
      const visibleBottom = winH - kbHeight;
      const overflow = y + h + 16 - visibleBottom;
      if (overflow > 0) {
        scroll.scrollTo({ y: scrollOffsetRef.current + overflow, animated: true });
      }
    });
  };

  const handleNotesFocus = () => {
    setTimeout(() => scrollToInput(notesFieldRef), 100);
    setTimeout(() => scrollToInput(notesFieldRef), 350);
  };

  const handleSubmit = async () => {
    if (hasTreeCoords && !isUnderTreeFencing) {
      const distStr =
        distanceToTree != null
          ? distanceToTree >= 1000
            ? `${(distanceToTree / 1000).toFixed(1)} km`
            : `${Math.round(distanceToTree)}m`
          : 'calculating...';
      Alert.alert(
        'Audit Blocked — Outside Tree Fence',
        `Audit data updates can only be submitted while standing directly under the tree's fencing area (within ${effectiveRadius}m).\n\nYour current distance: ${distStr}.\n\nPlease walk under the tree to unlock and submit this audit.`,
        [
          { text: 'View on Map', onPress: handleOpenMapToTree },
          { text: 'OK', style: 'cancel' },
        ]
      );
      return;
    }

    const alreadyCompleted = monitoringHistory.some((r) => r.monitoring_round === activeTab);
    if (alreadyCompleted) {
      Alert.alert(
        'Audit Already Completed',
        'Audit ' + activeTab + ' has already been completed for this tree. Audits cannot be repeated.'
      );
      return;
    }
    if (auditStatus.allCompleted) {
      Alert.alert(
        'All Audits Completed',
        'All 4 monitoring rounds have already been completed for this tree. Audits cannot be repeated.'
      );
      return;
    }
    if (!auditStatus.isDue) {
      Alert.alert(
        'Audit Not Due Yet',
        `Audit ${activeTab} is not due yet (${getDueLabel(auditStatus)}). Please wait until Audit Now.`
      );
      return;
    }
    if (activeTab === 2 && !survivalStatus) {
      Alert.alert('Required', 'Please select survival status.');
      return;
    }
    if (activeTab !== 2 || survivalStatus === 'alive') {
      if (!dbhCm || parseFloat(dbhCm) <= 0) {
        Alert.alert('Required', 'Please enter DBH (cm).');
        return;
      }
      if (!heightM || parseFloat(heightM) <= 0) {
        Alert.alert('Required', 'Please enter Height (m).');
        return;
      }
    }
    // Mandatory 3 audit photos validation
    const filledAuditPhotos = auditPhotoUris.filter(Boolean) as string[];
    if (filledAuditPhotos.length < AUDIT_PHOTO_COUNT) {
      Alert.alert(
        '3 Photos Required',
        `Please capture all ${AUDIT_PHOTO_COUNT} audit photos before submitting.\n\nTap the empty photo slots to add photos.`
      );
      return;
    }
    if (!tree || !user) return;

    setSubmitting(true);
    try {
      const result = await submitAudit({
        tree,
        round: activeTab,
        userId: user.id,
        projectId: activeProjectId ?? tree.project_id,
        // Pass all 3 audit photo URIs — first is primary
        photoUri: filledAuditPhotos[0],
        photoUris: filledAuditPhotos,
        dbhCm: parseFloat(dbhCm) || null,
        heightM: parseFloat(heightM) || null,
        crownDiameterM: parseFloat(crownDiam) || null,
        treeCondition,
        survivalStatus,
        notes,
        surveyor,
        surveyDate,
      });

      if (!result.ok) throw new Error(result.error ?? 'Failed to save audit');

      useTreeStore.getState().updateTree(tree.id, { survey_date: surveyDate });
      useProjectRefreshStore.getState().triggerProjectRefresh();

      const tasks = useTaskStore.getState().tasks ?? [];
      const matched = tasks.find(
        (task) =>
          (task.status === 'assigned' || task.status === 'in_progress') &&
          (task.task_type === 'audit' || !!task.audit_round) &&
          (task.tree_record_id === tree.id || task.tree_id === tree.id) &&
          (Number(task.audit_round) === activeTab || !task.audit_round)
      );
      if (matched) {
        const closed = await completeTask(matched.id, tree.id, undefined, {
          asAudit: true,
          auditRound: activeTab,
        });
        if (closed.error) throw new Error(closed.error);
      }

      const liveTreeId = resolveTreeId(tree) || treeIdDisplay;

      Alert.alert(
        'Audit Saved',
        `Audit ${activeTab} recorded for ${liveTreeId}. It is on the Completed tab until an admin approves or rejects it.`,
        [{
          text: 'OK',
          onPress: () => {
            useTaskStore.getState().openTaskTab('completed');
            (navigation as any).navigate('Main', { screen: 'Task', params: { tab: 'completed', at: Date.now() } });
          },
        }]
      );
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to save audit');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <Ionicons name="leaf" size={48} color="#1a5c2a" />
        <Text style={styles.loadingText}>Loading tree data...</Text>
      </View>
    );
  }

  if (!tree) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Tree record not found.</Text>
      </View>
    );
  }

  const displayId = resolveTreeId(tree) || treeIdDisplay;
  const roundInfo = getMonitoringRoundInfo(activeTab);
  const auditStatus = getAuditStatus(tree, monitoringHistory);

  // Audits that only exist on this device so far (monitoring table not deployed
  // yet) — they are uploaded automatically, this is just a heads-up.
  const pendingAuditCount = monitoringHistory.filter((rec) => rec?.pending_sync).length;
  // Show new photo if captured, else original
  const photoSource = newPhotoUri ?? tree.photo_url;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <LinearGradient colors={['#123f24', '#1a5c2a', '#2e7d43']} style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>AUDIT TREE</Text>
          <Text style={styles.headerSubtitle}>{displayId}</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={[styles.roundBadge, { backgroundColor: roundInfo.color + '30' }]}>
            <Text style={[styles.roundBadgeText, { color: roundInfo.color }]}>
              A{activeTab}
            </Text>
          </View>
        </View>
      </LinearGradient>

      {/* Compact Audit 1–4 + status strip */}
      <View style={styles.topBar}>
        <View style={styles.topTabs}>
          {MONITORING_ROUNDS.map((round) => {
            const isActive = activeTab === round.round;
            const isCompleted = monitoringHistory.some((r) => r.monitoring_round === round.round);
            const isAvailable = round.round <= auditStatus.currentRound || isCompleted;
            return (
              <TouchableOpacity
                key={round.round}
                style={[
                  styles.topTab,
                  isAvailable && !isActive && { borderColor: round.color + '44', backgroundColor: round.color + '12' },
                  isActive && { backgroundColor: round.color, borderColor: round.color },
                  !isAvailable && styles.topTabLocked,
                ]}
                onPress={() => {
                  if (isCompleted) {
                    const completedRec = monitoringHistory.find((r) => r.monitoring_round === round.round);
                    const dateStr = completedRec?.survey_date ? formatDateFriendly(completedRec.survey_date) : 'earlier';
                    Alert.alert(
                      'Audit ' + round.round + ' Completed',
                      'Audit ' + round.round + ' was already recorded on ' + dateStr + '. Audits cannot be repeated.'
                    );
                    return;
                  }
                  if (isAvailable && round.round === auditStatus.currentRound) {
                    setActiveTab(round.round);
                  } else {
                    Alert.alert(
                      'Next Audit Required',
                      'Please complete Audit ' + auditStatus.currentRound + ' first. Audits must be completed sequentially (Audit 1 -> 2 -> 3 -> 4) without repeating.'
                    );
                  }
                }}
                activeOpacity={0.75}
              >
                <Ionicons
                  name={(isAvailable ? (isCompleted ? 'checkmark-circle' : round.icon) : 'lock-closed') as any}
                  size={11}
                  color={isActive ? '#fff' : isAvailable ? round.color : '#bbb'}
                />
                <Text
                  style={[
                    styles.topTabLabel,
                    { color: isActive ? '#fff' : isAvailable ? '#1a5c2a' : '#bbb' },
                  ]}
                >
                  A{round.round}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={[styles.statusPill, { backgroundColor: roundInfo.color + '18' }]}>
          <Text style={[styles.statusPillText, { color: roundInfo.color }]} numberOfLines={1}>
            {monitoringHistory.length}/4
            {auditStatus.nextDate ? ` · ${formatDateFriendly(auditStatus.nextDate)}` : ''}
          </Text>
        </View>
      </View>

      {/* One-line audit title */}
      <View style={styles.titleStrip}>
        <Ionicons name={roundInfo.icon as any} size={13} color={roundInfo.color} />
        <Text style={[styles.titleStripText, { color: roundInfo.color }]} numberOfLines={1}>
          Audit {activeTab}: {roundInfo.subtitle.split('·')[0].trim()}
        </Text>
      </View>

      {/* Audits waiting on the device (cloud sync not ready yet) */}
      {pendingAuditCount > 0 && (
        <View style={styles.pendingBanner}>
          <Ionicons name="cloud-upload-outline" size={12} color="#8a6d1f" />
          <Text style={styles.pendingBannerText} numberOfLines={2}>
            {pendingAuditCount} audit{pendingAuditCount > 1 ? 's' : ''} stored on this device —
            uploads automatically once cloud sync is ready.
          </Text>
        </View>
      )}

      {/* Monitoring History Timeline (past audits) */}
      {monitoringHistory.length > 0 && (
        <View style={styles.historyBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.historyScroll}>
            {monitoringHistory.map((rec, idx) => {
              const rInfo = getMonitoringRoundInfo(rec.monitoring_round);
              return (
                <View key={rec.id ?? idx} style={[styles.historyChip, { borderColor: rInfo.color + '60' }]}>
                  <View style={[styles.historyDot, { backgroundColor: rInfo.color }]} />
                  <Text style={styles.historyChipText}>A{rec.monitoring_round}</Text>
                  <Text style={styles.historyChipDate}>{rec.survey_date ?? '—'}</Text>
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Form Content */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 16 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={(e: any) => {
          scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={32}
      >


        {/* ─── Audit Photos: 3 mandatory shots ─────────────────────────── */}
        <View style={styles.auditPhotoCard}>
          {/* Header */}
          <View style={styles.auditPhotoCardHeader}>
            <View style={styles.auditPhotoCardTitleRow}>
              <Ionicons name="camera" size={15} color="#15803d" />
              <Text style={styles.auditPhotoCardTitle}>Audit Photos (Required)</Text>
            </View>
            <View style={[styles.auditPhotoBadge, auditPhotoUris.filter(Boolean).length === AUDIT_PHOTO_COUNT && styles.auditPhotoBadgeDone]}>
              <Text style={styles.auditPhotoBadgeText}>{auditPhotoUris.filter(Boolean).length}/{AUDIT_PHOTO_COUNT}</Text>
            </View>
          </View>

          {/* 3-slot tray (Direct Camera on Tap) */}
          <View style={styles.auditPhotoSlotsRow}>
            {[0, 1, 2].map((slot) => {
              const uri = auditPhotoUris[slot];
              const slotLabels = ['Front', 'Side', 'Detail'];
              return (
                <TouchableOpacity
                  key={slot}
                  style={styles.auditPhotoSlotWrap}
                  activeOpacity={0.85}
                  onPress={() => handleOpenCamera(slot)}
                >
                  {uri ? (
                    <View style={styles.auditPhotoSlotFilled}>
                      <Image source={{ uri }} style={styles.auditSlotImage} resizeMode="cover" />
                      <View style={styles.auditSlotDoneBadge}>
                        <Ionicons name="checkmark-circle" size={12} color="#fff" />
                        <Text style={styles.auditSlotDoneBadgeText}>{slotLabels[slot]}</Text>
                      </View>
                      <View style={styles.auditSlotRetakeOverlay}>
                        <Text style={styles.auditSlotRetakeText}>Tap to retake</Text>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.auditPhotoSlotEmpty}>
                      <View style={styles.auditSlotCameraBtn}>
                        <Ionicons name="camera" size={22} color="#15803d" />
                        <Text style={styles.auditSlotCameraBtnText}>{slotLabels[slot]}</Text>
                        <Text style={styles.auditSlotCameraBtnSub}>Tap to shoot</Text>
                      </View>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Progress bar */}
          <View style={styles.auditPhotoProgress}>
            <View style={styles.auditPhotoProgressTrack}>
              <View style={[styles.auditPhotoProgressFill, {
                width: `${(auditPhotoUris.filter(Boolean).length / AUDIT_PHOTO_COUNT) * 100}%`
              }]} />
            </View>
          </View>
        </View>

        {/* ─── Audit 1: Planting (Baseline) ─── */}
        {activeTab === 1 && (
          <>
            <View style={styles.sectionHeader}>
              <Ionicons name="leaf" size={16} color="#22c55e" />
              <Text style={styles.sectionTitle}>Baseline Survey / Plantation Record</Text>
            </View>

            <View style={styles.measureGrid}>
              <View style={styles.measureCell}>
                <Text style={styles.measureLabel}>DBH (CM) *</Text>
                <TextInput
                  style={styles.measureInput}
                  value={dbhCm}
                  onChangeText={setDbhCm}
                  placeholder="0.0"
                  placeholderTextColor="#bbb"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.measureCell}>
                <Text style={styles.measureLabel}>HEIGHT (M) *</Text>
                <TextInput
                  style={styles.measureInput}
                  value={heightM}
                  onChangeText={setHeightM}
                  placeholder="0.0"
                  placeholderTextColor="#bbb"
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            <View style={styles.measureGrid}>
              <View style={styles.measureCell}>
                <Text style={styles.measureLabel}>CROWN (M)</Text>
                <TextInput
                  style={styles.measureInput}
                  value={crownDiam}
                  onChangeText={setCrownDiam}
                  placeholder="0.0"
                  placeholderTextColor="#bbb"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.measureCell} />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>CONDITION</Text>
              <View style={styles.conditionRow}>
                {TREE_CONDITION_OPTIONS.map((opt) => {
                  const selected = treeCondition === opt.label;
                  const icon = opt.label === 'Healthy' ? 'leaf' : opt.label === 'Stressed' ? 'alert-circle' : opt.label === 'Diseased' ? 'medkit' : 'close-circle';
                  return (
                  <TouchableOpacity
                    key={opt.label}
                    style={[
                      styles.conditionBtn,
                      { borderColor: selected ? opt.color : '#E4EDE6' },
                      selected && { backgroundColor: opt.color },
                    ]}
                    onPress={() => setTreeCondition(opt.label)}
                  >
                    <Ionicons name={icon as any} size={16} color={selected ? '#fff' : opt.color} />
                    <Text style={[styles.conditionBtnText, { color: selected ? '#fff' : '#1a1a1a' }]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </>
        )}

        {/* ─── Audit 2: Survival Survey ─── */}
        {activeTab === 2 && (
          <>
            <View style={styles.sectionHeader}>
              <Ionicons name="heart" size={16} color="#3b82f6" />
              <Text style={styles.sectionTitle}>Survival Check / Audit 2</Text>
            </View>

            <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>SURVIVAL STATUS *</Text>
              <View style={styles.survivalRow}>
                {SURVIVAL_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.survivalBtn,
                      { borderColor: opt.color },
                      survivalStatus === opt.value && { backgroundColor: opt.color },
                    ]}
                    onPress={() => setSurvivalStatus(opt.value)}
                  >
                    <Ionicons
                      name={opt.icon as any}
                      size={20}
                      color={survivalStatus === opt.value ? '#fff' : opt.color}
                    />
                    <Text style={[styles.survivalBtnText, { color: survivalStatus === opt.value ? '#fff' : opt.color }]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {survivalStatus === 'alive' && (
              <>
                <View style={styles.measureGrid}>
                  <View style={styles.measureCell}>
                    <Text style={styles.measureLabel}>DBH (CM) *</Text>
                    <TextInput
                      style={styles.measureInput}
                      value={dbhCm}
                      onChangeText={setDbhCm}
                      placeholder="0.0"
                      placeholderTextColor="#bbb"
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={styles.measureCell}>
                    <Text style={styles.measureLabel}>HEIGHT (M) *</Text>
                    <TextInput
                      style={styles.measureInput}
                      value={heightM}
                      onChangeText={setHeightM}
                      placeholder="0.0"
                      placeholderTextColor="#bbb"
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>CONDITION</Text>
                  <View style={styles.conditionRow}>
                    {TREE_CONDITION_OPTIONS.map((opt) => (
                      <TouchableOpacity
                        key={opt.label}
                        style={[
                          styles.conditionBtn,
                          { borderColor: opt.color },
                          treeCondition === opt.label && { backgroundColor: opt.color },
                        ]}
                        onPress={() => setTreeCondition(opt.label)}
                      >
                        <Text style={[styles.conditionBtnText, { color: treeCondition === opt.label ? '#fff' : opt.color }]}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
              </View>
            </View>
          </>
        )}
          </>
        )}

        {/* ─── Audit 3: Growth Monitoring ─── */}
        {activeTab === 3 && (
          <>
            <View style={styles.sectionHeader}>
              <Ionicons name="trending-up" size={16} color="#f59e0b" />
              <Text style={styles.sectionTitle}>Growth Monitoring / Audit 3</Text>
            </View>

            <View style={styles.measureGrid}>
              <View style={styles.measureCell}>
                <Text style={styles.measureLabel}>DBH (CM) *</Text>
                <TextInput
                  style={styles.measureInput}
                  value={dbhCm}
                  onChangeText={setDbhCm}
                  placeholder="0.0"
                  placeholderTextColor="#bbb"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.measureCell}>
                <Text style={styles.measureLabel}>HEIGHT (M) *</Text>
                <TextInput
                  style={styles.measureInput}
                  value={heightM}
                  onChangeText={setHeightM}
                  placeholder="0.0"
                  placeholderTextColor="#bbb"
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            <View style={styles.measureGrid}>
              <View style={styles.measureCell}>
                <Text style={styles.measureLabel}>CROWN (M)</Text>
                <TextInput
                  style={styles.measureInput}
                  value={crownDiam}
                  onChangeText={setCrownDiam}
                  placeholder="0.0"
                  placeholderTextColor="#bbb"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.measureCell} />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>CONDITION</Text>
              <View style={styles.conditionRow}>
                {TREE_CONDITION_OPTIONS.map((opt) => {
                  const selected = treeCondition === opt.label;
                  const icon = opt.label === 'Healthy' ? 'leaf' : opt.label === 'Stressed' ? 'alert-circle' : opt.label === 'Diseased' ? 'medkit' : 'close-circle';
                  return (
                  <TouchableOpacity
                    key={opt.label}
                    style={[
                      styles.conditionBtn,
                      { borderColor: selected ? opt.color : '#E4EDE6' },
                      selected && { backgroundColor: opt.color },
                    ]}
                    onPress={() => setTreeCondition(opt.label)}
                  >
                    <Ionicons name={icon as any} size={16} color={selected ? '#fff' : opt.color} />
                    <Text style={[styles.conditionBtnText, { color: selected ? '#fff' : '#1a1a1a' }]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Growth comparison */}
            {monitoringHistory.length > 0 && (
              <View style={styles.growthCard}>
                <View style={styles.growthHeader}>
                  <Ionicons name="analytics" size={16} color="#f59e0b" />
                  <Text style={styles.growthTitle}>Previous Measurements</Text>
                </View>
                {monitoringHistory.slice(-1).map((rec: any, idx: number) => (
                  <View key={idx} style={styles.growthRow}>
                    <View style={styles.growthCell}>
                      <Text style={styles.growthLabel}>Last DBH</Text>
                      <Text style={styles.growthValue}>{rec.dbh_cm ?? '—'} cm</Text>
                    </View>
                    <View style={styles.growthCell}>
                      <Text style={styles.growthLabel}>Last Height</Text>
                      <Text style={styles.growthValue}>{rec.height_m ?? '—'} m</Text>
                    </View>
                    <View style={styles.growthCell}>
                      <Text style={styles.growthLabel}>Last Crown</Text>
                      <Text style={styles.growthValue}>{rec.crown_diameter_m ?? '—'} m</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* ─── Audit 4: Periodic Monitoring ─── */}
        {activeTab >= 4 && (
          <>
            <View style={styles.sectionHeader}>
              <Ionicons name="time" size={16} color="#8b5cf6" />
              <Text style={styles.sectionTitle}>Periodic Check (Audit {activeTab})</Text>
            </View>

            <View style={styles.measureGrid}>
              <View style={styles.measureCell}>
                <Text style={styles.measureLabel}>DBH (CM) *</Text>
                <TextInput
                  style={styles.measureInput}
                  value={dbhCm}
                  onChangeText={setDbhCm}
                  placeholder="0.0"
                  placeholderTextColor="#bbb"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.measureCell}>
                <Text style={styles.measureLabel}>HEIGHT (M) *</Text>
                <TextInput
                  style={styles.measureInput}
                  value={heightM}
                  onChangeText={setHeightM}
                  placeholder="0.0"
                  placeholderTextColor="#bbb"
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            <View style={styles.measureGrid}>
              <View style={styles.measureCell}>
                <Text style={styles.measureLabel}>CROWN (M)</Text>
                <TextInput
                  style={styles.measureInput}
                  value={crownDiam}
                  onChangeText={setCrownDiam}
                  placeholder="0.0"
                  placeholderTextColor="#bbb"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.measureCell} />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>CONDITION</Text>
              <View style={styles.conditionRow}>
                {TREE_CONDITION_OPTIONS.map((opt) => {
                  const selected = treeCondition === opt.label;
                  const icon = opt.label === 'Healthy' ? 'leaf' : opt.label === 'Stressed' ? 'alert-circle' : opt.label === 'Diseased' ? 'medkit' : 'close-circle';
                  return (
                  <TouchableOpacity
                    key={opt.label}
                    style={[
                      styles.conditionBtn,
                      { borderColor: selected ? opt.color : '#E4EDE6' },
                      selected && { backgroundColor: opt.color },
                    ]}
                    onPress={() => setTreeCondition(opt.label)}
                  >
                    <Ionicons name={icon as any} size={16} color={selected ? '#fff' : opt.color} />
                    <Text style={[styles.conditionBtnText, { color: selected ? '#fff' : '#1a1a1a' }]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Growth comparison */}
            {monitoringHistory.length > 0 && (
              <View style={styles.growthCard}>
                <View style={styles.growthHeader}>
                  <Ionicons name="analytics" size={16} color="#8b5cf6" />
                  <Text style={styles.growthTitle}>Previous Measurements</Text>
                </View>
                {monitoringHistory.slice(-1).map((rec: any, idx: number) => (
                  <View key={idx} style={styles.growthRow}>
                    <View style={styles.growthCell}>
                      <Text style={styles.growthLabel}>Last DBH</Text>
                      <Text style={styles.growthValue}>{rec.dbh_cm ?? '—'} cm</Text>
                    </View>
                    <View style={styles.growthCell}>
                      <Text style={styles.growthLabel}>Last Height</Text>
                      <Text style={styles.growthValue}>{rec.height_m ?? '—'} m</Text>
                    </View>
                    <View style={styles.growthCell}>
                      <Text style={styles.growthLabel}>Last Crown</Text>
                      <Text style={styles.growthValue}>{rec.crown_diameter_m ?? '—'} m</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* ─── Common: Surveyor + Date + Notes ─── */}
        <View style={styles.commonSection}>
            <View style={styles.sectionHeader}>
              <Ionicons name="clipboard" size={16} color="#1a5c2a" />
              <Text style={styles.sectionTitle}>Survey Details</Text>
            </View>

          <View style={styles.measureGrid}>
            <View style={styles.measureCell}>
              <Text style={styles.fieldLabel}>FIELD SURVEYOR</Text>
              <View style={styles.readOnlyField}>
                <Ionicons name="lock-closed" size={14} color="#1a5c2a" />
                <Text style={styles.readOnlyText}>{surveyor || 'Signed-in user'}</Text>
              </View>
            </View>
            <View style={styles.measureCell}>
              <Text style={styles.fieldLabel}>DATE</Text>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyText}>{surveyDate}</Text>
              </View>
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>NOTES (optional)</Text>
            <TextInput
              ref={notesFieldRef}
              style={styles.notesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder="Add notes about this audit visit..."
              placeholderTextColor="#aaa"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              onFocus={handleNotesFocus}
            />
          </View>
        </View>
      </ScrollView>

      {/* Fixed Submit Footer */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <TouchableOpacity
          style={[
            styles.submitBtn,
            (submitting || (hasTreeCoords && !isUnderTreeFencing)) && styles.submitBtnDisabled,
            hasTreeCoords && !isUnderTreeFencing && styles.submitBtnLocked,
          ]}
          onPress={handleSubmit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <Ionicons name="hourglass" size={20} color="#fff" />
          ) : hasTreeCoords && !isUnderTreeFencing ? (
            <Ionicons name="lock-closed" size={20} color="#fff" />
          ) : (
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
          )}
          <Text style={styles.submitBtnText}>
            {submitting
              ? 'Saving...'
              : hasTreeCoords && !isUnderTreeFencing
              ? `Walk Under Tree to Unlock Audit (${distanceToTree != null ? Math.round(distanceToTree) + 'm' : '—'})`
              : `Submit Audit ${activeTab}`}
          </Text>
          {!submitting && isUnderTreeFencing ? (
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          ) : null}
        </TouchableOpacity>
      </View>

      {/* ─── Full-screen camera modal ─── */}
      <Modal visible={cameraOpen} animationType="slide" onRequestClose={() => setCameraOpen(false)}>
        <View style={styles.cameraContainer}>
          {permission?.granted ? (
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing={facing}
              onCameraReady={() => setIsReady(true)}
            />
          ) : (
            <View style={styles.cameraPerm}>
              <Ionicons name="camera-outline" size={64} color="#fff" />
              <Text style={styles.cameraPermText}>Camera permission required</Text>
              <TouchableOpacity style={styles.cameraPermBtn} onPress={requestPermission}>
                <Text style={styles.cameraPermBtnText}>Grant Permission</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.cameraOverlayTop}>
            <TouchableOpacity style={styles.cameraClose} onPress={() => setCameraOpen(false)}>
              <Ionicons name="close" size={26} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.cameraFlash} onPress={toggleFlash}>
              <Ionicons name={flash === 'off' ? 'flash-off' : 'flash'} size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={styles.cameraOverlayBottom}>
            <TouchableOpacity style={styles.cameraFlip} onPress={toggleFacing}>
              <Ionicons name="camera-reverse" size={28} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.shutterBtn} onPress={handleTakePhoto} activeOpacity={0.7}>
              <View style={styles.shutterInner} />
            </TouchableOpacity>
            <View style={styles.cameraFlipPlaceholder} />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f1' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f4f1' },
  loadingText: { marginTop: 12, fontSize: 14, color: '#666' },
  errorText: { fontSize: 16, color: '#888' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 48,
    paddingBottom: 14,
    paddingHorizontal: 14,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'flex-start', marginLeft: 10 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '800', textTransform: 'uppercase' },
  headerSubtitle: { color: '#cde8d3', fontSize: 11, marginTop: 3, fontFamily: 'monospace' },
  headerRight: { width: 42, alignItems: 'flex-end' },
  roundBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  roundBadgeText: { fontSize: 12, fontWeight: '800' },

  // Compact top: audit pills + status + title strip
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: '#fff',
  },
  topTabs: {
    flexDirection: 'row',
    flex: 1,
    gap: 5,
  },
  topTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: '#F4F7F4',
  },
  topTabLocked: {
    backgroundColor: '#EFF1EF',
    opacity: 0.75,
  },
  topTabLabel: { fontSize: 11, fontWeight: '800' },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    maxWidth: 130,
  },
  statusPillText: { fontSize: 10, fontWeight: '800' },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 14,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#FDF6E3',
    borderWidth: 1,
    borderColor: '#F0DFA8',
  },
  pendingBannerText: { flex: 1, fontSize: 10, fontWeight: '700', color: '#8a6d1f' },
  titleStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingBottom: 6,
    paddingTop: 2,
    backgroundColor: '#fff',
  },
  titleStripText: { fontSize: 12, fontWeight: '800', flex: 1 },

  // History Bar
  historyBar: { marginTop: 2, paddingLeft: 14, paddingBottom: 2 },
  historyScroll: { gap: 6, paddingRight: 14 },
  historyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
  },
  historyDot: { width: 6, height: 6, borderRadius: 3 },
  historyChipText: { fontSize: 10, fontWeight: '700', color: '#333' },
  historyChipDate: { fontSize: 9, color: '#888' },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { padding: 14, gap: 12, paddingBottom: 16 },

  // ─── 3-Slot Audit Photo Card ─────────────────────────────────────────────
  auditPhotoCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    elevation: 3,
    shadowColor: '#1a5c2a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    borderWidth: 1,
    borderColor: '#dcfce7',
    gap: 10,
  },
  auditPhotoCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  auditPhotoCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  auditPhotoCardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#15803d',
  },
  auditPhotoBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  auditPhotoBadgeDone: {
    backgroundColor: '#dcfce7',
    borderColor: '#22c55e',
  },
  auditPhotoBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#374151',
  },
  auditPhotoSlotsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  auditPhotoSlotWrap: {
    flex: 1,
    height: 100,
    borderRadius: 12,
    overflow: 'hidden',
  },
  auditPhotoSlotFilled: {
    flex: 1,
    position: 'relative',
    borderRadius: 12,
    overflow: 'hidden',
  },
  auditSlotImage: {
    width: '100%',
    height: '100%',
  },
  auditSlotDoneBadge: {
    position: 'absolute',
    top: 5,
    left: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#15803d',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  auditSlotDoneBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },
  auditSlotRetakeOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 3,
    alignItems: 'center',
  },
  auditSlotRetakeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  auditPhotoSlotEmpty: {
    flex: 1,
    backgroundColor: '#f0fdf4',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#bbf7d0',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  auditSlotCameraBtn: {
    alignItems: 'center',
    gap: 3,
    padding: 8,
  },
  auditSlotCameraBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#15803d',
  },
  auditSlotCameraBtnSub: {
    fontSize: 8,
    color: '#9ca3af',
  },
  auditPhotoProgress: {
    marginTop: 2,
  },
  auditPhotoProgressTrack: {
    height: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    overflow: 'hidden',
  },
  auditPhotoProgressFill: {
    height: 4,
    backgroundColor: '#22c55e',
    borderRadius: 2,
  },
  // Old photo card (kept for reference)
  photoCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 10,
    elevation: 2,
    shadowColor: '#1a5c2a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  photo: { width: '100%', height: 170, borderRadius: 12 },
  photoPlaceholder: {
    width: '100%',
    height: 140,
    backgroundColor: '#e8f5e9',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  photoPlaceholderText: { fontSize: 50 },
  newPhotoBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F09125',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  newPhotoBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  ogPhotoBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  ogPhotoBadgeText: { color: '#1a5c2a', fontSize: 9, fontWeight: '800' },
  photoActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    alignItems: 'center',
  },
  photoActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1a5c2a',
    paddingVertical: 12,
    borderRadius: 12,
  },
  photoActionText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  photoActionBtnOutline: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#1a5c2a',
    paddingVertical: 12,
    borderRadius: 12,
  },
  photoActionOutlineText: { color: '#1a5c2a', fontSize: 13, fontWeight: '700' },
  photoClearBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fef2f2',
    borderRadius: 12,
  },

  // Camera modal
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  cameraPerm: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#111',
  },
  cameraPermText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  cameraPermBtn: {
    backgroundColor: '#1a5c2a',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  cameraPermBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  cameraOverlayTop: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  cameraClose: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraFlash: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraOverlayBottom: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 30,
  },
  cameraFlip: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraFlipPlaceholder: { width: 52, height: 52 },
  shutterBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#fff',
  },

  // Sections
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: '#E8F5E9',
    marginTop: 4,
  },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: '#1a5c2a', textTransform: 'uppercase', letterSpacing: 0.4 },

  // Fields
  fieldGroup: {
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#EDF3ED',
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1a5c2a',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  // Measure Grid
  measureGrid: { flexDirection: 'row', gap: 8 },
  measureCell: { flex: 1, gap: 4 },
  measureLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#1a5c2a',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  measureInput: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#D4E8D0',
    paddingHorizontal: 10,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
    textAlign: 'center',
    minHeight: 46,
  },

  // Condition
  conditionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  conditionBtn: {
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: '#fff',
  },
  conditionBtnText: { flex: 1, fontSize: 13, fontWeight: '700' },

  // Survival
  survivalRow: { flexDirection: 'row', gap: 10 },
  survivalBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 2,
    backgroundColor: '#fff',
  },
  survivalBtnText: { fontSize: 14, fontWeight: '700' },

  // Growth Card
  growthCard: {
    backgroundColor: '#fffbeb',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#f59e0b30',
  },
  growthHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  growthTitle: { fontSize: 13, fontWeight: '700', color: '#92400e' },
  growthRow: { flexDirection: 'row', gap: 8 },
  growthCell: { flex: 1, alignItems: 'center' },
  growthLabel: { fontSize: 9, color: '#92400e', fontWeight: '600' },
  growthValue: { fontSize: 14, fontWeight: '800', color: '#78350f', marginTop: 2 },

  // Common Section
  commonSection: {
    marginTop: 8,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#EDF3ED',
    gap: 10,
  },

  // Read Only
  readOnlyField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F8F5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E5EDE5',
  },
  readOnlyText: { fontSize: 13, color: '#333', fontWeight: '600', flex: 1 },

  // Notes
  notesInput: {
    backgroundColor: '#F8FBF8',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#D4E8D0',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#1a1a1a',
    minHeight: 88,
    textAlignVertical: 'top',
  },

  // ─── Fixed Submit Footer ───
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 14,
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    borderTopWidth: 1,
    borderColor: '#E8F0E9',
  },

  // Submit
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#1a5c2a',
    shadowColor: '#1a5c2a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  submitBtnDisabled: { backgroundColor: '#9bb5a0', shadowOpacity: 0 },
  submitBtnText: { fontSize: 15, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
  submitBtnLocked: {
    backgroundColor: '#dc2626',
    shadowColor: '#dc2626',
  },

  // Proximity & Fencing Card
  proximityCard: {
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 12,
  },
  proximityCardInZone: {
    backgroundColor: '#f0fdf4',
    borderColor: '#86efac',
  },
  proximityCardOutOfZone: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
  },
  proximityCardLoading: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  proximityCardWarn: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  proximityHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  proximityIconWrap: {
    marginTop: 2,
  },
  proximityTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    flexWrap: 'wrap',
  },
  proximityTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  proximityStatusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  proximityStatusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  proximityDesc: {
    fontSize: 12,
    color: '#475569',
    marginTop: 4,
    lineHeight: 16,
  },
  proximityActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#00000010',
  },
  proximityBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#dc2626',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  proximityBtnInZone: {
    backgroundColor: '#16a34a',
  },
  proximityBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  proximityRefreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
  },
  proximityRefreshBtnText: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '600',
  },
  proximityDetachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  proximityDetachBtnInactive: {
    backgroundColor: '#fff7ed',
    borderColor: '#fdba74',
  },
  proximityDetachBtnActive: {
    backgroundColor: '#f0fdf4',
    borderColor: '#86efac',
  },
  proximityDetachBtnText: {
    fontSize: 11,
    fontWeight: '800',
  },
  proximitySyncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#e0f2fe',
    borderWidth: 1,
    borderColor: '#7dd3fc',
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 8,
  },
  proximitySyncBtnText: {
    color: '#0369a1',
    fontSize: 11,
    fontWeight: '800',
  },
  gpsDebugRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 8,
    marginTop: 8,
  },
  gpsCoordBox: {
    flex: 1,
  },
  gpsCoordHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 2,
  },
  gpsCoordLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.4,
  },
  gpsCoordVal: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1e293b',
    fontVariant: ['tabular-nums'],
  },
  gpsAccuracyText: {
    fontSize: 10,
    color: '#94a3b8',
    marginTop: 1,
  },
  gpsCoordDivider: {
    width: 1,
    backgroundColor: '#e2e8f0',
    marginHorizontal: 8,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  liveDotActive: {
    backgroundColor: '#22c55e',
  },
  liveDotInactive: {
    backgroundColor: '#cbd5e1',
  },
});
