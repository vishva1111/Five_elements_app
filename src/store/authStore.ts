import { create } from 'zustand';
import { AuthState, User, Project } from '../types';
import { supabase } from '../services/supabase';
import { fetchMyTrees, computeCredits } from '../services/treeService';

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  loading: false,
  assignedProjects: [],
  projectSelectionPending: false,

  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  setLoading: (loading) => set({ loading }),
  setAssignedProjects: (projects) => set({ assignedProjects: projects }),
  setProjectSelectionPending: (pending) => set({ projectSelectionPending: pending }),
  setUserCredits: (credits) =>
    set((state) => ({
      user: state.user ? { ...state.user, credits } : null,
    })),

  // ─── Credits = 500 given credits minus trees added in selected projects ──────
  refreshCredits: async () => {
    const { user, assignedProjects } = get();
    if (!user) return;
    // 1 tree added (in a selected project) = 1 credit deducted from the 500 given
    const { data } = await fetchMyTrees(user.id);
    if (data) {
      const remaining = computeCredits(data, assignedProjects);
      set((state) => ({
        user: state.user ? { ...state.user, credits: remaining } : null,
      }));
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null, assignedProjects: [], projectSelectionPending: false });
  },
}));
