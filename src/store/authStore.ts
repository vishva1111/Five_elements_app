import { create } from 'zustand';
import { AuthState, User, Project } from '../types';
import { supabase } from '../services/supabase';
import { fetchMyTrees, computeCreditsForProject } from '../services/treeService';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Persist the last active project so it survives app restarts ────────────
const ACTIVE_PROJECT_CACHE_PREFIX = 'treeapp_active_project_';

async function persistActiveProject(userId: string | null | undefined, projectId: string | null) {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(ACTIVE_PROJECT_CACHE_PREFIX + userId, JSON.stringify(projectId));
  } catch {
    // Best-effort — ignore failures
  }
}

export async function getCachedActiveProject(userId: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_PROJECT_CACHE_PREFIX + userId);
    return raw ? (JSON.parse(raw) as string | null) : null;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  assignedProjects: [],
  activeProjectId: null,
  projectSelectionPending: false,

  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  setAssignedProjects: (projects) => set({ assignedProjects: projects }),
  setActiveProjectId: (projectId) => {
    // Remember the last active project per user across app restarts
    persistActiveProject(get().user?.id ?? get().session?.user?.id, projectId);
    set({ activeProjectId: projectId });
  },
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
