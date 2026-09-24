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
import { recordTreeLocation, ACCURACY_THRESHOLD_M, COLLECTION_WINDOW_MS, MIN_VALID_READINGS } from '../../services/treeLocationService';
import {
  getMapboxToken,
  MAPBOX_GL_JS_CDN,
  MAPBOX_GL_CSS_CDN,
  DEFAULT_STYLE,
} from '../../services/mapboxConfig';

type Nav = NativeStackNavigationProp<CaptureStackParamList, 'MapPicker'>;
type Route = RouteProp<CaptureStackParamList, 'MapPicker'>;

const DEFAULT_COORDS: Coordinates = { latitude: 21.1458, longitude: 79.0882 };

function buildMapHtml(lat: number, lng: number): string {
  const token = getMapboxToken();
  if (!token) {
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
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="${MAPBOX_GL_CSS_CDN}"/>
<script src="${MAPBOX_GL_JS_CDN}"></script>
<style>
html,body,#map{margin:0;padding:0;width:100%;height:100%;}
.mapboxgl-ctrl-bottom-left,.mapboxgl-ctrl-bottom-right{display:none !important;}
</style>
</head>
<body>
<div id="map"></div>
<script>
mapboxgl.accessToken='${token}';
function post(msg){try{window.ReactNativeWebView.postMessage(JSON.stringify(msg));}catch(e){}}
var map=new mapboxgl.Map({
  container:'map',
  style:'${DEFAULT_STYLE}',
  center:[${lng},${lat}],
  zoom:15,
  renderWorldCopies:false,
  maxPitch:60,
  fadeDuration:0
});
map.addControl(new mapboxgl.NavigationControl({showCompass:false}),'bottom-right');
var marker=new mapboxgl.Marker({draggable:true,color:'#1a5c2a'})
  .setLngLat([${lng},${lat}])
  .addTo(map);
marker.on('dragend',function(){
  var lngLat=marker.getLngLat();
  post({lat:lngLat.lat,lng:lngLat.lng,src:'drag'});
});
map.on('click',function(e){
  marker.setLngLat(e.lngLat);
  post({lat:e.lngLat.lat,lng:e.lngLat.lng,src:'tap'});
});
window.moveTo=function(lat,lng){
  map.jumpTo({center:[lng,lat],zoom:18});
  marker.setLngLat([lng,lat]);
};
window.addEventListener('message',function(e){
  try{
    var d=JSON.parse(e.data);
    if(d.action==='move'&&d.lat!==undefined&&d.lng!==undefined){
      window.moveTo(d.lat,d.lng);
    }
  }catch(err){}
});
map.on('load',function(){post({type:'ready'});});
</script>
</body>
</html>`;
}

export default function MapPickerScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { photoUris } = route.params;

  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [progress, setProgress] = useState('');
  const [gnssError, setGnssError] = useState<string | null>(null);
  const [resultAccuracy, setResultAccuracy] = useState<number | null>(null);
  const [resultSamples, setResultSamples] = useState(0);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const webViewRef = useRef<WebView>(null);
  const mountedRef = useRef(true);

  // ── Auto-start GNSS capture on mount ───────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    startGNSSCapture();
    return () => { mountedRef.current = false; };
  }, []);

  const startGNSSCapture = useCallback(async () => {
    if (!mountedRef.current) return;
    setCapturing(true);
    setGnssError(null);
    setResultAccuracy(null);
    setResultSamples(0);
    setProgress('Requesting location permission…');

    try {
      const point = await recordTreeLocation((text) => {
        if (mountedRef.current) setProgress(text);
      });

      if (!mountedRef.current) return;

      const result: Coordinates = {
        latitude: point.latitude,
        longitude: point.longitude,
        accuracy: point.accuracy,
      };

      setCoords(result);
      setResultAccuracy(point.accuracy);
      setResultSamples(point.sampleCount);
      setCapturing(false);
      setProgress('');

      webViewRef.current?.postMessage(
        JSON.stringify({ action: 'move', lat: point.latitude, lng: point.longitude })
      );
    } catch (err: any) {
      if (!mountedRef.current) return;
      const msg = err?.message ?? 'GNSS capture failed';
      setGnssError(msg);
      setCapturing(false);
      setProgress('');
    }
  }, []);

  const handleRetake = useCallback(() => {
    setCoords(null);
    setResultAccuracy(null);
    setResultSamples(0);
    setGnssError(null);
    startGNSSCapture();
  }, [startGNSSCapture]);

  const startGPSFallback = useCallback(async () => {
    if (!mountedRef.current) return;
    setCapturing(true);
    setGnssError(null);
    setResultAccuracy(null);
    setResultSamples(0);
    setProgress('Fetching GPS location…');

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Location permission denied');
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });

      if (!mountedRef.current) return;

      const result: Coordinates = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy ?? undefined,
      };

      setCoords(result);
      setResultAccuracy(location.coords.accuracy ?? null);
      setResultSamples(0);
      setCapturing(false);
      setProgress('');

      webViewRef.current?.postMessage(
        JSON.stringify({ action: 'move', lat: result.latitude, lng: result.longitude })
      );
    } catch (err: any) {
      if (!mountedRef.current) return;
      setGnssError(err?.message ?? 'GPS fetch failed');
      setCapturing(false);
      setProgress('');
    }
  }, []);

  const handleWebViewMessage = useCallback((event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.lat !== undefined && data.lng !== undefined) {
        setCoords({ latitude: data.lat, longitude: data.lng, accuracy: resultAccuracy ?? undefined });
        setResultAccuracy(null);
        setResultSamples(0);
      }
    } catch {}
  }, [resultAccuracy]);

  const handleConfirm = () => {
    if (!coords) {
      Alert.alert('Location Required', 'Wait for GNSS/GPS capture to finish or tap on the map.');
      return;
    }
    navigation.navigate('TreeForm', { photoUris, coords });
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
        {/* Live capture progress */}
        {capturing && (
          <View style={styles.progressBox}>
            <ActivityIndicator color="#1a5c2a" size="small" />
            <Text style={styles.progressText}>{progress}</Text>
          </View>
        )}

        {/* GNSS error */}
        {gnssError && !capturing && (
          <View style={styles.errorBox}>
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={18} color="#ef4444" />
              <Text style={styles.errorText}>{gnssError}</Text>
            </View>
            <View style={styles.errorActions}>
              <TouchableOpacity style={styles.retryBtn} onPress={handleRetake} activeOpacity={0.7}>
                <Ionicons name="refresh" size={14} color="#1a5c2a" />
                <Text style={styles.retryBtnText}>Retry GNSS</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.gpsFallbackBtn} onPress={startGPSFallback} activeOpacity={0.7}>
                <Ionicons name="navigate" size={14} color="#fff" />
                <Text style={styles.gpsFallbackText}>Use GPS</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Coordinates + accuracy display */}
        <View style={styles.coordsBox}>
          <Text style={styles.coordsLabel}>Selected Coordinates</Text>
          <Text style={styles.coordsValue}>
            {coords
              ? `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`
              : 'Starting GNSS capture… (tap map to set manually)'}
          </Text>
          {resultAccuracy !== null && (
            <View style={styles.accuracyRow}>
              <Ionicons name="checkmark-circle" size={14} color="#22c55e" />
              <Text style={styles.accuracyGood}>
                GNSS accuracy: ±{resultAccuracy.toFixed(1)}m ({resultSamples} samples)
              </Text>
            </View>
          )}
          {coords?.accuracy != null && resultAccuracy === null && (
            <Text style={styles.accuracyText}>
              Accuracy: ~{Math.round(coords.accuracy)}m (drag map to adjust)
            </Text>
          )}
        </View>

        {/* Action buttons */}
        <View style={styles.btnRow}>
          {capturing ? (
            <View style={[styles.confirmBtn, styles.btnDisabled]}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.confirmBtnText}>Capturing…</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.confirmBtn, !coords && styles.btnDisabled]}
              onPress={handleConfirm}
              disabled={!coords}
            >
              <Text style={styles.confirmBtnText}>Confirm Location</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </TouchableOpacity>
          )}

          {!capturing && (
            <TouchableOpacity style={styles.retakeBtn} onPress={handleRetake}>
              <Ionicons name="refresh" size={18} color="#1a5c2a" />
              <Text style={styles.retakeBtnText}>Recapture</Text>
            </TouchableOpacity>
          )}
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
  headerTitle: { color: '#fff', fontSize: 19, fontWeight: '800', textTransform: 'uppercase', textAlign: 'center', flex: 1, letterSpacing: 0.5 },
  map: { flex: 1 },
  bottomPanel: {
    backgroundColor: '#fff',
    padding: 20,
    paddingBottom: 36,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
  },
  progressBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f0fdf4',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  progressText: { fontSize: 13, fontWeight: '600', color: '#1a5c2a', flex: 1 },
  errorBox: {
    backgroundColor: '#FEF0E3',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#fde047',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  errorText: { fontSize: 13, fontWeight: '500', color: '#ef4444', flex: 1 },
  errorActions: {
    flexDirection: 'row',
    gap: 8,
  },
  retryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: '#1a5c2a',
    borderRadius: 10,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  retryBtnText: { fontSize: 13, fontWeight: '700', color: '#1a5c2a' },
  gpsFallbackBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F09125',
    borderRadius: 10,
    paddingVertical: 10,
  },
  gpsFallbackText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  coordsBox: {
    backgroundColor: '#f0fdf4',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  coordsLabel: { fontSize: 11, color: '#888', marginBottom: 4, fontWeight: '600' },
  coordsValue: { fontSize: 14, fontWeight: '700', color: '#1a5c2a', fontFamily: 'monospace' },
  accuracyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  accuracyGood: { fontSize: 12, fontWeight: '700', color: '#22c55e' },
  accuracyText: { fontSize: 11, color: '#888', marginTop: 4 },
  btnRow: { flexDirection: 'row', gap: 12 },
  confirmBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1a5c2a',
    borderRadius: 14,
    paddingVertical: 15,
    elevation: 4,
    shadowColor: '#1a5c2a',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  confirmBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  retakeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 2,
    borderColor: '#1a5c2a',
    borderRadius: 14,
    paddingVertical: 15,
  },
  retakeBtnText: { color: '#1a5c2a', fontWeight: '700', fontSize: 14 },
  btnDisabled: { opacity: 0.5 },
});
