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
import { useCamera } from '../../hooks/useCamera';
import { useLocation } from '../../hooks/useLocation';
import { CaptureStackParamList, Project } from '../../types';
import { useAuthStore } from '../../store/authStore';
import { fetchAllProjects } from '../../services/treeService';

type Nav = NativeStackNavigationProp<CaptureStackParamList, 'CaptureCamera'>;

export default function CaptureScreen() {
  const navigation = useNavigation<Nav>();
  const [permission, requestPermission] = useCameraPermissions();
  const { cameraRef, flash, facing, setIsReady, takePicture, toggleFlash, toggleFacing } = useCamera();
  const { coords, requestLocation } = useLocation();
  const { user, activeProjectId } = useAuthStore();
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<'acquiring' | 'good' | 'unavailable'>('acquiring');
  const [mediaPermission, setMediaPermission] = useState(false);

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
    // Start GPS acquisition
    requestLocation().then((result) => {
      setGpsStatus(result ? 'good' : 'unavailable');
    });
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

  useEffect(() => {
    if (coords) {
      setGpsStatus('good');
    }
  }, [coords]);

  const handleCapture = async () => {
    setCapturing(true);
    try {
      const photoUri = await takePicture();
      if (!photoUri) {
        Alert.alert('Error', 'Failed to capture photo. Please try again.');
        return;
      }

      // Get GPS location (use existing or request new)
      let currentCoords = coords;
      if (!currentCoords) {
        currentCoords = await requestLocation();
      }

      navigation.navigate('MapPicker', {
        photoUri,
        initialCoords: currentCoords ?? undefined,
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

      // Get GPS location for the gallery image
      let currentCoords = coords;
      if (!currentCoords) {
        currentCoords = await requestLocation();
      }

      navigation.navigate('MapPicker', {
        photoUri,
        initialCoords: currentCoords ?? undefined,
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

  const formatCoords = () => {
    if (!coords) return 'Acquiring location...';
    const lat = coords.latitude.toFixed(4);
    const lng = coords.longitude.toFixed(4);
    return `${lat}° N, ${lng}° E`;
  };

  const formatTimestamp = () => {
    const now = new Date();
    const date = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    return `${date} · ${time}`;
  };

  // Show the ACTIVE project in the header — the one the user is currently working in
  const activeProject = allProjects.find((p) => p.id === activeProjectId);
  const projectName =
    allProjects.length === 0
      ? 'No project available'
      : activeProject?.name ?? 'Select a project';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.pentagon}>
            <Ionicons name="leaf" size={20} color="#AACBA7" />
          </View>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Field capture</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>{projectName}</Text>
          </View>
        </View>
      </View>

      {/* Camera View */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        flash={flash}
        onCameraReady={() => setIsReady(true)}
      >
        {/* GPS Chip */}
        <View style={[styles.gpsChip, gpsStatus === 'good' && styles.gpsChipGood, gpsStatus === 'unavailable' && styles.gpsChipBad]}>
          <View style={[styles.gpsDot, gpsStatus === 'good' && styles.gpsDotGood, gpsStatus === 'acquiring' && styles.gpsDotPulse]} />
          <Text style={styles.gpsText}>
            {gpsStatus === 'acquiring' ? 'Getting your location...' :
             gpsStatus === 'good' ? `GPS ±${coords?.accuracy?.toFixed(0) ?? '?'} m · Good fix` :
             'No GPS signal'}
          </Text>
        </View>

        {/* Viewfinder Corners */}
        <View style={styles.viewfinder}>
          <View style={styles.corner} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>

        {/* Coordinates + Timestamp */}
        {coords && (
          <View style={styles.coordsOverlay}>
            <Text style={styles.coordsText}>{formatCoords()}</Text>
            <Text style={styles.timestampText}>{formatTimestamp()}</Text>
          </View>
        )}
      </CameraView>

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
        <Text style={styles.gpsHintText}>GPS auto-captured</Text>
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
    backgroundColor: '#f5f5f5',
  },
  permTitle: {
    fontSize: 20,
    fontWeight: 'bold',
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
    borderRadius: 7.5,
  },
  permBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  // Header
  header: {
    backgroundColor: '#1a5c2a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
    paddingTop: 48,
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
    borderRadius: 7.5,
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
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  headerSubtitle: {
    color: '#AACBA7',
    fontSize: 11,
    marginTop: 2,
  },
  // Camera
  camera: {
    flex: 1,
    position: 'relative',
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
    borderRadius: 7.5,
    zIndex: 10,
  },
  gpsChipGood: {
    backgroundColor: '#EAF3DE',
  },
  gpsChipBad: {
    backgroundColor: '#FEF0E3',
  },
  gpsDot: {
    width: 9,
    height: 9,
    borderRadius: 7.5,
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
    fontWeight: '700',
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
    borderRadius: 7.5,
  },
  coordsText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  timestampText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  // Capture Row
  captureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingVertical: 14,
    backgroundColor: '#1a5c2a',
  },
  galleryBtn: {
    width: 52,
    height: 52,
    borderRadius: 7.5,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterBtn: {
    width: 76,
    height: 76,
    borderRadius: 7.5,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 5,
    borderColor: '#AACBA7',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  shutterBtnDisabled: {
    backgroundColor: '#6B7B6E',
  },
  shutterBtnInner: {
    width: 56,
    height: 56,
    borderRadius: 7.5,
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
    borderRadius: 7.5,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
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
    paddingHorizontal: 22,
    paddingBottom: 20,
    paddingTop: 8,
  },
  hintText: {
    color: '#ddd',
    fontSize: 13,
  },
  gpsHintText: {
    color: '#AACBA7',
    fontSize: 12,
  },
});
