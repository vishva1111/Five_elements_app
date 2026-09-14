import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ScrollView,
  Image,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAuthStore } from '../../store/authStore';
import { useTreeStore } from '../../store/treeStore';
import { useTaskStore } from '../../store/taskStore';
import { fetchMyTrees } from '../../services/treeService';
import { fetchAgentTasks } from '../../services/taskService';
import { TreeCondition, LandType, Task, TreeRecord } from '../../types';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

type FilterCategory = 'condition' | 'status';

interface HistoryItem {
  id: string;
  type: 'tree' | 'task';
  title: string;
  photo_url?: string;
  condition?: string;
  status?: string;
  date: string;
  latitude?: number;
  longitude?: number;
  surveyor?: string;
  project_id?: string;
}

const CATEGORIES: { key: FilterCategory; label: string; icon: string }[] = [
  { key: 'condition', label: 'Condition', icon: 'leaf' },
  { key: 'status', label: 'Status', icon: 'flag' },
];

const CONDITION_FILTERS: { label: string; value: TreeCondition | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Healthy', value: 'Healthy' },
  { label: 'Stressed', value: 'Stressed' },
  { label: 'Diseased', value: 'Diseased' },
  { label: 'Dead', value: 'Dead' },
];

const STATUS_FILTERS: { label: string; value: string }[] = [
  { label: 'All', value: 'all' },
  { label: 'Completed', value: 'completed' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
];

const CONDITION_COLORS: Record<string, string> = {
  Healthy: '#22c55e',
  Stressed: '#f59e0b',
  Diseased: '#ef4444',
  Dead: '#6b7280',
};

const STATUS_COLORS: Record<string, string> = {
  completed: '#22c55e',
  approved: '#8b5cf6',
  rejected: '#ef4444',
};

export default function HistoryScreen() {
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const activeProjectId = useAuthStore((s) => s.activeProjectId);
  const trees = useTreeStore((s) => s.trees) ?? [];
  const setTrees = useTreeStore((s) => s.setTrees);
  const tasks = useTaskStore((s) => s.tasks) ?? [];
  const setTasks = useTaskStore((s) => s.setTasks);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCategory, setActiveCategory] = useState<FilterCategory>('condition');
  const [conditionFilter, setConditionFilter] = useState<TreeCondition | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const loadSeqRef = useRef(0);

  const loadData = useCallback(async () => {
    if (!userId) return;
    const seq = ++loadSeqRef.current;
    const [treesRes, tasksRes] = await Promise.all([
      fetchMyTrees(userId),
      fetchAgentTasks(userId),
    ]);
    if (seq !== loadSeqRef.current) return;
    if (treesRes.data) setTrees(treesRes.data);
    if (tasksRes.data) setTasks(tasksRes.data);
  }, [userId, setTrees, setTasks]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleCategoryChange = (cat: FilterCategory) => {
    setActiveCategory(cat);
    setConditionFilter('all');
    setStatusFilter('all');
  };

  // Merge trees + approved/rejected tasks into history items
  const allItems: HistoryItem[] = [];

  // Trees
  trees.forEach((t) => {
    let meta: Record<string, any> = {};
    const metaMatch = (t.notes || '').match(/##META##({.*})/s);
    if (metaMatch) { try { meta = JSON.parse(metaMatch[1]); } catch {} }
    allItems.push({
      id: t.id,
      type: 'tree',
      title: t.species || 'Tree',
      photo_url: t.photo_url,
      condition: t.tree_condition || meta.tree_condition,
      status: 'completed',
      date: t.submitted_at,
      latitude: t.latitude,
      longitude: t.longitude,
      surveyor: t.surveyor || meta.surveyor,
      project_id: t.project_id,
    });
  });

  // Tasks (approved/rejected/completed with tree data)
  tasks.forEach((t) => {
    if (t.status === 'approved' || t.status === 'rejected') {
      allItems.push({
        id: t.id,
        type: 'task',
        title: t.name || 'Task',
        photo_url: t.photo_url,
        condition: t.tree_condition,
        status: t.status,
        date: t.created_at,
        latitude: t.latitude,
        longitude: t.longitude,
        surveyor: t.surveyor,
        project_id: t.project_id,
      });
    }
  });

  // Filter
  const filtered = allItems.filter((item) => {
    const projectMatch = activeProjectId ? item.project_id === activeProjectId : true;
    const conditionMatch = conditionFilter === 'all' || item.condition === conditionFilter;
    const statusMatch = statusFilter === 'all' || item.status === statusFilter;
    return projectMatch && conditionMatch && statusMatch;
  });

  const counts = {
    total: filtered.length,
    completed: allItems.filter((i) => i.status === 'completed').length,
    approved: allItems.filter((i) => i.status === 'approved').length,
    rejected: allItems.filter((i) => i.status === 'rejected').length,
  };

  const renderFilterChips = () => {
    let filters: { label: string; value: string }[] = [];
    let selectedValue = '';
    let onPress: (val: string) => void = () => {};

    switch (activeCategory) {
      case 'condition':
        filters = CONDITION_FILTERS;
        selectedValue = conditionFilter;
        onPress = (v) => setConditionFilter(v as TreeCondition | 'all');
        break;
      case 'status':
        filters = STATUS_FILTERS;
        selectedValue = statusFilter;
        onPress = setStatusFilter;
        break;
    }

    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
        {filters.map((f) => {
          const active = selectedValue === f.value;
          return (
            <TouchableOpacity
              key={f.value}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => onPress(f.value)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  };

  const renderHistoryCard = (item: HistoryItem) => {
    const statusColor = STATUS_COLORS[item.status || ''] || '#888';
    const conditionColor = CONDITION_COLORS[item.condition || ''] || '#6b7280';
    const dateStr = new Date(item.date).toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    return (
      <TouchableOpacity
        key={item.id}
        style={[styles.historyCard, { borderLeftColor: statusColor }]}
        onPress={() => navigation.navigate('TreeDetail', { treeId: item.id })}
        activeOpacity={0.7}
      >
        {/* Photo */}
        {item.photo_url ? (
          <View style={styles.photoWrap}>
            <Image source={{ uri: item.photo_url }} style={styles.photo} resizeMode="cover" />
          </View>
        ) : (
          <View style={styles.photoWrap}>
            <View style={styles.photoPlaceholder}>
              <Text style={styles.photoPlaceholderText}>🌳</Text>
            </View>
          </View>
        )}

        <View style={styles.cardContent}>
          <View style={styles.cardTop}>
            <View style={styles.cardTitleWrap}>
              <Text style={styles.taskId}>ID: {item.id.slice(0, 8).toUpperCase()}</Text>
              <Text style={styles.taskName} numberOfLines={1}>{item.title}</Text>
            </View>
            {/* Status badge on right */}
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '20', borderColor: statusColor }]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusText, { color: statusColor }]}>{(item.status || '').toUpperCase()}</Text>
            </View>
          </View>

          {/* Condition badge */}
          {item.condition ? (
            <View style={[styles.conditionBadge, { backgroundColor: conditionColor + '15', borderColor: conditionColor + '40' }]}>
              <View style={[styles.conditionDot, { backgroundColor: conditionColor }]} />
              <Text style={[styles.conditionText, { color: conditionColor }]}>{item.condition}</Text>
            </View>
          ) : null}

          {/* Location + Date */}
          <View style={styles.bottomRow}>
            {item.latitude && item.longitude ? (
              <View style={styles.locationBadge}>
                <Ionicons name="location-outline" size={10} color="#1a5c2a" />
                <Text style={styles.locationText}>Location</Text>
              </View>
            ) : null}
            <View style={styles.dateRow}>
              <Ionicons name="calendar-outline" size={10} color="#888" />
              <Text style={styles.date}>{dateStr}</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient colors={['#123f24', '#1a5c2a', '#2e7d43']} style={styles.header}>
        <Ionicons name="leaf" size={20} color="#fff" />
        <Text style={styles.headerTitle}>HISTORY</Text>
        <View style={styles.headerCountBadge}>
          <Text style={styles.headerCountText}>{counts.total}</Text>
        </View>
      </LinearGradient>

      {/* Category Tabs */}
      <View style={styles.categoryBar}>
        {CATEGORIES.map((cat) => {
          const active = activeCategory === cat.key;
          return (
            <TouchableOpacity
              key={cat.key}
              style={[styles.categoryBtn, active && styles.categoryBtnActive]}
              onPress={() => handleCategoryChange(cat.key)}
            >
              <Ionicons name={cat.icon as any} size={14} color={active ? '#fff' : '#1a5c2a'} />
              <Text style={[styles.categoryText, active && styles.categoryTextActive]}>{cat.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Filter Chips */}
      <View style={styles.chipBar}>
        {renderFilterChips()}
      </View>

      {/* Count */}
      <Text style={styles.count}>{filtered.length} record{filtered.length !== 1 ? 's' : ''}</Text>

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => `${item.type}-${item.id}`}
        renderItem={({ item }) => renderHistoryCard(item)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1a5c2a" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🌱</Text>
            <Text style={styles.emptyText}>No records found</Text>
            <Text style={styles.emptySubText}>
              {conditionFilter !== 'all' || statusFilter !== 'all'
                ? 'Try a different filter'
                : 'Your work history will appear here'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 48,
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: 'bold',
    color: '#fff',
    flex: 1,
  },
  headerCountBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 7.5,
  },
  headerCountText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  categoryBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  categoryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: 7.5,
    backgroundColor: '#E8F5E9',
  },
  categoryBtnActive: {
    backgroundColor: '#1a5c2a',
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1a5c2a',
  },
  categoryTextActive: {
    color: '#fff',
  },
  chipBar: {
    backgroundColor: '#fff',
    paddingBottom: 10,
  },
  chipScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 7.5,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  chipActive: {
    backgroundColor: '#1a5c2a',
    borderColor: '#1a5c2a',
  },
  chipText: {
    fontSize: 12,
    color: '#555',
    fontWeight: '500',
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  count: { fontSize: 12, color: '#888', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  list: { padding: 16, paddingTop: 8 },

  // History card
  historyCard: {
    backgroundColor: '#fff',
    borderRadius: 7.5,
    marginBottom: 10,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    flexDirection: 'row',
    borderLeftWidth: 3,
    borderLeftColor: '#22c55e',
    padding: 10,
  },
  photoWrap: {
    width: 80,
    height: 80,
    borderRadius: 7.5,
    overflow: 'hidden',
    marginRight: 12,
  },
  photo: {
    width: 80,
    height: 80,
  },
  photoPlaceholder: {
    width: 80,
    height: 80,
    backgroundColor: '#e8f5e9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: { fontSize: 32 },
  cardContent: {
    flex: 1,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  cardTitleWrap: {
    flex: 1,
    marginRight: 8,
  },
  taskId: {
    fontSize: 10,
    fontWeight: '600',
    color: '#999',
    marginBottom: 2,
  },
  taskName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#222',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7.5,
    borderWidth: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 9,
    fontWeight: '700',
  },
  conditionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7.5,
    borderWidth: 1,
    marginBottom: 6,
  },
  conditionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  conditionText: {
    fontSize: 10,
    fontWeight: '600',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  locationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7.5,
  },
  locationText: {
    fontSize: 10,
    color: '#1a5c2a',
    fontWeight: '600',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  date: {
    fontSize: 10,
    color: '#888',
  },

  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#555' },
  emptySubText: { fontSize: 13, color: '#888', marginTop: 4 },
});