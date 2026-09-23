import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuthStore } from '../../store/authStore';
import { useTreeStore } from '../../store/treeStore';
import { fetchAllProjects } from '../../services/treeService';
import { Project } from '../../types';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_W } = Dimensions.get('window');

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, activeProjectId, signOut, refreshCredits } = useAuthStore();
  const trees = useTreeStore((s) => s.trees) ?? [];
  const [allProjects, setAllProjects] = useState<Project[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await fetchAllProjects();
      if (active && data) setAllProjects(data);
    })();
    return () => { active = false; };
  }, []);

  useFocusEffect(useCallback(() => { refreshCredits(); }, []));
  useEffect(() => { refreshCredits(); }, [activeProjectId]);

  const activeTrees = trees.filter((t) => activeProjectId ? t.project_id === activeProjectId : true);
  const stats = {
    total: activeTrees.length,
    healthy: activeTrees.filter((t) => t.health_status === 'healthy').length,
    sick: activeTrees.filter((t) => t.health_status === 'sick').length,
    dead: activeTrees.filter((t) => t.health_status === 'dead').length,
  };
  const healthPct = stats.total > 0 ? Math.round((stats.healthy / stats.total) * 100) : 0;

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const initials = (user?.full_name?.trim() || '?')
    .split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  const projectName = allProjects.find((p) => p.id === activeProjectId)?.name ?? 'All Projects';
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
    : '—';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: insets.bottom + 88 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ═══ Hero header with wave bottom ═══ */}
      <LinearGradient
        colors={['#0d3320', '#1a5c2a', '#2e8b4a']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        {/* Decorative circles */}
        <View style={[styles.decoCircle, { top: -40, right: -30, width: 140, height: 140, backgroundColor: 'rgba(255,255,255,0.04)' }]} />
        <View style={[styles.decoCircle, { top: 60, left: -50, width: 100, height: 100, backgroundColor: 'rgba(255,255,255,0.03)' }]} />
        <View style={[styles.decoCircle, { bottom: 20, right: 40, width: 60, height: 60, backgroundColor: 'rgba(255,255,255,0.05)' }]} />

        <View style={styles.heroContent}>
          {/* Avatar with ring */}
          <View style={styles.avatarOuterRing}>
            <View style={styles.avatarInnerRing}>
              <LinearGradient
                colors={['#4ade80', '#16a34a']}
                style={styles.avatar}
              >
                <Text style={styles.avatarText}>{initials}</Text>
              </LinearGradient>
            </View>
          </View>

          <Text style={styles.name}>{user?.full_name ?? 'Field User'}</Text>
          <Text style={styles.email}>{user?.email}</Text>

          {/* Role pill */}
          <View style={styles.rolePill}>
            <Ionicons name="shield-checkmark" size={13} color="#1a5c2a" />
            <Text style={styles.rolePillText}>{(user?.role ?? 'field_user').replace('_', ' ')}</Text>
          </View>
        </View>

        {/* Wave divider */}
        <View style={styles.waveContainer}>
          <View style={styles.wave1} />
          <View style={styles.wave2} />
        </View>
      </LinearGradient>

      {/* ═══ Quick stats row ═══ */}
      <View style={styles.statsRow}>
        <QuickStat
          icon="leaf"
          value={stats.total}
          label="Trees"
          gradient={['#1a5c2a', '#2e8b4a']}
        />
        <QuickStat
          icon="heart"
          value={`${healthPct}%`}
          label="Healthy"
          gradient={['#16a34a', '#22c55e']}
        />
        <QuickStat
          icon="warning"
          value={stats.sick}
          label="Sick"
          gradient={['#d97706', '#f59e0b']}
        />
        <QuickStat
          icon="skull"
          value={stats.dead}
          label="Dead"
          gradient={['#b91c1c', '#ef4444']}
        />
      </View>

      {/* ═══ Credits card ═══ */}
      <View style={styles.section}>
        <LinearGradient
          colors={['#f0fdf4', '#dcfce7']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.creditsCard}
        >
          <View style={styles.creditsIconWrap}>
            <Ionicons name="flash" size={24} color="#F09125" />
          </View>
          <View style={styles.creditsBody}>
            <Text style={styles.creditsTitle}>Credits</Text>
            <Text style={styles.creditsValue}>{user?.credits ?? 0}</Text>
            <Text style={styles.creditsSub}>1 credit per photo upload</Text>
          </View>
          {user?.credits !== undefined && user.credits <= 3 && (
            <View style={[styles.creditBadge, user.credits === 0 && styles.creditBadgeDanger]}>
              <Text style={[styles.creditBadgeText, user.credits === 0 && styles.creditBadgeTextDanger]}>
                {user.credits === 0 ? 'Empty' : 'Low'}
              </Text>
            </View>
          )}
        </LinearGradient>
      </View>

      {/* ═══ Active project ═══ */}
      <View style={styles.section}>
        <View style={styles.projectCard}>
          <View style={styles.projectIconWrap}>
            <Ionicons name="folder-open" size={20} color="#fff" />
          </View>
          <View style={styles.projectBody}>
            <Text style={styles.projectLabel}>Active Project</Text>
            <Text style={styles.projectName} numberOfLines={1}>{projectName}</Text>
          </View>
        </View>
      </View>

      {/* ═══ Account details ═══ */}
      <View style={styles.section}>
        <Text style={styles.sectionHead}>Account Details</Text>
        <View style={styles.detailsCard}>
          <DetailItem icon="mail-outline" label="Email" value={user?.email ?? '—'} />
          <DetailItem icon="person-outline" label="Full Name" value={user?.full_name ?? '—'} />
          <DetailItem icon="shield-checkmark-outline" label="Role" value={(user?.role ?? '—').replace('_', ' ')} />
          <DetailItem icon="calendar-outline" label="Member Since" value={memberSince} last />
        </View>
      </View>

      {/* ═══ App info ═══ */}
      <View style={styles.section}>
        <Text style={styles.sectionHead}>App Info</Text>
        <View style={styles.detailsCard}>
          <DetailItem icon="phone-portrait-outline" label="Version" value="Five Elements v1.0.0" />
          <DetailItem icon="server-outline" label="Backend" value="Supabase" />
          <DetailItem icon="map-outline" label="Maps" value="OpenStreetMap / Mapbox" />
          <DetailItem icon="location-outline" label="GPS" value="Device GNSS" last />
        </View>
      </View>

      {/* ═══ Sign out ═══ */}
      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.7}>
        <Ionicons name="log-out-outline" size={20} color="#ef4444" />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────────────── */

function QuickStat({ icon, value, label, gradient }: {
  icon: string; value: number | string; label: string; gradient: [string, string];
}) {
  return (
    <LinearGradient colors={gradient} style={styles.qStat} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
      <Ionicons name={icon as any} size={16} color="#fff" />
      <Text style={styles.qStatValue}>{value}</Text>
      <Text style={styles.qStatLabel}>{label}</Text>
    </LinearGradient>
  );
}

function DetailItem({ icon, label, value, last }: {
  icon: string; label: string; value: string; last?: boolean;
}) {
  return (
    <View style={[styles.detailRow, last && { borderBottomWidth: 0 }]}>
      <View style={styles.detailIconWrap}>
        <Ionicons name={icon as any} size={16} color="#1a5c2a" />
      </View>
      <View style={styles.detailBody}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

/* ─── Styles ─────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f1' },

  /* Hero */
  hero: { paddingBottom: 50 },
  decoCircle: { position: 'absolute', borderRadius: 999 },
  heroContent: { alignItems: 'center', paddingTop: 48, paddingBottom: 30, paddingHorizontal: 24 },

  /* Avatar */
  avatarOuterRing: {
    width: 108, height: 108, borderRadius: 54,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  avatarInnerRing: {
    width: 100, height: 100, borderRadius: 50,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatar: {
    width: 88, height: 88, borderRadius: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 30, fontWeight: '800', color: '#fff' },

  name: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 4, letterSpacing: 0.3 },
  email: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginBottom: 12 },
  rolePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 20,
  },
  rolePillText: { color: '#1a5c2a', fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },

  /* Wave */
  waveContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 40 },
  wave1: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 40,
    backgroundColor: '#f0f4f1',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
  },
  wave2: {
    position: 'absolute', bottom: 0, left: -20, right: -20, height: 24,
    backgroundColor: '#f0f4f1',
    borderTopLeftRadius: 40, borderTopRightRadius: 40,
  },

  /* Stats */
  statsRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: -24, marginBottom: 8,
  },
  qStat: {
    flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 14,
    elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12, shadowRadius: 6,
  },
  qStatValue: { fontSize: 18, fontWeight: '800', color: '#fff', marginTop: 6 },
  qStatLabel: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.8)', marginTop: 2 },

  /* Section */
  section: { paddingHorizontal: 16, marginBottom: 8 },
  sectionHead: { fontSize: 13, fontWeight: '800', color: '#555', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 },

  /* Credits card */
  creditsCard: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 16, padding: 16,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4,
  },
  creditsIconWrap: {
    width: 48, height: 48, borderRadius: 14, backgroundColor: '#FEF3C7',
    alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  creditsBody: { flex: 1 },
  creditsTitle: { fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 2 },
  creditsValue: { fontSize: 30, fontWeight: '900', color: '#1a5c2a' },
  creditsSub: { fontSize: 11, color: '#aaa', marginTop: 2 },
  creditBadge: {
    backgroundColor: '#FEF0E3', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
  },
  creditBadgeDanger: { backgroundColor: '#FEE2E2' },
  creditBadgeText: { fontSize: 11, fontWeight: '700', color: '#B45309' },
  creditBadgeTextDanger: { color: '#DC2626' },

  /* Project card */
  projectCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 14, padding: 14, gap: 12,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4,
  },
  projectIconWrap: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: '#1a5c2a',
    alignItems: 'center', justifyContent: 'center',
  },
  projectBody: { flex: 1 },
  projectLabel: { fontSize: 11, color: '#888', marginBottom: 2 },
  projectName: { fontSize: 15, fontWeight: '700', color: '#222' },

  /* Details card */
  detailsCard: {
    backgroundColor: '#fff', borderRadius: 14, paddingVertical: 4, paddingHorizontal: 16,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4,
  },
  detailRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: '#f3f3f3', gap: 14,
  },
  detailIconWrap: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: '#E8F5E9',
    alignItems: 'center', justifyContent: 'center',
  },
  detailBody: { flex: 1 },
  detailLabel: { fontSize: 11, color: '#999', marginBottom: 2 },
  detailValue: { fontSize: 14, fontWeight: '600', color: '#222', textTransform: 'capitalize' },

  /* Sign out */
  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 16, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: '#fecaca', backgroundColor: '#fff',
    elevation: 1,
  },
  signOutText: { color: '#ef4444', fontWeight: '700', fontSize: 15 },
});
