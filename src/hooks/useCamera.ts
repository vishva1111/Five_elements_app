import { useState, useRef, useCallback } from 'react';
import { CameraView } from 'expo-camera';

export function useCamera() {
  const cameraRef = useRef<CameraView>(null);
  const [isReady, setIsReady] = useState(false);
  const [flash, setFlash] = useState<'off' | 'on' | 'auto'>('off');
  const [facing, setFacing] = useState<'front' | 'back'>('back');

  const takePicture = useCallback(async (): Promise<string | null> => {
    if (!cameraRef.current || !isReady) return null;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: false,
        skipProcessing: false,
      });
      return photo?.uri ?? null;
    } catch (err) {
      console.error('Camera capture error:', err);
      return null;
    }
  }, [isReady]);

  const toggleFlash = useCallback(() => {
    setFlash((prev) => (prev === 'off' ? 'on' : 'off'));
  }, []);

  const toggleFacing = useCallback(() => {
    setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
  }, []);

  return {
    cameraRef,
    isReady,
    flash,
    facing,
    setIsReady,
    takePicture,
    toggleFlash,
    toggleFacing,
  };
}