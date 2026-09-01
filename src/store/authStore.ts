import { create } from 'zustand';
import { AuthState, User, Project } from '../types';
import { supabase } from '../services/supabase';
import { fetchMyTrees } from '../services/treeService';

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

  // ─── Credits = total trees captured — auto-compute from DB ─────────────────
  refreshCredits: async () => {
    const { user } = get();
    if (!user) return;
    // 1 tree captured = 1 credit earned(so credits = total tree count)
    const { data } = await fetchMyTrees(user.id);
    if (data) {
      const earned = Math.max(0, data.length);
      set((state) => ({
        user: state.user ? { ...state.user, credits: earned } : null,
      }));
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null, assignedProjects: [] });
  },
}));
