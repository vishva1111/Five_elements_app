import { useState, useCallback } from 'react';
import * as Location from 'expo-location';
import { Coordinates } from '../types';

export function useLocation() {
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestLocation = useCallback(async (): Promise<Coordinates | null> => {
    setLoading(true);
    setError(null);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied. Please enable location in settings.');
        return null;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const result: Coordinates = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy ?? undefined,
      };

      setCoords(result);
      return result;
    } catch (err) {
      setError('Failed to get location. Please try again.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { coords, loading, error, requestLocation };
}