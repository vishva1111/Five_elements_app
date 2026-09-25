import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
  Dimensions,
  Animated,
  StatusBar,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaptureStackParamList, Project } from '../../types';
import { useAuthStore } from '../../store/authStore';
import { fetchAllProjects } from '../../services/treeService';

type Nav = NativeStackNavigationProp<CaptureStackParamList, 'CaptureCamera'>;

const REQUIRED_PHOTOS = 3;
const { width: SCREEN_W } = Dimensions.get('window');

const SLOT_CONFIG = [
  { label: 'Front View', shortLabel: 'Front', icon: 'leaf' },
  { label: 'Side View', shortLabel: 'Side', icon: 'git-network-outline' },
  { label: 'Close-up', shortLabel: 'Close-up', icon: 'scan-outline' },
];

export default function CaptureScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const { user, activeProjectId } = useAuthStore();
  const [allProjects, setAllProjects] = useState<Project[]>([]);

  // Camera settings
  const cameraRef = useRef<any>(null);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [isCameraReady, setIsCameraReady] = useState(false);

  // 3-photo state: [photo1, photo2, photo3]
  const [photos, setPhotos] = useState<(string | null)[]>([null, null, null]);
  // Currently active slot (0: Front, 1: Side, 2: Close-up)
  const [activeSlot, setActiveSlot] = useState<number>(0);
  const [capturing, setCapturing] = useState(false);

  // Shutter flash animation
  const flashAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, []);

  // Load active project info
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await fetchAllProjects();
      if (active && data) setAllProjects(data);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Flash white screen on snap
  const triggerFlash = () => {
    flashAnim.setValue(1);
    Animated.timing(flashAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  };

  // Capture current active slot
  const handleCapture = async () => {
    if (capturing) return;

    if (!cameraRef.current) {
      Alert.alert('Camera Error', 'Camera is initializing. Please try in a moment.');
      return;
    }

    setCapturing(true);
    try {
      const result = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: false,
      });

      if (!result?.uri) {
        throw new Error('No photo received from camera.');
      }

      triggerFlash();

      const newPhotos = [...photos];
      newPhotos[activeSlot] = result.uri;
      setPhotos(newPhotos);

      // Auto-advance to next empty slot
      const nextEmpty = [0, 1, 2].find((i) => i !== activeSlot && newPhotos[i] === null);
      if (nextEmpty !== undefined) {
        setActiveSlot(nextEmpty);
      }
    } catch (err: any) {
      console.error('[CaptureScreen] capture error:', err);
      Alert.alert('Capture Failed', 'Could not capture photo. Please try again.');
    } finally {
      setCapturing(false);
    }
  };

  const handleSlotPress = (index: number) => {
    setActiveSlot(index);
  };

  const handleRemoveSlotPhoto = (index: number) => {
    setPhotos((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
    setActiveSlot(index);
  };

  // Proceed to MapPicker
  const handleProceed = () => {
    const filledPhotos = photos.filter(Boolean) as string[];
    if (filledPhotos.length < REQUIRED_PHOTOS) {
      Alert.alert(
        '3 Photos Required',
        `Please capture all 3 photos:\n1. Front View\n2. Side View\n3. Close-up`
      );
      return;
    }
    navigation.navigate('MapPicker', { photoUris: filledPhotos });
  };

  const handleResetAll = () => {
    Alert.alert('Retake All Photos?', 'This will clear all 3 captured photos.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Retake All',
        style: 'destructive',
        onPress: () => {
          setPhotos([null, null, null]);
          setActiveSlot(0);
        },
      },
    ]);
  };

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a5c2a" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Ionicons name="camera-outline" size={64} color="#888" />
        <Text style={styles.permTitle}>Camera Permission Required</Text>
        <Text style={styles.permSub}>TreeApp needs camera access to photograph trees in the field.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const activeProject = allProjects.find((p) => p.id === activeProjectId);
  const projectName = activeProject?.name ?? 'Tree Plantation';
  const filledCount = photos.filter(Boolean).length;
  const isAllFilled = filledCount === REQUIRED_PHOTOS;
  const currentConfig = SLOT_CONFIG[activeSlot] || SLOT_CONFIG[0];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f331d" />

      {/* ─── 1. TOP GREEN CONTAINER ─── */}
      <LinearGradient
        colors={['#0f331d', '#155227', '#1a5c2a']}
        style={[styles.topGreenContainer, { paddingTop: Math.max(insets.top, 16) + 8 }]}
      >
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>

        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>FIELD CAPTURE</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {projectName}
          </Text>
        </View>

        {/* Counter Badge */}
        <View style={[styles.counterBadge, isAllFilled && styles.counterBadgeDone]}>
          <Ionicons
            name={isAllFilled ? 'checkmark-circle' : 'camera'}
            size={13}
            color={isAllFilled ? '#fff' : '#86efac'}
          />
          <Text style={[styles.counterBadgeText, isAllFilled && { color: '#fff' }]}>
            {filledCount}/{REQUIRED_PHOTOS}
          </Text>
        </View>
      </LinearGradient>

      {/* ─── 2. DEFINED CAMERA FRAME VIEWPORT (Center) ─── */}
      <View style={styles.cameraViewport}>
        {isFocused && (
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing={facing}
            onCameraReady={() => setIsCameraReady(true)}
          />
        )}

        {/* Shutter flash effect */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.shutterFlash,
            {
              opacity: flashAnim,
            },
          ]}
        />
      </View>

      {/* ─── 3. DOWNSIDE GREEN CONTAINER (Controls & 3 Photo Boxes) ─── */}
      <LinearGradient
        colors={['#1a5c2a', '#12441f', '#0c2e15']}
        style={[styles.bottomGreenContainer, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}
      >
        {/* Active Target Pill */}
        <View style={styles.activeTagRow}>
          <View style={styles.activeTagPill}>
            <Ionicons name={currentConfig.icon as any} size={13} color="#86efac" />
            <Text style={styles.activeTagText}>
              {isAllFilled ? 'All 3 Photos Ready' : `Now Shooting: ${currentConfig.label}`}
            </Text>
          </View>
        </View>

        {/* ─── 3 PHOTO CARDS TRAY ─── */}
        <View style={styles.trayRow}>
          {SLOT_CONFIG.map((cfg, idx) => {
            const uri = photos[idx];
            const isActive = activeSlot === idx;
            const isDone = uri !== null;

            return (
              <TouchableOpacity
                key={idx}
                activeOpacity={0.85}
                onPress={() => handleSlotPress(idx)}
                style={[
                  styles.slotCard,
                  isActive && styles.slotCardActive,
                  isDone && styles.slotCardDone,
                ]}
              >
                {isDone ? (
                  <View style={styles.slotCardFilled}>
                    <Image source={{ uri }} style={styles.slotCardThumb} resizeMode="cover" />
                    <TouchableOpacity
                      style={styles.slotCardRemove}
                      onPress={() => handleRemoveSlotPhoto(idx)}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Ionicons name="close-circle" size={16} color="#ef4444" />
                    </TouchableOpacity>
                    <View style={styles.slotCardBadge}>
                      <Ionicons name="checkmark" size={9} color="#fff" />
                      <Text style={styles.slotCardBadgeText}>{cfg.shortLabel}</Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.slotCardEmpty}>
                    <Ionicons
                      name={cfg.icon as any}
                      size={18}
                      color={isActive ? '#86efac' : 'rgba(255,255,255,0.7)'}
                    />
                    <Text
                      style={[styles.slotCardTitle, isActive && styles.slotCardTitleActive]}
                      numberOfLines={1}
                    >
                      {cfg.shortLabel}
                    </Text>
                    <View
                      style={[
                        styles.slotCardDot,
                        isActive && styles.slotCardDotActive,
                      ]}
                    />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ─── SHUTTER / PROCEED ROW ─── */}
        {isAllFilled ? (
          <View style={styles.proceedWrap}>
            <TouchableOpacity
              style={styles.proceedBtn}
              onPress={handleProceed}
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark-circle" size={22} color="#FFFFFF" />
              <Text style={styles.proceedBtnText}>Confirm Location (3/3)</Text>
              <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.retakeBtn} onPress={handleResetAll} activeOpacity={0.7}>
              <Ionicons name="refresh-outline" size={14} color="#fca5a5" />
              <Text style={styles.retakeBtnText}>Retake All Photos</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.shutterRow}>
            {/* Flip Camera */}
            <TouchableOpacity
              style={styles.flipBtn}
              onPress={() => setFacing((prev) => (prev === 'back' ? 'front' : 'back'))}
              activeOpacity={0.75}
            >
              <Ionicons name="camera-reverse-outline" size={22} color="#fff" />
            </TouchableOpacity>

            {/* Main Shutter Button */}
            <TouchableOpacity
              style={[styles.shutterOuter, capturing && styles.shutterOuterDisabled]}
              onPress={handleCapture}
              disabled={capturing}
              activeOpacity={0.8}
            >
              <View style={styles.shutterMiddle}>
                {capturing ? (
                  <ActivityIndicator size="small" color="#15803d" />
                ) : (
                  <View style={styles.shutterInner} />
                )}
              </View>
            </TouchableOpacity>

            {/* Spacer on right for symmetry */}
            <View style={{ width: 46 }} />
          </View>
        )}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#f0f4f1',
  },
  permTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#333',
    textAlign: 'center',
    marginTop: 16,
  },
  permSub: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  permBtn: {
    backgroundColor: '#1a5c2a',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
  },
  permBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
  },

  // ─── 1. TOP GREEN CONTAINER ───
  topGreenContainer: {
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  headerInfo: {
    flex: 1,
    marginHorizontal: 12,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  headerSubtitle: {
    color: '#86efac',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  counterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#86efac',
  },
  counterBadgeDone: {
    backgroundColor: '#15803d',
    borderColor: '#22c55e',
  },
  counterBadgeText: {
    color: '#86efac',
    fontSize: 12,
    fontWeight: '800',
  },

  // ─── 2. DEFINED CAMERA FRAME VIEWPORT ───
  cameraViewport: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  camera: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  shutterFlash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    zIndex: 99,
  },

  // ─── 3. DOWNSIDE GREEN CONTAINER ───
  bottomGreenContainer: {
    paddingTop: 12,
    paddingBottom: 32,
    paddingHorizontal: 16,
    zIndex: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  activeTagRow: {
    alignItems: 'center',
    marginBottom: 8,
  },
  activeTagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(134, 239, 172, 0.35)',
  },
  activeTagText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  // ─── 3 PHOTO CARDS TRAY ───
  trayRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
    justifyContent: 'center',
  },
  slotCard: {
    flex: 1,
    height: 64,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    overflow: 'hidden',
  },
  slotCardActive: {
    borderColor: '#86efac',
    backgroundColor: 'rgba(134, 239, 172, 0.2)',
    borderWidth: 2,
  },
  slotCardDone: {
    borderColor: '#22c55e',
    backgroundColor: '#000',
  },
  slotCardFilled: {
    flex: 1,
    position: 'relative',
  },
  slotCardThumb: {
    width: '100%',
    height: '100%',
  },
  slotCardRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#fff',
    borderRadius: 8,
  },
  slotCardBadge: {
    position: 'absolute',
    bottom: 2,
    left: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#16a34a',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  slotCardBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
  },
  slotCardEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
    gap: 2,
  },
  slotCardTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: '#cbd5e1',
  },
  slotCardTitleActive: {
    color: '#86efac',
  },
  slotCardDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginTop: 1,
  },
  slotCardDotActive: {
    backgroundColor: '#86efac',
    width: 10,
  },

  // ─── SHUTTER ROW ───
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  flipBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  shutterOuter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 3.5,
    borderColor: '#86efac',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 10,
  },
  shutterOuterDisabled: {
    opacity: 0.5,
  },
  shutterMiddle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#15803d',
    borderWidth: 2,
    borderColor: '#dcfce7',
  },

  // ─── PROCEED WRAP ───
  proceedWrap: {
    width: '100%',
    alignItems: 'center',
    gap: 8,
  },
  proceedBtn: {
    width: '100%',
    height: 52,
    borderRadius: 16,
    backgroundColor: '#16a34a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 8,
    borderWidth: 1.5,
    borderColor: '#86efac',
  },
  proceedBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  retakeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  retakeBtnText: {
    color: '#fca5a5',
    fontSize: 12,
    fontWeight: '700',
  },
});
