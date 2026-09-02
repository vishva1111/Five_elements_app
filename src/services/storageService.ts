import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase, TREE_PHOTOS_BUCKET } from './supabase';

export async function uploadTreePhoto(
  uri: string,
  userId: string
): Promise<string | null> {
  try {
    const fileName = `${userId}/${Date.now()}.jpg`;

    // Read file as base64 string (React Native compatible)
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: 'base64' as any,
    });

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