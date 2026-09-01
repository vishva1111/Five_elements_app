import { useState } from 'react';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../store/authStore';

export function useAuth() {
  // Local spinner flag for the login button
  const [signingIn, setSigningIn] = useState(false);
  const signOut = useAuthStore((s) => s.signOut);

  // NOTE: session/user loading is owned by App.tsx (single auth listener).
  // A second onAuthStateChange listener here used to deadlock supabase's
  // internal auth lock after logout, forcing users to sign in twice.

  const signIn = async (email: string, password: string) => {
    setSigningIn(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return { data, error };
    } finally {
      setSigningIn(false);
    }
  };

  return {
    loading: signingIn,
    signIn,
    signOut,
  };
}
