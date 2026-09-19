import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCamera } from '../../hooks/useCamera';
import { CaptureStackParamList, Project } from '../../types';
import { useAuthStore } from '../../store/authStore';
import { fetchAllProjects } from '../../services/treeService';

type Nav = NativeStackNavigationProp<CaptureStackParamList, 'CaptureCamera'>;

export default function CaptureScreen() {
  const navigation = useNavigation<Nav>();
  const [permission, requestPermission] = useCameraPermissions();
  const { cameraRef, flash, facing, setIsReady, takePicture, toggleFlash, toggleFacing } = useCamera();
  const { user, activeProjectId } = useAuthStore();
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [mediaPermission, setMediaPermission] = useState(false);

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, []);

  // Load ALL projects so the header can show the ACTIVE project's name —
  // matching the dashboard (which lists every project, not just assigned ones).
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

  const handleCapture = async () => {
    setCapturing(true);
    try {
      const photoUri = await takePicture();
      if (!photoUri) {
        Alert.alert('Error', 'Failed to capture photo. Please try again.');
        return;
      }

      navigation.navigate('MapPicker', {
        photoUri,
      });
    } catch (err) {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setCapturing(false);
    }
  };

  const handleGallery = async () => {
    // Request media library permission
    if (!mediaPermission) {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant access to your photo library in settings.');
        return;
      }
      setMediaPermission(true);
    }

    // Open image picker
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const photoUri = result.assets[0].uri;

      navigation.navigate('MapPicker', {
        photoUri,
      });
    }
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
        <Text style={styles.permSub}>TreeApp needs camera access to photograph trees.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Show the ACTIVE project in the header — the one the user is currently working in
  const activeProject = allProjects.find((p) => p.id === activeProjectId);
  const projectName =
    allProjects.length === 0
      ? 'No project available'
      : activeProject?.name ?? 'Select a project';

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient colors={['#123f24', '#1a5c2a', '#2e7d43']} style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.pentagon}>
            <Ionicons name="leaf" size={20} color="#AACBA7" />
          </View>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Field capture</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>{projectName}</Text>
          </View>
        </View>
      </LinearGradient>

      {/* Camera View */}
      <View style={styles.cameraContainer}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing={facing}
          flash={flash}
          onCameraReady={() => setIsReady(true)}
        />

        {/* Overlay on top of camera */}
        <View style={styles.cameraOverlay}>
          {/* Viewfinder Corners */}
          <View style={styles.viewfinder}>
            <View style={styles.corner} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
        </View>
      </View>

      {/* Capture Row */}
      <View style={styles.captureRow}>
        {/* Gallery Button */}
        <TouchableOpacity style={styles.galleryBtn} onPress={handleGallery}>
          <Ionicons name="images-outline" size={24} color="#fff" />
        </TouchableOpacity>

        {/* Shutter Button */}
        <TouchableOpacity
          style={[styles.shutterBtn, capturing && styles.shutterBtnDisabled]}
          onPress={handleCapture}
          disabled={capturing}
          activeOpacity={0.8}
        >
          {capturing ? (
            <ActivityIndicator color="#1a5c2a" size="small" />
          ) : (
            <View style={styles.shutterBtnInner} />
          )}
        </TouchableOpacity>

        {/* Flash + Flip Buttons */}
        <View style={styles.sideButtons}>
          <TouchableOpacity
            style={[styles.sideBtn, flash === 'on' && styles.sideBtnActive]}
            onPress={toggleFlash}
            activeOpacity={0.7}
          >
            <Ionicons
              name={flash === 'on' ? 'flash' : 'flash-off'}
              size={20}
              color={flash === 'on' ? '#F09125' : '#fff'}
            />
          </TouchableOpacity>
          <TouchableOpacity style={styles.sideBtn} onPress={toggleFacing}>
            <Ionicons name="camera-reverse" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Hint */}
      <View style={styles.hintBar}>
        <Text style={styles.hintText}>Position the tree in frame</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D1A17',
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
    letterSpacing: 0.3,
  },
  permSub: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
    letterSpacing: 0.2,
  },
  permBtn: {
    backgroundColor: '#1a5c2a',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: '#1a5c2a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  permBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.5,
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
    paddingTop: 48,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  pentagon: {
    width: 36,
    height: 36,
    borderRadius: 14,
    backgroundColor: 'rgba(170, 203, 167, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  headerSubtitle: {
    color: '#AACBA7',
    fontSize: 11,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  // Camera
  cameraContainer: {
    flex: 1,
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
  },
  // GPS Chip
  gpsChip: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EAF3DE',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  gpsChipGood: {
    backgroundColor: '#EAF3DE',
  },
  gpsChipBad: {
    backgroundColor: '#FEF0E3',
  },
  gpsChipWarn: {
    backgroundColor: '#FEF0E3',
  },
  gpsDot: {
    width: 9,
    height: 9,
    borderRadius: 14,
    backgroundColor: '#6B7B6E',
  },
  gpsDotGood: {
    backgroundColor: '#1a5c2a',
  },
  gpsDotPulse: {
    backgroundColor: '#6B7B6E',
    opacity: 0.5,
  },
  gpsText: {
    color: '#27500A',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  // Viewfinder
  viewfinder: {
    flex: 1,
    margin: 40,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderColor: 'rgba(255,255,255,0.85)',
    borderTopWidth: 3,
    borderLeftWidth: 3,
    top: 0,
    left: 0,
  },
  cornerTR: {
    borderLeftWidth: 0,
    borderRightWidth: 3,
    left: undefined,
    right: 0,
  },
  cornerBL: {
    borderTopWidth: 0,
    borderBottomWidth: 3,
    top: undefined,
    bottom: 0,
  },
  cornerBR: {
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    top: undefined,
    left: undefined,
    bottom: 0,
    right: 0,
  },
  // Coordinates Overlay
  coordsOverlay: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  coordsText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 16,
    letterSpacing: 0.4,
  },
  timestampText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 2,
    letterSpacing: 0.3,
  },
  // Capture Row
  captureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingVertical: 14,
    backgroundColor: '#1a5c2a',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 10,
  },
  galleryBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  shutterBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 5,
    borderColor: '#AACBA7',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 12,
  },
  shutterBtnDisabled: {
    backgroundColor: '#6B7B6E',
  },
  shutterBtnInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2.5,
    borderColor: '#1a5c2a',
  },
  sideButtons: {
    alignItems: 'center',
    gap: 10,
  },
  sideBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  sideBtnActive: {
    backgroundColor: 'rgba(240,145,37,0.35)',
  },
  // Hint Bar
  hintBar: {
    backgroundColor: '#1a5c2a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingBottom: 24,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  hintText: {
    color: '#ddd',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  gpsHintText: {
    color: '#AACBA7',
    fontSize: 12,
    letterSpacing: 0.2,
  },
});
