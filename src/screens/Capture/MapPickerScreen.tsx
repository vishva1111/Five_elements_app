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
import * as Location from 'expo-location';
import { CaptureStackParamList, Coordinates } from '../../types';

type Nav = NativeStackNavigationProp<CaptureStackParamList, 'MapPicker'>;
type Route = RouteProp<CaptureStackParamList, 'MapPicker'>;

const DEFAULT_COORDS: Coordinates = { latitude: 21.1458, longitude: 79.0882 };

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
var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([${lat},${lng}],15);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
var marker=L.marker([${lat},${lng}],{draggable:true}).addTo(map);
marker.on('dragend',function(e){
  var p=e.target.getLatLng();
  window.ReactNativeWebView.postMessage(JSON.stringify({lat:p.lat,lng:p.lng,src:'drag'}));
});
map.on('click',function(e){
  marker.setLatLng(e.latlng);
  window.ReactNativeWebView.postMessage(JSON.stringify({lat:e.latlng.lat,lng:e.latlng.lng,src:'tap'}));
});
window.moveTo=function(lat,lng){
  map.setView([lat,lng],18);
  marker.setLatLng([lat,lng]);
};
window.addEventListener('message',function(e){
  try{
    var d=JSON.parse(e.data);
    if(d.action==='move'&&d.lat!==undefined&&d.lng!==undefined){
      window.moveTo(d.lat,d.lng);
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
  const { photoUri } = route.params;

  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [locating, setLocating] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const webViewRef = useRef<WebView>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    requestPermissionAndGetLocation();
    return () => { mountedRef.current = false; };
  }, []);

  const requestPermissionAndGetLocation = async () => {
    if (mountedRef.current) setLocating(true);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        if (mountedRef.current) {
          setHasPermission(false);
          setLocating(false);
        }
        return;
      }

      if (mountedRef.current) setHasPermission(true);

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const result: Coordinates = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy ?? undefined,
      };

      if (mountedRef.current) {
        setCoords(result);
        setLocating(false);
      }

      webViewRef.current?.postMessage(
        JSON.stringify({ action: 'move', lat: result.latitude, lng: result.longitude })
      );
    } catch (err) {
      if (mountedRef.current) setLocating(false);
    }
  };

  const handleRelocate = async () => {
    if (locating) return;
    setLocating(true);

    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        const { status: newStatus } = await Location.requestForegroundPermissionsAsync();
        if (newStatus !== 'granted') {
          setHasPermission(false);
          setLocating(false);
          Alert.alert(
            'Location Permission',
            'Please enable location permission in device Settings > Apps > Five Elements > Permissions > Location.',
          );
          return;
        }
      }

      setHasPermission(true);

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const result: Coordinates = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy ?? undefined,
      };

      setCoords(result);
      setLocating(false);

      webViewRef.current?.postMessage(
        JSON.stringify({ action: 'move', lat: result.latitude, lng: result.longitude })
      );
    } catch (err) {
      setLocating(false);
      Alert.alert(
        'GPS Error',
        'Could not get your location. Please make sure GPS is turned on in device settings and try again.',
      );
    }
  };

  const handleWebViewMessage = useCallback((event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.lat !== undefined && data.lng !== undefined) {
        setCoords({ latitude: data.lat, longitude: data.lng });
      }
    } catch {}
  }, []);

  const handleConfirm = () => {
    if (!coords) {
      Alert.alert('Location Required', 'Tap "My Location" or tap on the map first.');
      return;
    }
    navigation.navigate('TreeForm', { photoUri, coords });
  };

  const mapCoords = coords ?? DEFAULT_COORDS;

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#123f24', '#1a5c2a', '#2e7d43']} style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Confirm Location</Text>
        <View style={{ width: 44 }} />
      </LinearGradient>

      <WebView
        ref={webViewRef}
        source={{ html: buildMapHtml(mapCoords.latitude, mapCoords.longitude) }}
        style={styles.map}
        onMessage={handleWebViewMessage}
        javaScriptEnabled={true}
      />

      <View style={styles.bottomPanel}>
        <View style={styles.coordsBox}>
          <Text style={styles.coordsLabel}>Selected Coordinates</Text>
          <Text style={styles.coordsValue}>
            {coords
              ? `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`
              : 'Tap "My Location" or tap on map'}
          </Text>
          {coords?.accuracy && (
            <Text style={styles.accuracyText}>Accuracy: ~{Math.round(coords.accuracy)}m</Text>
          )}
        </View>

        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.relocateBtn, locating && styles.btnDisabled]}
            onPress={handleRelocate}
            disabled={locating}
          >
            {locating ? (
              <ActivityIndicator color="#1a5c2a" size="small" />
            ) : (
              <Ionicons name="locate" size={20} color="#1a5c2a" />
            )}
            <Text style={styles.relocateBtnText}>
              {locating ? 'Locating...' : 'My Location'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.confirmBtn, !coords && styles.btnDisabled]}
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
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#fff', fontSize: 19, fontWeight: '700', textTransform: 'uppercase', textAlign: 'center', flex: 1 },
  map: { flex: 1 },
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
  btnDisabled: { opacity: 0.5 },
});
