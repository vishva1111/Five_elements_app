import React, { useState, useCallback, useRef, useEffect } from 'react';
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
import { useProjectRefreshStore } from '../../store/projectRefreshStore';
import { fetchMyTrees, backfillProjectTreeIds } from '../../services/treeService';
import { parseTreeMeta, resolveTreeId, TREE_ID_PLACEHOLDER } from '../../utils/treeId';
import { fetchAgentTasks } from '../../services/taskService';
import { TreeCondition, LandType, Task, TreeRecord, HistoryCategory, MONITORING_ROUNDS } from '../../types';
import { fetchAuditsForTrees, getLatestAudit } from '../../services/auditService';
import TreeCard from '../../components/TreeCard';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

type FilterCategory = HistoryCategory;

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
  tree_id?: string;
  tree_record_id?: string;
  audit_round?: number | null;
  rejection_notes?: string | null;
  raw_task?: Task | null;
}

const CATEGORIES: { key: FilterCategory; label: string; icon: string }[] = [
  { key: 'condition', label: 'Condition', icon: 'leaf' },
  { key: 'status', label: 'Status', icon: 'flag' },
  { key: 'audit', label: 'Audit', icon: 'clipboard' },
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

const AUDIT_FILTERS: { label: string; value: string }[] = [
  { label: 'All', value: 'all' },
  ...MONITORING_ROUNDS.map((r) => ({ label: `Audit ${r.round}`, value: String(r.round) })),
];

const CONDITION_COLORS: Record<string, string> = {
  Healthy: '#16a34a',
  Stressed: '#d97706',
  Diseased: '#dc2626',
  Dead: '#4b5563',
};

const STATUS_COLORS: Record<string, string> = {
  completed: '#16a34a',
  approved: '#7c3aed',
  rejected: '#dc2626',
};

const AUDIT_COLORS: Record<string, string> = {
  '1': '#22c55e',
  '2': '#3b82f6',
  '3': '#f59e0b',
  '4': '#8b5cf6',
};

export default function HistoryScreen() {
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const activeProjectId = useAuthStore((s) => s.activeProjectId);
  const refreshKey = useProjectRefreshStore((s) => s.refreshKey);
  const trees = useTreeStore((s) => s.trees) ?? [];
  const setTrees = useTreeStore((s) => s.setTrees);
  const tasks = useTaskStore((s) => s.tasks) ?? [];
  const setTasks = useTaskStore((s) => s.setTasks);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCategory, setActiveCategory] = useState<FilterCategory>('condition');
  const [conditionFilter, setConditionFilter] = useState<TreeCondition | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [auditFilter, setAuditFilter] = useState<string>('all');
  const [auditItems, setAuditItems] = useState<HistoryItem[]>([]);
  const [auditsByTree, setAuditsByTree] = useState<Record<string, any[]>>({});

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

    // Trees captured before project IDs existed get one assigned + persisted so
    // every card shows its project tree ID (e.g. ARAV-001)
    if (treesRes.data && treesRes.data.length > 0) {
      backfillProjectTreeIds(treesRes.data).then((enriched) => {
        if (seq !== loadSeqRef.current || !enriched) return;
        setTrees(enriched);
      });

      // Flatten monitoring records → one history item per audit photo
      try {
        const audits = await fetchAuditsForTrees(treesRes.data.map((t) => t.id));
        if (seq !== loadSeqRef.current) return;
        setAuditsByTree(audits);

        const currentTasks = tasksRes.data || [];
        const items: HistoryItem[] = [];
        for (const t of treesRes.data) {
          const records = audits[t.id] ?? [];
          const linkedTask = currentTasks.find((tk) => tk.tree_id === t.id || tk.id === t.id);
          const isApproved = Boolean(t.locked || linkedTask?.status === 'approved');
          for (const r of records) {
            items.push({
              id: r.id ?? `${t.id}-a${r.monitoring_round}`,
              tree_record_id: t.id,
              type: 'tree',
              title: t.species || 'Tree',
              photo_url: r.photo_url || t.photo_url,
              condition: r.tree_condition || t.tree_condition || 'Healthy',
              status: isApproved ? 'approved' : 'completed',
              date: r.survey_date || r.submitted_at || t.submitted_at,
              latitude: r.latitude ?? t.latitude,
              longitude: r.longitude ?? t.longitude,
              surveyor: r.surveyor || t.surveyor,
              project_id: r.project_id || t.project_id,
              tree_id: resolveTreeId(t),
              audit_round: r.monitoring_round ?? null,
            });
          }
        }
        setAuditItems(items);
      } catch (auditErr) {
        console.warn('[TreeApp] audit history load failed:', auditErr);
      }
    }
  }, [userId, setTrees, setTasks]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Instantly reload when the active project changes
  useEffect(() => {
    if (refreshKey > 0) loadData();
  }, [refreshKey]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleCategoryChange = (cat: FilterCategory) => {
    setActiveCategory(cat);
    setConditionFilter('all');
    setStatusFilter('all');
    setAuditFilter('all');
  };

  // Merge trees + approved/rejected tasks into history items
  const allItems: HistoryItem[] = [];

  // Trees (enriched with latest audit data if available)
  trees.forEach((t) => {
    const meta = parseTreeMeta(t.notes);
    const treeAudits = auditsByTree[t.id] ?? [];
    const latest = getLatestAudit(treeAudits);
    const rawCondition = latest?.tree_condition || t.tree_condition || meta.tree_condition || 'Healthy';
    const normalizedCondition = rawCondition.charAt(0).toUpperCase() + rawCondition.slice(1).toLowerCase();
    const photo = latest?.photo_url || t.photo_url;
    const linkedTask = tasks.find((tk) => tk.tree_id === t.id || tk.id === t.id);
    const isApproved = Boolean(t.locked || linkedTask?.status === 'approved');

    allItems.push({
      id: t.id,
      tree_record_id: t.id,
      type: 'tree',
      title: t.species || 'Tree',
      photo_url: photo,
      condition: normalizedCondition,
      status: isApproved ? 'approved' : 'completed',
      date: latest?.survey_date || latest?.submitted_at || t.submitted_at,
      latitude: latest?.latitude ?? t.latitude,
      longitude: latest?.longitude ?? t.longitude,
      surveyor: latest?.surveyor || t.surveyor || meta.surveyor,
      project_id: t.project_id,
      tree_id: resolveTreeId(t),
      audit_round: latest?.monitoring_round ?? null,
    });
  });

  // Tasks (completed, approved, rejected — all show in history with same TreeCard design)
  tasks.forEach((t) => {
    if (t.status === 'approved' || t.status === 'rejected' || t.status === 'completed') {
      const rawCondition = t.tree_condition || '';
      const normalizedCondition = rawCondition.charAt(0).toUpperCase() + rawCondition.slice(1).toLowerCase();
      allItems.push({
        id: t.id,
        tree_record_id: t.tree_record_id || t.tree_id || t.id,
        type: 'task',
        title: t.name || 'Task',
        photo_url: t.photo_url,
        condition: normalizedCondition,
        status: t.status,
        date: t.created_at,
        latitude: t.latitude,
        longitude: t.longitude,
        surveyor: t.surveyor,
        project_id: t.project_id,
        rejection_notes: t.review_notes || t.notes || null,
        raw_task: t,
      });
    }
  });

  // Filter
  const sourceItems =
    activeCategory === 'audit'
      ? auditItems
      : activeCategory === 'condition'
      ? trees.map((t) => allItems.find((i) => i.id === t.id)).filter(Boolean) as HistoryItem[]
      : // STATUS tab: show ALL tree cards (completed, approved, rejected)
        allItems; // all statuses shown

  const filtered = sourceItems.filter((item) => {
    const projectMatch = activeProjectId ? item.project_id === activeProjectId : true;
    if (activeCategory === 'audit') {
      const roundMatch = auditFilter === 'all' || String(item.audit_round ?? '') === auditFilter;
      return projectMatch && roundMatch;
    }
    const itemCondition = (item.condition || '').toLowerCase();
    const filterCondition = (conditionFilter || 'all').toLowerCase();
    const conditionMatch = filterCondition === 'all' || itemCondition === filterCondition;
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
      case 'audit':
        filters = AUDIT_FILTERS;
        selectedValue = auditFilter;
        onPress = setAuditFilter;
        break;
    }

    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
        {filters.map((f) => {
          const active = selectedValue === f.value;
          const chipColor =
            activeCategory === 'condition' && f.value !== 'all'
              ? CONDITION_COLORS[f.value] || '#1a5c2a'
              : activeCategory === 'status' && f.value !== 'all'
              ? STATUS_COLORS[f.value] || '#1a5c2a'
              : activeCategory === 'audit' && f.value !== 'all'
              ? AUDIT_COLORS[f.value] || '#1a5c2a'
              : '#1a5c2a';
          return (
            <TouchableOpacity
              key={f.value}
              style={[
                styles.chip,
                active && { backgroundColor: chipColor, borderColor: chipColor },
                !active && f.value !== 'all' && activeCategory === 'condition' && { backgroundColor: CONDITION_COLORS[f.value] + '15', borderColor: CONDITION_COLORS[f.value] + '40' },
                !active && f.value !== 'all' && activeCategory === 'status' && { backgroundColor: STATUS_COLORS[f.value] + '15', borderColor: STATUS_COLORS[f.value] + '40' },
                !active && f.value !== 'all' && activeCategory === 'audit' && { backgroundColor: AUDIT_COLORS[f.value] + '15', borderColor: AUDIT_COLORS[f.value] + '40' },
              ]}
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
    const targetTreeId = item.tree_record_id || item.id;
    const treeAudits = auditsByTree[targetTreeId] || [];

    return (
      <TreeCard
        key={item.id}
        tree={{
          id: targetTreeId,
          tree_id: item.tree_id,
          species: item.title,
          photo_url: item.photo_url || '',
          latitude: item.latitude || 0,
          longitude: item.longitude || 0,
          tree_condition: (item.condition as TreeCondition) || 'Healthy',
          health_status: 'healthy',
          submitted_at: item.date,
          synced: true,
          locked: item.status === 'approved',
          user_id: '',
          surveyor: item.surveyor,
        }}
        task={null}
        status={item.status as any}
        auditRound={item.audit_round}
        audits={treeAudits}
        rejectionNotes={null}
        displayId={item.tree_id || undefined}
        showSurveyor={false}
        onPress={() => {
          navigation.navigate('TreeDetail', { treeId: targetTreeId });
        }}
      />
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
              {conditionFilter !== 'all' || statusFilter !== 'all' || auditFilter !== 'all'
                ? 'Try a different filter'
                : activeCategory === 'audit'
                ? 'Your audit records will appear here'
                : 'Your work history will appear here'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f1' },
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
    fontWeight: '800',
    color: '#fff',
    flex: 1,
  },
  headerCountBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
  },
  headerCountText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  categoryBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
    backgroundColor: '#fff',
  },
  categoryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#E8F5E9',
  },
  categoryBtnActive: {
    backgroundColor: '#1a5c2a',
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1a5c2a',
  },
  categoryTextActive: {
    color: '#fff',
  },
  chipBar: {
    backgroundColor: '#fff',
    paddingBottom: 12,
  },
  chipScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#E8F5E9',
  },
  chipActive: {
    backgroundColor: '#1a5c2a',
  },
  chipText: {
    fontSize: 12,
    color: '#555',
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: '800',
  },
  list: { padding: 16, paddingTop: 8, paddingBottom: 100 },

  historyCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: 12,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    flexDirection: 'row',
    borderLeftWidth: 3,
    borderLeftColor: '#22c55e',
    padding: 12,
  },
  photoWrap: {
    width: 90,
    height: 90,
    borderRadius: 14,
    overflow: 'hidden',
    marginRight: 14,
  },
  photo: {
    width: 90,
    height: 90,
  },
  photoPlaceholder: {
    width: 90,
    height: 90,
    backgroundColor: '#e8f5e9',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  photoPlaceholderText: { fontSize: 36 },
  cardContent: {
    flex: 1,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardTitleWrap: {
    flex: 1,
    marginRight: 8,
  },
  taskId: {
    fontSize: 10,
    fontWeight: '700',
    color: '#999',
    marginBottom: 2,
  },
  taskIdValue: {
    color: '#1a5c2a',
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  taskName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#222',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 9,
    fontWeight: '800',
  },
  conditionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  conditionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  conditionText: {
    fontSize: 10,
    fontWeight: '700',
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
    borderRadius: 14,
  },
  locationText: {
    fontSize: 10,
    color: '#1a5c2a',
    fontWeight: '700',
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
  emptyText: { fontSize: 16, fontWeight: '800', color: '#555' },
  emptySubText: { fontSize: 13, color: '#888', marginTop: 4 },
});