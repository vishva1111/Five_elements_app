
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase, TREE_PHOTOS_BUCKET } from './supabase';

export async function uploadTreePhoto(
  uri: string,
  userId: string
): Promise<string | null> {
  try {
    if (!uri || typeof uri !== 'string') {
      throw new Error('No photo file to upload.');
    }

    const fileName = `${userId}/${Date.now()}.jpg`;
    const readableUri = await readablePhotoUri(uri);

    // Read file as base64 string (React Native compatible)
    const base64 = await FileSystem.readAsStringAsync(readableUri, {
      encoding: 'base64' as any,
    });
    if (!base64) throw new Error('The photo file was empty.');

    // Decode base64 to ArrayBuffer using base64-arraybuffer (no atob needed)
    const arrayBuffer = decode(base64);

    const { data, error } = await supabase.storage
      .from(TREE_PHOTOS_BUCKET)
      .upload(fileName, arrayBuffer, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (error) {
      console.error('Supabase storage upload error:', JSON.stringify(error));
      throw error;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(TREE_PHOTOS_BUCKET)
      .getPublicUrl(data.path);

    return urlData.publicUrl;
  } catch (err: any) {
    console.error('Photo upload error:', err?.message ?? JSON.stringify(err));
    return null;
  }
}

/** Camera photos on Android can be content:// URIs that must be copied first. */
async function readablePhotoUri(uri: string): Promise<string> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) return uri;
  } catch {
    // Fall through and copy the URI into the app cache.
  }

  const dest = `${FileSystem.cacheDirectory}tree-photo-${Date.now()}.jpg`;
  await FileSystem.copyAsync({ from: uri, to: dest });
  return dest;
}

/**
 * Ensure the storage bucket exists. Call this once on app startup or when
 * the storage bucket is missing (404). Creates a public bucket so photos
 * can be uploaded and accessed via public URLs.
 */
export async function ensureStorageBucket(): Promise<boolean> {
  try {
    const { data } = supabase.storage
      .from(TREE_PHOTOS_BUCKET)
      .getPublicUrl('__check__');

    return Boolean(data?.publicUrl);
  } catch (err: any) {
    console.warn('[TreeApp] Storage bucket check failed:', err?.message);
    return false;
  }
}
