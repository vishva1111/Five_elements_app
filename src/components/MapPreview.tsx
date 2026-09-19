import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { Coordinates } from '../types';
import {
  getMapboxToken,
  isMapboxConfigured,
  MAPBOX_GL_JS_CDN,
  MAPBOX_GL_CSS_CDN,
  DEFAULT_STYLE,
} from '../services/mapboxConfig';

interface Props {
  coords: Coordinates;
  onPress?: () => void;
  height?: number;
  interactive?: boolean;
}

function buildMapboxHtml(lat: number, lng: number, token: string): string {
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
var map=new mapboxgl.Map({
  container:'map',
  style:'${DEFAULT_STYLE}',
  center:[${lng},${lat}],
  zoom:17,
  interactive:false,
  renderWorldCopies:false,
  maxPitch:60,
  fadeDuration:0
});
map.on('load',function(){
  new mapboxgl.Marker({color:'#1a5c2a'})
    .setLngLat([${lng},${lat}])
    .addTo(map);
});
</script>
</body>
</html>`;
}

function buildLeafletHtml(lat: number, lng: number): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{margin:0;padding:0;width:100%;height:100%;}</style>
</head>
<body>
<div id="map"></div>
<script>
var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([${lat},${lng}],17);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
L.marker([${lat},${lng}]).addTo(map);
</script>
</body>
</html>`;
}

export default function MapPreview({
  coords,
  height = 180,
}: Props) {
  const lat = Number(coords.latitude) || 0;
  const lng = Number(coords.longitude) || 0;
  const token = getMapboxToken();

  const html = useMemo(
    () =>
      token
        ? buildMapboxHtml(lat, lng, token)
        : buildLeafletHtml(lat, lng),
    [lat, lng, token]
  );

  return (
    <View style={[styles.container, { height }]}>
      <WebView
        source={{ html }}
        style={styles.webview}
        scrollEnabled={false}
        pointerEvents="none"
      />
      <View style={styles.coordsOverlay}>
        <Text style={styles.coordsText}>
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#e8f5e9',
  },
  webview: {
    flex: 1,
  },
  coordsOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  coordsText: { color: '#fff', fontSize: 11 },
});
