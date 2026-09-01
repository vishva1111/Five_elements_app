import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
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
  const { user, assignedProjects } = useAuthStore();
  const { trees, setTrees } = useTreeStore();
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<HealthStatus | 'all'>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');

  const loadTrees = async () => {
    if (!user) return;
    const { data } = await fetchMyTrees(user.id);
    if (data) setTrees(data);
  };

  useEffect(() => {
    loadTrees();
  }, [user]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTrees();
    setRefreshing(false);
  };

  // Use assigned projects from auth store (project-level access control)
  const visibleProjects = assignedProjects;

  const filtered = trees.filter((t) => {
    const healthMatch = filter === 'all' || t.health_status === filter;
    const projectMatch =
      projectFilter === 'all' ||
      t.project_id === projectFilter ||
      (projectFilter === 'none' && !t.project_id);
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

      {/* Project Filter Bar — shows only assigned projects */}
      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.projectScrollContent}>
          <TouchableOpacity
            style={[styles.filterBtn, projectFilter === 'all' && styles.filterBtnActive]}
            onPress={() => setProjectFilter('all')}
          >
            <Text style={[styles.filterBtnText, projectFilter === 'all' && styles.filterBtnTextActive]}>
              All Projects
            </Text>
          </TouchableOpacity>
          {trees.some((t) => !t.project_id) && (
            <TouchableOpacity
              style={[styles.filterBtn, projectFilter === 'none' && styles.filterBtnActive]}
              onPress={() => setProjectFilter('none')}
            >
              <Text style={[styles.filterBtnText, projectFilter === 'none' && styles.filterBtnTextActive]}>
                No Project
              </Text>
            </TouchableOpacity>
          )}
          {visibleProjects.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.filterBtn, projectFilter === p.id && styles.filterBtnActive, styles.projectNameBtn]}
              onPress={() => setProjectFilter(p.id)}
            >
              <Text
                style={[styles.filterBtnText, projectFilter === p.id && styles.filterBtnTextActive]}
                numberOfLines={1}
              >
                {p.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
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
              {filter !== 'all' || projectFilter !== 'all'
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
  projectScrollContent: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  projectNameBtn: { maxWidth: 160 },
  projectBar: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    maxHeight: 60,
  },
  projectBarContent: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    alignItems: 'center',
  },
  projectBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#f0f4f0',
    borderWidth: 1,
    borderColor: '#dde8dd',
    maxWidth: 160,
  },
  projectBtnActive: { backgroundColor: '#1a5c2a', borderColor: '#1a5c2a' },
  projectBtnText: { fontSize: 12, color: '#3a6b3a', fontWeight: '500' },
  projectBtnTextActive: { color: '#fff', fontWeight: '700' },
  count: { fontSize: 12, color: '#888', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  list: { padding: 16, paddingTop: 8 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#555' },
  emptySubText: { fontSize: 13, color: '#888', marginTop: 4 },
});