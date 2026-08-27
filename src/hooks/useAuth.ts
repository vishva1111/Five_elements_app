import { useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../store/authStore';
import { User } from '../types';

export function useAuth() {
  const { user, session, loading, setUser, setSession, setLoading, signOut } = useAuthStore();

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
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (data) {
        // Profile found — use it
        setUser({
          id: userId,
          email: data.email ?? email,
          full_name: data.full_name ?? data.display_name ?? data.name ?? '',
          role: data.role ?? 'field_user',
          avatar_url: data.avatar_url ?? data.avatar ?? '',
          created_at: data.created_at ?? new Date().toISOString(),
        } as User);
      } else {
        // No profile row — use auth user data directly (still works for login)
        setUser({
          id: userId,
          email: email,
          full_name: '',
          role: 'field_user',
          avatar_url: '',
          created_at: new Date().toISOString(),
        } as User);
      }
    } catch (err) {
      // Fallback — set minimal user so app doesn't get stuck
      setUser({
        id: userId,
        email: email,
        full_name: '',
        role: 'field_user',
        avatar_url: '',
        created_at: new Date().toISOString(),
      } as User);
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