import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAuthStore } from '../../store/authStore';
import { useTreeStore } from '../../store/treeStore';
import { fetchMyTrees } from '../../services/treeService';
import { HealthStatus } from '../../types';
import TreeCard from '../../components/TreeCard';

const FILTERS: { label: string; value: HealthStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: '✅ Healthy', value: 'healthy' },
  { label: '⚠️ Sick', value: 'sick' },
  { label: '❌ Dead', value: 'dead' },
];

export default function HistoryScreen() {
  const navigation = useNavigation<any>();
  // Stable primitive selectors — the `user` OBJECT's identity changes on every
  // credit refresh, which used to re-trigger the focus effect in a loop.
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const activeProjectId = useAuthStore((s) => s.activeProjectId);
  const { trees, setTrees } = useTreeStore();
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<HealthStatus | 'all'>('all');

  // Ignore out-of-order responses so a slow earlier request can't overwrite a
  // newer one and shuffle the list while refreshing.
  const loadSeqRef = useRef(0);

  const loadTrees = useCallback(async () => {
    if (!userId) return;
    const seq = ++loadSeqRef.current;
    const { data } = await fetchMyTrees(userId);
    if (seq !== loadSeqRef.current) return; // stale response — ignore it
    if (data) setTrees(data);
  }, [userId, setTrees]);

  // ─── Reload trees whenever the screen is focused ───────────────────────────
  // useFocusEffect runs on mount too, so there is no separate useEffect and no
  // duplicate fetch. Only userId drives this callback — credits/refresh don't.
  useFocusEffect(
    useCallback(() => {
      loadTrees();
    }, [loadTrees])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTrees();
    setRefreshing(false);
  };

  // Filter trees by active project only
  const filtered = trees.filter((t) => {
    const healthMatch = filter === 'all' || t.health_status === filter;
    const projectMatch = activeProjectId ? t.project_id === activeProjectId : true;
    return healthMatch && projectMatch;
  });

  return (
    <View style={styles.container}>
      {/* Health Status Filter Bar */}
      <View style={styles.filterBar}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.value}
            style={[styles.filterBtn, filter === f.value && styles.filterBtnActive]}
            onPress={() => setFilter(f.value)}
          >
            <Text style={[styles.filterBtnText, filter === f.value && styles.filterBtnTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Count */}
      <Text style={styles.count}>{filtered.length} record{filtered.length !== 1 ? 's' : ''}</Text>

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TreeCard
            tree={item}
            onPress={() => navigation.navigate('TreeDetail', { treeId: item.id })}
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1a5c2a" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🌱</Text>
            <Text style={styles.emptyText}>No trees found</Text>
            <Text style={styles.emptySubText}>
              {filter !== 'all'
                ? 'Try a different filter'
                : 'Capture your first tree!'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  filterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
  },
  filterBtnActive: { backgroundColor: '#1a5c2a' },
  filterBtnText: { fontSize: 12, color: '#555', fontWeight: '500' },
  filterBtnTextActive: { color: '#fff', fontWeight: '700' },
  count: { fontSize: 12, color: '#888', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  list: { padding: 16, paddingTop: 8 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#555' },
  emptySubText: { fontSize: 13, color: '#888', marginTop: 4 },
});