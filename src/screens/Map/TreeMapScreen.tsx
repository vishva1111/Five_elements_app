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
  TextInput,
  ScrollView,
  Platform,
  Vibration,
} from 'react-native';
import { haversineDistance } from '../../services/geofenceService';
import { WebView } from 'react-native-webview';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTreeStore } from '../../store/treeStore';
import { fetchTreesByProject, fetchAllProjects, lockTree, fetchTreeById } from '../../services/treeService';
import { useAuthStore } from '../../store/authStore';
import { useGeofencing } from '../../hooks/useGeofencing';
import {
  TreeRecord,
  GeofenceAlert,
  Project,
  ProjectGeofence,
  GeofenceCoordinate,
  GeofenceChangeRequest,
} from '../../types';
import * as Location from 'expo-location';
import {
  getMapboxToken,
  MAPBOX_GL_JS_CDN,
  MAPBOX_GL_CSS_CDN,
  DEFAULT_STYLE,
} from '../../services/mapboxConfig';
import { displayTreeId, resolveTreeId } from '../../utils/treeId';
import {
  fetchProjectGeofence,
  saveProjectGeofence,
  confirmAndLockGeofence,
  adminUnlockGeofence,
  submitChangeRequest,
  fetchChangeRequests,
  reviewChangeRequest,
  calculatePolygonArea,
  calculatePolygonPerimeter,
  sqMetersToHectares,
  sqMetersToAcres,
  isPointInPolygon,
} from '../../services/projectGeofenceService';

type Nav = NativeStackNavigationProp<any>;
type Route = RouteProp<{ Map: { focusTreeId?: string; focusLat?: number; focusLng?: number; startGeofenceWalk?: boolean } }, 'Map'>;

// ─── Condition color map ─────────────────────────────────────────────────────
const CONDITION_COLORS: Record<string, string> = {
  Healthy: '#16a34a',
  Stressed: '#d97706',
  Diseased: '#dc2626',
  Dead: '#4b5563',
};

// ─── Tree proximity vibration (meters) ───────────────────────────────────────
const PROXIMITY_VIBRATE_M = 3; // keep buzzing while within 3 m of a tree
const PROXIMITY_RESET_M = 6; // stop only after moving 6 m away
const PROXIMITY_VIBRATE_INTERVAL_MS = 2000; // repeat the buzz every 2 s
const VIBRATE_PATTERN = [0, 180, 90, 180];
const NEAR_TREE_HIGHLIGHT_M = 10; // show/map-highlight the closest tree within 10 m

type NearTreeInfo = { id: string; label: string; distance: number; vibrating: boolean };

// ─── GPS accuracy guard ──────────────────────────────────────────────────────
const GPS_ACCURACY_MAX_M = 50; // ignore fixes worse than this while a good one exists
const GPS_ACCURACY_GOOD_M = 25; // fixes at or better than this reset the guard window
const GPS_GOOD_FIX_WINDOW_MS = 10000; // how long a good fix suppresses noisy jumps

// ─── Build map HTML with tree markers & land boundary ───────────────────────
function buildMapHtml(
  trees: TreeRecord[],
  userLat: number,
  userLng: number,
  focusTreeId?: string,
  boundaryCoords?: GeofenceCoordinate[],
  isBoundaryLocked?: boolean,
  walkCorners?: GeofenceCoordinate[],
  focusLat?: number,
  focusLng?: number,
  userAccuracy?: number,
  hasUserFix?: boolean
): string {
  const token = getMapboxToken();
  const focusTree = focusTreeId ? trees.find((t) => t.id === focusTreeId) : null;
  const activeBoundary = walkCorners && walkCorners.length > 0 ? walkCorners : (boundaryCoords || []);
  const hasBoundary = activeBoundary.length >= 2;
  const isPolygon = activeBoundary.length >= 3;

  const bLats = activeBoundary.map((c) => c.latitude);
  const bLngs = activeBoundary.map((c) => c.longitude);
  const bMinLat = bLats.length > 0 ? Math.min(...bLats) : userLat;
  const bMaxLat = bLats.length > 0 ? Math.max(...bLats) : userLat;
  const bMinLng = bLngs.length > 0 ? Math.min(...bLngs) : userLng;
  const bMaxLng = bLngs.length > 0 ? Math.max(...bLngs) : userLng;

  // Center calculation — priorities: target tree coords > land fencing boundary > live user location
  const targetLat = focusTree?.latitude ?? focusLat;
  const targetLng = focusTree?.longitude ?? focusLng;
  const hasFocus = Boolean(targetLat && targetLng);

  let centerLat = targetLat ?? (hasBoundary ? (bMinLat + bMaxLat) / 2 : userLat);
  let centerLng = targetLng ?? (hasBoundary ? (bMinLng + bMaxLng) / 2 : userLng);
  const centerZoom = hasFocus ? 19 : hasBoundary ? 16 : 14;

  if (!token) {
    // ─── Leaflet fallback ─────────────────────────────────────────────────────
    const markersJs = trees
      .filter((t) => t.latitude && t.longitude)
      .map((t) => {
        const color = CONDITION_COLORS[t.tree_condition || 'Healthy'] || '#16a34a';
        const species = (t.species || 'Unknown').replace(/'/g, "\\'");
        const treeId = resolveTreeId(t).replace(/'/g, "\\'");
        const condition = (t.tree_condition || 'N/A').replace(/'/g, "\\'");
        const date = t.survey_date || t.submitted_at?.split('T')[0] || '';
        const popup = `${t.locked ? '🔒 ' : ''}<b>${species}</b><br/>ID: ${treeId}<br/>Condition: ${condition}<br/>Date: ${date}`;
        const isFocused = Boolean(
          (focusTreeId && t.id === focusTreeId) ||
          (targetLat && targetLng && Math.abs(t.latitude - targetLat) < 0.00005 && Math.abs(t.longitude - targetLng) < 0.00005)
        );
        const size = isFocused ? 42 : 28;

        return `var m = L.marker([${t.latitude}, ${t.longitude}], {
          icon: L.divIcon({
            className: 'tree-marker',
            html: '<div style="background:${color};width:${size}px;height:${size}px;border-radius:50%;border:${isFocused ? '3.5px solid #F09125' : '2.5px solid #fff'};box-shadow:0 3px 12px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-size:${isFocused ? 22 : 16}px;">${t.locked ? '🔒' : '🌳'}</div>',
            iconSize: [${size}, ${size}],
            iconAnchor: [${size / 2}, ${size / 2}],
          })
        }).addTo(map).bindPopup(\`${popup}\`).on('click',function(){
          window.ReactNativeWebView.postMessage(JSON.stringify({type:'markerTap',treeId:'${t.id}'}));
        });
        window._treeMs['${t.id}']=m;
        ${isFocused ? 'setTimeout(function(){ m.openPopup(); map.setView([' + t.latitude + ',' + t.longitude + '], 19); }, 250);' : ''}
        `;
      })
      .join('\n');

    const boundaryJs = hasBoundary
      ? `
      var bCoords = [${activeBoundary.map((c) => `[${c.latitude}, ${c.longitude}]`).join(',')}];
      ${
        isPolygon
          ? `L.polygon(bCoords, {
              color: '${isBoundaryLocked ? '#10b981' : '#f59e0b'}',
              fillColor: '${isBoundaryLocked ? '#10b981' : '#f59e0b'}',
              fillOpacity: ${isBoundaryLocked ? 0.24 : 0.18},
              weight: 3.5,
              dashArray: ${isBoundaryLocked ? 'null' : "'6, 6'"}
            }).addTo(map);`
          : `L.polyline(bCoords, { color: '#f59e0b', weight: 3.5, dashArray: '6, 6' }).addTo(map);`
      }
      bCoords.forEach(function(c, idx) {
        var pinHtml = '<div style="position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;">' +
          '<div style="position:absolute;width:24px;height:24px;border-radius:50%;background:${isBoundaryLocked ? 'rgba(16,185,129,0.45)' : 'rgba(245,158,11,0.45)'};animation:surveyorPulse 2s cubic-bezier(0,0,0.2,1) infinite;pointer-events:none;"></div>' +
          '<svg width="34" height="34" viewBox="0 0 34 34" fill="none" style="filter:drop-shadow(0 2px 6px rgba(0,0,0,0.7));">' +
            '<circle cx="17" cy="17" r="13" stroke="${isBoundaryLocked ? '#34d399' : '#fbbf24'}" stroke-width="1.8" stroke-dasharray="3 2" opacity="0.95"/>' +
            '<circle cx="17" cy="17" r="7.5" stroke="#ffffff" stroke-width="1.5" fill="${isBoundaryLocked ? '#059669' : '#d97706'}" fill-opacity="0.9"/>' +
            '<line x1="17" y1="1" x2="17" y2="7" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>' +
            '<line x1="17" y1="27" x2="17" y2="33" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>' +
            '<line x1="1" y1="17" x2="7" y2="17" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>' +
            '<line x1="27" y1="17" x2="33" y2="17" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>' +
            '<circle cx="17" cy="17" r="3" fill="#ffffff"/>' +
            '<circle cx="17" cy="17" r="1.5" fill="${isBoundaryLocked ? '#10b981' : '#f59e0b'}"/>' +
          '</svg>' +
          '<div style="position:absolute;top:31px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,0.92);backdrop-filter:blur(4px);border:1px solid ${isBoundaryLocked ? '#34d399' : '#fbbf24'};border-radius:10px;padding:1px 6px;display:flex;align-items:center;gap:3px;box-shadow:0 2px 6px rgba(0,0,0,0.5);white-space:nowrap;pointer-events:none;">' +
            '<span style="color:${isBoundaryLocked ? '#34d399' : '#fbbf24'};font-size:9px;font-weight:900;line-height:1;">⌖</span>' +
            '<span style="color:#ffffff;font-size:10px;font-weight:700;letter-spacing:0.5px;font-family:monospace,sans-serif;line-height:1.1;">P' + (idx + 1) + '</span>' +
          '</div>' +
        '</div>';

        L.marker(c, {
          icon: L.divIcon({
            className: 'corner-marker',
            html: pinHtml,
            iconSize: [36, 36],
            iconAnchor: [17, 17]
          })
        }).addTo(map).bindPopup('<div style="font:12px/1.4 -apple-system,sans-serif;min-width:145px;color:#1e293b;"><div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:13px;color:${isBoundaryLocked ? '#059669' : '#d97706'};margin-bottom:4px;"><span>⌖</span> Land Corner P' + (idx + 1) + '</div><div style="font-family:monospace;font-size:11px;background:#f1f5f9;padding:4px 6px;border-radius:4px;color:#334155;margin-bottom:4px;">Lat: ' + c[0].toFixed(6) + '°<br/>Lng: ' + c[1].toFixed(6) + '°</div><div style="font-size:10px;color:#64748b;">${isBoundaryLocked ? '🔒 Verified & Locked Boundary' : '⚠️ Provisional Corner Point'}</div></div>');
      });
      `
      : '';

    const boundsPoints: string[] = trees
      .filter((t) => t.latitude && t.longitude)
      .map((t) => `[${t.latitude},${t.longitude}]`);
    if (activeBoundary.length > 0) {
      activeBoundary.forEach((c) => boundsPoints.push(`[${c.latitude},${c.longitude}]`));
    }

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
html,body,#map{margin:0;padding:0;width:100%;height:100%;background:#0b1320;}
.tree-marker,.corner-marker{background:transparent !important;border:none !important;}
.leaflet-popup-content-wrapper{border-radius:12px !important;box-shadow:0 8px 24px rgba(0,0,0,0.3) !important;background:#ffffff !important;}
.leaflet-popup-content{margin:10px 14px !important;font-size:13px;line-height:1.5;}
@keyframes surveyorPulse{0%{transform:scale(0.85);opacity:0.9;}50%{transform:scale(1.6);opacity:0.2;}100%{transform:scale(2.0);opacity:0;}}
@keyframes gpsPulse{0%{transform:scale(0.9);opacity:0.7;}70%{transform:scale(2.2);opacity:0;}100%{transform:scale(2.2);opacity:0;}}
@keyframes nearRing{0%{box-shadow:0 0 0 0 rgba(240,145,37,0.85),0 3px 12px rgba(0,0,0,0.5);}70%{box-shadow:0 0 0 18px rgba(240,145,37,0),0 3px 12px rgba(0,0,0,0.5);}100%{box-shadow:0 0 0 0 rgba(240,145,37,0),0 3px 12px rgba(0,0,0,0.5);}}
.near-hl{border-color:#F09125 !important;box-shadow:0 0 16px 5px rgba(240,145,37,0.75),0 3px 12px rgba(0,0,0,0.5) !important;animation:nearRing 1.4s infinite !important;filter:saturate(1.4) brightness(1.15);}
</style>
</head>
<body>
<div id="map"></div>
<script>
function post(msg){try{if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify(msg));}}catch(e){}}
var map=L.map('map',{zoomControl:false,attributionControl:false,maxZoom:22})
  .setView([${centerLat},${centerLng}],${centerZoom});
L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',{
  maxZoom:22,
  maxNativeZoom:20,
  attribution:'© Google Satellite'
}).addTo(map);
L.control.zoom({position:'bottomright'}).addTo(map);

// ─── Real-Time Live User Location Marker & Accuracy Circle ───
var userMarker = null;
var userAccuracyCircle = null;

window.updateUserLocation = function(lat, lng, accuracy, panToUser) {
  if (!lat || !lng) return;
  var latLng = [lat, lng];

  if (!userMarker) {
    userMarker = L.marker(latLng, {
      icon: L.divIcon({
        className: 'user-marker',
        html: '<div style="position:relative;width:24px;height:24px;display:flex;align-items:center;justify-content:center;">' +
              '<div style="position:absolute;width:24px;height:24px;border-radius:50%;background:#3b82f6;opacity:0.4;animation:gpsPulse 2s infinite;"></div>' +
              '<div style="width:14px;height:14px;background:#2563eb;border:2.5px solid #ffffff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.5);position:relative;z-index:2;"></div>' +
              '</div>',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
      zIndexOffset: 1000
    }).addTo(map).bindPopup('<b>📍 Your Live Location</b><br/>Lat: ' + lat.toFixed(6) + '<br/>Lng: ' + lng.toFixed(6) + (accuracy ? '<br/>Accuracy: ±' + Math.round(accuracy) + 'm' : ''));
  } else {
    userMarker.setLatLng(latLng);
    userMarker.setPopupContent('<b>📍 Your Live Location</b><br/>Lat: ' + lat.toFixed(6) + '<br/>Lng: ' + lng.toFixed(6) + (accuracy ? '<br/>Accuracy: ±' + Math.round(accuracy) + 'm' : ''));
  }

  if (accuracy && accuracy > 0) {
    if (!userAccuracyCircle) {
      userAccuracyCircle = L.circle(latLng, {
        radius: accuracy,
        color: '#2563eb',
        weight: 1.5,
        opacity: 0.6,
        fillColor: '#3b82f6',
        fillOpacity: 0.12
      }).addTo(map);
    } else {
      userAccuracyCircle.setLatLng(latLng);
      userAccuracyCircle.setRadius(accuracy);
    }
  }

  if (panToUser) {
    map.setView(latLng, Math.max(map.getZoom(), 18), { animate: true });
    if (userMarker) userMarker.openPopup();
  }
};

window.panToUserLocation = function(zoom) {
  if (userMarker) {
    var pos = userMarker.getLatLng();
    map.setView(pos, zoom || 19, { animate: true });
    userMarker.openPopup();
  }
};

${hasUserFix ? `window.updateUserLocation(${userLat}, ${userLng}, ${userAccuracy ?? 0}, false);` : ''}

// ─── Nearest-tree highlight (driven from React Native) ──────────────────────
window._treeMs = {};
window.highlightNearestTree = function(id) {
  if (window._nearHlId === id) return;
  window._nearHlId = id;
  Object.keys(window._treeMs).forEach(function(k) {
    var m = window._treeMs[k];
    var el = m && m.getElement && m.getElement();
    if (!el) return;
    var d = el.firstElementChild || el;
    if (id && k === id) {
      d.classList.add('near-hl');
      if (m.setZIndexOffset) m.setZIndexOffset(2000);
      if (m.openPopup) { try { m.openPopup(); } catch (e) {} }
    } else {
      d.classList.remove('near-hl');
      if (m.setZIndexOffset) m.setZIndexOffset(0);
    }
  });
};

${markersJs}
${boundaryJs}
${
  hasFocus && !trees.some((t) => (focusTreeId && t.id === focusTreeId) || (Math.abs(t.latitude - (targetLat as number)) < 0.00005 && Math.abs(t.longitude - (targetLng as number)) < 0.00005))
    ? `
    var focusMarker = L.marker([${targetLat}, ${targetLng}], {
      icon: L.divIcon({
        className: 'tree-marker',
        html: '<div style="background:#16a34a;width:42px;height:42px;border-radius:50%;border:3.5px solid #F09125;box-shadow:0 3px 12px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-size:22px;">🌳</div>',
        iconSize: [42, 42],
        iconAnchor: [21, 21],
      })
    }).addTo(map).bindPopup('<b>Target Tree</b><br/>Lat: ${(targetLat as number)?.toFixed(6)}<br/>Lng: ${(targetLng as number)?.toFixed(6)}');
    setTimeout(function(){ focusMarker.openPopup(); map.setView([${targetLat}, ${targetLng}], 19); }, 250);
    `
    : ''
}
window.zoomToBoundary = function() {
  ${
    hasBoundary
      ? `try {
          var bBounds = L.latLngBounds([[${bMinLat}, ${bMinLng}], [${bMaxLat}, ${bMaxLng}]]);
          if (bBounds.isValid()) {
            map.fitBounds(bBounds.pad(0.18), { maxZoom: 19, animate: true });
          }
        } catch(e) {}`
      : ''
  }
};
${
  hasFocus
    ? `setTimeout(function(){ map.setView([${centerLat}, ${centerLng}], 19); }, 200);`
    : hasBoundary
      ? `setTimeout(function(){ window.zoomToBoundary(); }, 250);`
      : boundsPoints.length > 0
        ? `var bounds=L.latLngBounds([${boundsPoints.join(',')}]);
           if(bounds.isValid()){map.fitBounds(bounds.pad(0.2));}`
        : ''
}
window._nearHlId=undefined;
post({type:'ready',hasBoundary:${hasBoundary}});
</script>
</body>
</html>`;
  }

  // ─── Mapbox GL JS ──────────────────────────────────────────────────────────
  const treeFeatures = trees
    .filter((t) => t.latitude && t.longitude)
    .map((t) => {
      const color = CONDITION_COLORS[t.tree_condition || 'Healthy'] || '#16a34a';
      const species = (t.species || 'Unknown').replace(/"/g, '\\"');
      const treeId = resolveTreeId(t).replace(/"/g, '\\"');
      const condition = (t.tree_condition || 'N/A').replace(/"/g, '\\"');
      const date = t.survey_date || t.submitted_at?.split('T')[0] || '';
      const isFocused = focusTreeId && t.id === focusTreeId;
      const locked = !!t.locked;
      const size = isFocused ? 42 : 34;

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
          "locked":${locked},
          "focused":${!!isFocused},
          "size":${size}
        }
      }`;
    })
    .join(',');

  const allPoints: [number, number][] = trees
    .filter((t) => t.latitude && t.longitude)
    .map((t) => [t.longitude, t.latitude]);
  if (activeBoundary.length > 0) {
    activeBoundary.forEach((c) => allPoints.push([c.longitude, c.latitude]));
  }

  const fitBoundsJs =
    hasFocus || allPoints.length === 0
      ? ''
      : `map.fitBounds([[${allPoints.map((p) => `${p[0]},${p[1]}`).join('],[')}]],{padding:70});`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="${MAPBOX_GL_CSS_CDN}"/>
<script src="${MAPBOX_GL_JS_CDN}"></script>
<style>
html,body,#map{margin:0;padding:0;width:100%;height:100%;background:#0b1320;}
.mapboxgl-ctrl-bottom-left,.mapboxgl-ctrl-bottom-right{display:none !important;}
@keyframes surveyorPulse{0%{transform:scale(0.85);opacity:0.9;}50%{transform:scale(1.6);opacity:0.2;}100%{transform:scale(2.0);opacity:0;}}
@keyframes gpsPulse{0%{transform:scale(0.9);opacity:0.7;}70%{transform:scale(2.2);opacity:0;}100%{transform:scale(2.2);opacity:0;}}
@keyframes nearRing{0%{box-shadow:0 0 0 0 rgba(240,145,37,0.85),0 3px 12px rgba(0,0,0,0.5);}70%{box-shadow:0 0 0 18px rgba(240,145,37,0),0 3px 12px rgba(0,0,0,0.5);}100%{box-shadow:0 0 0 0 rgba(240,145,37,0),0 3px 12px rgba(0,0,0,0.5);}}
.near-hl{border-color:#F09125 !important;box-shadow:0 0 16px 5px rgba(240,145,37,0.75),0 3px 12px rgba(0,0,0,0.5) !important;animation:nearRing 1.4s infinite !important;filter:saturate(1.4) brightness(1.15);}
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

// ─── Real-Time Live User Location Marker & Accuracy Circle ───
var userMarker=null, userPopup=null, pendingUserFix=null, mapLoaded=false;

// ─── Nearest-tree highlight (driven from React Native) ──────────────────────
var treeMarkers={};
window.highlightNearestTree=function(id){
  if(window._nearHlId===id) return;
  window._nearHlId=id;
  Object.keys(treeMarkers).forEach(function(k){
    var mk=treeMarkers[k];
    var el=mk.getElement();
    if(!el) return;
    if(id&&k===id){
      el.classList.add('near-hl');
      el.style.zIndex='9';
      var p=mk.getPopup();
      if(p && !p.isOpen()){ try{ mk.togglePopup(); }catch(e){} }
    } else {
      el.classList.remove('near-hl');
      el.style.zIndex='';
    }
  });
};

function makeUserDot(){
  var el=document.createElement('div');
  el.style.cssText='position:relative;width:24px;height:24px;display:flex;align-items:center;justify-content:center;';
  el.innerHTML='<div style="position:absolute;width:24px;height:24px;border-radius:50%;background:#3b82f6;opacity:0.45;animation:gpsPulse 2s infinite;"></div>'+
    '<div style="width:14px;height:14px;background:#2563eb;border:2.5px solid #ffffff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.5);position:relative;z-index:2;"></div>';
  return el;
}

function accuracyRing(lat,lng,acc){
  var ring=[];
  var mLat=1/111320;
  var mLng=1/(111320*Math.cos(lat*Math.PI/180));
  for(var i=0;i<=64;i++){
    var a=(i/64)*Math.PI*2;
    ring.push([lng+Math.cos(a)*acc*mLng, lat+Math.sin(a)*acc*mLat]);
  }
  ring.push(ring[0]);
  return ring;
}

function userPopupHtml(lat,lng,acc){
  return '<b>📍 Your Live Location</b><br/>Lat: '+lat.toFixed(6)+'<br/>Lng: '+lng.toFixed(6)+(acc?'<br/>Accuracy: ±'+Math.round(acc)+'m':'');
}

function applyUserFix(){
  var f=pendingUserFix;
  if(!f || !mapLoaded) return;
  pendingUserFix=null;
  var ll=[f.lng,f.lat];
  var html=userPopupHtml(f.lat,f.lng,f.acc);

  if(!userMarker){
    userPopup=new mapboxgl.Popup({offset:20}).setHTML(html);
    userMarker=new mapboxgl.Marker({element:makeUserDot(),anchor:'center'})
      .setLngLat(ll)
      .setPopup(userPopup)
      .addTo(map);
  } else {
    userMarker.setLngLat(ll);
    if(userPopup) userPopup.setHTML(html);
  }

  if(f.acc>0){
    var accData={type:'Feature',geometry:{type:'Polygon',coordinates:[accuracyRing(f.lat,f.lng,f.acc)]},properties:{}};
    var accSource=map.getSource('user-accuracy');
    if(!accSource){
      map.addSource('user-accuracy',{type:'geojson',data:accData});
      map.addLayer({id:'user-accuracy-fill',type:'fill',source:'user-accuracy',paint:{'fill-color':'#3b82f6','fill-opacity':0.14}});
      map.addLayer({id:'user-accuracy-line',type:'line',source:'user-accuracy',paint:{'line-color':'#2563eb','line-width':1.5,'line-opacity':0.6}});
    } else {
      accSource.setData(accData);
    }
  }

  if(f.pan){
    map.flyTo({center:ll,zoom:Math.max(map.getZoom(),18),essential:true});
    if(userPopup && !userPopup.isOpen()) userMarker.togglePopup();
  }
}

window.updateUserLocation=function(lat,lng,accuracy,panToUser){
  if(!lat || !lng) return;
  pendingUserFix={lat:lat,lng:lng,acc:accuracy||0,pan:!!panToUser};
  if(mapLoaded) applyUserFix();
};

window.panToUserLocation=function(zoom){
  if(userMarker){
    var c=userMarker.getLngLat();
    map.flyTo({center:[c.lng,c.lat],zoom:zoom||19,essential:true});
    if(userPopup && !userPopup.isOpen()) userMarker.togglePopup();
  }
};

${hasUserFix ? `window.updateUserLocation(${userLat}, ${userLng}, ${userAccuracy ?? 0}, false);` : ''}

var treesGeoJSON={
  "type":"FeatureCollection",
  "features":[${treeFeatures}]
};

map.on('load',function(){
  mapLoaded=true;
  if(pendingUserFix) applyUserFix();

  // Add tree markers
  treesGeoJSON.features.forEach(function(f){
    var p=f.properties;
    var c=f.geometry.coordinates;
    var el=document.createElement('div');
    el.style.cssText='width:'+p.size+'px;height:'+p.size+'px;background:'+p.color+';border-radius:50%;border:3px solid '+(p.focused?'#F09125':'#fff')+';box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:'+(p.focused?22:18)+'px;cursor:pointer;';
    el.innerHTML=p.locked?'🔒':'🌳';
    var popup=new mapboxgl.Popup({offset:15,closeButton:true}).setHTML(
      '<div style="font:13px/1.5 -apple-system,sans-serif;min-width:150px;">'+
      '<b>'+p.species+'</b><br/>'+
      'ID: '+p.treeId+'<br/>'+
      '<span style="color:'+p.color+'">&#9679;</span> '+p.condition+'<br/>'+
      'Date: '+p.date+
      (p.locked?'<br/>🔒 Locked':'')+'</div>'
    );
    var mk=new mapboxgl.Marker({element:el})
      .setLngLat(c)
      .setPopup(popup)
      .addTo(map);
    treeMarkers[p.id]=mk;
    el.addEventListener('click',function(){
      post({type:'markerTap',treeId:p.id});
    });
  });

  // Live user location marker is created by window.updateUserLocation()

  ${
    hasFocus
      ? `new mapboxgl.Marker({color:'#F09125'})
      .setLngLat([${targetLng},${targetLat}])
      .addTo(map);
      setTimeout(function(){ map.flyTo({ center: [${centerLng}, ${centerLat}], zoom: 19, essential: true }); }, 200);`
      : ''
  }

  // ─── Add Boundary Layer if available ───
  ${
    hasBoundary
      ? `
    var rawBoundary = [${activeBoundary.map((c) => `[${c.longitude},${c.latitude}]`).join(',')}];
    ${
      isPolygon
        ? `
      var polygonCoords = rawBoundary.slice();
      polygonCoords.push(rawBoundary[0]); // close polygon ring
      map.addSource('boundary-src', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [polygonCoords] }
        }
      });
      map.addLayer({
        id: 'boundary-fill',
        type: 'fill',
        source: 'boundary-src',
        paint: {
          'fill-color': '${isBoundaryLocked ? '#10b981' : '#f59e0b'}',
          'fill-opacity': ${isBoundaryLocked ? 0.24 : 0.18}
        }
      });
      map.addLayer({
        id: 'boundary-line',
        type: 'line',
        source: 'boundary-src',
        paint: {
          'line-color': '${isBoundaryLocked ? '#059669' : '#d97706'}',
          'line-width': 3.5,
          'line-dasharray': ${isBoundaryLocked ? '[1]' : '[2, 2]'}
        }
      });
      `
        : `
      map.addSource('boundary-line-src', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: rawBoundary }
        }
      });
      map.addLayer({
        id: 'boundary-open-line',
        type: 'line',
        source: 'boundary-line-src',
        paint: {
          'line-color': '#d97706',
          'line-width': 3.5,
          'line-dasharray': [2, 2]
        }
      });
      `
    }

    // Precision Geodesic surveyor corner beacons
    rawBoundary.forEach(function(c, i){
      var pin = document.createElement('div');
      pin.className = 'surveyor-corner-beacon';
      pin.style.cssText = 'position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;';
      pin.innerHTML =
        '<div style="position:absolute;width:24px;height:24px;border-radius:50%;background:${isBoundaryLocked ? 'rgba(16,185,129,0.45)' : 'rgba(245,158,11,0.45)'};animation:surveyorPulse 2s cubic-bezier(0,0,0.2,1) infinite;pointer-events:none;"></div>' +
        '<svg width="34" height="34" viewBox="0 0 34 34" fill="none" style="filter:drop-shadow(0 2px 6px rgba(0,0,0,0.7));">' +
          '<circle cx="17" cy="17" r="13" stroke="${isBoundaryLocked ? '#34d399' : '#fbbf24'}" stroke-width="1.8" stroke-dasharray="3 2" opacity="0.95"/>' +
          '<circle cx="17" cy="17" r="7.5" stroke="#ffffff" stroke-width="1.5" fill="${isBoundaryLocked ? '#059669' : '#d97706'}" fill-opacity="0.9"/>' +
          '<line x1="17" y1="1" x2="17" y2="7" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>' +
          '<line x1="17" y1="27" x2="17" y2="33" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>' +
          '<line x1="1" y1="17" x2="7" y2="17" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>' +
          '<line x1="27" y1="17" x2="33" y2="17" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>' +
          '<circle cx="17" cy="17" r="3" fill="#ffffff"/>' +
          '<circle cx="17" cy="17" r="1.5" fill="${isBoundaryLocked ? '#10b981' : '#f59e0b'}"/>' +
        '</svg>' +
        '<div style="position:absolute;top:31px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,0.92);backdrop-filter:blur(4px);border:1px solid ${isBoundaryLocked ? '#34d399' : '#fbbf24'};border-radius:10px;padding:1px 6px;display:flex;align-items:center;gap:3px;box-shadow:0 2px 6px rgba(0,0,0,0.5);white-space:nowrap;pointer-events:none;">' +
          '<span style="color:${isBoundaryLocked ? '#34d399' : '#fbbf24'};font-size:9px;font-weight:900;line-height:1;">⌖</span>' +
          '<span style="color:#ffffff;font-size:10px;font-weight:700;letter-spacing:0.5px;font-family:monospace,sans-serif;line-height:1.1;">P' + (i + 1) + '</span>' +
        '</div>';

      var popupHtml = '<div style="font:12px/1.4 -apple-system,sans-serif;min-width:145px;color:#1e293b;"><div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:13px;color:${isBoundaryLocked ? '#059669' : '#d97706'};margin-bottom:4px;"><span>⌖</span> Land Corner P' + (i + 1) + '</div><div style="font-family:monospace;font-size:11px;background:#f1f5f9;padding:4px 6px;border-radius:4px;color:#334155;margin-bottom:4px;">Lat: ' + c[1].toFixed(6) + '°<br/>Lng: ' + c[0].toFixed(6) + '°</div><div style="font-size:10px;color:#64748b;">${isBoundaryLocked ? '🔒 Verified & Locked Boundary' : '⚠️ Provisional Corner Point'}</div></div>';

      new mapboxgl.Marker({ element: pin, anchor: 'center' })
        .setLngLat(c)
        .setPopup(new mapboxgl.Popup({ offset: [0, -18] }).setHTML(popupHtml))
        .addTo(map);
    });
    `
      : ''
  }

  window.zoomToBoundary = function() {
    ${
      hasBoundary
        ? `try {
            map.fitBounds([[${bMinLng}, ${bMinLat}], [${bMaxLng}, ${bMaxLat}]], {
              padding: { top: 90, bottom: 130, left: 60, right: 60 },
              maxZoom: 19,
              duration: 1000
            });
          } catch(e) {}`
        : ''
    }
  };

  ${
    hasFocus
      ? `setTimeout(function(){ map.flyTo({ center: [${centerLng}, ${centerLat}], zoom: 19, essential: true }); }, 200);`
      : hasBoundary
        ? `setTimeout(function(){ window.zoomToBoundary(); }, 200);`
        : fitBoundsJs
  }

  window._nearHlId=undefined;
post({type:'ready',hasBoundary:${hasBoundary},count:${trees.filter((t) => t.latitude && t.longitude).length}});
});
</script>
</body>
</html>`;
}

export default function TreeMapScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const focusTreeId = route.params?.focusTreeId;
  const focusLat = route.params?.focusLat;
  const focusLng = route.params?.focusLng;
  const initialStartWalk = route.params?.startGeofenceWalk;

  const trees = useTreeStore((s) => s.trees);
  const setTrees = useTreeStore((s) => s.setTrees);
  const { activeProjectId, user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const [allTrees, setAllTrees] = useState<TreeRecord[]>([]);
  const [projectName, setProjectName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const userCoordsRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const gpsAccuracyRef = useRef<number | null>(null);
  const lastGoodFixAtRef = useRef(0);
  const proximityTreeIdRef = useRef<string | null>(null);
  const proximityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [vibrateEnabled, setVibrateEnabled] = useState(true);
  const vibrateEnabledRef = useRef(true);
  const [nearTree, setNearTree] = useState<NearTreeInfo | null>(null);
  const nearTreeRef = useRef<NearTreeInfo | null>(null);
  const highlightedTreeIdRef = useRef<string | null>(null);
  const [selectedTree, setSelectedTree] = useState<TreeRecord | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [detailSheetH, setDetailSheetH] = useState(0);
  const [isolateFocusedTree, setIsolateFocusedTree] = useState<boolean>(Boolean(focusTreeId));
  const [geofenceAlerts, setGeofenceAlerts] = useState<GeofenceAlert[]>([]);
  const [showAlerts, setShowAlerts] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'enter' | 'exit' } | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webViewRef = useRef<WebView>(null);

  // Reset the measured tree-details height whenever the card closes.
  useEffect(() => {
    if (!showDetails) setDetailSheetH(0);
  }, [showDetails]);

  // ─── Land Area Geofence State ─────────────────────────────────────────────
  const [projectGeofence, setProjectGeofence] = useState<ProjectGeofence | null>(null);
  const [geofenceWalkMode, setGeofenceWalkMode] = useState(false);
  const [walkCorners, setWalkCorners] = useState<GeofenceCoordinate[]>([]);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [locationWatcher, setLocationWatcher] = useState<Location.LocationSubscription | null>(null);
  const [savingGeofence, setSavingGeofence] = useState(false);

  // Modals for Geofence info, Change Request & Admin Review
  const [showGeofenceModal, setShowGeofenceModal] = useState(false);
  const [showRequestChangeModal, setShowRequestChangeModal] = useState(false);
  const [changeReason, setChangeReason] = useState('');
  const [submittingChangeRequest, setSubmittingChangeRequest] = useState(false);
  const [changeRequests, setChangeRequests] = useState<GeofenceChangeRequest[]>([]);
  const [showAdminRequestsModal, setShowAdminRequestsModal] = useState(false);

  // Circular Geofencing for individual trees
  const { isMonitoring, start: startGeofence, stop: stopGeofence } = useGeofencing({
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

  // Load project trees & project land geofence
  const loadData = useCallback(async () => {
    setLoading(true);

    if (activeProjectId) {
      const { data: projects } = await fetchAllProjects();
      const proj = projects?.find((p: Project) => p.id === activeProjectId);
      setProjectName(proj?.name ?? '');

      // Load project trees
      const { data: treeList } = await fetchTreesByProject(activeProjectId);
      let combined = treeList ?? [];

      // If a specific tree was targeted, ensure it's included in allTrees and selected
      if (focusTreeId) {
        const found = combined.find((t: TreeRecord) => t.id === focusTreeId);
        if (found) {
          setSelectedTree(found);
          setShowDetails(true);
        } else {
          try {
            const { data: singleTree } = await fetchTreeById(focusTreeId);
            if (singleTree) {
              combined = [singleTree, ...combined];
              setSelectedTree(singleTree);
              setShowDetails(true);
            }
          } catch {}
        }
      }

      setAllTrees(combined);
      setTrees(combined);

      // Load project land boundary geofence
      const { data: geofence } = await fetchProjectGeofence(activeProjectId);
      setProjectGeofence(geofence);

      // If admin, also load change requests
      if (isAdmin) {
        const { data: reqs } = await fetchChangeRequests(activeProjectId);
        setChangeRequests(reqs ?? []);
      }
    } else {
      if (focusTreeId) {
        try {
          const { data: singleTree } = await fetchTreeById(focusTreeId);
          if (singleTree) {
            setAllTrees([singleTree]);
            setSelectedTree(singleTree);
            setShowDetails(true);
          }
        } catch {}
      } else {
        setAllTrees([]);
        setTrees([]);
      }
      setProjectGeofence(null);
    }

    setLoading(false);
  }, [activeProjectId, isAdmin, setTrees, focusTreeId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle start walk requested from navigation params
  useEffect(() => {
    if (initialStartWalk && !geofenceWalkMode) {
      startBoundaryWalkMode();
    }
  }, [initialStartWalk]);

  // ─── Real-Time Live Location Tracking & Leaflet Sync ───────────────────────
  const pushLocationToMap = useCallback(
    (lat: number, lng: number, accuracy?: number | null, panToUser?: boolean) => {
      if (!lat || !lng) return;
      const js = `
        if (window.updateUserLocation) {
          window.updateUserLocation(${lat}, ${lng}, ${accuracy ?? 0}, ${panToUser ? 'true' : 'false'});
        }
        true;
      `;
      webViewRef.current?.injectJavaScript(js);
    },
    []
  );

  // ─── Continuous proximity vibration ────────────────────────────────────────
  // Buzzes repeatedly while the user stands within 3 m of the nearest tree and
  // stops only when they walk 6 m away (or the screen unmounts).
  const buzz = useCallback(() => {
    try {
      Vibration.vibrate(VIBRATE_PATTERN);
    } catch {}
  }, []);

  const stopProximityVibration = useCallback(() => {
    if (proximityTimerRef.current) {
      clearInterval(proximityTimerRef.current);
      proximityTimerRef.current = null;
    }
    proximityTreeIdRef.current = null;
  }, []);

  const startProximityVibration = useCallback(
    (treeId: string) => {
      if (!vibrateEnabledRef.current) return; // user pressed "Stop Vibrate"
      if (proximityTreeIdRef.current === treeId && proximityTimerRef.current) return;
      stopProximityVibration();
      proximityTreeIdRef.current = treeId;
      buzz();
      proximityTimerRef.current = setInterval(buzz, PROXIMITY_VIBRATE_INTERVAL_MS);
    },
    [buzz, stopProximityVibration]
  );

  const rearmProximityVibration = useCallback(() => {
    // Called when the user hits Resume — buzz again immediately instead of
    // waiting for the next GPS tick, so "Resume" visibly works.
    const u = userCoordsRef.current;
    if (!u) return;
    let best: TreeRecord | null = null;
    let bestDist = Infinity;
    for (const t of allTrees) {
      if (!t?.latitude || !t?.longitude) continue;
      const d = haversineDistance(u.latitude, u.longitude, Number(t.latitude), Number(t.longitude));
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    if (best && bestDist <= PROXIMITY_VIBRATE_M) startProximityVibration(best.id);
  }, [allTrees, startProximityVibration]);

  const toggleProximityVibration = useCallback(() => {
    const next = !vibrateEnabledRef.current;
    vibrateEnabledRef.current = next;
    setVibrateEnabled(next);
    if (next) {
      rearmProximityVibration();
      try {
        Vibration.vibrate([0, 90, 60, 90]); // confirm ON
      } catch {}
    } else {
      stopProximityVibration();
      try {
        Vibration.vibrate(60); // confirm OFF
      } catch {}
    }
  }, [stopProximityVibration, rearmProximityVibration]);

  // Highlight the tree the phone is buzzing for, on the WebView map itself.
  const pushNearestTreeToMap = useCallback((id: string | null, force = false) => {
    if (!force && highlightedTreeIdRef.current === id) return;
    highlightedTreeIdRef.current = id;
    const arg = id ? `'${id.replace(/'/g, "\\'")}'` : 'null';
    webViewRef.current?.injectJavaScript(
      `if (window.highlightNearestTree) { window.highlightNearestTree(${arg}); } true;`
    );
  }, []);

  const handleLocationUpdate = useCallback(
    (loc: Location.LocationObject) => {
      if (!loc?.coords) return;
      const { latitude, longitude, accuracy } = loc.coords;

      // Drop noisy low-accuracy jumps while a decent fix exists nearby in time,
      // so the dot and the 3 m vibration window stay stable.
      const now = Date.now();
      if (
        accuracy != null &&
        accuracy > GPS_ACCURACY_MAX_M &&
        now - lastGoodFixAtRef.current < GPS_GOOD_FIX_WINDOW_MS
      ) {
        return;
      }
      if (accuracy == null || accuracy <= GPS_ACCURACY_GOOD_M) {
        lastGoodFixAtRef.current = now;
      }

      userCoordsRef.current = { latitude, longitude };
      gpsAccuracyRef.current = accuracy ?? null;

      setUserCoords({ latitude, longitude });
      setGpsAccuracy(accuracy ?? null);

      pushLocationToMap(latitude, longitude, accuracy ?? null, false);

      // ─── Proximity vibration ────────────────────────────────────────────
      // Nearest tree wins — no need to tap a marker on the map first.
      let nearestTree: TreeRecord | null = null;
      let nearestDist = Infinity;
      for (const t of allTrees) {
        if (!t?.latitude || !t?.longitude) continue;
        const d = haversineDistance(
          latitude,
          longitude,
          Number(t.latitude),
          Number(t.longitude)
        );
        if (d < nearestDist) {
          nearestDist = d;
          nearestTree = t;
        }
      }

      if (nearestTree && nearestDist <= PROXIMITY_VIBRATE_M) {
        startProximityVibration(nearestTree.id);
      } else if (!nearestTree || nearestDist > PROXIMITY_RESET_M) {
        stopProximityVibration();
      }

      // ─── Nearest tree: map highlight + on-screen card ────────────────────
      if (nearestTree && nearestDist <= NEAR_TREE_HIGHLIGHT_M) {
        const vibrating = nearestDist <= PROXIMITY_VIBRATE_M;
        const prev = nearTreeRef.current;
        if (
          !prev ||
          prev.id !== nearestTree.id ||
          prev.vibrating !== vibrating ||
          Math.abs(prev.distance - nearestDist) >= 0.5
        ) {
          const next: NearTreeInfo = {
            id: nearestTree.id,
            label: `${nearestTree.species || 'Unknown'} · ${resolveTreeId(nearestTree)}`,
            distance: nearestDist,
            vibrating,
          };
          nearTreeRef.current = next;
          setNearTree(next);
        }
        pushNearestTreeToMap(nearestTree.id);
      } else if (nearTreeRef.current) {
        nearTreeRef.current = null;
        setNearTree(null);
        pushNearestTreeToMap(null);
      }
    },
    [allTrees, pushLocationToMap, startProximityVibration, stopProximityVibration, pushNearestTreeToMap]
  );

  // Always call the latest handler without restarting the GPS watcher whenever
  // the trees/selection state changes (a restart drops live map updates).
  const handleLocationUpdateRef = useRef(handleLocationUpdate);
  useEffect(() => {
    handleLocationUpdateRef.current = handleLocationUpdate;
  }, [handleLocationUpdate]);

  // Request location & continuous live user coordinates
  useEffect(() => {
    let watcher: Location.LocationSubscription | null = null;
    let isMounted = true;

    (async () => {
      try {
        // 0. Permission first (enableNetworkProviderAsync needs it on Android)
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.warn('[TreeMapScreen] Location permission denied');
          return;
        }

        if (Platform.OS === 'android') {
          // Turn on the network location provider so the first fix lands in
          // well under a second instead of waiting for a GPS cold start.
          try {
            await Location.enableNetworkProviderAsync();
          } catch (e) {
            console.warn('[TreeMapScreen] enableNetworkProviderAsync error:', e);
          }
        }

        // 1. Instant paint from a recent cached fix (0-10 ms)
        try {
          const lastKnown = await Location.getLastKnownPositionAsync({
            maxAge: 300000, // fresh enough for up to 5 minutes
            requiredAccuracy: 150, // skip hopelessly stale/uncertain caches
          });
          if (lastKnown && isMounted) {
            handleLocationUpdateRef.current(lastKnown);
          }
        } catch {}

        // 2. Highest-quality one-shot fix (navigation grade = GPS + sensors)
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.BestForNavigation,
          mayShowUserSettingsDialog: true,
        })
          .then((loc) => {
            if (loc && isMounted) {
              handleLocationUpdateRef.current(loc);
            }
          })
          .catch(async () => {
            try {
              const balanced = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
                mayShowUserSettingsDialog: true,
              });
              if (balanced && isMounted) {
                handleLocationUpdateRef.current(balanced);
              }
            } catch {}
          });

        // 3. Continuous live stream: navigation-grade accuracy, twice a second,
        //    and the moment the user moves a single metre.
        watcher = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            distanceInterval: 1, // update every 1 meter
            timeInterval: 500, // or every 0.5 seconds
            mayShowUserSettingsDialog: false, // one-shot above already prompted
          },
          (loc) => {
            if (isMounted) {
              handleLocationUpdateRef.current(loc);
            }
          },
          (err) => {
            console.warn('[TreeMapScreen] watch error:', err);
          }
        );
      } catch (err) {
        console.warn('[TreeMapScreen] Location error:', err);
      }
    })();

    return () => {
      isMounted = false;
      if (watcher) {
        watcher.remove();
      }
      stopProximityVibration();
    };
  }, [stopProximityVibration]);

  const handleCenterOnMyLocation = useCallback(async () => {
    if (userCoordsRef.current) {
      pushLocationToMap(
        userCoordsRef.current.latitude,
        userCoordsRef.current.longitude,
        gpsAccuracyRef.current,
        true
      );
      try { Vibration.vibrate(40); } catch {}
    } else {
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.BestForNavigation,
          mayShowUserSettingsDialog: true,
        });
        if (loc?.coords) {
          handleLocationUpdate(loc);
          pushLocationToMap(loc.coords.latitude, loc.coords.longitude, loc.coords.accuracy, true);
          try { Vibration.vibrate(40); } catch {}
        }
      } catch {
        Alert.alert('GPS Acquiring', 'Searching for GPS location... Please ensure Location/GPS is turned on.');
      }
    }
  }, [pushLocationToMap, handleLocationUpdate]);

  // ─── Boundary Walk Mode Handlers ──────────────────────────────────────────
  const startBoundaryWalkMode = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Location permission is required to walk the land boundary.');
      return;
    }

    setWalkCorners([]);
    setGeofenceWalkMode(true);

    // Start watching position at highest accuracy as user walks
    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Highest,
        distanceInterval: 1, // update every 1 meter
        timeInterval: 1000,
      },
      (loc) => {
        handleLocationUpdate(loc);
      }
    );
    setLocationWatcher(sub);
  };

  const stopBoundaryWalkMode = () => {
    if (locationWatcher) {
      locationWatcher.remove();
      setLocationWatcher(null);
    }
    setGeofenceWalkMode(false);
    setWalkCorners([]);
  };

  // Record corner point at current physical location
  const handleRecordCorner = async () => {
    try {
      let locCoords: { latitude: number; longitude: number; accuracy?: number | null } | null = null;
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (loc?.coords) {
          locCoords = loc.coords;
        }
      } catch {
        try {
          const lastKnown = await Location.getLastKnownPositionAsync({});
          if (lastKnown?.coords) {
            locCoords = lastKnown.coords;
          }
        } catch {}
        if (!locCoords && userCoords) {
          locCoords = { ...userCoords, accuracy: gpsAccuracy };
        }
      }

      if (!locCoords) {
        throw new Error('No GPS coordinate available');
      }

      const corner: GeofenceCoordinate = {
        latitude: locCoords.latitude,
        longitude: locCoords.longitude,
        accuracy: locCoords.accuracy ?? undefined,
        timestamp: Date.now(),
        corner_index: walkCorners.length + 1,
      };

      const updated = [...walkCorners, corner];
      setWalkCorners(updated);
      setUserCoords({ latitude: locCoords.latitude, longitude: locCoords.longitude });
      setGpsAccuracy(locCoords.accuracy ?? null);

      if (updated.length >= 2) {
        setTimeout(handleZoomToBoundary, 350);
      }

      Alert.alert(
        `Corner #${updated.length} Saved`,
        `Lat: ${corner.latitude.toFixed(5)}, Lng: ${corner.longitude.toFixed(5)}\nGPS Accuracy: ±${(locCoords.accuracy || 0).toFixed(1)}m\n\nWalk to the next corner point along the land boundary.`
      );
    } catch {
      Alert.alert('Location Error', 'Could not record current GPS position. Ensure GPS is enabled.');
    }
  };

  const handleUndoLastCorner = () => {
    if (walkCorners.length === 0) return;
    const remaining = walkCorners.slice(0, -1);
    setWalkCorners(remaining);
    if (remaining.length >= 2) {
      setTimeout(handleZoomToBoundary, 350);
    }
  };

  const handleClearCorners = () => {
    Alert.alert('Clear Corners', 'Discard all recorded boundary corners?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => setWalkCorners([]) },
    ]);
  };

  // Complete & Lock Land Boundary
  const handleCompleteAndLockBoundary = async () => {
    if (walkCorners.length < 3) {
      Alert.alert('Need 3+ Corners', 'A land boundary polygon requires at least 3 corner points to close the perimeter.');
      return;
    }

    if (!activeProjectId) {
      Alert.alert('Error', 'No active project selected.');
      return;
    }

    const areaSqM = calculatePolygonArea(walkCorners);
    const perimeterM = calculatePolygonPerimeter(walkCorners);
    const hectares = sqMetersToHectares(areaSqM);
    const acres = sqMetersToAcres(areaSqM);

    Alert.alert(
      'Complete & Lock Land Boundary',
      `Project: ${projectName || activeProjectId}\nCorners: ${walkCorners.length}\nPerimeter: ${perimeterM.toLocaleString()} m\nArea: ${hectares} ha (${acres} acres)\n\nThis will lock this land area boundary for this project. Once locked, modifying requires Admin approval.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm & Lock',
          style: 'default',
          onPress: async () => {
            setSavingGeofence(true);
            const { data, error } = await saveProjectGeofence({
              project_id: activeProjectId,
              project_name: projectName,
              coordinates: walkCorners,
              area_sq_m: areaSqM,
              perimeter_m: perimeterM,
              locked: true,
              status: 'locked',
              user,
            });

            setSavingGeofence(false);
            if (error || !data) {
              Alert.alert('Error', error || 'Failed to save land boundary.');
            } else {
              setProjectGeofence(data);
              stopBoundaryWalkMode();
              Alert.alert(
                'Land Area Locked!',
                `The land area boundary for ${projectName || 'this project'} has been successfully geofenced and locked.\nArea: ${hectares} Hectares (${areaSqM.toLocaleString()} m²)`
              );
            }
          },
        },
      ]
    );
  };

  // ─── Change Request Workflow ─────────────────────────────────────────────
  const handleSubmitChangeRequest = async () => {
    if (!activeProjectId || !user) return;
    if (!changeReason || changeReason.trim().length < 5) {
      Alert.alert('Reason Required', 'Please provide a clear reason for requesting a change to the locked boundary.');
      return;
    }

    setSubmittingChangeRequest(true);
    const { data, error } = await submitChangeRequest(
      activeProjectId,
      projectName || activeProjectId,
      user,
      changeReason
    );
    setSubmittingChangeRequest(false);

    if (error || !data) {
      Alert.alert('Submission Error', error || 'Could not submit change request.');
    } else {
      setShowRequestChangeModal(false);
      setChangeReason('');
      Alert.alert(
        'Request Submitted',
        'Your boundary change request has been sent to the Admin. Once approved, the boundary will unlock for editing.'
      );
    }
  };

  // Admin Direct Unlock / Redraw
  const handleAdminUnlock = async () => {
    if (!isAdmin || !user || !activeProjectId) return;

    Alert.alert(
      'Admin: Unlock Boundary',
      'Unlock this land boundary to allow re-walking or redrawing corners?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlock & Redraw',
          style: 'destructive',
          onPress: async () => {
            const { data, error } = await adminUnlockGeofence(activeProjectId, user);
            if (error || !data) {
              Alert.alert('Error', error || 'Failed to unlock.');
            } else {
              setProjectGeofence(data);
              setShowGeofenceModal(false);
              startBoundaryWalkMode();
            }
          },
        },
      ]
    );
  };

  // Admin Review Change Request
  const handleReviewRequest = async (requestId: string, approve: boolean) => {
    if (!isAdmin || !user) return;

    const { error } = await reviewChangeRequest(requestId, approve, user);
    if (error) {
      Alert.alert('Error', error);
    } else {
      Alert.alert('Updated', approve ? 'Request approved. Boundary unlocked.' : 'Request rejected.');
      // Refresh requests and geofence
      if (activeProjectId) {
        const { data: reqs } = await fetchChangeRequests(activeProjectId);
        setChangeRequests(reqs ?? []);
        const { data: geo } = await fetchProjectGeofence(activeProjectId);
        setProjectGeofence(geo);
      }
    }
  };

  // Lock a tree record
  const handleLockTree = async (tree: TreeRecord) => {
    if (tree.locked) {
      Alert.alert('Already Locked', 'This tree is already locked and cannot be modified.');
      return;
    }

    Alert.alert(
      'Lock Tree',
      `Lock "${tree.species || displayTreeId(tree, 'this tree')}"? This cannot be undone from the app.`,
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

  const hasActiveBoundary = Boolean(
    (geofenceWalkMode && walkCorners.length >= 2) ||
    (projectGeofence && projectGeofence.coordinates && projectGeofence.coordinates.length >= 2)
  );

  const handleZoomToBoundary = useCallback(() => {
    webViewRef.current?.injectJavaScript(`
      if (window.zoomToBoundary) {
        window.zoomToBoundary();
      }
      true;
    `);
  }, []);

  // Handle marker taps and events from WebView
  const handleWebViewMessage = useCallback(
    (event: any) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === 'ready') {
          if (userCoordsRef.current) {
            pushLocationToMap(userCoordsRef.current.latitude, userCoordsRef.current.longitude, gpsAccuracyRef.current, false);
          }
          // Map just (re)loaded — re-apply the nearest-tree highlight
          pushNearestTreeToMap(nearTreeRef.current?.id ?? null, true);
          if (!focusTreeId && hasActiveBoundary) {
            setTimeout(handleZoomToBoundary, 350);
          }
        } else if (data.type === 'markerTap' && data.treeId) {
          const tree = allTrees.find((t) => t.id === data.treeId);
          if (tree) {
            setSelectedTree(tree);
            setShowDetails(true);
          }
        }
      } catch {}
    },
    [allTrees, focusTreeId, hasActiveBoundary, handleZoomToBoundary, pushLocationToMap, pushNearestTreeToMap]
  );

  // Auto-zoom to boundary when project geofence is loaded
  useEffect(() => {
    if (projectGeofence && projectGeofence.coordinates && projectGeofence.coordinates.length >= 2 && !focusTreeId) {
      const timer = setTimeout(handleZoomToBoundary, 500);
      return () => clearTimeout(timer);
    }
  }, [projectGeofence, focusTreeId, handleZoomToBoundary]);

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

  // Compute live walking area stats
  const liveWalkArea = useMemo(() => {
    if (walkCorners.length < 3) return { areaSqM: 0, hectares: 0, acres: 0, perimeter: 0 };
    const areaSqM = calculatePolygonArea(walkCorners);
    const perimeter = calculatePolygonPerimeter(walkCorners);
    return {
      areaSqM,
      hectares: sqMetersToHectares(areaSqM),
      acres: sqMetersToAcres(areaSqM),
      perimeter,
    };
  }, [walkCorners]);

  // Number of trees inside the boundary
  const treesInsideBoundary = useMemo(() => {
    if (!projectGeofence || !projectGeofence.coordinates || projectGeofence.coordinates.length < 3) {
      return 0;
    }
    return allTrees.filter((t) =>
      t.latitude && t.longitude && isPointInPolygon({ latitude: t.latitude, longitude: t.longitude }, projectGeofence.coordinates)
    ).length;
  }, [allTrees, projectGeofence]);

  const treesToRender = useMemo(() => {
    if (isolateFocusedTree && focusTreeId) {
      const match = allTrees.filter((t) => t.id === focusTreeId);
      if (match.length > 0) return match;
    }
    return allTrees;
  }, [allTrees, isolateFocusedTree, focusTreeId]);

  const html = useMemo(
    () =>
      buildMapHtml(
        treesToRender,
        userCoordsRef.current?.latitude ?? (allTrees[0]?.latitude || 20.5937),
        userCoordsRef.current?.longitude ?? (allTrees[0]?.longitude || 78.9629),
        focusTreeId,
        projectGeofence?.coordinates,
        projectGeofence?.locked,
        geofenceWalkMode ? walkCorners : undefined,
        focusLat,
        focusLng,
        gpsAccuracyRef.current ?? undefined,
        userCoordsRef.current != null
      ),
    [treesToRender, focusTreeId, projectGeofence, geofenceWalkMode, walkCorners, focusLat, focusLng]
  );

  // Stable source object: recreating it every render can reset the WebView and
  // wipe the injected live-location updates.
  const mapSource = useMemo(() => ({ html }), [html]);

  const pendingRequestsCount = useMemo(
    () => changeRequests.filter((r) => r.status === 'pending').length,
    [changeRequests]
  );

  // The tree-details sheet shares the bottom edge with the floating controls;
  // lift the controls by the measured sheet height so they never cover it.
  const detailLift = showDetails && detailSheetH > 0 ? detailSheetH + 16 : 0;
  const hudBaseBottom = hasActiveBoundary && !focusTreeId ? insets.bottom + 122 : insets.bottom + 68;

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient colors={['#123f24', '#1a5c2a', '#2e7d43']} style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>PROJECT MAP & GEOFENCE</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {projectName || (focusTreeId ? 'Viewing Tree' : 'All Trees')}
          </Text>
        </View>
        <TouchableOpacity onPress={loadData} style={styles.refreshBtn}>
          <Ionicons name="refresh" size={22} color="#fff" />
        </TouchableOpacity>
      </LinearGradient>

      {/* Geofence Status Sub-Banner (Removed Land Locked bar as requested) */}
      {!projectGeofence?.locked && (
        <View style={styles.geofenceStatusBar}>
          <TouchableOpacity
            style={styles.geofenceChipPending}
            onPress={startBoundaryWalkMode}
            activeOpacity={0.8}
          >
            <Ionicons name="warning" size={14} color="#b45309" />
            <Text style={styles.geofenceChipTextPending}>
              Land Geofencing Required · Tap to Walk & Lock
            </Text>
            <Ionicons name="chevron-forward" size={14} color="#b45309" />
          </TouchableOpacity>

          {isAdmin && pendingRequestsCount > 0 && (
            <TouchableOpacity
              style={styles.adminReqBadge}
              onPress={() => setShowAdminRequestsModal(true)}
            >
              <Text style={styles.adminReqBadgeText}>Requests ({pendingRequestsCount})</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {projectGeofence?.locked && isAdmin && pendingRequestsCount > 0 && (
        <View style={styles.geofenceStatusBar}>
          <TouchableOpacity
            style={styles.adminReqBadge}
            onPress={() => setShowAdminRequestsModal(true)}
          >
            <Text style={styles.adminReqBadgeText}>Requests ({pendingRequestsCount})</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Specific Tree vs All Trees Filter Bar */}
      {focusTreeId && (
        <View style={styles.focusFilterBar}>
          <TouchableOpacity
            style={[styles.focusFilterChip, isolateFocusedTree && styles.focusFilterChipActive]}
            onPress={() => setIsolateFocusedTree(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="scan" size={13} color={isolateFocusedTree ? '#fff' : '#15803d'} />
            <Text style={[styles.focusFilterChipText, isolateFocusedTree && styles.focusFilterChipTextActive]}>
              This Tree Only
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.focusFilterChip, !isolateFocusedTree && styles.focusFilterChipActive]}
            onPress={() => setIsolateFocusedTree(false)}
            activeOpacity={0.8}
          >
            <Ionicons name="grid-outline" size={13} color={!isolateFocusedTree ? '#fff' : '#15803d'} />
            <Text style={[styles.focusFilterChipText, !isolateFocusedTree && styles.focusFilterChipTextActive]}>
              All Trees ({allTrees.length})
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Map WebView */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1a5c2a" />
          <Text style={styles.loadingText}>Loading project map & boundaries...</Text>
        </View>
      ) : (
        <WebView
          ref={webViewRef}
          source={mapSource}
          style={styles.map}
          onMessage={handleWebViewMessage}
          javaScriptEnabled={true}
        />
      )}

      {/* ─── Explorer HUD: nearest-tree radar + live GPS + locate FAB ─── */}
      {!geofenceWalkMode && (
        <View pointerEvents="box-none" style={[styles.hudCluster, { bottom: hudBaseBottom + detailLift }]}>
          {/* Nearest tree + vibration control */}
          {nearTree || !vibrateEnabled ? (
            <View style={styles.nearTreeCard}>
              <LinearGradient
                colors={
                  nearTree && nearTree.vibrating && vibrateEnabled
                    ? ['#fb923c', '#ea580c']
                    : nearTree
                      ? ['#4ade80', '#16a34a']
                      : ['#94a3b8', '#64748b']
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.nearRadar}
              >
                <Ionicons name={nearTree ? 'pulse' : 'leaf'} size={17} color="#fff" />
              </LinearGradient>

              <View style={styles.nearTreeInfo}>
                <Text style={styles.nearTreeTitle} numberOfLines={1}>
                  {nearTree ? nearTree.label : 'No tree nearby'}
                </Text>

                <View style={styles.nearDistRow}>
                  <Text
                    style={[
                      styles.nearDist,
                      nearTree?.vibrating && vibrateEnabled && styles.nearDistActive,
                    ]}
                  >
                    {nearTree
                      ? nearTree.distance < 100
                        ? `${nearTree.distance.toFixed(1)} m`
                        : `${(nearTree.distance / 1000).toFixed(2)} km`
                      : 'Scanning'}
                  </Text>
                  <View
                    style={[
                      styles.nearStatePill,
                      nearTree?.vibrating && vibrateEnabled && styles.nearStatePillActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.nearStatePillText,
                        nearTree?.vibrating && vibrateEnabled && styles.nearStatePillTextActive,
                      ]}
                    >
                      {nearTree
                        ? nearTree.vibrating && vibrateEnabled
                          ? 'VIBRATING'
                          : 'NEARBY'
                        : 'SEARCHING'}
                    </Text>
                  </View>
                </View>

                {nearTree ? (
                  <View style={styles.nearBarTrack}>
                    <View
                      style={[
                        styles.nearBarFill,
                        {
                          width: `${Math.min(
                            100,
                            Math.max(8, (1 - nearTree.distance / NEAR_TREE_HIGHLIGHT_M) * 100)
                          )}%`,
                          backgroundColor:
                            nearTree.vibrating && vibrateEnabled ? '#F09125' : '#22c55e',
                        },
                      ]}
                    />
                  </View>
                ) : null}
              </View>

              <TouchableOpacity
                style={[styles.nearVibeBtn, !vibrateEnabled && styles.nearVibeBtnResume]}
                onPress={toggleProximityVibration}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={vibrateEnabled ? 'stop-circle' : 'play-circle'}
                  size={16}
                  color={vibrateEnabled ? '#fff' : '#15803d'}
                />
                <Text style={[styles.nearVibeBtnText, !vibrateEnabled && styles.nearVibeBtnTextResume]}>
                  {vibrateEnabled ? 'Stop' : 'Resume'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Live GPS accuracy pill */}
          {userCoords && (
            <View style={styles.gpsBadge}>
              <View style={styles.gpsBadgeDotWrap}>
                <View
                  style={[
                    styles.gpsBadgeDot,
                    {
                      backgroundColor:
                        gpsAccuracy && gpsAccuracy <= 5
                          ? '#22c55e'
                          : gpsAccuracy && gpsAccuracy <= 20
                            ? '#f59e0b'
                            : '#ef4444',
                    },
                  ]}
                />
              </View>
              <Text style={styles.gpsBadgeText}>
                ±{gpsAccuracy ? Math.round(gpsAccuracy) : '--'}m
              </Text>
              <View style={styles.gpsLiveTag}>
                <Text style={styles.gpsLiveTagText}>LIVE</Text>
              </View>
            </View>
          )}

          {/* Locate me FAB */}
          <TouchableOpacity
            style={styles.myLocationFab}
            onPress={handleCenterOnMyLocation}
            activeOpacity={0.85}
          >
            <View style={styles.fabHalo}>
              <LinearGradient
                colors={['#38bdf8', '#2563eb', '#1d4ed8']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.fabInner}
              >
                <Ionicons name="locate" size={22} color="#fff" />
              </LinearGradient>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* Floating Auto-Zoom Land Fence Button */}
      {hasActiveBoundary && !focusTreeId && (
        <TouchableOpacity
          style={[
            styles.autoZoomFab,
            {
              bottom:
                (geofenceWalkMode ? insets.bottom + 270 : insets.bottom + 68) +
                (geofenceWalkMode ? 0 : detailLift),
            },
          ]}
          onPress={handleZoomToBoundary}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={['#34d399', '#059669', '#047857']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.autoZoomFabGradient}
          >
            <View style={styles.autoZoomIconWrap}>
              <Ionicons name="scan" size={14} color="#fff" />
            </View>
            <Text style={styles.autoZoomFabText}>Auto-Zoom Land Fence</Text>
            <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.85)" />
          </LinearGradient>
        </TouchableOpacity>
      )}

      {/* Geofence Alert Toast Banner */}
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

      {/* ─── LIVE WALK MODE FLOATING PANEL ─── */}
      {geofenceWalkMode ? (
        <View style={[styles.walkPanel, { bottom: insets.bottom + 12 }]}>
          <View style={styles.walkHeader}>
            <View style={styles.walkHeaderLeft}>
              <View style={styles.walkPulseDot} />
              <Text style={styles.walkTitle}>Walk Land Perimeter</Text>
            </View>
            <TouchableOpacity onPress={stopBoundaryWalkMode} style={styles.walkCloseBtn}>
              <Ionicons name="close" size={20} color="#666" />
            </TouchableOpacity>
          </View>

          <Text style={styles.walkInstruction}>
            Walk to each corner of the land edge with your phone. At each corner point, tap "Save Corner Point".
          </Text>

          {/* GPS Accuracy & Stats Pill */}
          <View style={styles.walkStatsRow}>
            <View style={styles.walkStatPill}>
              <Ionicons
                name="locate"
                size={13}
                color={gpsAccuracy && gpsAccuracy <= 5 ? '#16a34a' : gpsAccuracy && gpsAccuracy <= 10 ? '#d97706' : '#dc2626'}
              />
              <Text style={styles.walkStatPillText}>
                GPS: ±{gpsAccuracy ? gpsAccuracy.toFixed(1) : '...'}m
              </Text>
            </View>
            <View style={styles.walkStatPill}>
              <Ionicons name="pin" size={13} color="#1a5c2a" />
              <Text style={styles.walkStatPillText}>
                {walkCorners.length} {walkCorners.length === 1 ? 'Corner' : 'Corners'}
              </Text>
            </View>
            {walkCorners.length >= 3 && (
              <View style={[styles.walkStatPill, { backgroundColor: '#dcfce7' }]}>
                <Ionicons name="resize" size={13} color="#16a34a" />
                <Text style={[styles.walkStatPillText, { color: '#16a34a' }]}>
                  {liveWalkArea.hectares} ha
                </Text>
              </View>
            )}
          </View>

          {/* Action Buttons Row */}
          <View style={styles.walkActionsRow}>
            <TouchableOpacity
              style={styles.recordCornerBtn}
              onPress={handleRecordCorner}
              activeOpacity={0.8}
            >
              <Ionicons name="radio-button-on" size={20} color="#fff" />
              <Text style={styles.recordCornerBtnText}>
                Record Corner Point (⌖ P{walkCorners.length + 1})
              </Text>
            </TouchableOpacity>

            {walkCorners.length > 0 && (
              <TouchableOpacity
                style={styles.undoBtn}
                onPress={handleUndoLastCorner}
                activeOpacity={0.7}
              >
                <Ionicons name="arrow-undo" size={18} color="#444" />
              </TouchableOpacity>
            )}

            {walkCorners.length > 0 && (
              <TouchableOpacity
                style={styles.clearBtn}
                onPress={handleClearCorners}
                activeOpacity={0.7}
              >
                <Ionicons name="trash-outline" size={18} color="#dc2626" />
              </TouchableOpacity>
            )}
          </View>

          {/* Complete & Lock Button */}
          {walkCorners.length >= 3 ? (
            <TouchableOpacity
              style={styles.completeLockBtn}
              onPress={handleCompleteAndLockBoundary}
              disabled={savingGeofence}
              activeOpacity={0.85}
            >
              {savingGeofence ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="lock-closed" size={18} color="#fff" />
                  <Text style={styles.completeLockBtnText}>
                    Complete & Lock Land Area ({liveWalkArea.hectares} ha)
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <Text style={styles.walkMinText}>
              Record at least {3 - walkCorners.length} more {3 - walkCorners.length === 1 ? 'corner' : 'corners'} to complete the boundary.
            </Text>
          )}
        </View>
      ) : (
        /* Normal Stats bar - floating overlay */
        <View style={[styles.statsBar, { bottom: insets.bottom + 12 }]}>
          <View style={styles.statItem}>
            <View style={[styles.statIconWrap, { backgroundColor: '#dcfce7' }]}>
              <Ionicons name="leaf" size={14} color="#16a34a" />
            </View>
            <Text style={styles.statText}>{allTrees.length}</Text>
          </View>

          <View style={styles.statDivider} />

          <TouchableOpacity
            style={styles.statItem}
            onPress={() => {
              if (projectGeofence?.locked) {
                setShowGeofenceModal(true);
              } else {
                startBoundaryWalkMode();
              }
            }}
          >
            <View style={[styles.statIconWrap, { backgroundColor: projectGeofence?.locked ? '#dcfce7' : '#fef3c7' }]}>
              <Ionicons
                name={projectGeofence?.locked ? 'lock-closed' : 'walk'}
                size={14}
                color={projectGeofence?.locked ? '#16a34a' : '#d97706'}
              />
            </View>
            <Text style={styles.statText}>
              {projectGeofence?.locked ? `${projectGeofence.area_hectares || sqMetersToHectares(projectGeofence.area_sq_m)} ha` : 'Walk Area'}
            </Text>
          </TouchableOpacity>

          <View style={styles.statDivider} />

          <View style={styles.statItem}>
            <View style={[styles.statIconWrap, { backgroundColor: '#dbeafe' }]}>
              <Ionicons name="shield-checkmark" size={14} color="#4285f4" />
            </View>
            <Text style={styles.statText}>{treesInsideBoundary} inside</Text>
          </View>

          {geofenceAlerts.length > 0 && (
            <TouchableOpacity style={styles.alertBadge} onPress={() => setShowAlerts(true)}>
              <Ionicons name="notifications" size={14} color="#fff" />
              <Text style={styles.alertBadgeText}>{geofenceAlerts.length}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ─── LAND AREA DETAILS & LOCK MODAL ─── */}
      <Modal visible={showGeofenceModal} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={styles.modalBackdropTouch} activeOpacity={1} onPress={() => setShowGeofenceModal(false)} />
          <View style={styles.detailSheet}>
            <View style={styles.detailHeader}>
              <View style={styles.detailHeaderLeft}>
                <Text style={styles.detailSpecies}>
                  {projectGeofence?.locked ? '🔒 Land Boundary Locked' : '📍 Land Area Geofence'}
                </Text>
                <Text style={styles.detailId}>{projectName || activeProjectId}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowGeofenceModal(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            {projectGeofence ? (
              <ScrollView style={{ maxHeight: 380 }}>
                <View style={styles.detailGrid}>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailLabel}>Land Area</Text>
                    <Text style={styles.detailValue}>
                      {projectGeofence.area_hectares || sqMetersToHectares(projectGeofence.area_sq_m)} ha
                    </Text>
                    <Text style={{ fontSize: 10, color: '#888' }}>
                      ({(projectGeofence.area_sq_m || 0).toLocaleString()} m²)
                    </Text>
                  </View>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailLabel}>Perimeter</Text>
                    <Text style={styles.detailValue}>
                      {(projectGeofence.perimeter_m || 0).toLocaleString()} m
                    </Text>
                  </View>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailLabel}>Corners Saved</Text>
                    <Text style={styles.detailValue}>
                      {projectGeofence.coordinates?.length || 0} Points
                    </Text>
                  </View>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailLabel}>Trees Inside</Text>
                    <Text style={styles.detailValue}>{treesInsideBoundary} Trees</Text>
                  </View>
                </View>

                {projectGeofence.locked && (
                  <View style={styles.lockedNoticeBox}>
                    <Ionicons name="shield-checkmark" size={18} color="#15803d" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lockedNoticeTitle}>Admin Confirmed & Locked</Text>
                      <Text style={styles.lockedNoticeSub}>
                        Locked by {projectGeofence.locked_by_name || 'Admin'}
                        {projectGeofence.locked_at ? ` on ${new Date(projectGeofence.locked_at).toLocaleDateString()}` : ''}
                      </Text>
                    </View>
                  </View>
                )}

                <View style={styles.boundaryActionsRow}>
                  {isAdmin ? (
                    <TouchableOpacity
                      style={[styles.modalActionBtn, { backgroundColor: '#dc2626' }]}
                      onPress={handleAdminUnlock}
                    >
                      <Ionicons name="lock-open-outline" size={16} color="#fff" />
                      <Text style={styles.modalActionBtnText}>Admin: Unlock & Redraw</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.modalActionBtn, { backgroundColor: '#1a5c2a' }]}
                      onPress={() => {
                        setShowGeofenceModal(false);
                        setShowRequestChangeModal(true);
                      }}
                    >
                      <Ionicons name="git-pull-request-outline" size={16} color="#fff" />
                      <Text style={styles.modalActionBtnText}>Request Boundary Change</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* ─── REQUEST BOUNDARY CHANGE MODAL ─── */}
      <Modal visible={showRequestChangeModal} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={styles.modalBackdropTouch} activeOpacity={1} onPress={() => setShowRequestChangeModal(false)} />
          <View style={styles.detailSheet}>
            <View style={styles.detailHeader}>
              <View style={styles.detailHeaderLeft}>
                <Text style={styles.detailSpecies}>Request Boundary Change</Text>
                <Text style={styles.detailId}>Requires Admin Review & Approval</Text>
              </View>
              <TouchableOpacity onPress={() => setShowRequestChangeModal(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            <Text style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
              This land boundary is currently locked. To redraw or adjust the corner points, submit a change request explaining why the boundary needs modification.
            </Text>

            <TextInput
              style={styles.changeInput}
              placeholder="e.g. Boundary fencing expanded 20m North, or corner 3 was misaligned..."
              placeholderTextColor="#999"
              multiline
              numberOfLines={4}
              value={changeReason}
              onChangeText={setChangeReason}
            />

            <TouchableOpacity
              style={[styles.completeLockBtn, { marginTop: 14 }]}
              onPress={handleSubmitChangeRequest}
              disabled={submittingChangeRequest}
            >
              {submittingChangeRequest ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="send" size={18} color="#fff" />
                  <Text style={styles.completeLockBtnText}>Submit Request to Admin</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ─── ADMIN CHANGE REQUESTS REVIEW MODAL ─── */}
      <Modal visible={showAdminRequestsModal} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={styles.modalBackdropTouch} activeOpacity={1} onPress={() => setShowAdminRequestsModal(false)} />
          <View style={styles.detailSheet}>
            <View style={styles.detailHeader}>
              <View style={styles.detailHeaderLeft}>
                <Text style={styles.detailSpecies}>Boundary Change Requests</Text>
                <Text style={styles.detailId}>Admin Review</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAdminRequestsModal(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 350 }}>
              {changeRequests.length === 0 ? (
                <Text style={{ textAlign: 'center', color: '#888', marginVertical: 20 }}>
                  No boundary change requests for this project.
                </Text>
              ) : (
                changeRequests.map((req) => (
                  <View key={req.id} style={styles.reqCard}>
                    <View style={styles.reqCardHeader}>
                      <Text style={styles.reqUser}>{req.requested_by_name || 'User'}</Text>
                      <View style={[styles.reqStatusChip, req.status === 'pending' ? styles.chipPending : styles.chipApproved]}>
                        <Text style={styles.reqStatusText}>{req.status.toUpperCase()}</Text>
                      </View>
                    </View>
                    <Text style={styles.reqReason}>"{req.reason}"</Text>
                    <Text style={styles.reqDate}>{new Date(req.created_at).toLocaleDateString()}</Text>

                    {req.status === 'pending' && (
                      <View style={styles.reqActions}>
                        <TouchableOpacity
                          style={[styles.reqBtn, { backgroundColor: '#16a34a' }]}
                          onPress={() => handleReviewRequest(req.id, true)}
                        >
                          <Text style={styles.reqBtnText}>Approve & Unlock</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.reqBtn, { backgroundColor: '#ef4444' }]}
                          onPress={() => handleReviewRequest(req.id, false)}
                        >
                          <Text style={styles.reqBtnText}>Reject</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ─── TREE DETAILS FLOATING CARD (Non-modal: map is 100% interactive & clear) ─── */}
      {selectedTree && showDetails && (
        <View
          style={[styles.floatingDetailSheet, { bottom: insets.bottom + 12 }]}
          onLayout={(e) => setDetailSheetH(e.nativeEvent.layout.height)}
        >
          {(() => {
            let cleanNotes = selectedTree.notes || '';
            let meta: Record<string, any> = {};
            const metaMatch = (selectedTree.notes || '').match(/##META##({.*})/s);
            if (metaMatch) {
              try { meta = JSON.parse(metaMatch[1]); } catch {}
              cleanNotes = selectedTree.notes!.replace(/##META##{.*}/s, '').trim();
            }
            const dbh = selectedTree.dbh_cm || meta.dbh_cm;
            const height = selectedTree.height_m || meta.height_m;
            const condition = selectedTree.tree_condition || meta.tree_condition;
            const date = selectedTree.survey_date || meta.survey_date || selectedTree.submitted_at?.split('T')[0] || '';
            const condColor = CONDITION_COLORS[condition || 'Healthy'] || '#16a34a';

            return (
              <>
                <View style={styles.detailHeader}>
                  <View style={styles.detailHeaderLeft}>
                    <Text style={styles.detailSpecies}>
                      {selectedTree.locked ? '🔒 ' : '🌳 '}
                      {selectedTree.species || 'Unknown Species'}
                    </Text>
                    <Text style={styles.detailId}>
                      {displayTreeId(selectedTree)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setShowDetails(false)}
                    style={styles.closeCardBtn}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="close" size={20} color="#475569" />
                  </TouchableOpacity>
                </View>

                <View style={styles.detailGrid}>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailLabel}>Condition</Text>
                    {condition ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: condColor }} />
                        <Text style={[styles.detailValue, { color: condColor }]}>{condition}</Text>
                      </View>
                    ) : (
                      <Text style={[styles.detailValue, { color: '#ccc' }]}>Not set</Text>
                    )}
                  </View>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailLabel}>DBH</Text>
                    <Text style={[styles.detailValue, !dbh && { color: '#ccc' }]}>
                      {dbh ? `${dbh} cm` : 'Not recorded'}
                    </Text>
                  </View>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailLabel}>Height</Text>
                    <Text style={[styles.detailValue, !height && { color: '#ccc' }]}>
                      {height ? `${height} m` : 'Not recorded'}
                    </Text>
                  </View>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailLabel}>Date</Text>
                    <Text style={[styles.detailValue, !date && { color: '#ccc' }]}>
                      {date || 'Not recorded'}
                    </Text>
                  </View>
                </View>

                {cleanNotes ? (
                  <View style={styles.detailNotes}>
                    <Text style={styles.detailNotesLabel}>Notes</Text>
                    <Text style={styles.detailNotesText} numberOfLines={2}>{cleanNotes}</Text>
                  </View>
                ) : null}

                <View style={styles.detailFooterContainer}>
                  <View style={styles.detailMetaRow}>
                    <View style={styles.detailCoords}>
                      <Ionicons name="location" size={13} color="#1a5c2a" />
                      <Text style={styles.detailCoordsText}>
                        {selectedTree.latitude?.toFixed(5)}, {selectedTree.longitude?.toFixed(5)}
                      </Text>
                    </View>

                    {!selectedTree.locked ? (
                      <TouchableOpacity
                        style={styles.detailActionLock}
                        onPress={() => handleLockTree(selectedTree)}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="lock-closed-outline" size={13} color="#ea580c" />
                        <Text style={styles.detailActionLockText}>Lock Tree</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.lockedPill}>
                        <Ionicons name="lock-closed" size={12} color="#64748b" />
                        <Text style={styles.lockedPillText}>Locked</Text>
                      </View>
                    )}
                  </View>

                  <TouchableOpacity
                    style={styles.detailActionPrimaryFull}
                    onPress={() => {
                      try {
                        navigation.navigate('TreeDetail', { treeId: selectedTree.id });
                      } catch {
                        navigation.navigate('History', {
                          screen: 'TreeDetail',
                          params: { treeId: selectedTree.id },
                        });
                      }
                    }}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="eye-outline" size={15} color="#fff" />
                    <Text style={styles.detailActionPrimaryFullText}>Full Details</Text>
                    <Ionicons name="arrow-forward" size={14} color="#fff" />
                  </TouchableOpacity>
                </View>
              </>
            );
          })()}
        </View>
      )}

      {/* Floating Pill when minimized */}
      {selectedTree && !showDetails && (
        <TouchableOpacity
          style={[styles.floatingDetailPill, { bottom: insets.bottom + 14 }]}
          onPress={() => setShowDetails(true)}
          activeOpacity={0.85}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 }}>
            <Ionicons name="leaf" size={16} color="#15803d" />
            <Text style={styles.floatingDetailPillText} numberOfLines={1}>
              {selectedTree.species || 'Tree'} · {displayTreeId(selectedTree)}
            </Text>
          </View>
          <View style={styles.pillExpandBtn}>
            <Text style={styles.pillExpandText}>Tree Details</Text>
            <Ionicons name="chevron-up" size={14} color="#15803d" />
          </View>
        </TouchableOpacity>
      )}

      {/* ─── GEOFENCE ALERTS MODAL ─── */}
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
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 44,
    paddingBottom: 10,
    paddingHorizontal: 12,
  },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  headerCenter: { flex: 1, alignItems: 'center', marginHorizontal: 8 },
  headerTitle: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  headerSubtitle: { color: '#cde8d3', fontSize: 11, marginTop: 1 },
  refreshBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  map: { flex: 1 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f4f1' },
  loadingText: { marginTop: 12, fontSize: 14, color: '#666' },

  // Geofence status sub-banner
  geofenceStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  geofenceChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
    gap: 6,
  },
  geofenceChipLocked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#dcfce7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    flex: 1,
  },
  geofenceChipTextLocked: {
    fontSize: 12,
    fontWeight: '700',
    color: '#15803d',
    flex: 1,
  },
  zoomTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(21,128,61,0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  zoomTagText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#15803d',
  },
  infoBtn: {
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  autoZoomFab: {
    position: 'absolute',
    right: 14,
    zIndex: 90,
    elevation: 6,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    borderRadius: 24,
  },
  autoZoomFabGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  autoZoomIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  autoZoomFabText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // ─── Explorer HUD: right-hand floating stack (radar card + GPS + FAB) ───
  hudCluster: {
    position: 'absolute',
    right: 14,
    zIndex: 95,
    elevation: 8,
    alignItems: 'flex-end',
    gap: 8,
  },

  // Nearest-tree radar card
  nearTreeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    maxWidth: 280,
    backgroundColor: 'rgba(11,19,32,0.94)',
    padding: 9,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 9,
  },
  nearRadar: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  nearTreeInfo: {
    flexShrink: 1,
    width: 118,
  },
  nearTreeTitle: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  nearDistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  nearDist: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  nearDistActive: {
    color: '#FDBA74',
  },
  nearStatePill: {
    flexShrink: 0,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 7,
    backgroundColor: 'rgba(148,163,184,0.25)',
  },
  nearStatePillActive: {
    backgroundColor: 'rgba(240,145,37,0.28)',
  },
  nearStatePillText: {
    color: '#94a3b8',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  nearStatePillTextActive: {
    color: '#FDBA74',
  },
  nearBarTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.16)',
    marginTop: 5,
    overflow: 'hidden',
  },
  nearBarFill: {
    height: 4,
    borderRadius: 2,
  },
  nearVibeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: '#dc2626',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  nearVibeBtnResume: {
    backgroundColor: '#dcfce7',
    borderColor: '#16a34a',
  },
  nearVibeBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  nearVibeBtnTextResume: {
    color: '#15803d',
  },

  // Live GPS pill
  gpsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(11,19,32,0.92)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  gpsBadgeDotWrap: {
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  gpsBadgeDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  gpsBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  gpsLiveTag: {
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 6,
    backgroundColor: 'rgba(34,197,94,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.5)',
  },
  gpsLiveTagText: {
    color: '#4ade80',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },

  // Locate-me FAB
  myLocationFab: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
    elevation: 9,
  },
  fabHalo: {
    width: 54,
    height: 54,
    borderRadius: 27,
    padding: 3,
    backgroundColor: 'rgba(37,99,235,0.28)',
    borderWidth: 1.5,
    borderColor: 'rgba(147,197,253,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabInner: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  geofenceChipPending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fef3c7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    flex: 1,
    marginRight: 8,
  },
  geofenceChipTextPending: {
    fontSize: 12,
    fontWeight: '700',
    color: '#b45309',
    flex: 1,
  },
  adminReqBadge: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  adminReqBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },

  toastBanner: {
    position: 'absolute',
    top: 108,
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

  // Stats bar - floating overlay
  statsBar: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderRadius: 20,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
  },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statDivider: { width: 1, height: 16, backgroundColor: '#E5E5E5' },
  statText: { fontSize: 13, fontWeight: '700', color: '#333' },
  alertBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ef4444',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    marginLeft: 4,
  },
  alertBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  // ─── Walk Mode Floating Panel ───
  walkPanel: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  walkHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  walkHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  walkPulseDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#16a34a' },
  walkTitle: { fontSize: 16, fontWeight: '800', color: '#1a5c2a' },
  walkCloseBtn: { padding: 4 },
  walkInstruction: { fontSize: 12, color: '#666', lineHeight: 17, marginBottom: 10 },
  walkStatsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  walkStatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  walkStatPillText: { fontSize: 11, fontWeight: '700', color: '#374151' },
  walkActionsRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  recordCornerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1a5c2a',
    paddingVertical: 12,
    borderRadius: 12,
  },
  recordCornerBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  undoBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  clearBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#fee2e2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeLockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F09125',
    paddingVertical: 13,
    borderRadius: 12,
    marginTop: 10,
  },
  completeLockBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  walkMinText: { fontSize: 11, color: '#888', textAlign: 'center', marginTop: 8 },

  // Details Modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBackdropTouch: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  detailSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
    maxHeight: '75%',
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
  lockedNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#dcfce7',
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  lockedNoticeTitle: { fontSize: 13, fontWeight: '700', color: '#15803d' },
  lockedNoticeSub: { fontSize: 11, color: '#166534', marginTop: 2 },
  boundaryActionsRow: { marginTop: 8 },
  modalActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  modalActionBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  // Change request modal
  changeInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
    color: '#1a1a1a',
    backgroundColor: '#f9fafb',
    textAlignVertical: 'top',
    minHeight: 90,
  },

  // Admin request card
  reqCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  reqCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reqUser: { fontSize: 13, fontWeight: '700', color: '#333' },
  reqStatusChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  chipPending: { backgroundColor: '#fef3c7' },
  chipApproved: { backgroundColor: '#dcfce7' },
  reqStatusText: { fontSize: 9, fontWeight: '800', color: '#374151' },
  reqReason: { fontSize: 12, color: '#4b5563', marginVertical: 6, fontStyle: 'italic' },
  reqDate: { fontSize: 10, color: '#9ca3af' },
  reqActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  reqBtn: { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  reqBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },

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
  alertSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
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

  // Floating Tree Details Card (non-modal)
  floatingDetailSheet: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 200,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  floatingDetailPill: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 190,
    backgroundColor: '#ffffff',
    borderRadius: 30,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 11,
    borderWidth: 1.5,
    borderColor: '#86efac',
  },
  floatingDetailPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#15803d',
  },
  pillExpandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#dcfce7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  pillExpandText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803d',
  },
  closeCardBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailFooterContainer: {
    marginTop: 6,
  },
  detailMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  detailCoords: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#f0fdf4',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    flexShrink: 1,
  },
  detailCoordsText: {
    fontSize: 11,
    color: '#1a5c2a',
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  detailActionLock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fdba74',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    flexShrink: 0,
  },
  detailActionLockText: {
    color: '#ea580c',
    fontSize: 11,
    fontWeight: '700',
  },
  lockedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
    flexShrink: 0,
  },
  lockedPillText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
  },
  detailActionPrimaryFull: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1a5c2a',
    paddingVertical: 10,
    borderRadius: 12,
    shadowColor: '#1a5c2a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  detailActionPrimaryFullText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // Focus filter bar
  focusFilterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: '#f0fdf4',
    borderBottomWidth: 1,
    borderBottomColor: '#dcfce7',
  },
  focusFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: '#e2e8f0',
  },
  focusFilterChipActive: {
    backgroundColor: '#16a34a',
  },
  focusFilterChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  focusFilterChipTextActive: {
    color: '#ffffff',
  },
});
