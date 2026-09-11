import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  ActivityIndicator,
  Linking,
  FlatList,
} from 'react-native';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useTreeStore } from '../../store/treeStore';
import { useTaskStore } from '../../store/taskStore';
import { fetchMyTrees, fetchAllProjects } from '../../services/treeService';
import { fetchAgentTasks, startTask } from '../../services/taskService';
import {
  loadLocalTasks,
  saveLocalTasks,
  makeLocalTask,
  refreshLocalProgress,
  isLocalTask,
} from '../../services/localTaskService';
import { Task, Project } from '../../types';
import CircularProgress from '../../components/CircularProgress';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

type TaskTab = 'assigned' | 'completed' | 'approved' | 'rejected';

const TABS: { key: TaskTab; label: string; color: string }[] = [
  { key: 'assigned', label: 'Assigned', color: '#1a5c2a' },
  { key: 'completed', label: 'Completed', color: '#22c55e' },
  { key: 'approved', label: 'Approved', color: '#8b5cf6' },
  { key: 'rejected', label: 'Rejected', color: '#ef4444' },
];

export default function TaskScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const activeProjectId = useAuthStore((s) => s.activeProjectId);
  const assignedProjects = useAuthStore((s) => s.assignedProjects) ?? [];
  const refreshCredits = useAuthStore((s) => s.refreshCredits);
  const trees = useTreeStore((s) => s.trees) ?? [];
  const setTrees = useTreeStore((s) => s.setTrees);
  const tasks = useTaskStore((s) => s.tasks) ?? [];
  const setTasks = useTaskStore((s) => s.setTasks);
  const localTasks = useTaskStore((s) => s.localTasks) ?? [];
  const setLocalTasks = useTaskStore((s) => s.setLocalTasks);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TaskTab>('assigned');
  const [addingDemo, setAddingDemo] = useState(false);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('all');
  const loadSeqRef = useRef(0);

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
    loadLocalTasks().then((loaded) => {
      if (!cancelled && loaded.length > 0) setLocalTasks(loaded);
    });

    (async () => {
      const { data } = await fetchAllProjects();
      if (!cancelled && data) setAllProjects(data);
    })();

    return () => { cancelled = true; };
  }, []);

  const loadTasks = useCallback(async () => {
    if (!userId) return;
    const seq = ++loadSeqRef.current;
    const [treesRes, tasksRes] = await Promise.all([
      fetchMyTrees(userId),
      fetchAgentTasks(userId),
    ]);
    if (seq !== loadSeqRef.current) return;
    const myTrees = treesRes.data ?? [];
    const localWithProgress = refreshLocalProgress(localTasks, myTrees);

    // Filter: tasks with no project, assigned projects, or active project
    const filterByAssigned = (t: Task) =>
      !t.project_id || (assignedProjects ?? []).some((p) => p.id === t.project_id) || t.project_id === activeProjectId;

    let visibleTasks = (tasksRes.data ?? []).filter(filterByAssigned);
    let visibleLocal = localWithProgress.filter(filterByAssigned);

    if (activeProjectId) {
      visibleTasks = visibleTasks.filter((t) => t.project_id === activeProjectId);
      visibleLocal = visibleLocal.filter((t) => t.project_id === activeProjectId);
    }

    setTasks([...visibleTasks, ...visibleLocal]);
  }, [userId, activeProjectId, assignedProjects, setTasks, localTasks]);

  useFocusEffect(
    useCallback(() => {
      loadTasks();
    }, [loadTasks])
  );

  useEffect(() => {
    loadTasks();
  }, [activeProjectId, loadTasks]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTasks();
    setRefreshing(false);
  };

  const handleStartTask = async (task: Task) => {
    if (!task.started_at) {
      if (isLocalTask(task)) {
        const startedAt = new Date().toISOString();
        const updatedLocal = localTasks.map((t) =>
          t.id === task.id
            ? { ...t, started_at: startedAt, status: 'in_progress' as const }
            : t
        );
        setLocalTasks(updatedLocal);
        saveLocalTasks(updatedLocal);
        setTasks(
          tasks.map((t) =>
            t.id === task.id ? { ...t, started_at: startedAt, status: 'in_progress' } : t
          )
        );
      } else {
        await startTask(task.id);
        setTasks(tasks.map((t) => (t.id === task.id ? { ...t, started_at: new Date().toISOString(), status: 'in_progress' } : t)));
      }
    }
    navigation.navigate('Capture');
  };

  const handleAddDemoTask = async () => {
    setAddingDemo(true);
    const names = ['Demo Survey — Phase 1', 'Demo Planting Drive', 'Demo Health Check'];
    const localOnly = localTasks.filter(isLocalTask).filter((t) => activeProjectId ? t.project_id === activeProjectId : true);
    const used = new Set(localOnly.map((t) => t.name));
    const name = names.find((n) => !used.has(n)) ?? `Demo Task ${localOnly.length + 1}`;
    const due = new Date(Date.now() + 30 * 86400000).toISOString();
    const newTask = makeLocalTask({
      name,
      target_count: 50,
      location: 'Demo field site',
      priority: 'medium',
      due_date: due,
      project_id: activeProjectId ?? undefined,
    });
    const updated = [...localTasks, newTask];
    setLocalTasks(updated);
    await saveLocalTasks(updated);

    // Reload tasks with the updated local list (loadTasks uses stale closure)
    if (userId) {
      const [treesRes, tasksRes] = await Promise.all([
        fetchMyTrees(userId),
        fetchAgentTasks(userId),
      ]);
      const myTrees = treesRes.data ?? [];
      const localWithProgress = refreshLocalProgress(updated, myTrees);
      const assignedProjectIds = new Set((assignedProjects ?? []).map((p) => p.id));
      const filterByAssigned = (t: Task) => !t.project_id || assignedProjectIds.has(t.project_id);
      if (tasksRes.data) {
        let visibleTasks = tasksRes.data.filter(filterByAssigned);
        if (activeProjectId) visibleTasks = visibleTasks.filter((t) => t.project_id === activeProjectId);
        let visibleLocal = localWithProgress.filter(filterByAssigned);
        if (activeProjectId) visibleLocal = visibleLocal.filter((t) => t.project_id === activeProjectId);
        setTasks([...visibleTasks, ...visibleLocal]);
      } else {
        let visibleLocal = localWithProgress.filter(filterByAssigned);
        if (activeProjectId) visibleLocal = visibleLocal.filter((t) => t.project_id === activeProjectId);
        setTasks(visibleLocal);
      }
    }

    setAddingDemo(false);
    Alert.alert('Demo task added', `"${name}" saved for this project.`);
  };

  const handleOpenMap = (location: string) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
    Linking.openURL(url);
  };

  const getTodayDate = () => {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    return now.toLocaleDateString('en-IN', options);
  };

  const assignedTasks = tasks.filter((t) => t.status === 'assigned');
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress');
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const approvedTasks = tasks.filter((t) => t.status === 'approved');
  const rejectedTasks = tasks.filter((t) => t.status === 'rejected');

  // Count tasks for each tab
  const treeCaptures = trees.length;
  const assignedCount = assignedTasks.length;
  const completedCount = completedTasks.length + treeCaptures;
  const approvedCount = approvedTasks.length;
  const rejectedCount = rejectedTasks.length;
  const reviewedCount = approvedCount + rejectedCount;
  const totalTasks = assignedCount + completedCount + approvedCount + rejectedCount;
  const priorityColor = (p: string) => p === 'high' ? '#ef4444' : p === 'medium' ? '#f59e0b' : '#6b7280';

  // Extract unique dates from assigned tasks (descending, past first)
  const dates = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    const dateSet = new Set<string>();
    assignedTasks.forEach((t) => {
      if (t.created_at) dateSet.add(t.created_at.split('T')[0]);
    });
    trees.forEach((t) => {
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
  }, [assignedTasks, trees]);

  const activeProject = allProjects.find((p) => p.id === activeProjectId);

  const renderTaskCard = (task: Task) => {
    const started = !!task.started_at;
    const createdDate = task.created_at ? new Date(task.created_at) : null;
    const dayName = createdDate ? createdDate.toLocaleDateString('en-IN', { weekday: 'short' }) : '';
    const dateStr = createdDate ? createdDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const statusColor = task.status === 'completed' ? '#22c55e'
      : task.status === 'approved' ? '#8b5cf6'
      : task.status === 'rejected' ? '#ef4444'
      : '#1a5c2a';
    const isAssigned = task.status === 'assigned';
    const isTreeCapture = task.status === 'completed' && task.tree_condition !== undefined;
    
    const handlePress = () => {
      if (isTreeCapture && task.id) {
        navigation.navigate('TreeDetail', { treeId: task.id });
      }
    };

    return (
      <TouchableOpacity key={task.id} style={[s.taskCard, { borderLeftColor: statusColor }]} onPress={handlePress} activeOpacity={0.7}>
        <View style={s.taskCardTop}>
          <View style={s.taskTitleWrap}>
            <Text style={s.taskId} numberOfLines={1}>ID: {task.id.slice(0, 8).toUpperCase()}</Text>
            <Text style={s.taskName} numberOfLines={1}>{task.name}</Text>
          </View>
          {isAssigned ? (
            <TouchableOpacity
              style={s.startBtn}
              onPress={(e) => { e.stopPropagation(); handleStartTask(task); }}
              activeOpacity={0.7}
            >
              <Ionicons name="play-circle-outline" size={14} color="#fff" />
              <Text style={s.startBtnText}>Start</Text>
            </TouchableOpacity>
          ) : (
            <View style={[s.statusBadge, { backgroundColor: statusColor + '18' }]}>
              <Text style={[s.statusText, { color: statusColor }]}>{task.status.toUpperCase()}</Text>
            </View>
          )}
        </View>
        {task.notes ? (
          <Text style={s.taskNote} numberOfLines={2}>{task.notes}</Text>
        ) : null}
        
        {/* Extra details for tree captures (completed tasks) */}
        {isTreeCapture && (
          <View style={s.treeDetailRow}>
            {task.latitude && task.longitude && (
              <TouchableOpacity
                style={s.detailLink}
                onPress={(e) => { e.stopPropagation(); handleOpenMap(`${task.latitude},${task.longitude}`); }}
                activeOpacity={0.7}
              >
                <Ionicons name="location-outline" size={12} color="#1a5c2a" />
                <Text style={s.detailLinkText}>View Location</Text>
              </TouchableOpacity>
            )}
            {task.tree_condition && (
              <View style={[s.conditionBadge, { backgroundColor: task.tree_condition_color + '22' }]}>
                <Text style={{ color: task.tree_condition_color, fontWeight: '600', fontSize: 11 }}>{task.tree_condition}</Text>
              </View>
            )}
            {task.surveyor && (
              <View style={s.surveyorRow}>
                <Ionicons name="person-outline" size={11} color="#888" />
                <Text style={s.surveyorText}>{task.surveyor}</Text>
              </View>
            )}
          </View>
        )}
        
        <View style={s.taskCardBottom}>
          <View style={[s.priorityBadge, { backgroundColor: priorityColor(task.priority) + '22' }]}>
            <Text style={[s.priorityText, { color: priorityColor(task.priority) }]}>{task.priority.toUpperCase()}</Text>
          </View>
          {createdDate ? (
            <View style={s.dueRow}>
              <Ionicons name="calendar-outline" size={11} color="#888" />
              <Text style={s.dueText}>{dayName}, {dateStr}</Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
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
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
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
                  style={[s.tabBtn, active && { backgroundColor: tab.color + '15', borderColor: tab.color }]}
                  onPress={() => setActiveTab(tab.key)}
                  activeOpacity={0.7}
                >
                  <CircularProgress size={52} progress={pct} color={tab.color} strokeWidth={4} trackColor="#E8E8E8">
                    <Text style={[s.tabCountText, { color: tab.color }]}>{count}/{denominator}</Text>
                  </CircularProgress>
                  <Text numberOfLines={1} style={[s.tabText, active && { color: tab.color }]}>{tab.label}</Text>
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
          {activeTab === 'assigned' && renderTaskList(filterByDate(assignedTasks))}
          {activeTab === 'completed' && renderTaskList(filterByDate([...completedTasks, ...trees.map((t) => ({
            id: t.id,
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
            notes: t.notes,
            latitude: t.latitude,
            longitude: t.longitude,
            tree_condition: t.tree_condition || 'Healthy',
            tree_condition_color: (t.tree_condition === 'Healthy' ? '#22c55e' : t.tree_condition === 'Stressed' ? '#f59e0b' : t.tree_condition === 'Diseased' ? '#ef4444' : '#6b7280'),
            surveyor: t.surveyor,
          }))]))}
          {activeTab === 'approved' && renderTaskList(filterByDate(approvedTasks))}
          {activeTab === 'rejected' && renderTaskList(filterByDate(rejectedTasks))}
        </View>
      </ScrollView>

      {/* Add Demo Button - Fixed at bottom */}
      <View style={[s.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
        <TouchableOpacity
          style={s.addDemoBtn}
          onPress={handleAddDemoTask}
          disabled={addingDemo}
          activeOpacity={0.8}
        >
          {addingDemo ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="add-circle-outline" size={20} color="#fff" />
              <Text style={s.addDemoBtnText}>Add Demo Task</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
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
  headerDate: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
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
  tabsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#fff',
    borderRadius: 7.5,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#E8E8E8',
  },
  tabBtnActive: {},
  tabText: { fontSize: 11, fontWeight: '700', color: '#888' },
  tabCountText: { fontSize: 12, fontWeight: '700' },
  dateSelectorWrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4, gap: 8 },
  dateAllBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 7.5,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderColor: '#E0ECDD',
    minWidth: 56,
    minHeight: 68,
  },
  dateAllBtnActive: { backgroundColor: '#1a5c2a', borderColor: '#1a5c2a' },
  dateAllText: { fontSize: 12, fontWeight: '700', color: '#1a5c2a' },
  dateAllTextActive: { color: '#fff' },
  dateList: { gap: 8 },
  dateItem: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 7.5,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderColor: '#E8E8E8',
    minWidth: 56,
  },
  dateItemActive: { backgroundColor: '#1a5c2a', borderColor: '#1a5c2a' },
  dateLabel: { fontSize: 9, fontWeight: '700', color: '#888', letterSpacing: 0.5 },
  dateLabelActive: { color: '#fff' },
  dateDay: { fontSize: 18, fontWeight: '800', color: '#222', marginTop: 1 },
  dateDayActive: { color: '#fff' },
  dateMonth: { fontSize: 10, fontWeight: '600', color: '#888' },
  dateMonthActive: { color: '#fff' },
  content: { padding: 16, paddingTop: 12 },
  taskCard: {
    backgroundColor: '#fff',
    borderRadius: 7.5,
    padding: 12,
    marginBottom: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    borderLeftWidth: 3,
    borderLeftColor: '#1a5c2a',
  },
  taskCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  taskTitleWrap: { flex: 1 },
  taskId: { fontSize: 10, fontWeight: '600', color: '#999', marginBottom: 2 },
  taskName: { fontSize: 14, fontWeight: '700', color: '#222' },
  statusBadge: { borderRadius: 7.5, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 9, fontWeight: '700' },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F09125',
    borderRadius: 7.5,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  startBtnText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  taskNote: { fontSize: 12, color: '#666', marginTop: 6, lineHeight: 16 },
  taskCardBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  priorityBadge: { borderRadius: 7.5, paddingHorizontal: 7, paddingVertical: 2 },
  priorityText: { fontSize: 9, fontWeight: '700' },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dueText: { fontSize: 10, color: '#888' },
  treeDetailRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  detailLink: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#E8F5E9', borderRadius: 7.5 },
  detailLinkText: { fontSize: 11, color: '#1a5c2a', fontWeight: '600' },
  conditionBadge: { borderRadius: 7.5, paddingHorizontal: 8, paddingVertical: 2 },
  surveyorRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  surveyorText: { fontSize: 11, color: '#666' },
  emptyState: { alignItems: 'center', paddingVertical: 48 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#555' },
  emptySubText: { fontSize: 13, color: '#888', marginTop: 4, textAlign: 'center', paddingHorizontal: 24 },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  addDemoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1a5c2a',
    borderRadius: 10,
    paddingVertical: 14,
  },
  addDemoBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
