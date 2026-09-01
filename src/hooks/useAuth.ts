import { useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../store/authStore';
import { User } from '../types';
import {
  fetchUserProjects,
  fetchMyTrees,
  fetchUserProfile,
  buildUserFromProfile,
  computeCredits,
} from '../services/treeService';

export function useAuth() {
  const {
    user,
    session,
    loading,
    setUser,
    setSession,
    setLoading,
    setAssignedProjects,
    signOut,
  } = useAuthStore();

  useEffect(() => {
    let mounted = true;

    // Safety timeout — never stay loading more than 5 seconds
    const timeout = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 5000);

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setSession(session);
      if (session?.user) {
        fetchProfile(session.user.id, session.user.email ?? '').finally(() => {
          clearTimeout(timeout);
          if (mounted) setLoading(false);
        });
      } else {
        clearTimeout(timeout);
        setLoading(false);
      }
    }).catch(() => {
      clearTimeout(timeout);
      if (mounted) setLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!mounted) return;
        setSession(session);
        if (session?.user) {
          await fetchProfile(session.user.id, session.user.email ?? '');
        } else {
          setUser(null);
          setLoading(false);
        }
      }
    );

    return () => {
      mounted = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const fetchProfile = async (userId: string, email: string) => {
    try {
      // ─── Fetch profile, trees, and projects in parallel ──────────────────
      const { data: profile, error: profileError } = await fetchUserProfile(userId);
      // Credits = trees captured within the user's selected projects
      const { data: userTrees } = await fetchMyTrees(userId);

      // Fetch assigned projects first (projects selected by the user at login)
      let { data: projects } = await fetchUserProjects(userId);
      // No fallback to all projects — users only see their selected projects

      // Credits are calculated according to the selected projects
      const earnedCredits = computeCredits(userTrees, projects ?? []);

      // Build user object from profile data (handles missing columns gracefully)
      const user = buildUserFromProfile(
        userId,
        email,
        profileError ? null : profile,
        earnedCredits
      );

      setUser(user);
      setAssignedProjects(projects ?? []);
    } catch (err) {
      // Fallback — set minimal user so app doesn't get stuck
      setUser({
        id: userId,
        email: email,
        full_name: '',
        role: 'field_user',
        avatar_url: '',
        created_at: new Date().toISOString(),
        credits: 10,
      } as User);

      setAssignedProjects([]);
    }
  };

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return { data, error };
    } finally {
      setLoading(false);
    }
  };

  return {
    user,
    session,
    loading,
    signIn,
    signOut,
    isAuthenticated: !!session,
  };
}
