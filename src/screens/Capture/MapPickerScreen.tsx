import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import MapView, { Marker, UrlTile, Callout, MapPressEvent } from 'react-native-maps';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { CaptureStackParamList, Coordinates } from '../../types';
import { useLocation } from '../../hooks/useLocation';

type Nav = NativeStackNavigationProp<CaptureStackParamList, 'MapPicker'>;
type Route = RouteProp<CaptureStackParamList, 'MapPicker'>;

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const DEFAULT_COORDS: Coordinates = { latitude: 20.5937, longitude: 78.9629 }; // India center

export default function MapPickerScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { photoUri, initialCoords } = route.params;

  const [coords, setCoords] = useState<Coordinates>(initialCoords ?? DEFAULT_COORDS);
  const [locating, setLocating] = useState(false);
  const mapRef = useRef<MapView>(null);
  const { requestLocation } = useLocation();

  const handleMapPress = (e: MapPressEvent) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setCoords({ latitude, longitude });
  };

  const handleRelocate = async () => {
    setLocating(true);
    const loc = await requestLocation();
    if (loc) {
      setCoords(loc);
      mapRef.current?.animateToRegion({
        latitude: loc.latitude,
        longitude: loc.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      }, 800);
    } else {
      Alert.alert('Location Error', 'Could not get your current location. Please tap on the map to set it manually.');
    }
    setLocating(false);
  };

  const handleConfirm = () => {
    navigation.navigate('TreeForm', { photoUri, coords });
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Confirm Location</Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: coords.latitude,
          longitude: coords.longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        }}
        onPress={handleMapPress}
        mapType="none"
      >
        <UrlTile urlTemplate={OSM_TILE_URL} maximumZ={19} flipY={false} />
        <Marker
          coordinate={{ latitude: coords.latitude, longitude: coords.longitude }}
          draggable
          onDragEnd={(e) => {
            const { latitude, longitude } = e.nativeEvent.coordinate;
            setCoords({ latitude, longitude });
          }}
        >
          <Callout>
            <View>
              <Text>📍 Tree Location</Text>
              <Text>{coords.latitude.toFixed(6)}, {coords.longitude.toFixed(6)}</Text>
            </View>
          </Callout>
        </Marker>
      </MapView>

      {/* Instruction */}
      <View style={styles.instruction}>
        <Text style={styles.instructionText}>
          Tap on map or drag the pin to set exact tree location
        </Text>
      </View>

      {/* Bottom Panel */}
      <View style={styles.bottomPanel}>
        <View style={styles.coordsBox}>
          <Text style={styles.coordsLabel}>Selected Coordinates</Text>
          <Text style={styles.coordsValue}>
            {coords.latitude.toFixed(6)}, {coords.longitude.toFixed(6)}
          </Text>
        </View>

        <View style={styles.btnRow}>
          <TouchableOpacity
            style={styles.relocateBtn}
            onPress={handleRelocate}
            disabled={locating}
          >
            {locating ? (
              <ActivityIndicator color="#1a5c2a" size="small" />
            ) : (
              <Ionicons name="locate" size={20} color="#1a5c2a" />
            )}
            <Text style={styles.relocateBtnText}>My Location</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm}>
            <Text style={styles.confirmBtnText}>Confirm Location</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1a5c2a',
    paddingTop: 48,
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { color: '#fff', fontSize: 19, fontWeight: '700', textTransform: 'uppercase', textAlign: 'center', flex: 1 },
  map: { flex: 1 },
  instruction: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  instructionText: { color: '#fff', fontSize: 12 },
  bottomPanel: {
    backgroundColor: '#fff',
    padding: 20,
    paddingBottom: 36,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    elevation: 8,
  },
  coordsBox: {
    backgroundColor: '#f0fdf4',
    borderRadius: 7.5,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  coordsLabel: { fontSize: 11, color: '#888', marginBottom: 4 },
  coordsValue: { fontSize: 14, fontWeight: '600', color: '#1a5c2a', fontFamily: 'monospace' },
  btnRow: { flexDirection: 'row', gap: 12 },
  relocateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 2,
    borderColor: '#1a5c2a',
    borderRadius: 7.5,
    paddingVertical: 14,
  },
  relocateBtnText: { color: '#1a5c2a', fontWeight: '600', fontSize: 14 },
  confirmBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1a5c2a',
    borderRadius: 7.5,
    paddingVertical: 14,
  },
  confirmBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});