import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import MapView, { Marker, UrlTile } from 'react-native-maps';
import { Coordinates } from '../types';

interface Props {
  coords: Coordinates;
  onPress?: () => void;
  height?: number;
  interactive?: boolean;
}

// OpenStreetMap tile URL — 100% FREE, no API key needed
const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export default function MapPreview({
  coords,
  onPress,
  height = 180,
  interactive = false,
}: Props) {
  const region = {
    latitude: coords.latitude,
    longitude: coords.longitude,
    latitudeDelta: 0.005,
    longitudeDelta: 0.005,
  };

  return (
    <TouchableOpacity
      style={[styles.container, { height }]}
      onPress={onPress}
      activeOpacity={onPress ? 0.85 : 1}
      disabled={!onPress}
    >
      <MapView
        style={StyleSheet.absoluteFillObject}
        region={region}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        rotateEnabled={false}
        pitchEnabled={false}
        mapType="none"
      >
        {/* OpenStreetMap tiles — FREE */}
        <UrlTile
          urlTemplate={OSM_TILE_URL}
          maximumZ={19}
          flipY={false}
        />
        <Marker
          coordinate={{ latitude: coords.latitude, longitude: coords.longitude }}
          title="Tree Location"
        />
      </MapView>

      {/* Coords overlay */}
      <View style={styles.coordsOverlay}>
        <Text style={styles.coordsText}>
          📍 {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}
        </Text>
      </View>

      {onPress && (
        <View style={styles.tapHint}>
          <Text style={styles.tapHintText}>Tap to adjust location</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#e8f5e9',
  },
  coordsOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  coordsText: { color: '#fff', fontSize: 11 },
  tapHint: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(26,92,42,0.85)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tapHintText: { color: '#fff', fontSize: 11, fontWeight: '600' },
});