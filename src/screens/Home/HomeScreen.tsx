import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../store/authStore';
import { useTreeStore } from '../../store/treeStore';
import { fetchMyTrees } from '../../services/treeService';
import { TreeRecord } from '../../types';
import StatusBadge from '../../components/StatusBadge';

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const { trees, setTrees } = useTreeStore();
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ total: 0, healthy: 0, sick: 0, dead: 0 });

  const loadTrees = async () => {
    if (!user) return;
    const { data } = await fetchMyTrees(user.id);
    if (data) {
      setTrees(data);
      setStats({
        total: data.length,
        healthy: data.filter((t) => t.health_status === 'healthy').length,
        sick: data.filter((t) => t.health_status === 'sick').length,
        dead: data.filter((t) => t.health_status === 'dead').length,
      });
    }
  };

  useEffect(() => {
    loadTrees();
  }, [user]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTrees();
    setRefreshing(false);
  };

  const recentTrees = trees.slice(0, 5);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1a5c2a" />}
    >
      {/* Welcome Banner */}
      <View style={styles.banner}>
        <Text style={styles.greeting}>Hello, {user?.full_name?.split(' ')[0] ?? 'Field User'} 👋</Text>
        <Text style={styles.bannerSub}>Ready to capture trees today?</Text>
      </View>

      {/* Stats Cards */}
      <View style={styles.statsRow}>
        <View style={[styles.statCard, { borderTopColor: '#1a5c2a' }]}>
          <Text style={styles.statNumber}>{stats.total}</Text>
          <Text style={styles.statLabel}>Total Trees</Text>
        </View>
        <View style={[styles.statCard, { borderTopColor: '#22c55e' }]}>
          <Text style={[styles.statNumber, { color: '#22c55e' }]}>{stats.healthy}</Text>
          <Text style={styles.statLabel}>Healthy</Text>
        </View>
        <View style={[styles.statCard, { borderTopColor: '#f59e0b' }]}>
          <Text style={[styles.statNumber, { color: '#f59e0b' }]}>{stats.sick}</Text>
          <Text style={styles.statLabel}>Sick</Text>
        </View>
        <View style={[styles.statCard, { borderTopColor: '#ef4444' }]}>
          <Text style={[styles.statNumber, { color: '#ef4444' }]}>{stats.dead}</Text>
          <Text style={styles.statLabel}>Dead</Text>
        </View>
      </View>

      {/* Capture CTA */}
      <TouchableOpacity
        style={styles.captureBtn}
        onPress={() => navigation.navigate('Capture')}
        activeOpacity={0.85}
      >
        <Text style={styles.captureBtnIcon}>📸</Text>
        <View>
          <Text style={styles.captureBtnTitle}>Capture a Tree</Text>
          <Text style={styles.captureBtnSub}>Take photo + tag GPS location</Text>
        </View>
      </TouchableOpacity>

      {/* Recent Submissions */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Submissions</Text>
          {trees.length > 5 && (
            <TouchableOpacity onPress={() => navigation.navigate('History')}>
              <Text style={styles.seeAll}>See all</Text>
            </TouchableOpacity>
          )}
        </View>

        {recentTrees.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🌱</Text>
            <Text style={styles.emptyText}>No trees captured yet.</Text>
            <Text style={styles.emptySubText}>Tap "Capture a Tree" to get started!</Text>
          </View>
        ) : (
          recentTrees.map((tree) => (
            <TouchableOpacity
              key={tree.id}
              style={styles.treeRow}
              onPress={() => navigation.navigate('History', {
                screen: 'TreeDetail',
                params: { treeId: tree.id },
              })}
            >
              <View style={styles.treeRowLeft}>
                <Text style={styles.treeSpecies}>{tree.species}</Text>
                <Text style={styles.treeDate}>
                  {new Date(tree.submitted_at).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}
                </Text>
                <Text style={styles.treeCoords}>
                  📍 {tree.latitude.toFixed(4)}, {tree.longitude.toFixed(4)}
                </Text>
              </View>
              <StatusBadge status={tree.health_status} />
            </TouchableOpacity>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  banner: {
    backgroundColor: '#1a5c2a',
    padding: 24,
    paddingTop: 20,
    paddingBottom: 32,
  },
  greeting: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  bannerSub: { fontSize: 14, color: '#a5d6a7', marginTop: 4 },
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: -16,
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderTopWidth: 3,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  statNumber: { fontSize: 22, fontWeight: 'bold', color: '#1a5c2a' },
  statLabel: { fontSize: 10, color: '#888', marginTop: 2 },
  captureBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a5c2a',
    margin: 16,
    borderRadius: 16,
    padding: 20,
    gap: 16,
    elevation: 3,
  },
  captureBtnIcon: { fontSize: 36 },
  captureBtnTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  captureBtnSub: { fontSize: 12, color: '#a5d6a7', marginTop: 2 },
  section: { margin: 16 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  seeAll: { fontSize: 13, color: '#1a5c2a', fontWeight: '600' },
  treeRow: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
  },
  treeRowLeft: { flex: 1 },
  treeSpecies: { fontSize: 15, fontWeight: '600', color: '#222' },
  treeDate: { fontSize: 12, color: '#888', marginTop: 2 },
  treeCoords: { fontSize: 11, color: '#aaa', marginTop: 2 },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#555' },
  emptySubText: { fontSize: 13, color: '#888', marginTop: 4 },
});