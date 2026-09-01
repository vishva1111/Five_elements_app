import { create } from 'zustand';
import { AuthState, User, Project } from '../types';
import { supabase } from '../services/supabase';
import { fetchUserCredits } from '../services/treeService';

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  loading: true,
  assignedProjects: [],

  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  setLoading: (loading) => set({ loading }),
  setAssignedProjects: (projects) => set({ assignedProjects: projects }),
  setUserCredits: (credits) =>
    set((state) => ({
      user: state.user ? { ...state.user, credits } : null,
    })),

  // ─── Re-fetch credits from the database ─────────────────────────────────────
  refreshCredits: async () => {
    const { user } = get();
    if (!user) return;
    const { data, error } = await fetchUserCredits(user.id);
    if (!error && data !== null) {
      set((state) => ({
        user: state.user ? { ...state.user, credits: data } : null,
      }));
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null, assignedProjects: [] });
  },
}));
