import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuthStore } from '../../store/authStore';
import { useTreeStore } from '../../store/treeStore';

export default function ProfileScreen() {
  const { user, assignedProjects, signOut, refreshCredits } = useAuthStore();
  const { trees } = useTreeStore();

  // ─── Refresh credits when screen is focused ─────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      refreshCredits();
    }, [])
  );

  const stats = {
    total: trees.length,
    healthy: trees.filter((t) => t.health_status === 'healthy').length,
    sick: trees.filter((t) => t.health_status === 'sick').length,
    dead: trees.filter((t) => t.health_status === 'dead').length,
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: signOut },
      ]
    );
  };

  return (
    <ScrollView style={styles.container}>
      {/* Avatar & Name */}
      <View style={styles.profileHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.full_name?.charAt(0)?.toUpperCase() ?? '?'}
          </Text>
        </View>
        <Text style={styles.name}>{user?.full_name ?? 'Field User'}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>{user?.role ?? 'field_user'}</Text>
        </View>
      </View>

      {/* Credits Section */}
      <View style={styles.creditsSection}>
        <Text style={styles.sectionTitle}>Credits</Text>
        <View style={styles.creditsCard}>
          <View style={styles.creditsRow}>
            <Ionicons name="wallet-outline" size={28} color="#1a5c2a" />
            <View style={styles.creditsInfo}>
              <Text style={styles.creditsLabel}>Available Credits</Text>
              <Text style={styles.creditsValue}>{user?.credits ?? 0}</Text>
            </View>
            {user?.credits !== undefined && user.credits <= 3 && (
              <View style={[styles.creditsWarning, user.credits === 0 && styles.creditsWarningCritical]}>
                <Text style={[styles.creditsWarningText, user.credits === 0 && styles.creditsWarningTextCritical]}>
                  {user.credits === 0 ? 'No credits!' : 'Low credits'}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.creditsNote}>
            1 credit is used per tree photo upload
          </Text>
        </View>
      </View>

      {/* Assigned Projects */}
      <View style={styles.projectsSection}>
        <Text style={styles.sectionTitle}>Assigned Projects ({assignedProjects.length})</Text>
        {assignedProjects.length === 0 ? (
          <View style={styles.noProjectsCard}>
            <Ionicons name="alert-circle-outline" size={20} color="#8B3A00" />
            <Text style={styles.noProjectsText}>
              No projects assigned. Contact your administrator.
            </Text>
          </View>
        ) : (
          <View style={styles.projectsCard}>
            {assignedProjects.map((project) => (
              <View key={project.id} style={styles.projectItem}>
                <Ionicons name="folder-outline" size={18} color="#1a5c2a" />
                <Text style={styles.projectName}>{project.name}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Stats */}
      <View style={styles.statsSection}>
        <Text style={styles.sectionTitle}>My Contributions</Text>
        <View style={styles.statsGrid}>
          <StatBox label="Total Trees" value={stats.total} color="#1a5c2a" />
          <StatBox label="Healthy" value={stats.healthy} color="#22c55e" />
          <StatBox label="Sick" value={stats.sick} color="#f59e0b" />
          <StatBox label="Dead" value={stats.dead} color="#ef4444" />
        </View>
      </View>

      {/* Info */}
      <View style={styles.infoSection}>
        <Text style={styles.sectionTitle}>Account Info</Text>
        <View style={styles.infoCard}>
          <InfoRow icon="mail" label="Email" value={user?.email ?? '-'} />
          <InfoRow icon="person" label="Name" value={user?.full_name ?? '-'} />
          <InfoRow icon="shield-checkmark" label="Role" value={user?.role ?? '-'} />
          <InfoRow
            icon="calendar"
            label="Member since"
            value={user?.created_at
              ? new Date(user.created_at).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
              : '-'}
          />
        </View>
      </View>

      {/* App Info */}
      <View style={styles.infoSection}>
        <Text style={styles.sectionTitle}>App Info</Text>
        <View style={styles.infoCard}>
          <InfoRow icon="phone-portrait" label="App" value="TreeApp v1.0.0" />
          <InfoRow icon="server" label="Backend" value="Supabase (Free)" />
          <InfoRow icon="map" label="Maps" value="OpenStreetMap (Free)" />
          <InfoRow icon="location" label="GPS" value="Device GPS (Free)" />
        </View>
      </View>

      {/* Sign Out */}
      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
        <Ionicons name="log-out" size={20} color="#ef4444" />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[statStyles.box, { borderTopColor: color }]}>
      <Text style={[statStyles.value, { color }]}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={infoStyles.row}>
      <Ionicons name={icon as any} size={16} color="#1a5c2a" />
      <View style={infoStyles.textGroup}>
        <Text style={infoStyles.label}>{label}</Text>
        <Text style={infoStyles.value}>{value}</Text>
      </View>
    </View>
  );
}

const statStyles = StyleSheet.create({
  box: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderTopWidth: 3,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  value: { fontSize: 24, fontWeight: 'bold' },
  label: { fontSize: 11, color: '#888', marginTop: 4, textAlign: 'center' },
});

const infoStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  textGroup: { flex: 1 },
  label: { fontSize: 11, color: '#888', marginBottom: 2 },
  value: { fontSize: 14, color: '#222', fontWeight: '500' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  profileHeader: {
    backgroundColor: '#1a5c2a',
    alignItems: 'center',
    paddingTop: 32,
    paddingBottom: 36,
    paddingHorizontal: 24,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#a5d6a7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { fontSize: 32, fontWeight: 'bold', color: '#1a5c2a' },
  name: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  email: { fontSize: 13, color: '#a5d6a7', marginBottom: 10 },
  roleBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 12,
  },
  roleText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  creditsSection: { padding: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#333', marginBottom: 12 },
  creditsCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  creditsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  creditsInfo: {
    flex: 1,
  },
  creditsLabel: {
    fontSize: 12,
    color: '#888',
  },
  creditsValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a5c2a',
  },
  creditsWarning: {
    backgroundColor: '#FEF0E3',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  creditsWarningCritical: {
    backgroundColor: '#FEE2E2',
  },
  creditsWarningText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8B3A00',
  },
  creditsWarningTextCritical: {
    color: '#EF4444',
  },
  creditsNote: {
    fontSize: 12,
    color: '#888',
    marginTop: 12,
    fontStyle: 'italic',
  },
  projectsSection: { paddingHorizontal: 16, paddingBottom: 16 },
  projectsCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  projectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  projectName: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  noProjectsCard: {
    backgroundColor: '#FEF0E3',
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#EF9F27',
  },
  noProjectsText: {
    fontSize: 13,
    color: '#8B3A00',
    flex: 1,
  },
  statsSection: { padding: 16 },
  statsGrid: { flexDirection: 'row', gap: 8 },
  infoSection: { paddingHorizontal: 16, paddingBottom: 16 },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#ef4444',
    backgroundColor: '#fff',
  },
  signOutText: { color: '#ef4444', fontWeight: '700', fontSize: 15 },
});