import { create } from 'zustand';
import { AuthState, User, Project } from '../types';
import { supabase } from '../services/supabase';
import { fetchMyTrees, computeCreditsForProject, INITIAL_CREDITS } from '../services/treeService';

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  loading: false,
  assignedProjects: [],
  activeProjectId: null,
  projectSelectionPending: false,

  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  setLoading: (loading) => set({ loading }),
  setAssignedProjects: (projects) => set({ assignedProjects: projects }),
  setActiveProjectId: (projectId) => set({ activeProjectId: projectId }),
  setProjectSelectionPending: (pending) => set({ projectSelectionPending: pending }),
  setUserCredits: (credits) =>
    set((state) => ({
      user: state.user ? { ...state.user, credits } : null,
    })),

  // ─── Credits are PER PROJECT (activeProjectId) ─────────────────────────────
  // Each project keeps its own 500-credit pool. Switching projects switches the
  // credit count to match that project (500 − trees captured in it).
  refreshCredits: async () => {
    const { user, activeProjectId } = get();
    if (!user) return;
    const { data } = await fetchMyTrees(user.id);
    const remaining = computeCreditsForProject(data, activeProjectId);
    set((state) => ({
      user: state.user ? { ...state.user, credits: remaining } : null,
    }));
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null, assignedProjects: [], activeProjectId: null, projectSelectionPending: false });
  },
}));
