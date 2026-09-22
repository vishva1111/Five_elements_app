import * as Location from 'expo-location';
import { GeofenceZone, GeofenceEvent, GeofenceAlert, TreeRecord } from '../types';

// ─── Haversine distance between two coordinates (in meters) ──────────────────
// Used for geofence entry/exit detection. No external library needed.
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ─── Default geofence radius (meters) ────────────────────────────────────────
export const DEFAULT_GEOFENCE_RADIUS = 100;

// ─── Create geofence zones from tree records ─────────────────────────────────
// Each tree gets a circular geofence around its coordinates.
export function createZonesFromTrees(
  trees: TreeRecord[],
  radiusMeters: number = DEFAULT_GEOFENCE_RADIUS
): GeofenceZone[] {
  return trees
    .filter((t) => t.latitude && t.longitude)
    .map((t) => ({
      id: `zone-${t.id}`,
      treeId: t.id,
      latitude: t.latitude,
      longitude: t.longitude,
      radius: radiusMeters,
      label: t.species || t.tree_id || 'Tree',
    }));
}

// ─── Check which zones a point is inside ─────────────────────────────────────
export function checkZones(
  latitude: number,
  longitude: number,
  zones: GeofenceZone[]
): Set<string> {
  const inside = new Set<string>();
  for (const zone of zones) {
    const dist = haversineDistance(latitude, longitude, zone.latitude, zone.longitude);
    if (dist <= zone.radius) {
      inside.add(zone.id);
    }
  }
  return inside;
}

// ─── Detect enter/exit events by comparing previous and current zone sets ─────
export function detectEvents(
  prevInside: Set<string>,
  currInside: Set<string>,
  zones: GeofenceZone[]
): GeofenceAlert[] {
  const alerts: GeofenceAlert[] = [];
  const now = Date.now();

  for (const zone of zones) {
    const wasInside = prevInside.has(zone.id);
    const isInside = currInside.has(zone.id);

    if (!wasInside && isInside) {
      alerts.push({ zone, event: 'enter', timestamp: now });
    } else if (wasInside && !isInside) {
      alerts.push({ zone, event: 'exit', timestamp: now });
    }
  }

  return alerts;
}

// ─── Geofence Monitor ────────────────────────────────────────────────────────
// Watches the user's position and calls back on enter/exit events.
// Uses expo-location's watchPositionAsync for continuous tracking.
export type GeofenceCallback = (alerts: GeofenceAlert[]) => void;

export interface GeofenceMonitor {
  start: (zones: GeofenceZone[], callback: GeofenceCallback) => Promise<void>;
  stop: () => void;
  isRunning: () => boolean;
}

let monitorSubscription: Location.LocationSubscription | null = null;
let prevZoneState = new Set<string>();
let activeZones: GeofenceZone[] = [];
let onGeofenceCallback: GeofenceCallback | null = null;

function handlePositionUpdate(location: Location.LocationObject) {
  const { latitude, longitude } = location.coords;
  const currInside = checkZones(latitude, longitude, activeZones);
  const alerts = detectEvents(prevZoneState, currInside, activeZones);

  if (alerts.length > 0 && onGeofenceCallback) {
    onGeofenceCallback(alerts);
  }

  prevZoneState = currInside;
}

// ─── Get permission + start watching position ────────────────────────────────
async function startMonitor(zones: GeofenceZone[], callback: GeofenceCallback) {
  // Stop any existing monitor first
  if (monitorSubscription) {
    monitorSubscription.remove();
    monitorSubscription = null;
  }

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    console.warn('[Geofence] Location permission denied');
    return;
  }

  activeZones = zones;
  onGeofenceCallback = callback;
  prevZoneState = new Set();

  monitorSubscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      distanceInterval: 10, // update every 10 meters
      timeInterval: 10000,  // or every 10 seconds
    },
    handlePositionUpdate
  );
}

function stopMonitor() {
  if (monitorSubscription) {
    monitorSubscription.remove();
    monitorSubscription = null;
  }
  activeZones = [];
  prevZoneState = new Set();
  onGeofenceCallback = null;
}

// ─── Public API ──────────────────────────────────────────────────────────────
export const geofenceMonitor: GeofenceMonitor = {
  start: async (zones: GeofenceZone[], callback: GeofenceCallback) => {
    await startMonitor(zones, callback);
  },
  stop: stopMonitor,
  isRunning: () => monitorSubscription !== null,
};
