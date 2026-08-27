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
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useCamera } from '../../hooks/useCamera';
import { useLocation } from '../../hooks/useLocation';
import { CaptureStackParamList } from '../../types';

type Nav = NativeStackNavigationProp<CaptureStackParamList, 'CaptureCamera'>;

export default function CaptureScreen() {
  const navigation = useNavigation<Nav>();
  const [permission, requestPermission] = useCameraPermissions();
  const { cameraRef, flash, facing, setIsReady, takePicture, toggleFlash, toggleFacing } = useCamera();
  const { requestLocation } = useLocation();
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, []);

  const handleCapture = async () => {
    setCapturing(true);
    try {
      const photoUri = await takePicture();
      if (!photoUri) {
        Alert.alert('Error', 'Failed to capture photo. Please try again.');
        return;
      }

      // Get GPS location simultaneously
      const coords = await requestLocation();

      navigation.navigate('MapPicker', {
        photoUri,
        initialCoords: coords ?? undefined,
      });
    } catch (err) {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setCapturing(false);
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
        <Text style={styles.permText}>📷</Text>
        <Text style={styles.permTitle}>Camera Permission Required</Text>
        <Text style={styles.permSub}>TreeApp needs camera access to photograph trees.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Camera View */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        flash={flash}
        onCameraReady={() => setIsReady(true)}
      >
        {/* Top Controls */}
        <View style={styles.topControls}>
          <TouchableOpacity style={styles.iconBtn} onPress={toggleFlash}>
            <Ionicons
              name={flash === 'on' ? 'flash' : 'flash-off'}
              size={24}
              color="#fff"
            />
          </TouchableOpacity>
          <Text style={styles.cameraTitle}>📸 Capture Tree</Text>
          <TouchableOpacity style={styles.iconBtn} onPress={toggleFacing}>
            <Ionicons name="camera-reverse" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Viewfinder Guide */}
        <View style={styles.viewfinder}>
          <View style={styles.corner} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>

        {/* Bottom Controls */}
        <View style={styles.bottomControls}>
          <Text style={styles.hint}>Position the tree in frame</Text>
          <TouchableOpacity
            style={[styles.captureBtn, capturing && styles.captureBtnDisabled]}
            onPress={handleCapture}
            disabled={capturing}
            activeOpacity={0.8}
          >
            {capturing ? (
              <ActivityIndicator color="#1a5c2a" size="small" />
            ) : (
              <View style={styles.captureBtnInner} />
            )}
          </TouchableOpacity>
          <Text style={styles.gpsHint}>GPS auto-captured 📍</Text>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#f5f5f5',
  },
  permText: { fontSize: 60, marginBottom: 16 },
  permTitle: { fontSize: 20, fontWeight: 'bold', color: '#333', textAlign: 'center' },
  permSub: { fontSize: 14, color: '#666', textAlign: 'center', marginTop: 8, marginBottom: 24 },
  permBtn: {
    backgroundColor: '#1a5c2a',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  permBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  topControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 16,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  viewfinder: {
    flex: 1,
    margin: 40,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: '#fff',
    borderTopWidth: 3,
    borderLeftWidth: 3,
    top: 0,
    left: 0,
  },
  cornerTR: { borderLeftWidth: 0, borderRightWidth: 3, left: undefined, right: 0 },
  cornerBL: { borderTopWidth: 0, borderBottomWidth: 3, top: undefined, bottom: 0 },
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
  bottomControls: {
    alignItems: 'center',
    paddingBottom: 48,
    paddingTop: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    gap: 12,
  },
  hint: { color: '#ddd', fontSize: 13 },
  captureBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  captureBtnDisabled: { opacity: 0.6 },
  captureBtnInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#1a5c2a',
  },
  gpsHint: { color: '#a5d6a7', fontSize: 12 },
});