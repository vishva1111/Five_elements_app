import React, { useState, useCallback, useRef, useEffect } from 'react';
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
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
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

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

type TaskTab = 'assigned' | 'in_progress' | 'completed';

const TABS: { key: TaskTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'assigned', label: 'Assigned', icon: 'clipboard-outline' },
  { key: 'in_progress', label: 'Pending', icon: 'time-outline' },
  { key: 'completed', label: 'Completed', icon: 'checkmark-done-circle-outline' },
];

export default function TaskScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const activeProjectId = useAuthStore((s) => s.activeProjectId);
  const assignedProjects = useAuthStore((s) => s.assignedProjects);
  const refreshCredits = useAuthStore((s) => s.refreshCredits);
  const { trees, setTrees } = useTreeStore();
  const { tasks, setTasks } = useTaskStore();
  const localTasks = useTaskStore((s) => s.localTasks);
  const setLocalTasks = useTaskStore((s) => s.setLocalTasks);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TaskTab>('assigned');
  const [addingDemo, setAddingDemo] = useState(false);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const loadSeqRef = useRef(0);

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

    // Get assigned project IDs
    const assignedProjectIds = new Set(assignedProjects.map((p) => p.id));

    // Filter tasks to only show those from assigned projects
    const filterByAssigned = (tasks: Task[]) =>
      tasks.filter((t) => !t.project_id || assignedProjectIds.has(t.project_id));

    if (tasksRes.data) {
      let visibleTasks = filterByAssigned(tasksRes.data);
      if (activeProjectId) {
        visibleTasks = visibleTasks.filter((t) => t.project_id === activeProjectId);
      }
      const visibleLocal = filterByAssigned(localWithProgress);
      setTasks([...visibleTasks, ...visibleLocal]);
    } else {
      let visibleLocalTasks = filterByAssigned(localWithProgress);
      if (activeProjectId) {
        visibleLocalTasks = visibleLocalTasks.filter((t) => t.project_id === activeProjectId);
      }
      setTasks(visibleLocalTasks);
    }
  }, [userId, activeProjectId, assignedProjects, setTasks, localTasks]);

  useFocusEffect(
    useCallback(() => {
      loadTasks();
    }, [loadTasks])
  );

  useEffect(() => {
    loadTasks();
  }, [activeProjectId]);

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
    const localOnly = localTasks.filter(isLocalTask);
    const used = new Set(localOnly.map((t) => t.name));
    const name = names.find((n) => !used.has(n)) ?? `Demo Task ${localOnly.length + 1}`;
    const due = new Date(Date.now() + 30 * 86400000).toISOString();
    const newTask = makeLocalTask({
      name,
      target_count: 50,
      location: 'Demo field site',
      priority: 'medium',
      due_date: due,
    });
    const updated = [...localTasks, newTask];
    setLocalTasks(updated);
    await saveLocalTasks(updated);
    setTasks(refreshLocalProgress(updated, trees));
    setAddingDemo(false);
    Alert.alert('Demo task added', `"${name}" saved on this device. Capture trees and watch progress fill up!`);
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
  const priorityColor = (p: string) => p === 'high' ? '#ef4444' : p === 'medium' ? '#f59e0b' : '#6b7280';

  const activeProject = allProjects.find((p) => p.id === activeProjectId);

  const renderTaskCard = (task: Task) => {
    const started = !!task.started_at;
    const createdDate = task.created_at ? new Date(task.created_at) : null;
    const dayName = createdDate ? createdDate.toLocaleDateString('en-IN', { weekday: 'short' }) : '';
    const dateStr = createdDate ? createdDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    return (
      <View key={task.id} style={s.taskCard}>
        <View style={s.taskCardTop}>
          <View style={s.taskTitleWrap}>
            <Text style={s.taskId} numberOfLines={1}>ID: {task.id.slice(0, 8).toUpperCase()}</Text>
            <Text style={s.taskName} numberOfLines={1}>{task.name}</Text>
          </View>
          <TouchableOpacity
            style={[s.startBtn, task.status === 'completed' && s.startBtnDone]}
            onPress={() => handleStartTask(task)}
            disabled={task.status === 'completed'}
          >
            <Ionicons name={started ? 'play-circle' : 'play-circle-outline'} size={16} color="#fff" />
            <Text style={s.startBtnText}>
              {task.status === 'completed' ? 'Done' : started ? 'Continue' : 'Start'}
            </Text>
          </TouchableOpacity>
        </View>
        {task.notes ? (
          <Text style={s.taskNote} numberOfLines={2}>{task.notes}</Text>
        ) : null}
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
      </View>
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

        {/* Tabs */}
        <View style={s.tabsWrap}>
          <View style={s.tabsRow}>
            {TABS.map((tab) => {
              const count = tab.key === 'assigned' ? assignedTasks.length
                : tab.key === 'in_progress' ? inProgressTasks.length
                : completedTasks.length;
              const active = activeTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={[s.tabBtn, active && s.tabBtnActive]}
                  onPress={() => setActiveTab(tab.key)}
                  activeOpacity={0.7}
                >
                  {count > 0 && (
                    <View style={[s.tabCount, active && s.tabCountActive]}>
                      <Text style={[s.tabCountText, active && s.tabCountTextActive]}>{count > 99 ? '99+' : count}</Text>
                    </View>
                  )}
                  <Ionicons name={tab.icon} size={17} color={active ? '#fff' : '#1a5c2a'} />
                  <Text numberOfLines={1} style={[s.tabText, active && s.tabTextActive]}>{tab.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Tab content */}
        <View style={s.content}>
          {activeTab === 'assigned' && renderTaskList(assignedTasks)}
          {activeTab === 'in_progress' && renderTaskList(inProgressTasks)}
          {activeTab === 'completed' && (
            completedTasks.length === 0
              ? renderEmpty('✅', 'Nothing completed yet', 'Tasks move here automatically once the target is captured.')
              : completedTasks.map((t) => {
                  const tCreatedDate = t.created_at ? new Date(t.created_at) : null;
                  const tDayName = tCreatedDate ? tCreatedDate.toLocaleDateString('en-IN', { weekday: 'short' }) : '';
                  const tDateStr = tCreatedDate ? tCreatedDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
                  return (
                  <View key={t.id} style={[s.taskCard, s.taskCardDone]}>
                    <View style={s.taskCardTop}>
                      <View style={s.taskTitleWrap}>
                        <Text style={s.taskId} numberOfLines={1}>ID: {t.id.slice(0, 8).toUpperCase()}</Text>
                        <Text style={s.taskName} numberOfLines={1}>{t.name}</Text>
                      </View>
                      <View style={s.doneBadge}>
                        <Ionicons name="checkmark-circle" size={14} color="#16a34a" />
                        <Text style={s.doneText}>Done</Text>
                      </View>
                    </View>
                    {t.notes ? (
                      <Text style={s.taskNote} numberOfLines={2}>{t.notes}</Text>
                    ) : null}
                    <View style={s.taskCardBottom}>
                      <View style={[s.priorityBadge, { backgroundColor: '#16a34a22' }]}>
                        <Text style={[s.priorityText, { color: '#16a34a' }]}>COMPLETED</Text>
                      </View>
                      {tCreatedDate ? (
                        <View style={s.dueRow}>
                          <Ionicons name="calendar-outline" size={11} color="#888" />
                          <Text style={s.dueText}>{tDayName}, {tDateStr}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  );
                })
          )}
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
  tabsWrap: { padding: 16, paddingBottom: 0 },
  tabsRow: { flexDirection: 'row', gap: 8 },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: '#E0ECDD',
  },
  tabBtnActive: { backgroundColor: '#1a5c2a', borderColor: '#1a5c2a' },
  tabText: { fontSize: 11, fontWeight: '600', color: '#1a5c2a' },
  tabTextActive: { color: '#fff' },
  tabCount: {
    position: 'absolute',
    top: 4,
    right: 5,
    backgroundColor: '#E8F5E9',
    borderRadius: 7.5,
    minWidth: 16,
    paddingHorizontal: 4,
    paddingVertical: 1,
    alignItems: 'center',
  },
  tabCountActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  tabCountText: { fontSize: 9, fontWeight: '700', color: '#1a5c2a' },
  tabCountTextActive: { color: '#fff' },
  content: { padding: 16, paddingTop: 12 },
  taskCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
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
  taskCardDone: { borderLeftColor: '#16a34a' },
  taskCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  taskTitleWrap: { flex: 1 },
  taskId: { fontSize: 10, fontWeight: '600', color: '#999', marginBottom: 2 },
  taskName: { fontSize: 14, fontWeight: '700', color: '#222' },
  taskNote: { fontSize: 12, color: '#666', marginTop: 6, lineHeight: 16 },
  taskCardBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  doneBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#16a34a22', borderRadius: 7.5, paddingHorizontal: 8, paddingVertical: 4 },
  doneText: { fontSize: 11, fontWeight: '700', color: '#16a34a' },
  priorityBadge: { borderRadius: 7.5, paddingHorizontal: 7, paddingVertical: 2 },
  priorityText: { fontSize: 9, fontWeight: '700' },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dueText: { fontSize: 10, color: '#888' },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F09125',
    borderRadius: 7.5,
    paddingVertical: 7,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  startBtnDone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#16a34a',
    borderRadius: 7.5,
    paddingVertical: 7,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  startBtnText: { color: '#fff', fontWeight: '700', fontSize: 11 },
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
