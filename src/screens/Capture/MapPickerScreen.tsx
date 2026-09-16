import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { CaptureStackParamList, Coordinates } from '../../types';
import { useLocation } from '../../hooks/useLocation';

type Nav = NativeStackNavigationProp<CaptureStackParamList, 'MapPicker'>;
type Route = RouteProp<CaptureStackParamList, 'MapPicker'>;

function buildMapHtml(lat: number, lng: number): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
html,body,#map{margin:0;padding:0;width:100%;height:100%;}
.leaflet-container{cursor:crosshair !important;}
</style>
</head>
<body>
<div id="map"></div>
<script>
var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([${lat},${lng}],17);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
var marker=L.marker([${lat},${lng}],{draggable:true}).addTo(map);
marker.on('dragend',function(e){
  var p=e.target.getLatLng();
  window.ReactNativeWebView.postMessage(JSON.stringify({lat:p.lat,lng:p.lng}));
});
map.on('click',function(e){
  marker.setLatLng(e.latlng);
  window.ReactNativeWebView.postMessage(JSON.stringify({lat:e.latlng.lat,lng:e.latlng.lng}));
});
window.setMarkerPosition=function(lat,lng){
  map.setView([lat,lng],17);
  marker.setLatLng([lat,lng]);
};
window.addEventListener('message',function(e){
  try{
    var d=JSON.parse(e.data);
    if(d.action==='setMarker'&&d.lat!==undefined&&d.lng!==undefined){
      window.setMarkerPosition(d.lat,d.lng);
    }
  }catch(err){}
});
</script>
</body>
</html>`;
}

export default function MapPickerScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { photoUri, initialCoords } = route.params;
  const [coords, setCoords] = useState<Coordinates | null>(initialCoords ?? null);
  const [gpsReady, setGpsReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const { requestLocation } = useLocation();

  // Auto-acquire GPS on mount — this ensures the map always opens at the real location
  useEffect(() => {
    let cancelled = false;

    const acquireGps = async () => {
      // If we already have good coords from the capture screen, use them
      if (initialCoords && initialCoords.accuracy && initialCoords.accuracy < 30) {
        setCoords(initialCoords);
        setGpsReady(true);
        return;
      }

      // Otherwise, request fresh GPS
      setLocating(true);
      try {
        const loc = await requestLocation();
        if (!cancelled && loc) {
          setCoords(loc);
          setGpsReady(true);
          // Move the marker on the map if WebView is already mounted
          webViewRef.current?.postMessage(
            JSON.stringify({ action: 'setMarker', lat: loc.latitude, lng: loc.longitude })
          );
        } else if (!cancelled) {
          // GPS failed — use fallback but mark as ready so user can proceed
          setCoords((prev) => prev ?? { latitude: 20.5937, longitude: 78.9629 });
          setGpsReady(true);
        }
      } catch {
        if (!cancelled) {
          setCoords((prev) => prev ?? { latitude: 20.5937, longitude: 78.9629 });
          setGpsReady(true);
        }
      } finally {
        if (!cancelled) setLocating(false);
      }
    };

    acquireGps();
    return () => { cancelled = true; };
  }, []);

  const handleWebViewMessage = useCallback((event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.lat !== undefined && data.lng !== undefined) {
        setCoords({ latitude: data.lat, longitude: data.lng });
      }
    } catch {}
  }, []);

  const handleRelocate = async () => {
    setLocating(true);
    const loc = await requestLocation();
    if (loc) {
      setCoords(loc);
      webViewRef.current?.postMessage(
        JSON.stringify({ action: 'setMarker', lat: loc.latitude, lng: loc.longitude })
      );
    } else {
      Alert.alert('Location Error', 'Could not get your current location. Please tap on the map to set it manually.');
    }
    setLocating(false);
  };

  const handleConfirm = () => {
    if (!coords) {
      Alert.alert('Wait', 'Getting your location...');
      return;
    }
    navigation.navigate('TreeForm', { photoUri, coords });
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#123f24', '#1a5c2a', '#2e7d43']} style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Confirm Location</Text>
        <View style={{ width: 44 }} />
      </LinearGradient>

      {/* Map — only render once we have coordinates */}
      {coords ? (
        <WebView
          ref={webViewRef}
          source={{ html: buildMapHtml(coords.latitude, coords.longitude) }}
          style={styles.map}
          onMessage={handleWebViewMessage}
          javaScriptEnabled={true}
        />
      ) : (
        <View style={[styles.map, styles.mapLoading]}>
          <ActivityIndicator size="large" color="#1a5c2a" />
          <Text style={styles.mapLoadingText}>Acquiring GPS location...</Text>
        </View>
      )}

      {/* GPS acquiring overlay */}
      {locating && (
        <View style={styles.gpsOverlay}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.gpsOverlayText}>Getting your location...</Text>
        </View>
      )}

      <View style={styles.instruction}>
        <Text style={styles.instructionText}>
          Tap on map or drag the pin to set exact tree location
        </Text>
      </View>

      <View style={styles.bottomPanel}>
        <View style={styles.coordsBox}>
          <Text style={styles.coordsLabel}>Selected Coordinates</Text>
          <Text style={styles.coordsValue}>
            {coords ? `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}` : 'Waiting for GPS...'}
          </Text>
          {coords?.accuracy !== undefined && (
            <Text style={styles.accuracyText}>GPS accuracy: ±{coords.accuracy.toFixed(0)}m</Text>
          )}
        </View>

        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.relocateBtn, locating && styles.relocateBtnDisabled]}
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

          <TouchableOpacity
            style={[styles.confirmBtn, !coords && styles.confirmBtnDisabled]}
            onPress={handleConfirm}
            disabled={!coords}
          >
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
  mapLoading: {
    backgroundColor: '#e8f5e9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapLoadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#1a5c2a',
    fontWeight: '600',
  },
  gpsOverlay: {
    position: 'absolute',
    top: 110,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(26,92,42,0.9)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  gpsOverlayText: { color: '#fff', fontSize: 13, fontWeight: '600' },
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
  accuracyText: { fontSize: 11, color: '#888', marginTop: 4 },
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
  relocateBtnDisabled: { opacity: 0.6 },
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
  confirmBtnDisabled: { backgroundColor: '#aaa' },
  confirmBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
