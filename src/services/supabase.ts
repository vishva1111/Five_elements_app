import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// ─── Supabase Config ───────────────────────────────────────────────────────────
// Replace these values with your actual Supabase project credentials
// Get them from: https://supabase.com/dashboard → Settings → API
const SUPABASE_URL = 'https://iauhmhkmreojmfahvxxh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhdWhtaGttcmVvam1mYWh2eHhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzNDgxODcsImV4cCI6MjEwMTkyNDE4N30.RKrSMG4vYHj4Hdm-27N6JStcr7seCROTvx7FNzY3jF4';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ─── Storage Bucket Name ───────────────────────────────────────────────────────
export const TREE_PHOTOS_BUCKET = 'tree-photos';