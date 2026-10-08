import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  FlatList,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getCachedActiveProject, useAuthStore } from '../../store/authStore';
import { useTreeStore } from '../../store/treeStore';
import { useProjectRefreshStore } from '../../store/projectRefreshStore';
import { fetchMyTrees, fetchTreesByProject, fetchAllTrees } from '../../services/treeService';
import { fetchAgentTasks } from '../../services/taskService';
import { fetchAuditsForTrees, getLatestAudit } from '../../services/auditService';
import { supabase } from '../../services/supabase';
import ProjectSelector from '../../components/ProjectSelector';
import CurveDivider from '../../components/CurveDivider';
import GradientProgress from '../../components/GradientProgress';
import { buildProgressPalette, buildProjectPalette } from '../../utils/colorMix';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Task, Project, ProjectGeofence, TreeRecord } from '../../types';
import { fetchProjectGeofence, sqMetersToHectares } from '../../services/projectGeofenceService';

// ─── Status classification helpers (mutually exclusive priority) ────────────
export type TreeCategory = 'healthy' | 'sick' | 'dead';

export const classifyTree = (t: TreeRecord): TreeCategory => {
  const hs = (t.health_status || '').toLowerCase().trim();
  const tc = (t.tree_condition || '').toLowerCase().trim();

  // 1. Dead always takes highest precedence
  if (hs === 'dead' || tc === 'dead') {
    return 'dead';
  }
  // 2. Sick / Stressed / Diseased
  if (hs === 'sick' || tc === 'stressed' || tc === 'diseased') {
    return 'sick';
  }
  // 3. Healthy (or default)
  return 'healthy';
};

export const computeTreeStats = (trees: TreeRecord[]) => {
  let healthy = 0;
  let sick = 0;
  let dead = 0;

  for (let i = 0; i < trees.length; i++) {
    const cat = classifyTree(trees[i]);
    if (cat === 'dead') dead++;
    else if (cat === 'sick') sick++;
    else healthy++;
  }

  return {
    total: trees.length,
    healthy,
    sick,
    dead,
  };
};

const isAuditTask = (task: Pick<Task, 'id' | 'task_type' | 'audit_round'>) =>
  task.task_type === 'audit' || !!task.audit_round || String(task.id).startsWith('audit-');

const taskMatchesTree = (task: Task, tree: TreeRecord) =>
  task.tree_id === tree.id ||
  task.tree_record_id === tree.id ||
  task.id === tree.id ||
  (!!tree.tree_id && task.tree_id === tree.tree_id);

const taskRank = (task: Task) => {
  const round = Number(task.audit_round) || (task.task_type === 'audit' ? 1 : 0);
  const time = new Date(task.reviewed_at || task.completed_at || task.created_at || 0).getTime();
  return round * 1e15 + (Number.isFinite(time) ? time : 0);
};

/** Approved planting or approved audit, counted once for that tree. A newer task replaces an older one. */
const isApprovedProjectTree = (tree: TreeRecord, tasks: Task[]) => {
  const current = tasks
    .filter((task) => taskMatchesTree(task, tree))
    .sort((a, b) => taskRank(b) - taskRank(a))[0];
  return Boolean(current && current.status === 'approved');
};

/** Healthy / Sick / Dead follow the newest audit. No audit yet uses the approved tree itself. */
const treeWithLatestAuditCondition = (tree: TreeRecord, audits: any[] | undefined): TreeRecord => {
  const latest = getLatestAudit(audits);
  if (!latest) return tree;
  const survival = String(latest.survival_status || '').toLowerCase();
  if (survival === 'dead' || String(latest.health_status || '').toLowerCase() === 'dead') {
    return { ...tree, health_status: 'dead', tree_condition: 'Dead' };
  }
  return {
    ...tree,
    health_status: (latest.health_status || tree.health_status) as TreeRecord['health_status'],
    tree_condition: (latest.tree_condition || tree.tree_condition) as TreeRecord['tree_condition'],
  };
};

export const computeApprovedTreeStats = (
  trees: TreeRecord[],
  tasks: Task[],
  auditsByTree: Record<string, any[]> = {}
) => {
  const approved = trees.filter((tree) => isApprovedProjectTree(tree, tasks));
  return computeTreeStats(
    approved.map((tree) => treeWithLatestAuditCondition(tree, auditsByTree[tree.id]))
  );
};

async function fetchTasksForTreeStats(projectId: string | null, userId?: string): Promise<Task[]> {
  const columnLists = [
    'id, status, tree_id, tree_record_id, task_type, audit_round, project_id',
    'id, status, tree_id, project_id',
  ];
  for (const columns of columnLists) {
    let query = supabase.from('tasks').select(columns);
    if (projectId) query = query.eq('project_id', projectId);
    const { data, error } = await query;
    if (!error && data) return data as unknown as Task[];
  }
  if (!userId) return [];
  const { data } = await fetchAgentTasks(userId);
  const rows = data ?? [];
  return projectId ? rows.filter((task) => task.project_id === projectId) : rows;
}

function buildApprovedStatsMap(
  allTrees: TreeRecord[],
  tasks: Task[],
  auditsByTree: Record<string, any[]>
) {
  const map: Record<string, { total: number; healthy: number; sick: number; dead: number }> = {};
  map['__all__'] = computeApprovedTreeStats(allTrees, tasks, auditsByTree);
  const grouped = new Map<string, TreeRecord[]>();
  allTrees.forEach((tree) => {
    const pid = tree.project_id || 'unassigned';
    const list = grouped.get(pid);
    if (list) list.push(tree);
    else grouped.set(pid, [tree]);
  });
  grouped.forEach((group, pid) => {
    map[pid] = computeApprovedTreeStats(group, tasks, auditsByTree);
  });
  return map;
}

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const activeProjectId = useAuthStore((s) => s.activeProjectId);
  const setActiveProjectId = useAuthStore((s) => s.setActiveProjectId);
  const assignedProjects = useAuthStore((s) => s.assignedProjects) ?? [];
  const refreshKey = useProjectRefreshStore((s) => s.refreshKey);
  const trees = useTreeStore((s) => s.trees) ?? [];
  const setTrees = useTreeStore((s) => s.setTrees);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ total: 0, healthy: 0, sick: 0, dead: 0 });
  const [taskStats, setTaskStats] = useState({ total: 0, assigned: 0, rejected: 0, completed: 0, approved: 0 });
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [projectGeofence, setProjectGeofence] = useState<ProjectGeofence | null>(null);
  const [showGeofencePromptModal, setShowGeofencePromptModal] = useState(false);
  const [projectStatsMap, setProjectStatsMap] = useState<
    Record<string, { total: number; healthy: number; sick: number; dead: number }>
  >({});
  const projectStatsMapRef = useRef(projectStatsMap);
  projectStatsMapRef.current = projectStatsMap;
  const promptedProjectsRef = useRef<Set<string>>(new Set());
  const loadSeqRef = useRef(0);
  const taskSeqRef = useRef(0);

  const firstName = (user?.full_name?.trim()?.split(' ')[0] || '').replace(/[.!]$/, '');
  const greetingName = firstName || 'there';

  const preCacheAllProjects = useCallback(async () => {
    try {
      const { data: all } = await fetchAllTrees();
      if (all) {
        const uid = userId || useAuthStore.getState().user?.id;
        const tasks = await fetchTasksForTreeStats(null, uid);
        const audits = all.length > 0 ? await fetchAuditsForTrees(all.map((tree) => tree.id)) : {};
        const map = buildApprovedStatsMap(all, tasks, audits);
        setProjectStatsMap(map);
        projectStatsMapRef.current = map;

        const key = useAuthStore.getState().activeProjectId || '__all__';
        if (map[key]) {
          setStats(map[key]);
        }
      }
    } catch {}
  }, [userId]);

  // ─── Instant local cache for immediate display (<10ms) ─────────────────────
  useEffect(() => {
    let cancelled = false;

    // Counts already loaded in this session. The database refresh below replaces them.
    const memoryTrees = useTreeStore.getState().trees;
    if (memoryTrees && memoryTrees.length > 0) {
      const match = activeProjectId
        ? memoryTrees.filter((t) => t.project_id === activeProjectId)
        : memoryTrees;
      const remembered = projectStatsMapRef.current[activeProjectId || '__all__'];
      if (remembered) setStats(remembered);
    }

    return () => {
      cancelled = true;
    };
  }, []);

  // Only the projects assigned to this user. The home count and picker use this list.
  useEffect(() => {
    let active = true;
    setAllProjects(assignedProjects);
    (async () => {
      const state = useAuthStore.getState();
      if (!state.activeProjectId && assignedProjects.length > 0 && active) {
        const cachedId = await getCachedActiveProject(state.user?.id ?? state.session?.user?.id);
        const restored = cachedId && assignedProjects.some((project) => project.id === cachedId)
          ? cachedId
          : assignedProjects[0].id;
        setActiveProjectId(restored);
      }
    })();
    return () => { active = false; };
  }, [assignedProjects, setActiveProjectId]);

  const loadTrees = useCallback(async () => {
    const seq = ++loadSeqRef.current;

    try {
      let visibleTrees: TreeRecord[] = [];

      if (activeProjectId) {
        // Fetch project-specific trees
        const { data: projTrees } = await fetchTreesByProject(activeProjectId);
        if (projTrees && projTrees.length > 0) {
          visibleTrees = projTrees;
        } else if (userId) {
          // Fallback to user's trees for this project
          const { data: myTrees } = await fetchMyTrees(userId);
          visibleTrees = (myTrees || []).filter((t) => t.project_id === activeProjectId);
        }
      } else {
        // All Projects view
        const { data: allTrees } = await fetchAllTrees();
        if (allTrees && allTrees.length > 0) {
          visibleTrees = allTrees;
        } else if (userId) {
          const { data: myTrees } = await fetchMyTrees(userId);
          visibleTrees = myTrees || [];
        }
      }

      if (seq !== loadSeqRef.current) return;

      setTrees(visibleTrees);
      const tasks = await fetchTasksForTreeStats(activeProjectId, userId);
      const audits = visibleTrees.length > 0
        ? await fetchAuditsForTrees(visibleTrees.map((tree) => tree.id))
        : {};
      if (seq !== loadSeqRef.current) return;

      const computedStats = computeApprovedTreeStats(visibleTrees, tasks, audits);
      setStats(computedStats);

      // Keep projectStatsMap updated
      const key = activeProjectId || '__all__';
      const updatedMap = { ...projectStatsMapRef.current, [key]: computedStats };
      setProjectStatsMap(updatedMap);
      projectStatsMapRef.current = updatedMap;
    } catch (e) {
      console.warn('[HomeScreen] Error loading trees:', e);
    }
  }, [userId, activeProjectId, setTrees]);

  const loadTasks = useCallback(async () => {
    if (!userId) return;
    const seq = ++taskSeqRef.current;

    try {
      const agentTasksRes = await fetchAgentTasks(userId);
      const projectTreesRes = { data: useTreeStore.getState().trees ?? [] };
      const auditsByTree = await fetchAuditsForTrees((projectTreesRes.data ?? []).map((tree) => tree.id));

      if (seq !== taskSeqRef.current) return;

      const dbTasks = (agentTasksRes.data ?? []).filter((task) => !task.id.startsWith('local_'));
      let visibleTasks: Task[] = dbTasks;
      let visibleTrees = projectTreesRes.data ?? [];

      if (activeProjectId) {
        visibleTasks = visibleTasks.filter((t) => t.project_id === activeProjectId);
        visibleTrees = visibleTrees.filter((t) => t.project_id === activeProjectId);
      }

      const isAuditTask = (task: Task) =>
        task.task_type === 'audit' || !!task.audit_round || String(task.id).startsWith('audit-');
      const statusByTree = new Map<string, 'assigned' | 'completed' | 'approved' | 'rejected'>();
      const knownTreeIds = new Set(visibleTrees.map((tree) => tree.id));

      visibleTrees.forEach((tree) => {
        const linked = visibleTasks.find(
          (task) =>
            !isAuditTask(task) &&
            (task.tree_id === tree.id || task.tree_record_id === tree.id || task.id === tree.id)
        );
        if (!linked && !tree.locked) return;
        if (tree.locked || linked?.status === 'approved') statusByTree.set(tree.id, 'approved');
        else if (linked?.status === 'rejected') statusByTree.set(tree.id, 'rejected');
        else if (linked?.status === 'assigned' || linked?.status === 'in_progress') statusByTree.set(tree.id, 'assigned');
        else if (linked?.status === 'completed') statusByTree.set(tree.id, 'completed');
      });

      visibleTasks.forEach((task) => {
        if (isAuditTask(task)) return;
        const key = task.tree_record_id || task.tree_id || task.id;
        if (!key || knownTreeIds.has(key) || (task.tree_id && knownTreeIds.has(task.tree_id))) return;
        if (task.status === 'approved') statusByTree.set(key, 'approved');
        else if (task.status === 'rejected') statusByTree.set(key, 'rejected');
        else if (task.status === 'completed') statusByTree.set(key, 'completed');
        else if (task.status === 'assigned' || task.status === 'in_progress') statusByTree.set(key, 'assigned');
      });

      let assigned = 0;
      let completed = 0;
      let rejected = 0;
      let approved = 0;
      statusByTree.forEach((status) => {
        if (status === 'assigned') assigned += 1;
        else if (status === 'completed') completed += 1;
        else if (status === 'rejected') rejected += 1;
        else if (status === 'approved') approved += 1;
      });

      const pendingAuditKeys = new Set<string>();
      visibleTasks.forEach((task) => {
        if (!isAuditTask(task)) return;
        if (task.status !== 'assigned' && task.status !== 'in_progress') return;
        const treeKey = task.tree_record_id || task.tree_id || task.id;
        pendingAuditKeys.add(`${treeKey}_${task.audit_round || 1}`);
      });
      assigned += pendingAuditKeys.size;

      const taskTotal = assigned + completed + rejected + approved;
      setTaskStats({
        total: taskTotal,
        assigned,
        rejected,
        completed,
        approved,
      });
    } catch (e) {
      console.warn('[HomeScreen] Error loading tasks:', e);
    }
  }, [userId, activeProjectId]);

  const loadGeofence = useCallback(async () => {
    if (!activeProjectId) {
      setProjectGeofence(null);
      return;
    }
    const { data } = await fetchProjectGeofence(activeProjectId);
    setProjectGeofence(data);
    const isCompleted = !!data && data.locked && data.coordinates && data.coordinates.length >= 3;
    if (!isCompleted && !promptedProjectsRef.current.has(activeProjectId)) {
      promptedProjectsRef.current.add(activeProjectId);
      setShowGeofencePromptModal(true);
    }
  }, [activeProjectId]);

  // Real-time listener: auto-update stats when tree records change in database
  useEffect(() => {
    const channel = supabase
      .channel(`home-trees-realtime-${activeProjectId || 'all'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tree_records',
        },
        () => {
          loadTrees();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
        },
        () => {
          loadTrees();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tree_monitoring_records',
        },
        () => {
          loadTrees();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeProjectId, loadTrees]);

  useFocusEffect(
    useCallback(() => {
      loadTrees().then(() => loadTasks());
      loadGeofence();
    }, [loadTrees, loadTasks, loadGeofence])
  );

  const handleSelectProject = (projectId: string | null) => {
    const key = projectId || '__all__';
    const targetStats = projectStatsMapRef.current[key];
    if (targetStats) {
      setStats(targetStats); // 0ms instant display!
    }
    setActiveProjectId(projectId);
  };

  // Instantly reload when the active project changes
  useEffect(() => {
    const key = activeProjectId || '__all__';
    const targetStats = projectStatsMapRef.current[key];
    if (targetStats) {
      setStats(targetStats); // 0ms instant UI update!
    }
    loadTrees().then(() => loadTasks());
    loadGeofence();
  }, [activeProjectId, refreshKey, loadTrees, loadTasks, loadGeofence]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      loadTrees().then(() => loadTasks()),
      loadGeofence(),
      preCacheAllProjects(),
    ]);
    setRefreshing(false);
  };


  return (
    <View style={styles.container}>
      <View style={styles.bannerWrap}>
        <LinearGradient
          colors={['#123f24', '#1a5c2a', '#2e7d43']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[styles.banner, { paddingTop: insets.top + 18 }]}
        >
          <View style={styles.bannerTopRow}>
            <View style={styles.bannerGreeting}>
              <Text style={styles.greeting}>Hi {greetingName}</Text>
              <Text style={styles.bannerSub}>Ready to capture trees today?</Text>
            </View>
            <TouchableOpacity
              style={styles.noticeBtn}
              onPress={() => navigation.navigate('Notifications')}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Open notifications"
            >
              <Ionicons name="notifications" size={20} color="#123f24" />
            </TouchableOpacity>
          </View>

          {/* Active Project Card - Tappable Dropdown */}
          <TouchableOpacity
            style={styles.activeProjectCard}
            onPress={() => navigation.navigate('ProjectSelect')}
            activeOpacity={0.8}
          >
            <View style={styles.activeProjectIcon}>
              <Ionicons name="folder-open" size={20} color="#1a5c2a" />
            </View>
            <View style={styles.activeProjectInfo}>
              <Text style={styles.activeProjectLabel}>ACTIVE PROJECT</Text>
              <Text style={styles.activeProjectName} numberOfLines={1}>
                {allProjects.find((p) => p.id === activeProjectId)?.name ?? 'No project'}
              </Text>
            </View>

          </TouchableOpacity>
        </LinearGradient>
      </View>

    <ScrollView
      style={styles.scroll}
      contentContainerStyle={{ paddingBottom: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1a5c2a" />}
    >
      <View style={styles.contentSection}>
        {/* Tree Stats - 4 cards in a row */}
        <View style={styles.treeStatsRow}>
          <View style={[styles.treeStatCard, { borderTopColor: '#1a5c2a' }]}>
            <Text style={[styles.treeStatNumber, { color: '#1a5c2a' }]}>{stats.total}</Text>
            <Text style={styles.treeStatLabel}>Total Trees</Text>
          </View>
          <View style={[styles.treeStatCard, { borderTopColor: '#22c55e' }]}>
            <Text style={[styles.treeStatNumber, { color: '#22c55e' }]}>{stats.healthy}</Text>
            <Text style={styles.treeStatLabel}>Healthy</Text>
          </View>
          <View style={[styles.treeStatCard, { borderTopColor: '#f59e0b' }]}>
            <Text style={[styles.treeStatNumber, { color: '#f59e0b' }]}>{stats.sick}</Text>
            <Text style={styles.treeStatLabel}>Sick</Text>
          </View>
          <View style={[styles.treeStatCard, { borderTopColor: '#ef4444' }]}>
            <Text style={[styles.treeStatNumber, { color: '#ef4444' }]}>{stats.dead}</Text>
            <Text style={styles.treeStatLabel}>Dead</Text>
          </View>
        </View>

        {/* Land geofencing stays visible only until the boundary is locked. */}
        {activeProjectId &&
        (!projectGeofence?.locked || !projectGeofence.coordinates || projectGeofence.coordinates.length < 3) ? (
          <TouchableOpacity
            style={styles.geofenceNoticeCard}
            onPress={() => navigation.navigate('Map', { startGeofenceWalk: true })}
            activeOpacity={0.85}
          >
            <View style={styles.geofenceNoticeIconWrap}>
              <Ionicons name="map" size={24} color="#b45309" />
            </View>
            <View style={styles.geofenceNoticeInfo}>
              <View style={styles.geofenceNoticeBadgeRow}>
                <Text style={styles.geofenceNoticeBadgeText}>1-TIME SETUP REQUIRED</Text>
              </View>
              <Text style={styles.geofenceNoticeTitle}>Land Geofencing Pending</Text>
              <Text style={styles.geofenceNoticeSub}>Walk land perimeter with phone & save corners to lock</Text>
            </View>
            <View style={styles.geofenceNoticeActionBtn}>
              <Text style={styles.geofenceNoticeActionText}>Walk & Lock</Text>
              <Ionicons name="arrow-forward" size={13} color="#fff" />
            </View>
          </TouchableOpacity>
        ) : null}

        {/* Capture a Tree Card — opens the Assigned tab. Text stays fixed. */}
        <TouchableOpacity
          style={styles.captureCard}
          onPress={() => navigation.navigate('Task', { tab: 'assigned', at: Date.now() })}
          activeOpacity={0.88}
        >
          <View style={styles.captureLens}>
            <Ionicons name="leaf" size={22} color="#1a5c2a" />
          </View>
          <View style={styles.captureInfo}>
            <Text style={styles.captureTitle}>Capture a Tree</Text>
            <Text style={styles.captureSub}>Take photo + tag GPS location</Text>
          </View>
          <GradientProgress
            size={52}
            progress={taskStats.total > 0 ? (taskStats.assigned / taskStats.total) * 100 : 0}
            strokeWidth={4}
            colors={['#86efac', '#22c55e', '#1a5c2a']}
            trackColor="#e5efe7"
          >
            <Text style={styles.captureProgressValue}>{taskStats.assigned}</Text>
          </GradientProgress>
        </TouchableOpacity>

        {/* Task Stats - 2x2 Grid with GradientProgress */}
        <View style={styles.taskStatsContainer}>
          {/* Header — username + all data (left aligned above the boxes) */}
          <View style={styles.taskStatsHeader}>
            <Text style={styles.taskStatsHeaderText} numberOfLines={1}>
              {user?.full_name?.trim() || 'User'} all data
            </Text>
          </View>
          <View style={styles.taskStatsRow}>
            <TouchableOpacity
              style={styles.taskStatCard}
              onPress={() => navigation.navigate('ProjectSelect')}
              activeOpacity={0.7}
            >
              <GradientProgress
                size={64}
                progress={100}
                strokeWidth={5}
                colors={buildProjectPalette(allProjects.length)}
                trackColor="#E8F5E9"
              >
                <Text style={styles.taskStatNumber}>{allProjects.length}</Text>
              </GradientProgress>
              <Text style={styles.taskStatLabel}>Projects</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.taskStatCard}
              onPress={() => navigation.navigate('Task', { tab: 'approved', at: Date.now() })}
              activeOpacity={0.7}
            >
              <GradientProgress
                size={64}
                progress={taskStats.total > 0 ? (taskStats.approved / taskStats.total) * 100 : 0}
                strokeWidth={5}
                colors={buildProgressPalette(['#c4b5fd', '#8b5cf6', '#7c3aed', '#5b21b6'], allProjects.length)}
                trackColor="#EDE9FE"
              >
                <Text style={styles.taskStatNumber}>{taskStats.approved}</Text>
              </GradientProgress>
              <Text style={styles.taskStatLabel}>Approved Trees</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.taskStatsRow}>
            <TouchableOpacity
              style={styles.taskStatCard}
              onPress={() => navigation.navigate('Task', { tab: 'rejected' })}
              activeOpacity={0.7}
            >
              <GradientProgress
                size={64}
                progress={taskStats.total > 0 ? (taskStats.rejected / taskStats.total) * 100 : 0}
                strokeWidth={5}
                colors={buildProgressPalette(['#fecaca', '#f87171', '#ef4444', '#b91c1c'], allProjects.length)}
                trackColor="#FEE2E2"
              >
                <Text style={styles.taskStatNumber}>{taskStats.rejected}</Text>
              </GradientProgress>
              <Text style={styles.taskStatLabel}>Rejected</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.taskStatCard}
              onPress={() => navigation.navigate('Task', { tab: 'completed' })}
              activeOpacity={0.7}
            >
              <GradientProgress
                size={64}
                progress={taskStats.total > 0 ? (taskStats.completed / taskStats.total) * 100 : 0}
                strokeWidth={5}
                colors={buildProgressPalette(['#86d189', '#4caf50', '#2e7d43', '#1a5c2a'], allProjects.length)}
                trackColor="#E8F5E9"
              >
                <Text style={styles.taskStatNumber}>{taskStats.completed}</Text>
              </GradientProgress>
              <Text style={styles.taskStatLabel}>Completed</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </ScrollView>



    {/* First-Time Land Geofencing Prompt Modal */}
    <Modal
      visible={showGeofencePromptModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowGeofencePromptModal(false)}
    >
      <View style={styles.promptModalBackdrop}>
        <View style={styles.promptModalCard}>
          <View style={styles.promptModalIconCircle}>
            <Ionicons name="map" size={32} color="#F09125" />
          </View>
          <Text style={styles.promptModalTitle}>Land Geofencing Required</Text>
          <Text style={styles.promptModalProject}>
            {allProjects.find((p) => p.id === activeProjectId)?.name || 'This Project'}
          </Text>
          <Text style={styles.promptModalBody}>
            Before trees can be surveyed or tasks completed, this project requires its land area boundary to be geofenced and locked.
            {'\n\n'}
            This is a 1-time setup. Please walk along the perimeter with your phone and record a point at each corner of the land.
          </Text>
          <View style={styles.promptModalActions}>
            <TouchableOpacity
              style={styles.promptModalPrimaryBtn}
              onPress={() => {
                setShowGeofencePromptModal(false);
                navigation.navigate('Map', { startGeofenceWalk: true });
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="walk" size={18} color="#fff" />
              <Text style={styles.promptModalPrimaryBtnText}>Start Boundary Walk</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.promptModalSecondaryBtn}
              onPress={() => setShowGeofencePromptModal(false)}
            >
              <Text style={styles.promptModalSecondaryBtnText}>Remind Me Later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f1' },
  scroll: { flex: 1 },
  bannerWrap: { zIndex: 5, overflow: 'visible' },
  banner: {
    backgroundColor: '#1a5c2a',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 22,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  curveDivider: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  contentSection: {
    backgroundColor: '#f0f4f1',
    paddingBottom: 5,
    marginTop: 0,
  },
  bannerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  bannerGreeting: { flex: 1 },
  noticeBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  greeting: { fontSize: 24, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
  bannerSub: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  captureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 14,
    backgroundColor: '#fff',
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12,
    borderTopWidth: 3,
    borderTopColor: '#1a5c2a',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  captureLens: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#e8f5e9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureInfo: { flex: 1 },
  captureTitle: { fontSize: 16, fontWeight: '800', color: '#1a1a1a' },
  captureSub: { fontSize: 12, color: '#888', marginTop: 2 },
  captureProgressValue: { fontSize: 15, fontWeight: '800', color: '#1a5c2a' },
  captureBadge: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  captureBadgeText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  activeProjectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginTop: 14,
    gap: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  activeProjectIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeProjectInfo: { flex: 1 },
  activeProjectLabel: { fontSize: 10, fontWeight: '700', color: '#999', letterSpacing: 0.5 },
  activeProjectName: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginTop: 1 },
  activeProjectArrow: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalBackdropTouch: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingBottom: 40,
    maxHeight: '60%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#1a1a1a' },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  modalOptionActive: { backgroundColor: '#1a5c2a' },
  modalOptionIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOptionIconActive: { backgroundColor: 'rgba(255,255,255,0.2)' },
  modalOptionName: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  modalOptionNameActive: { color: '#fff' },
  modalOptionDesc: { fontSize: 12, color: '#888', marginTop: 2 },
  modalOptionDescActive: { color: '#cde8d3' },
  projectCountBadge: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  projectCountBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  projectCountBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1a5c2a',
  },
  projectCountBadgeTextActive: {
    color: '#fff',
  },
  projectSelectorWrapper: { marginTop: 14 },
  treeStatsRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 14,
    gap: 8,
  },
  treeStatCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderTopWidth: 3,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  treeStatNumber: { fontSize: 22, fontWeight: '800' },
  treeStatLabel: { fontSize: 10, color: '#888', marginTop: 4, fontWeight: '600' },
  taskStatsContainer: {
    marginHorizontal: 16,
    marginTop: 8,
    gap: 8,
  },
  taskStatsHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  taskStatsHeaderText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  taskStatsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  taskStatCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  taskStatNumber: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1a1a1a',
  },
  taskStatLabel: {
    fontSize: 12,
    color: '#888',
    marginTop: 8,
  },
  // Geofence Notice & Success Cards
  geofenceNoticeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 14,
    padding: 14,
    gap: 12,
    borderWidth: 1.5,
    borderColor: '#f59e0b',
    elevation: 3,
    shadowColor: '#f59e0b',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  geofenceNoticeIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#fef3c7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  geofenceNoticeInfo: { flex: 1 },
  geofenceNoticeBadgeRow: { marginBottom: 3 },
  geofenceNoticeBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#b45309',
    letterSpacing: 0.5,
  },
  geofenceNoticeTitle: { fontSize: 13, fontWeight: '700', color: '#1a1a1a' },
  geofenceNoticeSub: { fontSize: 11, color: '#666', marginTop: 2 },
  geofenceNoticeActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#b45309',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
  },
  geofenceNoticeActionText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  geofenceSuccessCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 14,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  geofenceSuccessIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  geofenceSuccessInfo: { flex: 1 },
  geofenceSuccessTitle: { fontSize: 13, fontWeight: '700', color: '#15803d' },
  geofenceSuccessSub: { fontSize: 11, color: '#666', marginTop: 2 },
  geofenceViewMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  geofenceViewMapBtnText: { color: '#15803d', fontSize: 11, fontWeight: '700' },

  // Prompt Modal Styles
  promptModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  promptModalCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 22,
    alignItems: 'center',
    maxWidth: 360,
    width: '100%',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
  },
  promptModalIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fff7ed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  promptModalTitle: { fontSize: 18, fontWeight: '800', color: '#1a1a1a', textAlign: 'center' },
  promptModalProject: { fontSize: 13, fontWeight: '600', color: '#1a5c2a', marginTop: 4, textAlign: 'center' },
  promptModalBody: {
    fontSize: 13,
    color: '#4b5563',
    lineHeight: 19,
    textAlign: 'center',
    marginVertical: 14,
  },
  promptModalActions: { width: '100%', gap: 10 },
  promptModalPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1a5c2a',
    paddingVertical: 13,
    borderRadius: 12,
  },
  promptModalPrimaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  promptModalSecondaryBtn: {
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptModalSecondaryBtnText: { color: '#888', fontSize: 13, fontWeight: '600' },
});

