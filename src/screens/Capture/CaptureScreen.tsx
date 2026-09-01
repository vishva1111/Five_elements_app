import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Dimensions,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons, Feather } from '@expo/vector-icons';
import { useCamera } from '../../hooks/useCamera';
import { useLocation } from '../../hooks/useLocation';
import { CaptureStackParamList } from '../../types';
import { useAuthStore } from '../../store/authStore';

type Nav = NativeStackNavigationProp<CaptureStackParamList, 'CaptureCamera'>;

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function CaptureScreen() {
  const navigation = useNavigation<Nav>();
  const [permission, requestPermission] = useCameraPermissions();
  const { cameraRef, flash, facing, setIsReady, takePicture, toggleFlash, toggleFacing } = useCamera();
  const { coords, loading: gpsLoading, requestLocation } = useLocation();
  const { user, assignedProjects } = useAuthStore();
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

  // Get assigned project name
  const projectName = assignedProjects.length > 0 ? assignedProjects[0].name : 'No project assigned';

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
        <TouchableOpacity style={styles.syncBtn}>
          <Ionicons name="cloud-upload-outline" size={18} color="#AACBA7" />
          <Text style={styles.syncBtnText}>0 waiting</Text>
        </TouchableOpacity>
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
            <ActivityIndicator color="#2B5341" size="small" />
          ) : (
            <View style={styles.shutterBtnInner} />
          )}
        </TouchableOpacity>

        {/* Flash + Flip Buttons */}
        <View style={styles.sideButtons}>
          <TouchableOpacity style={styles.sideBtn} onPress={toggleFlash}>
            <Ionicons
              name={flash === 'on' ? 'flash' : 'flash-off'}
              size={20}
              color="#fff"
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
    borderRadius: 12,
  },
  permBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  // Header
  header: {
    backgroundColor: '#2B5341',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
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
    borderRadius: 18,
    backgroundColor: 'rgba(170, 203, 167, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: '#AACBA7',
    fontSize: 11,
    marginTop: 2,
  },
  syncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#112121',
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 20,
  },
  syncBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
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
    borderRadius: 20,
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
    borderRadius: 5,
    backgroundColor: '#6B7B6E',
  },
  gpsDotGood: {
    backgroundColor: '#2B5341',
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
    borderRadius: 8,
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
    backgroundColor: '#112121',
  },
  galleryBtn: {
    width: 52,
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
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
    borderRadius: 28,
    borderWidth: 2.5,
    borderColor: '#2B5341',
  },
  sideButtons: {
    alignItems: 'center',
    gap: 10,
  },
  sideBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Hint Bar
  hintBar: {
    backgroundColor: '#112121',
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
