import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthState, User, Project } from '../types';
import { supabase } from '../services/supabase';
import { fetchMyTrees, computeCreditsForProject } from '../services/treeService';
import { useProjectRefreshStore } from './projectRefreshStore';

const activeProjectKey = (userId: string) => `@treeapp_active_project_${userId}`;

/** Last project this user had open. Kept on the phone so the next launch reopens it. */
export async function getCachedActiveProject(userId?: string | null): Promise<string | null> {
  if (!userId) return null;
  try {
    return await AsyncStorage.getItem(activeProjectKey(userId));
  } catch {
    return null;
  }
}

function persistActiveProject(userId: string | null | undefined, projectId: string | null) {
  if (!userId || !projectId) return;
  AsyncStorage.setItem(activeProjectKey(userId), projectId).catch(() => {});
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
    const userId = get().user?.id ?? get().session?.user?.id;
    set({ activeProjectId: projectId });
    persistActiveProject(userId, projectId);
    // Signal all screens to instantly reload their project-specific data
    useProjectRefreshStore.getState().triggerProjectRefresh();
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
