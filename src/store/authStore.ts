import { create } from 'zustand';
import { AuthState, User } from '../types';
import { supabase } from '../services/supabase';

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  loading: true,

  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  setLoading: (loading) => set({ loading }),

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null });
  },
}));