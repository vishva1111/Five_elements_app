import { useState, useEffect, useCallback, useRef } from 'react';
import {
  geofenceMonitor,
  createZonesFromTrees,
  DEFAULT_GEOFENCE_RADIUS,
} from '../services/geofenceService';
import { TreeRecord, GeofenceAlert, GeofenceZone } from '../types';

interface UseGeofencingOptions {
  trees: TreeRecord[];
  enabled?: boolean;
  radiusMeters?: number;
  onAlert?: (alerts: GeofenceAlert[]) => void;
}

interface UseGeofencingResult {
  isMonitoring: boolean;
  alerts: GeofenceAlert[];
  zones: GeofenceZone[];
  start: () => Promise<void>;
  stop: () => void;
  clearAlerts: () => void;
}

export function useGeofencing({
  trees,
  enabled = true,
  radiusMeters = DEFAULT_GEOFENCE_RADIUS,
  onAlert,
}: UseGeofencingOptions): UseGeofencingResult {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [alerts, setAlerts] = useState<GeofenceAlert[]>([]);
  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;

  const zones = createZonesFromTrees(trees, radiusMeters);

  const handleAlerts = useCallback((newAlerts: GeofenceAlert[]) => {
    setAlerts((prev) => [...prev, ...newAlerts]);
    onAlertRef.current?.(newAlerts);
  }, []);

  const start = useCallback(async () => {
    if (zones.length === 0) return;
    await geofenceMonitor.start(zones, handleAlerts);
    setIsMonitoring(true);
  }, [zones, handleAlerts]);

  const stop = useCallback(() => {
    geofenceMonitor.stop();
    setIsMonitoring(false);
  }, []);

  const clearAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  // Auto-start/stop when trees change or enabled toggles
  useEffect(() => {
    if (enabled && zones.length > 0) {
      start();
    } else {
      stop();
    }
    return () => stop();
  }, [enabled, zones.length]);

  return {
    isMonitoring,
    alerts,
    zones,
    start,
    stop,
    clearAlerts,
  };
}
