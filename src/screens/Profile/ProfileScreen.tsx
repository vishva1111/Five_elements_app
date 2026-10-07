import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';
import { fetchAllProjects } from '../../services/treeService';
import { Project } from '../../types';
import { LinearGradient } from 'expo-linear-gradient';

export default function ProfileScreen() {
  const { user, signOut, assignedProjects, activeProjectId } = useAuthStore();
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [projectsOpen, setProjectsOpen] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!user?.id) return;
      const { data } = await fetchAllProjects();
      if (active && data && data.length > 0) setAllProjects(data);
    })();
    return () => { active = false; };
  }, [user?.id]);

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const initials = (user?.full_name?.trim() || '?')
    .split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  const projects = allProjects.length > 0 ? allProjects : assignedProjects;
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? projects[0];
  const orderedProjects = activeProject
    ? [activeProject, ...projects.filter((p) => p.id !== activeProject.id)]
    : projects;
  const projectSummary = activeProject?.name ?? 'No projects assigned';
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
    : '—';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 16 }}
      showsVerticalScrollIndicator={false}
    >
      <LinearGradient
        colors={['#123f24', '#1a5c2a', '#2e7d43']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <View style={[styles.decoCircle, { top: -40, right: -30, width: 140, height: 140, backgroundColor: 'rgba(255,255,255,0.04)' }]} />
        <View style={[styles.decoCircle, { top: 60, left: -50, width: 100, height: 100, backgroundColor: 'rgba(255,255,255,0.03)' }]} />
        <View style={[styles.decoCircle, { bottom: 20, right: 40, width: 60, height: 60, backgroundColor: 'rgba(255,255,255,0.05)' }]} />

        <View style={styles.heroContent}>
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

          <View style={styles.rolePill}>
            <Ionicons name="shield-checkmark" size={13} color="#1a5c2a" />
            <Text style={styles.rolePillText}>{(user?.role ?? 'field_user').replace('_', ' ')}</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.section}>
        <Text style={styles.sectionHead}>My Projects</Text>
        <TouchableOpacity
          style={styles.dropdownBtn}
          activeOpacity={0.8}
          onPress={() => setProjectsOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Projects"
        >
          <View style={styles.detailIconWrap}>
            <Ionicons name="folder-open-outline" size={16} color="#1a5c2a" />
          </View>
          <View style={styles.detailBody}>
            <Text style={styles.detailLabel}>Active project</Text>
            <Text style={styles.dropdownValue} numberOfLines={1}>{projectSummary}</Text>
          </View>
          <Ionicons name="chevron-down" size={18} color="#1a5c2a" />
        </TouchableOpacity>
      </View>

      <Modal
        visible={projectsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setProjectsOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setProjectsOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>All projects</Text>
            <ScrollView style={styles.modalList} bounces={false}>
              {orderedProjects.length === 0 ? (
                <Text style={styles.emptyProjects}>No projects assigned</Text>
              ) : (
                orderedProjects.map((project, index) => {
                  const isActive = project.id === activeProject?.id;
                  return (
                    <View
                      key={project.id}
                      style={[styles.projectOption, index === orderedProjects.length - 1 && styles.projectOptionLast]}
                    >
                      <Ionicons
                        name={isActive ? 'checkmark-circle' : 'folder-outline'}
                        size={18}
                        color="#1a5c2a"
                      />
                      <Text style={[styles.projectOptionText, isActive && styles.projectOptionTextActive]}>
                        {project.name}
                      </Text>
                      {isActive ? <Text style={styles.activeTag}>Active</Text> : null}
                    </View>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <View style={styles.section}>
        <Text style={styles.sectionHead}>Account Details</Text>
        <View style={styles.detailsCard}>
          <DetailItem icon="mail-outline" label="Email" value={user?.email ?? '—'} />
          <DetailItem icon="person-outline" label="Full Name" value={user?.full_name ?? '—'} />
          <DetailItem icon="shield-checkmark-outline" label="Role" value={(user?.role ?? '—').replace('_', ' ')} />
          <DetailItem icon="calendar-outline" label="Member Since" value={memberSince} last />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionHead}>App Info</Text>
        <View style={styles.detailsCard}>
          <DetailItem icon="phone-portrait-outline" label="Version" value="Five Elements v1.0.0" />
          <DetailItem icon="location-outline" label="GPS" value="Device GNSS" last />
        </View>
      </View>

      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.7}>
        <Ionicons name="log-out-outline" size={20} color="#ef4444" />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f1' },

  hero: {
    paddingBottom: 28,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    overflow: 'hidden',
  },
  decoCircle: { position: 'absolute', borderRadius: 999 },
  heroContent: { alignItems: 'center', paddingTop: 48, paddingBottom: 24, paddingHorizontal: 24 },

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

  section: { paddingHorizontal: 16, marginTop: 16, marginBottom: 4 },
  sectionHead: { fontSize: 13, fontWeight: '800', color: '#555', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 },

  dropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  dropdownValue: { fontSize: 14, fontWeight: '700', color: '#222' },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(18, 63, 36, 0.45)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingTop: 16,
    paddingBottom: 8,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#123f24',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  modalList: { flexGrow: 0 },
  emptyProjects: { fontSize: 14, color: '#6b7280', paddingHorizontal: 16, paddingVertical: 16 },
  projectOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f3f3',
  },
  projectOptionLast: { borderBottomWidth: 0 },
  projectOptionText: { flex: 1, fontSize: 15, fontWeight: '600', color: '#222' },
  projectOptionTextActive: { color: '#1a5c2a' },
  activeTag: { fontSize: 11, fontWeight: '700', color: '#1a5c2a' },

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

  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 16, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: '#fecaca', backgroundColor: '#fff',
    elevation: 1,
  },
  signOutText: { color: '#ef4444', fontWeight: '700', fontSize: 15 },
});
