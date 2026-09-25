import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Image,
} from 'react-native';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useTreeStore } from '../../store/treeStore';
import { useTaskStore } from '../../store/taskStore';
import { useProjectRefreshStore } from '../../store/projectRefreshStore';
import { fetchMyTrees, fetchAllProjects, backfillProjectTreeIds } from '../../services/treeService';
import { fetchAgentTasks, startTask } from '../../services/taskService';
import { loadLocalTasks } from '../../services/localTaskService';
import { fetchAuditsForTrees } from '../../services/auditService';
import { Task, Project, TreeRecord } from '../../types';
import { displayTreeId, parseTreeMeta, resolveTreeId } from '../../utils/treeId';
import { fetchProjectGeofence } from '../../services/projectGeofenceService';
import CircularProgress from '../../components/CircularProgress';
import TreeCard from '../../components/TreeCard';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

type TaskTab = 'assigned' | 'completed' | 'approved' | 'rejected';

const TABS: { key: TaskTab; label: string; color: string }[] = [
  { key: 'assigned', label: 'Assigned', color: '#1a5c2a' },
  { key: 'completed', label: 'Completed', color: '#16a34a' },
  { key: 'approved', label: 'Approved', color: '#7c3aed' },
  { key: 'rejected', label: 'Rejected', color: '#ef4444' },
];

export default function TaskScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const activeProjectId = useAuthStore((s) => s.activeProjectId);
  const refreshKey = useProjectRefreshStore((s) => s.refreshKey);
  const trees = useTreeStore((s) => s.trees) ?? [];
  const setTrees = useTreeStore((s) => s.setTrees);
  const tasks = useTaskStore((s) => s.tasks) ?? [];
  const setTasks = useTaskStore((s) => s.setTasks);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TaskTab>('assigned');
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('all');
  const [hasRemainingGeofence, setHasRemainingGeofence] = useState(false);
  // uuid (tree record) → project tree ID, e.g. "ARAV-001" (see utils/treeId.ts)
  const [treeIds, setTreeIds] = useState<Record<string, string>>({});
  const [auditsByTree, setAuditsByTree] = useState<Record<string, any[]>>({});
  const loadSeqRef = useRef(0);

  // Keep stable refs so loadTasks never needs to be recreated on value changes
  const activeProjectIdRef = useRef(activeProjectId);
  useEffect(() => { activeProjectIdRef.current = activeProjectId; }, [activeProjectId]);

  // Dashboard boxes can open this screen on a specific tab (e.g. Rejected/Completed).
  useEffect(() => {
    const tab = (route.params as { tab?: TaskTab } | undefined)?.tab;
    if (tab) setActiveTab(tab);
  }, [route.params]);

  // Filter tasks by selected date
  const filterByDate = (taskList: Task[]) => {
    if (selectedDate === 'all') return taskList;
    const dateStr = selectedDate === 'today' ? new Date().toISOString().split('T')[0] : selectedDate;
    return taskList.filter((t) => {
      if (!t.created_at) return false;
      return t.created_at.split('T')[0] === dateStr;
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await fetchAllProjects();
      if (!cancelled && data) setAllProjects(data);
    })();
    return () => { cancelled = true; };
  }, []);

  const loadTasks = useCallback(async () => {
    if (!userId) return;
    const seq = ++loadSeqRef.current;
    const [treesRes, tasksRes, localTasks] = await Promise.all([
      fetchMyTrees(userId),
      fetchAgentTasks(userId),
      loadLocalTasks(),
    ]);
    if (seq !== loadSeqRef.current) return;
    const myTrees = treesRes.data ?? [];
    const pid = activeProjectIdRef.current;

    // Filter trees by active project if selected
    const visibleTrees = pid ? myTrees.filter((t) => t.project_id === pid) : myTrees;
    setTrees(visibleTrees);

    // Filter DB + local tasks by active project if selected
    const combinedTasks: Task[] = [...(tasksRes.data ?? []), ...localTasks];
    const visibleTasks = pid ? combinedTasks.filter((t) => t.project_id === pid) : combinedTasks;
    setTasks(visibleTasks);

    // Check if active project has remaining geofencing setup
    if (pid) {
      fetchProjectGeofence(pid).then((geoRes) => {
        if (seq !== loadSeqRef.current) return;
        const isDone = Boolean(geoRes.data?.locked && geoRes.data?.coordinates && geoRes.data.coordinates.length >= 3);
        setHasRemainingGeofence(!isDone);
      });
    } else {
      setHasRemainingGeofence(false);
    }

    // Fetch audits for all trees so approved cards have complete audit schedules

    if (visibleTrees.length > 0) {
      fetchAuditsForTrees(visibleTrees.map((t) => t.id)).then((audits) => {
        if (seq === loadSeqRef.current && audits) {
          setAuditsByTree(audits);
        }
      });
    }

    // Tree capture cards labelled with the project tree ID (e.g. ARAV-001).
    if (myTrees.length > 0) {
      backfillProjectTreeIds(myTrees).then((enriched) => {
        if (seq !== loadSeqRef.current || !enriched) return;
        const resolved: Record<string, string> = {};
        enriched.forEach((t) => {
          const id = resolveTreeId(t);
          if (t?.id && id) resolved[t.id] = id;
        });
        if (Object.keys(resolved).length > 0) {
          setTreeIds((prev) => ({ ...prev, ...resolved }));
        }
      });
    }
  // activeProjectId read via ref — stable callback, no recreation on project change
  }, [userId, setTasks, setTrees]);

  useFocusEffect(
    useCallback(() => {
      loadTasks();
    }, [loadTasks])
  );

  // Instantly reload whenever the active project changes (refreshKey incremented
  // by setActiveProjectId in authStore — fires even when this screen is not focused)
  useEffect(() => {
    if (refreshKey > 0) loadTasks();
  }, [refreshKey]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTasks();
    setRefreshing(false);
  };

  const handleStartTask = async (task: Task) => {
    if (!task.started_at) {
      await startTask(task.id);
      setTasks(tasks.map((t) => (t.id === task.id ? { ...t, started_at: new Date().toISOString(), status: 'in_progress' } : t)));
    }
    navigation.navigate('Capture');
  };

  const handleOpenMap = (location: string) => {
    navigation.getParent()?.navigate('Map');
  };

  const getTodayDate = () => {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    return now.toLocaleDateString('en-IN', options);
  };

  // Ensure trees are filtered by active project
  const projectTrees = useMemo(() => {
    if (!activeProjectId) return trees;
    return trees.filter((t) => t.project_id === activeProjectId);
  }, [trees, activeProjectId]);

  // assigned + in_progress both show in the Assigned tab
  const assignedTasks = tasks.filter((t) => t.status === 'assigned' || t.status === 'in_progress');
  const rejectedTasks = tasks.filter((t) => t.status === 'rejected');

  // Approved Tasks + Approved Trees (locked or approved status)
  const approvedItems = useMemo(() => {
    const list: Task[] = [];
    const seenIds = new Set<string>();

    tasks.forEach((t) => {
      if (t.status === 'approved') {
        list.push(t);
        seenIds.add(t.id);
        if (t.tree_id) seenIds.add(t.tree_id);
        if (t.tree_record_id) seenIds.add(t.tree_record_id);
      }
    });

    projectTrees.forEach((t) => {
      const linkedTask = tasks.find((tk) => tk.tree_id === t.id || tk.id === t.id);
      const isApproved = Boolean(t.locked || linkedTask?.status === 'approved');
      if (isApproved && !seenIds.has(t.id)) {
        seenIds.add(t.id);
        const meta = parseTreeMeta(t.notes);
        const condition = t.tree_condition || meta.tree_condition || 'Healthy';
        list.push({
          id: t.id,
          tree_id: t.id,
          tree_record_id: t.id,
          name: t.species || 'Tree Capture',
          project_id: t.project_id,
          assignee_id: t.user_id || '',
          target_count: 1,
          priority: 'medium' as const,
          captured: 1,
          remaining: 0,
          progress: 100,
          status: 'approved' as const,
          created_at: t.submitted_at,
          photo_url: t.photo_url,
          latitude: t.latitude,
          longitude: t.longitude,
          tree_condition: condition,
          tree_condition_color: condition === 'Healthy' ? '#16a34a' : condition === 'Stressed' ? '#d97706' : condition === 'Diseased' ? '#dc2626' : '#4b5563',
          surveyor: t.surveyor || meta.surveyor,
        });
      }
    });

    return list;
  }, [tasks, projectTrees]);

  // Completed Tasks (pending review) + Completed Trees (pending review)
  const completedItems = useMemo(() => {
    const list: Task[] = [];
    const seenIds = new Set<string>();

    tasks.forEach((t) => {
      if (t.status === 'completed') {
        list.push(t);
        seenIds.add(t.id);
        if (t.tree_id) seenIds.add(t.tree_id);
        if (t.tree_record_id) seenIds.add(t.tree_record_id);
      }
    });

    projectTrees.forEach((t) => {
      const linkedTask = tasks.find((tk) => tk.tree_id === t.id || tk.id === t.id);
      const isApproved = Boolean(t.locked || linkedTask?.status === 'approved');
      const isRejected = linkedTask?.status === 'rejected';
      if (!isApproved && !isRejected && !seenIds.has(t.id)) {
        seenIds.add(t.id);
        const meta = parseTreeMeta(t.notes);
        const condition = t.tree_condition || meta.tree_condition || 'Healthy';
        list.push({
          id: t.id,
          tree_id: t.id,
          tree_record_id: t.id,
          name: t.species || 'Tree Capture',
          project_id: t.project_id,
          assignee_id: t.user_id || '',
          target_count: 1,
          priority: 'medium' as const,
          captured: 1,
          remaining: 0,
          progress: 100,
          status: 'completed' as const,
          created_at: t.submitted_at,
          photo_url: t.photo_url,
          latitude: t.latitude,
          longitude: t.longitude,
          tree_condition: condition,
          tree_condition_color: condition === 'Healthy' ? '#16a34a' : condition === 'Stressed' ? '#d97706' : condition === 'Diseased' ? '#dc2626' : '#4b5563',
          surveyor: t.surveyor || meta.surveyor,
        });
      }
    });

    return list;
  }, [tasks, projectTrees]);

  // Tab counts
  const assignedCount = assignedTasks.length;
  const completedCount = completedItems.length;
  const approvedCount = approvedItems.length;
  const rejectedCount = rejectedTasks.length;
  const reviewedCount = approvedCount + rejectedCount;
  const totalTasks = assignedCount + completedCount + approvedCount + rejectedCount;

  // Date selector — pull dates from active tasks and trees so every tab's date filter works
  const dates = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    const dateSet = new Set<string>();
    tasks.forEach((t) => {
      if (t.created_at) dateSet.add(t.created_at.split('T')[0]);
    });
    projectTrees.forEach((t) => {
      if (t.submitted_at) dateSet.add(t.submitted_at.split('T')[0]);
    });
    const sorted = Array.from(dateSet).sort((a, b) => b.localeCompare(a));
    return sorted.map((dateStr) => {
      const d = new Date(dateStr + 'T00:00:00');
      const dayNum = d.getDate().toString();
      const monthStr = d.toLocaleDateString('en-IN', { month: 'short' });
      const weekdayStr = d.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase();
      return {
        key: dateStr === todayStr ? 'today' : dateStr,
        label: dateStr === todayStr ? 'TODAY' : weekdayStr,
        day: dayNum,
        month: monthStr,
        isToday: dateStr === todayStr,
      };
    });
  }, [tasks, projectTrees]);

  const activeProject = allProjects.find((p) => p.id === activeProjectId);

  // uuid → tree record: lets a completed card know it stands for a tree capture,
  // so it can be labelled with the project tree ID instead of the DB uuid.
  const treeByUuid = useMemo(() => {
    const map = new Map<string, TreeRecord>();
    projectTrees.forEach((t) => {
      if (t?.id) map.set(t.id, t);
    });
    return map;
  }, [projectTrees]);

  const renderTaskCard = (task: Task) => {
    // For rejected tasks or tree captures, resolve the linked tree record
    let treeRecord =
      treeByUuid.get(task.id) ||
      (task.tree_id ? treeByUuid.get(task.tree_id) : undefined) ||
      (task.tree_record_id ? treeByUuid.get(task.tree_record_id) : undefined);

    if (!treeRecord && task.name) {
      const match = task.name.match(/\(([A-Fa-f0-9]{4,36})\)/);
      if (match && match[1]) {
        const hex = match[1].toLowerCase();
        treeRecord = trees.find(
          (t) =>
            t.id.toLowerCase().startsWith(hex) ||
            resolveTreeId(t).toLowerCase().includes(hex)
        );
      }
    }

    const targetId = treeRecord?.id || task.tree_id || task.id;
    const projectTreeId = treeRecord ? treeIds[treeRecord.id] || resolveTreeId(treeRecord) || displayTreeId(treeRecord) : undefined;
    const isAssigned = task.status === 'assigned' || task.status === 'in_progress';
    const isRejected = task.status === 'rejected';
    const isApproved = task.status === 'approved' || Boolean(treeRecord?.locked);
    const treeAudits = auditsByTree[targetId] || [];

    const handlePress = () => {
      navigation.navigate('TreeDetail', { treeId: targetId });
    };

    const handleUpdate = () => {
      navigation.navigate('EditTree', {
        treeId: targetId,
        taskId: task.id,
        rejectionNotes: task.review_notes || null,
      });
    };

    return (
      <TreeCard
        key={task.id}
        tree={treeRecord ? { ...treeRecord, locked: isApproved } : null}
        task={task}
        status={isApproved ? 'approved' : task.status}
        audits={treeAudits}
        displayId={projectTreeId}
        showSurveyor={false}
        onPress={isAssigned ? undefined : handlePress}
        onAction={
          isAssigned
            ? () => handleStartTask(task)
            : isRejected
            ? handleUpdate
            : undefined
        }
        actionLabel={isAssigned ? 'Start' : isRejected ? 'Update Submission' : undefined}
        actionVariant={isAssigned ? 'start' : isRejected ? 'update' : undefined}
        onLocationPress={
          !isAssigned && ((task.latitude && task.longitude) || (treeRecord?.latitude && treeRecord?.longitude))
            ? () =>
                handleOpenMap(
                  `${task.latitude ?? treeRecord?.latitude},${task.longitude ?? treeRecord?.longitude}`
                )
            : undefined
        }
      />
    );
  };

  const renderEmpty = (emoji: string, title: string, sub: string) => (
    <View style={s.emptyState}>
      <Text style={s.emptyEmoji}>{emoji}</Text>
      <Text style={s.emptyText}>{title}</Text>
      <Text style={s.emptySubText}>{sub}</Text>
    </View>
  );

  const renderTaskList = (list: Task[]) =>
    list.length === 0
      ? renderEmpty('🗂️', 'No tasks here', 'Tap "+ Add Demo" to create one')
      : list.map(renderTaskCard);

  return (
    <View style={s.container}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1a5c2a" />}
      >
        {/* Header with date and project location */}
        <LinearGradient colors={['#123f24', '#1a5c2a', '#2e7d43']} style={[s.header, { paddingTop: insets.top + 12 }]}>
          <View style={s.headerRow}>
            <View style={s.headerLeft}>
              <Text style={s.headerDate}>{getTodayDate()}</Text>
              <Text style={s.headerSub} numberOfLines={1}>{activeProject?.name ?? 'No project selected'}</Text>
            </View>
            <View style={s.headerDivider} />
            {activeProject ? (
              <TouchableOpacity
                style={s.headerLocation}
                onPress={() => handleOpenMap(activeProject.name)}
                activeOpacity={0.7}
              >
                <View style={s.headerLocationImage}>
                  <Ionicons name="map" size={22} color="#fff" />
                </View>
                <Text style={s.headerLocationLabel}>OPEN MAP</Text>
              </TouchableOpacity>
            ) : (
              <View style={s.headerLocation}>
                <View style={s.headerLocationImage}>
                  <Ionicons name="location-outline" size={22} color="#fff" />
                </View>
                <Text style={s.headerLocationLabel}>LOCATION</Text>
              </View>
            )}
          </View>
        </LinearGradient>

        {/* Tabs with CircularProgress rings */}
        <View style={s.tabsWrap}>
          <View style={s.tabsRow}>
            {TABS.map((tab) => {
              const active = activeTab === tab.key;
              let count: number;
              let denominator: number;
              if (tab.key === 'assigned') {
                count = totalTasks - completedCount;
                denominator = totalTasks;
              } else if (tab.key === 'completed') {
                count = reviewedCount;
                denominator = completedCount;
              } else if (tab.key === 'approved') {
                count = approvedCount;
                denominator = totalTasks;
              } else {
                count = rejectedCount;
                denominator = completedCount;
              }

              const pct = denominator > 0 ? (count / denominator) * 100 : 0;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={[
                    s.tabBtn,
                    active && { backgroundColor: tab.color + '15', borderColor: tab.color },
                    !active && { borderColor: tab.color + '40' },
                  ]}
                  onPress={() => setActiveTab(tab.key)}
                  activeOpacity={0.7}
                >
                  <CircularProgress
                    size={56}
                    progress={pct}
                    color={tab.color}
                    strokeWidth={4}
                    trackColor="#E8E8E8"
                  >
                    <Text style={[s.tabCountText, { color: tab.color }]}>
                      {count}/{denominator}
                    </Text>
                  </CircularProgress>
                  <Text numberOfLines={1} style={[s.tabText, active && { color: tab.color }]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Date Selector */}
        <View style={s.dateSelectorWrap}>
          <TouchableOpacity
            style={[s.dateAllBtn, selectedDate === 'all' && s.dateAllBtnActive]}
            onPress={() => setSelectedDate('all')}
            activeOpacity={0.7}
          >
            <Ionicons name="calendar-outline" size={16} color={selectedDate === 'all' ? '#fff' : '#1a5c2a'} />
            <Text style={[s.dateAllText, selectedDate === 'all' && s.dateAllTextActive]}>All</Text>
          </TouchableOpacity>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.dateList}>
            {dates.map((d) => {
              const isActive = selectedDate === d.key;
              return (
                <TouchableOpacity
                  key={d.key}
                  style={[s.dateItem, isActive && s.dateItemActive]}
                  onPress={() => setSelectedDate(d.key)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.dateLabel, isActive && s.dateLabelActive]}>{d.label}</Text>
                  <Text style={[s.dateDay, isActive && s.dateDayActive]}>{d.day}</Text>
                  <Text style={[s.dateMonth, isActive && s.dateMonthActive]}>{d.month}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Tab content */}
        <View style={s.content}>
          {activeTab === 'assigned' && (
            <>
              {hasRemainingGeofence && (
                <TouchableOpacity
                  style={s.geofenceTaskCard}
                  onPress={() => navigation.getParent()?.navigate('Map', { startGeofenceWalk: true })}
                  activeOpacity={0.85}
                >
                  <View style={s.geofenceTaskHeader}>
                    <View style={s.geofenceTaskBadge}>
                      <Text style={s.geofenceTaskBadgeText}>1-TIME MANDATORY SETUP</Text>
                    </View>
                    <View style={s.geofenceTaskPriority}>
                      <Text style={s.geofenceTaskPriorityText}>REQUIRED</Text>
                    </View>
                  </View>
                  <Text style={s.geofenceTaskTitle}>Land Perimeter Geofencing</Text>
                  <Text style={s.geofenceTaskSub}>
                    Walk the land edge perimeter with your phone and save a point at each corner to define and lock this project's boundary.
                  </Text>
                  <View style={s.geofenceTaskFooter}>
                    <View style={s.geofenceTaskInfo}>
                      <Ionicons name="walk" size={16} color="#1a5c2a" />
                      <Text style={s.geofenceTaskInfoText}>Walk corners on Map</Text>
                    </View>
                    <View style={s.geofenceTaskActionBtn}>
                      <Text style={s.geofenceTaskActionText}>Start Walk</Text>
                      <Ionicons name="arrow-forward" size={13} color="#fff" />
                    </View>
                  </View>
                </TouchableOpacity>
              )}
              {renderTaskList(filterByDate(assignedTasks))}
            </>
          )}
          {activeTab === 'completed' && renderTaskList(filterByDate(completedItems))}
          {activeTab === 'approved' && renderTaskList(filterByDate(approvedItems))}
          {activeTab === 'rejected' && renderTaskList(filterByDate(rejectedTasks))}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f1' },
  scroll: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  headerLeft: { flex: 1 },
  headerDate: { fontSize: 18, fontWeight: '800', color: '#fff' },
  headerSub: { fontSize: 13, fontWeight: '600', color: '#cde8d3', marginTop: 2 },
  headerDivider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  headerLocation: {
    alignItems: 'center',
    gap: 4,
  },
  headerLocationImage: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLocationLabel: { fontSize: 9, fontWeight: '600', color: '#cde8d3', letterSpacing: 0.5 },
  tabsWrap: { paddingHorizontal: 12, paddingTop: 12 },
  tabsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#E0ECDD',
  },
  tabBtnActive: {},
  tabText: { fontSize: 11, fontWeight: '800', color: '#888' },
  tabCountText: { fontSize: 13, fontWeight: '800' },
  dateSelectorWrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8, gap: 8 },
  dateAllBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minWidth: 56,
    height: 68,
  },
  dateAllBtnActive: { backgroundColor: '#1a5c2a' },
  dateAllText: { fontSize: 12, fontWeight: '800', color: '#1a5c2a' },
  dateAllTextActive: { color: '#fff' },
  dateList: { gap: 8 },
  dateItem: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minWidth: 56,
    height: 68,
  },
  dateItemActive: { backgroundColor: '#1a5c2a' },
  dateLabel: { fontSize: 9, fontWeight: '800', color: '#888', letterSpacing: 0.5 },
  dateLabelActive: { color: '#fff' },
  dateDay: { fontSize: 18, fontWeight: '800', color: '#222', marginTop: 1 },
  dateDayActive: { color: '#fff' },
  dateMonth: { fontSize: 10, fontWeight: '600', color: '#888' },
  dateMonthActive: { color: '#fff' },
  content: { padding: 16, paddingTop: 12 },
  taskCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    elevation: 4,
    shadowColor: '#1a5c2a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#1a5c2a',
    flexDirection: 'row',
  },
  taskPhotoWrap: {
    width: 80,
    height: 80,
    borderRadius: 14,
    overflow: 'hidden',
    marginRight: 12,
  },
  taskPhoto: {
    width: 80,
    height: 80,
  },
  taskPhotoPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 14,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskCardContent: {
    flex: 1,
  },
  taskCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  taskTitleWrap: { flex: 1 },
  taskId: { fontSize: 10, fontWeight: '600', color: '#999', marginBottom: 2 },
  // Project tree ID on a tree-capture card (same look as components/TreeCard.tsx)
  taskIdValue: { color: '#1a5c2a', fontFamily: 'monospace', fontWeight: '800' },
  taskName: { fontSize: 14, fontWeight: '800', color: '#222' },
  statusBadge: { borderRadius: 14, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 9, fontWeight: '800' },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1a5c2a',
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 10,
    elevation: 2,
    shadowColor: '#1a5c2a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  startBtnText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  // Update button — full-width below card details, only for rejected tasks
  updateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#ef4444',
    borderRadius: 10,
    paddingVertical: 8,
    marginTop: 10,
    elevation: 2,
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  updateBtnText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  // Rejection reason row (review_notes)
  rejectionReasonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    marginTop: 6,
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  rejectionReasonText: { fontSize: 10, color: '#ef4444', flex: 1, lineHeight: 14 },
  taskNote: { fontSize: 12, color: '#666', marginTop: 4, lineHeight: 16 },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  dueText: { fontSize: 10, color: '#888' },
  treeDetailRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  detailLink: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#E8F5E9', borderRadius: 14 },
  detailLinkText: { fontSize: 10, color: '#1a5c2a', fontWeight: '800' },
  conditionBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 14, borderWidth: 1 },
  conditionDot: { width: 6, height: 6, borderRadius: 3 },
  surveyorRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  surveyorText: { fontSize: 10, color: '#666' },
  auditChip: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#E8F5E9', borderRadius: 12 },
  auditChipText: { fontSize: 10, fontWeight: '800', color: '#1a5c2a' },
  emptyState: { alignItems: 'center', paddingVertical: 48 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '800', color: '#555' },
  emptySubText: { fontSize: 13, color: '#888', marginTop: 4, textAlign: 'center', paddingHorizontal: 24 },
  // Mandatory Geofence Task Card
  geofenceTaskCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#f59e0b',
    elevation: 3,
    shadowColor: '#f59e0b',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  geofenceTaskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  geofenceTaskBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  geofenceTaskBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#b45309',
    letterSpacing: 0.5,
  },
  geofenceTaskPriority: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  geofenceTaskPriorityText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#dc2626',
  },
  geofenceTaskTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1a1a1a',
    marginTop: 2,
  },
  geofenceTaskSub: {
    fontSize: 12,
    color: '#666',
    lineHeight: 17,
    marginTop: 4,
  },
  geofenceTaskFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  geofenceTaskInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  geofenceTaskInfoText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1a5c2a',
  },
  geofenceTaskActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1a5c2a',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  geofenceTaskActionText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
});

