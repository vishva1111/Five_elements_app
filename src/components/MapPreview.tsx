import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { Coordinates } from '../types';

interface Props {
  coords: Coordinates;
  onPress?: () => void;
  height?: number;
  interactive?: boolean;
}

export default function MapPreview({
  coords,
  height = 180,
}: Props) {
  const lat = Number(coords.latitude) || 0;
  const lng = Number(coords.longitude) || 0;

  const html = useMemo(() => `<!DOCTYPE html>
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
</html>`, [lat, lng]);

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
    borderRadius: 7.5,
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
    borderRadius: 7.5,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  coordsText: { color: '#fff', fontSize: 11 },
});
