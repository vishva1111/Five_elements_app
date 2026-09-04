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
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useTreeStore } from '../../store/treeStore';
import { useTaskStore } from '../../store/taskStore';
import { fetchMyTrees } from '../../services/treeService';
import { fetchAgentTasks, startTask } from '../../services/taskService';
import {
  loadLocalTasks,
  saveLocalTasks,
  makeLocalTask,
  refreshLocalProgress,
  isLocalTask,
} from '../../services/localTaskService';
import { Task, TreeRecord } from '../../types';
import ProjectSelector from '../../components/ProjectSelector';
import CircularProgress from '../../components/CircularProgress';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

type TaskTab = 'assigned' | 'in_progress' | 'completed' | 'activity';

const TABS: { key: TaskTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'assigned', label: 'Assigned', icon: 'clipboard-outline' },
  { key: 'in_progress', label: 'In Progress', icon: 'play-circle-outline' },
  { key: 'completed', label: 'Completed', icon: 'checkmark-done-circle-outline' },
  { key: 'activity', label: 'Activity', icon: 'time-outline' },
];

interface ActivityItem {
  id: string;
  type: 'capture' | 'start' | 'assign' | 'complete';
  label: string;
  subtitle: string;
  time: string;
}

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const activeProjectId = useAuthStore((s) => s.activeProjectId);
  const setActiveProjectId = useAuthStore((s) => s.setActiveProjectId);
  const refreshCredits = useAuthStore((s) => s.refreshCredits);
  const { trees, setTrees } = useTreeStore();
  const { tasks, setTasks } = useTaskStore();
  const localTasks = useTaskStore((s) => s.localTasks);
  const setLocalTasks = useTaskStore((s) => s.setLocalTasks);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ total: 0, healthy: 0, sick: 0, dead: 0 });
  const [activeTab, setActiveTab] = useState<TaskTab>('assigned');
  const [addingDemo, setAddingDemo] = useState(false);
  const loadSeqRef = useRef(0);

  const firstName = (user?.full_name?.trim()?.split(' ')[0] || '').replace(/[.!]$/, '');
  const greetingName = firstName || 'there';

  // Load LOCAL tasks saved on this device into the store once on mount.
  // Without this the store starts empty and no local task ever appears.
  useEffect(() => {
    let cancelled = false;
    loadLocalTasks().then((loaded) => {
      if (!cancelled && loaded.length > 0) setLocalTasks(loaded);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTrees = useCallback(async () => {
    if (!userId) return;
    const seq = ++loadSeqRef.current;
    const [treesRes, tasksRes] = await Promise.all([
      fetchMyTrees(userId),
      fetchAgentTasks(userId),
    ]);
    if (seq !== loadSeqRef.current) return;
    const data = treesRes.data;
    if (data) {
      const visibleTrees = activeProjectId
        ? data.filter((t) => t.project_id === activeProjectId)
        : data;
      setTrees(visibleTrees);
      setStats({
        total: visibleTrees.length,
        healthy: visibleTrees.filter((t) => t.health_status === 'healthy').length,
        sick: visibleTrees.filter((t) => t.health_status === 'sick').length,
        dead: visibleTrees.filter((t) => t.health_status === 'dead').length,
      });
    }
    // ── Build the tree list that powers task progress ──
    // Progress counts only trees captured AFTER a task's started_at, so
    // pre-existing captures don't inflate progress before the agent taps Start.
    const myTrees = treesRes.data ?? [];

    // Local tasks always get their progress refreshed from real captures.
    const localWithProgress = localTasks.map((lt) =>
      refreshLocalProgress(lt, myTrees)
    );

    if (tasksRes.data) {
      // ── Merge DB tasks with LOCAL (on-device) tasks ──
      // When a project is active, scope tasks to it (matching captures/stats).
      // With NO active project, show ALL tasks — incl. demo/seeded tasks that
      // are attached to a project — so nothing assigned to the agent is hidden.
      const visibleTasks = activeProjectId
        ? tasksRes.data.filter((t) => t.project_id === activeProjectId)
        : tasksRes.data;
      setTasks([...visibleTasks, ...localWithProgress]);
    } else {
      // tasks table missing / fetch failed — LOCAL tasks still fully work and
      // their progress is derived from the agent's real captures per project.
      const visibleLocalTasks = activeProjectId
        ? localWithProgress.filter((t) => t.project_id === activeProjectId)
        : localWithProgress;
      setTasks(visibleLocalTasks);
    }
  }, [userId, activeProjectId, setTrees, setTasks, localTasks]);

  useFocusEffect(
    useCallback(() => {
      refreshCredits();
      loadTrees();
    }, [loadTrees, refreshCredits])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTrees();
    setRefreshing(false);
  };

  // ─── Start / Continue a task ────────────────────────────────────────────────
  const handleStartTask = async (task: Task) => {
    // Point the app at the task's project so new captures count toward it
    if (task.project_id) {
      setActiveProjectId(task.project_id);
      refreshCredits();
    }
    // Best-effort: record that the agent started work on the task
    if (!task.started_at) {
      if (isLocalTask(task)) {
        // Local task — update on-device only, no database involved
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

  // ─── Add a demo task directly in the UI — NO DATABASE NEEDED ────────────────
  // The task is stored on-device (AsyncStorage) and appears instantly in the
  // dashboard; progress updates automatically from real tree captures.
  const handleAddDemoTask = async () => {
    setAddingDemo(true);
    const names = [
      'Demo Survey — Phase 1',
      'Demo Planting Drive',
      'Demo Health Check',
    ];
    // Pick a name that isn't already used by one of the local tasks
    const localOnly = localTasks.filter(isLocalTask);
    const used = new Set(localOnly.map((t) => t.name));
    const name = names.find((n) => !used.has(n)) ?? `Demo Task ${localOnly.length + 1}`;
    const due = new Date(Date.now() + 30 * 86400000).toISOString();
    // No project_id — demo task counts ALL your captures regardless of project,
    // so progress climbs no matter which project you capture in.
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
    // Compute progress from current captures so the card shows the right %
    // immediately — no need to wait for the next loadTrees() refresh.
    // (refreshLocalProgress now counts only trees captured after started_at.)
    setTasks(updated.map((lt) => refreshLocalProgress(lt, trees)));
    setAddingDemo(false);
    Alert.alert(
      'Demo task added',
      `"${name}" was saved on this device. Capture trees and watch the progress ring fill up — no database needed!`
    );
  };

  // ─── Build the "Recent Activity" feed ───────────────────────────────────────
  const buildActivity = (): ActivityItem[] => {
    const items: ActivityItem[] = [];

    // Task lifecycle events
    tasks.forEach((t) => {
      if (t.status === 'completed') {
        items.push({
          id: `complete-${t.id}`,
          type: 'complete',
          label: 'Task completed',
          subtitle: t.name,
          time: t.due_date ?? t.created_at,
        });
      } else if (t.started_at) {
        items.push({
          id: `start-${t.id}`,
          type: 'start',
          label: 'Task started',
          subtitle: t.name,
          time: t.started_at!,
        });
      } else {
        items.push({
          id: `assign-${t.id}`,
          type: 'assign',
          label: 'Task assigned',
          subtitle: t.name,
          time: t.created_at,
        });
      }
    });

    // Latest tree captures (most recent first from the store)
    (trees ?? []).slice(0, 10).forEach((tree) => {
      items.push({
        id: `capture-${tree.id}`,
        type: 'capture',
        label: `${tree.species} captured`,
        subtitle: tree.project_name ?? 'Tree capture',
        time: tree.submitted_at,
      });
    });

    return items
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 12);
  };

  const assignedTasks = tasks.filter((t) => t.status === 'assigned');
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress');
  const completedTasks = tasks.filter((t) => t.status === 'completed');

  const priorityColor = (p: string) =>
    p === 'high' ? '#ef4444' : p === 'medium' ? '#f59e0b' : '#6b7280';

  const renderTaskCard = (task: Task) => {
    const started = !!task.started_at;
    return (
      <View key={task.id} style={styles.taskCard}>
        <View style={styles.taskHeader}>
          <View style={styles.taskTitleWrap}>
            <Text style={styles.taskName} numberOfLines={2}>
              {task.name}
            </Text>
            {task.project_name ? (
              <Text style={styles.taskProject} numberOfLines={1}>
                {task.project_name}
              </Text>
            ) : null}
          </View>
          <CircularProgress size={72} progress={task.progress}>
            <Text style={styles.taskPct}>{task.progress}%</Text>
            <Text style={styles.taskPctSub}>
              {task.captured}/{task.target_count}
            </Text>
          </CircularProgress>
        </View>

        <View style={styles.taskMetaGrid}>
          {task.location ? (
            <View style={styles.taskMetaItem}>
              <Ionicons name="location-outline" size={13} color="#1a5c2a" />
              <Text style={styles.taskMetaText} numberOfLines={1}>📍 {task.location}</Text>
            </View>
          ) : null}
          <View style={styles.taskMetaItem}>
            <Ionicons name="flag-outline" size={13} color="#1a5c2a" />
            <Text style={styles.taskMetaText}>🎯 Target: {task.target_count} Trees</Text>
          </View>
          <View style={styles.taskMetaItem}>
            <Ionicons name="leaf-outline" size={13} color="#1a5c2a" />
            <Text style={styles.taskMetaText}>🌳 Captured: {task.captured}</Text>
          </View>
          <View style={styles.taskMetaItem}>
            <Ionicons name="hourglass-outline" size={13} color={task.remaining > 0 ? '#1a5c2a' : '#22c55e'} />
            <Text style={styles.taskMetaText}>⏳ Remaining: {task.remaining}</Text>
          </View>
        </View>

        <View style={styles.taskFooter}>
          <View style={styles.taskFooterLeft}>
            <View style={[styles.priorityBadge, { backgroundColor: priorityColor(task.priority) + '22' }]}>
              <Text style={[styles.priorityText, { color: priorityColor(task.priority) }]}>
                {task.priority.toUpperCase()}
              </Text>
            </View>
            {task.due_date ? (
              <View style={styles.dueRow}>
                <Ionicons name="calendar-outline" size={12} color="#888" />
                <Text style={styles.dueText}>
                  {new Date(task.due_date).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}
                </Text>
              </View>
            ) : null}
          </View>
          <TouchableOpacity
            style={[styles.startBtn, task.status === 'completed' && styles.startBtnDone]}
            onPress={() => handleStartTask(task)}
            disabled={task.status === 'completed'}
          >
            <Ionicons
              name={started ? 'play-circle' : 'play-circle-outline'}
              size={18}
              color={task.status === 'completed' ? '#fff' : '#fff'}
            />
            <Text style={styles.startBtnText}>
              {task.status === 'completed'
                ? 'Completed'
                : started
                ? 'Continue Task'
                : 'Start Task'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderEmpty = (emoji: string, title: string, sub: string) => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyEmoji}>{emoji}</Text>
      <Text style={styles.emptyText}>{title}</Text>
      <Text style={styles.emptySubText}>{sub}</Text>
    </View>
  );

  const renderTaskList = (list: Task[]) =>
    list.length === 0
      ? renderEmpty(
          '🗂️',
          'No tasks here',
          'Tap "＋ Add Demo Task" to create one — tasks you add work right away and are saved on this device (no database needed).'
        )
      : list.map(renderTaskCard);

  const renderActivity = () => {
    const activity = buildActivity();
    if (activity.length === 0) {
      return renderEmpty('🕐', 'No activity yet', 'Your latest captures and task updates will show here.');
    }
    return activity.map((a) => {
      const icon =
        a.type === 'capture'
          ? { name: 'leaf', color: '#22c55e' }
          : a.type === 'start'
          ? { name: 'play-circle', color: '#1a5c2a' }
          : a.type === 'complete'
          ? { name: 'checkmark-done-circle', color: '#16a34a' }
          : { name: 'clipboard', color: '#F09125' };
      return (
        <View key={a.id} style={styles.activityRow}>
          <View style={[styles.activityIcon, { backgroundColor: icon.color + '1a' }]}>
            <Ionicons name={icon.name as any} size={16} color={icon.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.activityLabel}>{a.label}</Text>
            <Text style={styles.activitySub} numberOfLines={1}>{a.subtitle}</Text>
          </View>
          <Text style={styles.activityTime}>
            {new Date(a.time).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </Text>
        </View>
      );
    });
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1a5c2a" />}
    >
      <LinearGradient
        colors={['#1a5c2a', '#48915b', '#cde8d3']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.banner}
      >
        <View style={styles.bannerTopRow}>
          <View style={styles.bannerGreeting}>
            <Text style={styles.greeting}>Hi {greetingName}</Text>
            <Text style={styles.bannerSub}>Ready to capture trees today?</Text>
          </View>
          <View style={styles.creditsPill}>
            <Ionicons name="wallet-outline" size={15} color="#F09125" />
            <Text style={styles.creditsPillText}>{user?.credits ?? 0}</Text>
          </View>
        </View>
        <View style={styles.projectSelectorWrapper}>
          <ProjectSelector />
        </View>
      </LinearGradient>

      <TouchableOpacity
        style={styles.captureBtn}
        onPress={() => navigation.navigate('Capture')}
        activeOpacity={0.85}
      >
        <Text style={styles.captureBtnIcon}>📸</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.captureBtnTitle}>Capture a Tree</Text>
          <Text style={styles.captureBtnSub}>Take photo + tag GPS location</Text>
        </View>
        {(user?.credits ?? 0) > 0 && (
          <View style={styles.creditBadge}>
            <Text style={styles.creditBadgeText}>{user?.credits} credits</Text>
          </View>
        )}
      </TouchableOpacity>

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

      {/* Task Management */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>My Tasks</Text>
          <TouchableOpacity
            style={styles.addDemoBtn}
            onPress={handleAddDemoTask}
            disabled={addingDemo}
            activeOpacity={0.7}
          >
            {addingDemo ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="add-circle-outline" size={15} color="#fff" />
                <Text style={styles.addDemoBtnText}>Add Demo Task</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Tabs */}
        <View style={styles.tabsRow}>
          {TABS.map((tab) => {
            const count =
              tab.key === 'assigned'
                ? assignedTasks.length
                : tab.key === 'in_progress'
                ? inProgressTasks.length
                : tab.key === 'completed'
                ? completedTasks.length
                : 0;
            const active = activeTab === tab.key;
            const showCount = count > 0 && tab.key !== 'activity';
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tabBtn, active && styles.tabBtnActive]}
                onPress={() => setActiveTab(tab.key)}
                activeOpacity={0.7}
              >
                {showCount && (
                  <View style={[styles.tabCount, active && styles.tabCountActive]}>
                    <Text style={[styles.tabCountText, active && styles.tabCountTextActive]}>
                      {count > 99 ? '99+' : count}
                    </Text>
                  </View>
                )}
                <Ionicons
                  name={tab.icon}
                  size={17}
                  color={active ? '#fff' : '#1a5c2a'}
                />
                <Text
                  numberOfLines={1}
                  style={[styles.tabText, active && styles.tabTextActive]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Tab content */}
        <View style={{ marginTop: 14 }}>
          {activeTab === 'assigned' && renderTaskList(assignedTasks)}
          {activeTab === 'in_progress' && renderTaskList(inProgressTasks)}
          {activeTab === 'completed' && (
            completedTasks.length === 0
              ? renderEmpty('✅', 'Nothing completed yet', 'Tasks move here automatically once the target is captured.')
              : completedTasks.map((t) => {
                  const started = !!t.started_at;
                  return (
                    <View key={t.id} style={[styles.taskCard, styles.taskCardDone]}>
                      <View style={styles.taskHeader}>
                        <View style={styles.taskTitleWrap}>
                          <Text style={styles.taskName} numberOfLines={2}>{t.name}</Text>
                          {t.project_name ? (
                            <Text style={styles.taskProject} numberOfLines={1}>{t.project_name}</Text>
                          ) : null}
                        </View>
                        <CircularProgress size={72} progress={t.progress} color="#16a34a">
                          <Text style={styles.taskPct}>100%</Text>
                          <Text style={styles.taskPctSub}>{t.captured}/{t.target_count}</Text>
                        </CircularProgress>
                      </View>
                      <View style={styles.taskMetaGrid}>
                        <View style={styles.taskMetaItem}>
                          <Ionicons name="flag-outline" size={13} color="#16a34a" />
                          <Text style={styles.taskMetaText}>🎯 Target: {t.target_count} Trees</Text>
                        </View>
                        <View style={styles.taskMetaItem}>
                          <Ionicons name="leaf-outline" size={13} color="#16a34a" />
                          <Text style={styles.taskMetaText}>🌳 Captured: {t.captured}</Text>
                        </View>
                        <View style={styles.taskMetaItem}>
                          <Ionicons name="checkmark-done" size={13} color="#16a34a" />
                          <Text style={styles.taskMetaText}>✓ Completed</Text>
                        </View>
                      </View>
                      {!started && (
                        <TouchableOpacity style={styles.startBtnDone} onPress={() => handleStartTask(t)}>
                          <Text style={styles.startBtnText}>View Task</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })
          )}
          {activeTab === 'activity' && renderActivity()}
        </View>
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
    paddingBottom: 16,
  },
  bannerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  bannerGreeting: { flex: 1 },
  creditsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 7.5,
    alignSelf: 'flex-start',
  },
  creditsPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F09125',
  },
  greeting: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  bannerSub: { fontSize: 14, color: '#fff', marginTop: 4 },
  projectSelectorWrapper: { marginTop: 12 },
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 7.5,
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
    borderRadius: 7.5,
    padding: 20,
    gap: 16,
    elevation: 3,
  },
  captureBtnIcon: { fontSize: 36 },
  captureBtnTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  captureBtnSub: { fontSize: 12, color: '#a5d6a7', marginTop: 2 },
  creditBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 7.5,
  },
  creditBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  section: { margin: 16 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  addDemoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1a5c2a',
    borderRadius: 7.5,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  addDemoBtnText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  // Tabs — vertical pills (icon on top, label below) so all four fit on one
  // row without wrapping; the count badge floats in the top-right corner.
  tabsRow: { flexDirection: 'row', gap: 6 },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#fff',
    borderRadius: 7.5,
    paddingVertical: 10,
    paddingHorizontal: 2,
    borderWidth: 1,
    borderColor: '#E0ECDD',
  },
  tabBtnActive: { backgroundColor: '#1a5c2a', borderColor: '#1a5c2a' },
  tabText: { fontSize: 10.5, fontWeight: '600', color: '#1a5c2a' },
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
  // Task card
  taskCard: {
    backgroundColor: '#fff',
    borderRadius: 7.5,
    padding: 16,
    marginBottom: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    borderLeftWidth: 3,
    borderLeftColor: '#1a5c2a',
  },
  taskCardDone: { borderLeftColor: '#16a34a' },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  taskTitleWrap: { flex: 1 },
  taskName: { fontSize: 15, fontWeight: '700', color: '#222' },
  taskProject: { fontSize: 12, color: '#1a5c2a', fontWeight: '600', marginTop: 2 },
  taskPct: { fontSize: 15, fontWeight: 'bold', color: '#1a5c2a' },
  taskPctSub: { fontSize: 10, color: '#888', marginTop: 1 },
  taskMetaGrid: {
    marginTop: 12,
    gap: 6,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  taskMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  taskMetaText: { fontSize: 12, color: '#555', flex: 1 },
  taskFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 12,
  },
  taskFooterLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  priorityBadge: { borderRadius: 7.5, paddingHorizontal: 8, paddingVertical: 3 },
  priorityText: { fontSize: 10, fontWeight: '700' },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dueText: { fontSize: 11, color: '#888' },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F09125',
    borderRadius: 7.5,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minWidth: 120,
    justifyContent: 'center',
  },
  startBtnDone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#16a34a',
    borderRadius: 7.5,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minWidth: 120,
    justifyContent: 'center',
  },
  startBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  // Activity
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 7.5,
    padding: 12,
    marginBottom: 8,
  },
  activityIcon: {
    width: 34,
    height: 34,
    borderRadius: 7.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityLabel: { fontSize: 13, fontWeight: '600', color: '#333' },
  activitySub: { fontSize: 12, color: '#888', marginTop: 2 },
  activityTime: { fontSize: 11, color: '#aaa' },
  emptyState: { alignItems: 'center', paddingVertical: 36 },
  emptyEmoji: { fontSize: 44, marginBottom: 12 },
  emptyText: { fontSize: 15, fontWeight: '600', color: '#555' },
  emptySubText: { fontSize: 13, color: '#888', marginTop: 4, textAlign: 'center', paddingHorizontal: 12 },
});
