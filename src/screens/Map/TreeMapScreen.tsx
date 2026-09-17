import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  Animated,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTreeStore } from '../../store/treeStore';
import { fetchTreesByProject, fetchAllProjects, lockTree } from '../../services/treeService';
import { useAuthStore } from '../../store/authStore';
import { useGeofencing } from '../../hooks/useGeofencing';
import { TreeRecord, GeofenceAlert, Project } from '../../types';
import * as Location from 'expo-location';
import {
  getMapboxToken,
  MAPBOX_GL_JS_CDN,
  MAPBOX_GL_CSS_CDN,
  DEFAULT_STYLE,
} from '../../services/mapboxConfig';

type Nav = NativeStackNavigationProp<any>;
type Route = RouteProp<{ Map: { focusTreeId?: string } }, 'Map'>;

// ─── Condition color map ─────────────────────────────────────────────────────
const CONDITION_COLORS: Record<string, string> = {
  Healthy: '#22c55e',
  Stressed: '#f59e0b',
  Diseased: '#ef4444',
  Dead: '#6b7280',
};

// ─── Build map HTML with tree markers ────────────────────────────────────────
function buildMapHtml(
  trees: TreeRecord[],
  userLat: number,
  userLng: number,
  focusTreeId?: string
): string {
  const token = getMapboxToken();
  const focusTree = focusTreeId ? trees.find((t) => t.id === focusTreeId) : null;
  const centerLat = focusTree?.latitude ?? userLat;
  const centerLng = focusTree?.longitude ?? userLng;
  const centerZoom = focusTree ? 18 : 14;

  if (!token) {
    // Leaflet fallback
    const markersJs = trees
      .filter((t) => t.latitude && t.longitude)
      .map((t) => {
        const color = CONDITION_COLORS[t.tree_condition || ''] || '#6b7280';
        const species = (t.species || 'Unknown').replace(/'/g, "\\'");
        const treeId = (t.tree_id || t.id.slice(0, 8)).replace(/'/g, "\\'");
        const condition = (t.tree_condition || 'N/A').replace(/'/g, "\\'");
        const date = t.survey_date || t.submitted_at?.split('T')[0] || '';
        const popup = `${t.locked ? '🔒 ' : ''}<b>${species}</b><br/>ID: ${treeId}<br/>Condition: ${condition}<br/>Date: ${date}`;
        const isFocused = focusTreeId && t.id === focusTreeId;
        const size = isFocused ? 36 : 28;

        return `L.marker([${t.latitude}, ${t.longitude}], {
          icon: L.divIcon({
            className: 'tree-marker',
            html: '<div style="background:${color};width:${size}px;height:${size}px;border-radius:50%;border:3px solid ${isFocused ? '#F09125' : '#fff'};box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:${isFocused ? 20 : 16}px;${isFocused ? 'animation:pulse 1.5s infinite;' : ''}">${t.locked ? '🔒' : '🌳'}</div>',
            iconSize: [${size}, ${size}],
            iconAnchor: [${size / 2}, ${size / 2}],
          })
        }).addTo(map).bindPopup(\`${popup}\`).on('click',function(){
          window.ReactNativeWebView.postMessage(JSON.stringify({type:'markerTap',treeId:'${t.id}'}));
        });`;
      })
      .join('\n');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
html,body,#map{margin:0;padding:0;width:100%;height:100%;}
.tree-marker{background:transparent !important;border:none !important;}
.leaflet-popup-content-wrapper{border-radius:10px !important;}
.leaflet-popup-content{margin:10px 14px !important;font-size:13px;line-height:1.5;}
@keyframes pulse{0%{transform:scale(1)}50%{transform:scale(1.15)}100%{transform:scale(1)}}
</style>
</head>
<body>
<div id="map"></div>
<script>
var map=L.map('map',{zoomControl:false,attributionControl:false})
  .setView([${centerLat},${centerLng}],${centerZoom});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
L.control.zoom({position:'bottomright'}).addTo(map);
L.marker([${userLat},${userLng}],{
  icon:L.divIcon({
    className:'user-marker',
    html:'<div style="width:16px;height:16px;background:#4285f4;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>',
    iconSize:[16,16],
    iconAnchor:[8,8],
  })
}).addTo(map).bindPopup('📍 Your location');
${markersJs}
${focusTree ? `L.circle([${focusTree.latitude},${focusTree.longitude}],{
  radius:50,color:'#F09125',fillColor:'#F09125',fillOpacity:0.15,weight:2,dashArray:'5,10'
}).addTo(map);` : ''}
${!focusTree ? `var bounds=L.latLngBounds([
${trees
  .filter((t) => t.latitude && t.longitude)
  .map((t) => `[${t.latitude},${t.longitude}]`)
  .join(',')}
]);
if(bounds.isValid()){map.fitBounds(bounds.pad(0.2));}` : ''}
</script>
</body>
</html>`;
  }

  // Mapbox GL JS
  const treeFeatures = trees
    .filter((t) => t.latitude && t.longitude)
    .map((t) => {
      const color = CONDITION_COLORS[t.tree_condition || ''] || '#6b7280';
      const species = (t.species || 'Unknown').replace(/"/g, '\\"');
      const treeId = (t.tree_id || t.id.slice(0, 8)).replace(/"/g, '\\"');
      const condition = (t.tree_condition || 'N/A').replace(/"/g, '\\"');
      const date = t.survey_date || t.submitted_at?.split('T')[0] || '';
      const isFocused = focusTreeId && t.id === focusTreeId;

      return `{
        "type":"Feature",
        "geometry":{"type":"Point","coordinates":[${t.longitude},${t.latitude}]},
        "properties":{
          "id":"${t.id}",
          "species":"${species}",
          "treeId":"${treeId}",
          "condition":"${condition}",
          "date":"${date}",
          "color":"${color}",
          "locked":${!!t.locked},
          "focused":${!!isFocused}
        }
      }`;
    })
    .join(',');

  const fitBoundsJs = focusTree
    ? ''
    : `map.fitBounds([[${trees.filter((t) => t.latitude && t.longitude).map((t) => `${t.longitude},${t.latitude}`).join('],[')}]],{padding:60});`;

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
  center:[${centerLng},${centerLat}],
  zoom:${centerZoom},
  renderWorldCopies:false,
  maxPitch:60,
  fadeDuration:0
});
map.addControl(new mapboxgl.NavigationControl({showCompass:false}),'bottom-right');

var treesGeoJSON={
  "type":"FeatureCollection",
  "features":[${treeFeatures}]
};

map.on('load',function(){
  map.addSource('trees',{type:'geojson',data:treesGeoJSON});
  map.addLayer({
    id:'tree-circles',
    type:'circle',
    source:'trees',
    paint:{
      'circle-radius':['case',['get','focused'],18,12],
      'circle-color':['get','color'],
      'circle-stroke-color':['case',['get','focused'],'#F09125','#ffffff'],
      'circle-stroke-width':['case',['get','focused'],3,2],
      'circle-opacity':0.9
    }
  });
  map.addLayer({
    id:'tree-labels',
    type:'symbol',
    source:'trees',
    layout:{
      'text-field':['get','species'],
      'text-size':11,
      'text-offset':[0,1.5],
      'text-anchor':'top'
    },
    paint:{
      'text-color':'#ffffff',
      'text-halo-color':'rgba(0,0,0,0.7)',
      'text-halo-width':1
    }
  });

  var userEl=document.createElement('div');
  userEl.style.cssText='width:20px;height:20px;background:#4285f4;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
  new mapboxgl.Marker({element:userEl})
    .setLngLat([${userLng},${userLat}])
    .setPopup(new mapboxgl.Popup({offset:25}).setText('Your location'))
    .addTo(map);

  ${focusTree ? `new mapboxgl.Marker({color:'#F09125'})
    .setLngLat([${focusTree.longitude},${focusTree.latitude}])
    .addTo(map);` : ''}

  ${fitBoundsJs}

  map.on('click','tree-circles',function(e){
    if(e.features&&e.features.length>0){
      var f=e.features[0];
      var props=f.properties;
      var coords=f.geometry.coordinates.slice();
      var popupHtml='<div style="font:13px/1.5 -apple-system,sans-serif;min-width:150px;">'+
        '<b>'+props.species+'</b><br/>'+
        'ID: '+props.treeId+'<br/>'+
        '<span style="color:'+props.color+'">&#9679;</span> '+props.condition+'<br/>'+
        'Date: '+props.date+
        (props.locked?'<br/>Locked':'')+'</div>';
      new mapboxgl.Popup({offset:15})
        .setLngLat(coords)
        .setHTML(popupHtml)
        .addTo(map);
      post({type:'markerTap',treeId:props.id});
    }
  });

  map.on('mouseenter','tree-circles',function(){map.getCanvas().style.cursor='pointer';});
  map.on('mouseleave','tree-circles',function(){map.getCanvas().style.cursor='';});

  post({type:'ready',count:${trees.filter((t) => t.latitude && t.longitude).length}});
});
</script>
</body>
</html>`;
}

export default function TreeMapScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const focusTreeId = route.params?.focusTreeId;
  const trees = useTreeStore((s) => s.trees);
  const setTrees = useTreeStore((s) => s.setTrees);
  const { activeProjectId } = useAuthStore();
  const [allTrees, setAllTrees] = useState<TreeRecord[]>([]);
  const [projectName, setProjectName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [userCoords, setUserCoords] = useState({ latitude: 20.5937, longitude: 78.9629 });
  const [selectedTree, setSelectedTree] = useState<TreeRecord | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [geofenceAlerts, setGeofenceAlerts] = useState<GeofenceAlert[]>([]);
  const [showAlerts, setShowAlerts] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'enter' | 'exit' } | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webViewRef = useRef<WebView>(null);

  // Geofencing
  const { isMonitoring, alerts: newAlerts, start: startGeofence, stop: stopGeofence } = useGeofencing({
    trees: allTrees,
    enabled: true,
    onAlert: (alerts) => {
      setGeofenceAlerts((prev) => [...prev, ...alerts]);
      if (alerts.length > 0) {
        const latest = alerts[alerts.length - 1];
        showToast(latest);
      }
    },
  });

  const showToast = (alert: GeofenceAlert) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message: alert.zone.label, type: alert.event });
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.delay(2500),
      Animated.timing(toastAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setToast(null));
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  };

  // Fetch project trees on mount
  useEffect(() => {
    loadTrees();
  }, [activeProjectId]);

  // Get user location
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          setUserCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        }
      } catch {}
    })();
  }, []);

  const loadTrees = async () => {
    setLoading(true);

    // Get project name
    if (activeProjectId) {
      const { data: projects } = await fetchAllProjects();
      const project = projects?.find((p: Project) => p.id === activeProjectId);
      setProjectName(project?.name ?? '');
    }

    // Fetch trees for active project only
    if (activeProjectId) {
      const { data } = await fetchTreesByProject(activeProjectId);
      if (data) {
        setAllTrees(data);
        setTrees(data);
      } else {
        setAllTrees([]);
        setTrees([]);
      }
    } else {
      setAllTrees([]);
      setTrees([]);
    }

    setLoading(false);
  };

  // Lock a tree
  const handleLockTree = async (tree: TreeRecord) => {
    if (tree.locked) {
      Alert.alert('Already Locked', 'This tree is already locked and cannot be modified.');
      return;
    }

    Alert.alert(
      'Lock Tree',
      `Lock "${tree.species || tree.tree_id}"? This cannot be undone from the app.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Lock',
          style: 'destructive',
          onPress: async () => {
            const { data, error } = await lockTree(tree.id, true);
            if (error) {
              Alert.alert('Error', error);
            } else if (data) {
              setAllTrees((prev) => prev.map((t) => (t.id === tree.id ? { ...t, locked: true } : t)));
              setSelectedTree({ ...tree, locked: true });
              Alert.alert('Locked', 'Tree record is now locked.');
            }
          },
        },
      ]
    );
  };

  // Handle marker taps from WebView
  const handleWebViewMessage = useCallback(
    (event: any) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === 'markerTap' && data.treeId) {
          const tree = allTrees.find((t) => t.id === data.treeId);
          if (tree) {
            setSelectedTree(tree);
            setShowDetails(true);
          }
        }
      } catch {}
    },
    [allTrees]
  );

  // Auto-open details for focused tree
  useEffect(() => {
    if (focusTreeId && allTrees.length > 0) {
      const tree = allTrees.find((t) => t.id === focusTreeId);
      if (tree) {
        setSelectedTree(tree);
        setShowDetails(true);
      }
    }
  }, [focusTreeId, allTrees]);

  const html = useMemo(
    () => buildMapHtml(allTrees, userCoords.latitude, userCoords.longitude, focusTreeId),
    [allTrees, userCoords, focusTreeId]
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient colors={['#123f24', '#1a5c2a', '#2e7d43']} style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>TREE MAP</Text>
          <Text style={styles.headerSubtitle}>
            {projectName ? projectName : focusTreeId ? 'Viewing tree' : `${allTrees.length} trees`}
          </Text>
        </View>
        <TouchableOpacity onPress={loadTrees} style={styles.refreshBtn}>
          <Ionicons name="refresh" size={22} color="#fff" />
        </TouchableOpacity>
      </LinearGradient>

      {/* Map */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1a5c2a" />
          <Text style={styles.loadingText}>Loading trees...</Text>
        </View>
      ) : (
        <WebView
          ref={webViewRef}
          source={{ html }}
          style={styles.map}
          onMessage={handleWebViewMessage}
          javaScriptEnabled={true}
        />
      )}

      {/* Geofence Toast Banner */}
      {toast && (
        <Animated.View
          style={[
            styles.toastBanner,
            toast.type === 'enter' ? styles.toastEnter : styles.toastExit,
            { opacity: toastAnim, transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] },
          ]}
        >
          <Ionicons
            name={toast.type === 'enter' ? 'enter-outline' : 'exit-outline'}
            size={20}
            color="#fff"
          />
          <Text style={styles.toastText}>
            {toast.type === 'enter' ? 'Entered' : 'Exited'} "{toast.message}"
          </Text>
        </Animated.View>
      )}

      {/* Stats bar */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Ionicons name="leaf" size={16} color="#1a5c2a" />
          <Text style={styles.statText}>{allTrees.length}</Text>
        </View>
        <View style={styles.statItem}>
          <Ionicons name="lock-closed" size={16} color="#F09125" />
          <Text style={styles.statText}>{allTrees.filter((t) => t.locked).length}</Text>
        </View>
        <View style={styles.statItem}>
          <Ionicons name="location" size={16} color="#4285f4" />
          <Text style={styles.statText}>{isMonitoring ? 'Geofence ON' : 'Geofence OFF'}</Text>
        </View>
        {geofenceAlerts.length > 0 && (
          <TouchableOpacity style={styles.alertBadge} onPress={() => setShowAlerts(true)}>
            <Ionicons name="notifications" size={16} color="#fff" />
            <Text style={styles.alertBadgeText}>{geofenceAlerts.length}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Tree Details Modal */}
      <Modal visible={showDetails} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={styles.modalBackdropTouch} activeOpacity={1} onPress={() => setShowDetails(false)} />
          <View style={styles.detailSheet}>
            {selectedTree && (
              <>
                <View style={styles.detailHeader}>
                  <View style={styles.detailHeaderLeft}>
                    <Text style={styles.detailSpecies}>
                      {selectedTree.locked ? '🔒 ' : '🌳 '}
                      {selectedTree.species || 'Unknown Species'}
                    </Text>
                    <Text style={styles.detailId}>
                      {selectedTree.tree_id || selectedTree.id.slice(0, 8)}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setShowDetails(false)}>
                    <Ionicons name="close" size={24} color="#333" />
                  </TouchableOpacity>
                </View>

                <View style={styles.detailGrid}>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailLabel}>Condition</Text>
                    <Text style={[styles.detailValue, { color: CONDITION_COLORS[selectedTree.tree_condition || ''] || '#6b7280' }]}>
                      {selectedTree.tree_condition || 'N/A'}
                    </Text>
                  </View>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailLabel}>DBH</Text>
                    <Text style={styles.detailValue}>{selectedTree.dbh_cm ?? '—'} cm</Text>
                  </View>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailLabel}>Height</Text>
                    <Text style={styles.detailValue}>{selectedTree.height_m ?? '—'} m</Text>
                  </View>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailLabel}>Date</Text>
                    <Text style={styles.detailValue}>{selectedTree.survey_date || '—'}</Text>
                  </View>
                </View>

                {selectedTree.notes && (
                  <View style={styles.detailNotes}>
                    <Text style={styles.detailNotesLabel}>Notes</Text>
                    <Text style={styles.detailNotesText}>{selectedTree.notes}</Text>
                  </View>
                )}

                <View style={styles.detailCoords}>
                  <Text style={styles.detailCoordsText}>
                    📍 {selectedTree.latitude?.toFixed(5)}, {selectedTree.longitude?.toFixed(5)}
                  </Text>
                </View>

                <View style={styles.detailActions}>
                  <TouchableOpacity
                    style={styles.detailActionBtn}
                    onPress={() => {
                      setShowDetails(false);
                      navigation.navigate('History', {
                        screen: 'TreeDetail',
                        params: { treeId: selectedTree.id },
                      });
                    }}
                  >
                    <Ionicons name="eye" size={18} color="#1a5c2a" />
                    <Text style={styles.detailActionText}>Full Details</Text>
                  </TouchableOpacity>

                  {!selectedTree.locked ? (
                    <TouchableOpacity
                      style={[styles.detailActionBtn, styles.lockActionBtn]}
                      onPress={() => handleLockTree(selectedTree)}
                    >
                      <Ionicons name="lock-closed" size={18} color="#F09125" />
                      <Text style={[styles.detailActionText, { color: '#F09125' }]}>Lock</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={[styles.detailActionBtn, styles.lockedBadge]}>
                      <Ionicons name="lock-closed" size={18} color="#999" />
                      <Text style={[styles.detailActionText, { color: '#999' }]}>Locked</Text>
                    </View>
                  )}
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Geofence Alerts Modal */}
      <Modal visible={showAlerts} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={styles.modalBackdropTouch} activeOpacity={1} onPress={() => setShowAlerts(false)} />
          <View style={styles.alertSheet}>
            <View style={styles.detailHeader}>
              <Text style={styles.detailSpecies}>Geofence Alerts</Text>
              <TouchableOpacity onPress={() => setShowAlerts(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            {geofenceAlerts.length === 0 ? (
              <Text style={styles.noAlertsText}>No alerts yet</Text>
            ) : (
              geofenceAlerts.slice().reverse().map((alert, idx) => (
                <View key={idx} style={styles.alertItem}>
                  <Ionicons
                    name={alert.event === 'enter' ? 'log-in' : 'log-out'}
                    size={18}
                    color={alert.event === 'enter' ? '#22c55e' : '#ef4444'}
                  />
                  <View style={styles.alertInfo}>
                    <Text style={styles.alertText}>
                      {alert.event === 'enter' ? 'Entered' : 'Exited'} "{alert.zone.label}"
                    </Text>
                    <Text style={styles.alertTime}>{new Date(alert.timestamp).toLocaleTimeString()}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 48,
    paddingBottom: 14,
    paddingHorizontal: 14,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 19, fontWeight: '700', textTransform: 'uppercase' },
  headerSubtitle: { color: '#cde8d3', fontSize: 12, marginTop: 2 },
  refreshBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  map: { flex: 1 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 12, fontSize: 14, color: '#666' },
  toastBanner: {
    position: 'absolute',
    top: 110,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    zIndex: 999,
    maxWidth: '90%',
  },
  toastEnter: { backgroundColor: '#16a34a' },
  toastExit: { backgroundColor: '#dc2626' },
  toastText: { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
  },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statText: { fontSize: 13, fontWeight: '600', color: '#333' },
  alertBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ef4444',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 'auto',
  },
  alertBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBackdropTouch: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  detailSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
    maxHeight: '60%',
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  detailHeaderLeft: { flex: 1 },
  detailSpecies: { fontSize: 18, fontWeight: '700', color: '#1a1a1a' },
  detailId: { fontSize: 12, color: '#888', marginTop: 2, fontFamily: 'monospace' },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  detailCell: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#f9fdf8',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E8F5E9',
  },
  detailLabel: { fontSize: 10, color: '#888', fontWeight: '600', marginBottom: 2 },
  detailValue: { fontSize: 14, fontWeight: '700', color: '#1a5c2a' },
  detailNotes: {
    backgroundColor: '#f9fdf8',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E8F5E9',
  },
  detailNotesLabel: { fontSize: 10, color: '#888', fontWeight: '600', marginBottom: 4 },
  detailNotesText: { fontSize: 13, color: '#333', lineHeight: 18 },
  detailCoords: { backgroundColor: '#f0f0f0', borderRadius: 8, padding: 10, marginBottom: 16 },
  detailCoordsText: { fontSize: 12, color: '#666', fontFamily: 'monospace' },
  detailActions: { flexDirection: 'row', gap: 10 },
  detailActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#1a5c2a',
  },
  lockActionBtn: { borderColor: '#F09125' },
  lockedBadge: { borderColor: '#ddd', backgroundColor: '#f5f5f5' },
  detailActionText: { fontSize: 13, fontWeight: '600', color: '#1a5c2a' },
  alertSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
    maxHeight: '50%',
  },
  noAlertsText: { textAlign: 'center', color: '#888', fontSize: 14, paddingVertical: 30 },
  alertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  alertInfo: { flex: 1 },
  alertText: { fontSize: 14, fontWeight: '600', color: '#333' },
  alertTime: { fontSize: 11, color: '#888', marginTop: 2 },
});
