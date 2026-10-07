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
import { fetchMyTrees, fetchTreesByProject, fetchAllTrees, fetchAllProjects, backfillProjectTreeIds } from '../../services/treeService';
import { fetchAgentTasks, startTask } from '../../services/taskService';
import { supabase } from '../../services/supabase';
import {
  fetchAuditsForTrees,
  getLatestAudit,
  parseAuditDate,
} from '../../services/auditService';
import { Task, Project, TreeRecord } from '../../types';
import { displayTreeId, parseTreeMeta, resolveTreeId, splitLabeledTreeName } from '../../utils/treeId';
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

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDateKeyFromValue(value?: string | null) {
  if (!value) return null;
  const dateOnly = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateOnly && value.length === 10) return dateOnly[1];
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return localDateKey(parsed);
}

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
  const pendingTaskTab = useTaskStore((s) => s.pendingTaskTab);
  const pendingTaskTabAt = useTaskStore((s) => s.pendingTaskTabAt);
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TaskTab>('assigned');
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('all');
  const [hasRemainingGeofence, setHasRemainingGeofence] = useState(false);
  // uuid (tree record) → project tree ID, e.g. "ARAV-001" (see utils/treeId.ts)
  const [treeIds, setTreeIds] = useState<Record<string, string>>({});
  const [auditsByTree, setAuditsByTree] = useState<Record<string, any[]>>({});
  const loadSeqRef = useRef(0);
  const holdCompletedUntil = useRef(0);

  // Keep stable refs so loadTasks never needs to be recreated on value changes
  const activeProjectIdRef = useRef(activeProjectId);
  useEffect(() => { activeProjectIdRef.current = activeProjectId; }, [activeProjectId]);

  // Dashboard boxes can open this screen on a specific tab (e.g. Rejected/Completed).
  useEffect(() => {
    const params = route.params as { tab?: TaskTab; at?: number } | undefined;
    if (params?.tab) setActiveTab(params.tab);
  }, [route.params, (route.params as { at?: number } | undefined)?.at]);

  // An audit form sits on the root stack, so it cannot pass a tab param to this
  // sibling. The store request is what opens Completed after the audit is saved.
  useEffect(() => {
    if (!pendingTaskTab) return;
    setActiveTab(pendingTaskTab);
    if (pendingTaskTab === 'completed') holdCompletedUntil.current = Date.now() + 12000;
    // Clear the pending request so it does not re-fire on subsequent renders.
    useTaskStore.getState().openTaskTab(null);
  }, [pendingTaskTab, pendingTaskTabAt]);

  // Assigned tree and audit tasks belong to their due date. Other tabs stay on
  // the day the work was reviewed or created.
  const taskDateKey = (task: Task, listKind: 'assigned' | 'other' = 'other') => {
    if (listKind === 'assigned') {
      return (
        localDateKeyFromValue(task.due_date) ||
        localDateKeyFromValue(task.created_at)
      );
    }
    return (
      localDateKeyFromValue(task.reviewed_at) ||
      localDateKeyFromValue(task.completed_at) ||
      localDateKeyFromValue(task.created_at)
    );
  };

  const filterByDate = (taskList: Task[], listKind: 'assigned' | 'other' = 'other') => {
    if (selectedDate === 'all') return taskList;
    const dateStr = selectedDate === 'today' ? localDateKey(new Date()) : selectedDate;
    return taskList.filter((task) => taskDateKey(task, listKind) === dateStr);
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
    const pid = activeProjectIdRef.current;

    // Fetch trees for active project (or all trees), so audits for any project tree can be monitored
    const treePromise = pid ? fetchTreesByProject(pid) : fetchAllTrees();

    const [treesRes, tasksRes] = await Promise.all([
      treePromise,
      fetchAgentTasks(userId),
    ]);
    if (seq !== loadSeqRef.current) return;
    let myTrees = treesRes.data ?? [];
    if (myTrees.length === 0) {
      const fallback = await fetchMyTrees(userId);
      if (fallback.data && fallback.data.length > 0) {
        myTrees = fallback.data;
      }
    }

    // Filter trees by active project if selected. A failed read does not keep old cards.
    const visibleTrees = pid ? myTrees.filter((t) => t.project_id === pid) : myTrees;
    setTrees(treesRes.error ? [] : visibleTrees);

    // Only database tasks are shown. A failed read keeps the cards already loaded.
    const dbTasks = (tasksRes.data ?? []).filter((task) => task?.id && !String(task.id).startsWith('local_'));
    if (!tasksRes.error) {
      // Assigned and Completed follow the tasks row. A local completed flag must
      // not keep a card on Completed after the database still says assigned.
      setTasks(dbTasks);
    }

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

    // Audits already saved for these trees. A new audit card is not created here.
    // It appears on Assigned only after an admin assigns that task.
    if (visibleTrees.length > 0) {
      const audits = await fetchAuditsForTrees(visibleTrees.map((t) => t.id));
      if (seq !== loadSeqRef.current) return;
      if (audits) setAuditsByTree(audits);
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

  // An admin approve or reject updates this user's task row. Follow that status
  // without waiting for a manual refresh: Completed leaves, Approved or Rejected opens.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`agent-task-review-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `assignee_id=eq.${userId}` },
        (payload) => {
          const next = (payload.new ?? null) as Partial<Task> | null;
          if (!next?.id) return;
          const status = next.status;
          const current = useTaskStore.getState().tasks ?? [];
          const exists = current.some((task) => task.id === next.id);
          if (payload.eventType === 'INSERT' || !exists) {
            // During the hold window, an INSERT for the same task id that still
            // carries 'assigned' must not overwrite the optimistic 'completed'.
            const isHolding =
              Date.now() < holdCompletedUntil.current ||
              useTaskStore.getState().pendingTaskTab === 'completed';
            const existingTask = current.find((t) => t.id === next.id);
            const protectCompleted =
              isHolding &&
              existingTask?.status === 'completed' &&
              (status === 'assigned' || status === 'in_progress');
            if (!protectCompleted) {
              setTasks([next as Task, ...current.filter((task) => task.id !== next.id)]);
            }
            const linkedId = next.tree_record_id || next.tree_id;
            const finishedSameTree = current.some((task) => {
              if (task.status !== 'completed') return false;
              const taskTree = task.tree_record_id || task.tree_id;
              return Boolean(linkedId && taskTree && taskTree === linkedId);
            });
            // The next assigned round must not pull the screen off the audit that was just completed.
            const stayOnCompleted = isHolding;
            if ((status === 'assigned' || status === 'in_progress') && !finishedSameTree && !stayOnCompleted) {
              setActiveTab('assigned');
            }
            return;
          }
          if (status !== 'approved' && status !== 'rejected' && status !== 'completed' && status !== 'assigned' && status !== 'in_progress') return;
          setTasks(
            current.map((task) =>
              task.id === next.id ? { ...task, ...next, status: status as Task['status'] } : task
            )
          );
          // A reviewed audit leaves Completed. Reject opens Rejected; approve opens Approved.
          if (status === 'rejected') setActiveTab('rejected');
          else if (status === 'approved') setActiveTab('approved');
          else if (status === 'completed') setActiveTab('completed');
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, setTasks]);

  // Fallback when the live update is not delivered: a finished audit that an admin
  // has since approved or rejected leaves Completed and opens that tab.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const watchReview = async () => {
      const { data, error } = await fetchAgentTasks(userId);
      if (cancelled || error) return;
      const current = useTaskStore.getState().tasks ?? [];
      const fresh = data ?? [];
      const freshById = new Map(fresh.map((task) => [task.id, task]));
      const added = fresh.filter((task) => !current.some((row) => row.id === task.id));
      let moved: 'approved' | 'rejected' | null = null;
      const isHolding =
        Date.now() < holdCompletedUntil.current ||
        useTaskStore.getState().pendingTaskTab === 'completed';
      const next = current.map((task) => {
        const row = freshById.get(task.id);
        if (!row || row.status === task.status) return task;
        // During the hold window, protect optimistic 'completed' from being
        // overwritten by a stale 'assigned' or 'in_progress' DB row.
        if (
          isHolding &&
          task.status === 'completed' &&
          (row.status === 'assigned' || row.status === 'in_progress')
        ) {
          return task;
        }
        if (row.status === 'approved' || row.status === 'rejected') {
          if (task.status === 'completed' || task.status === 'assigned' || task.status === 'in_progress') {
            moved = row.status;
          }
          return { ...task, ...row };
        }
        return { ...task, ...row };
      });
      if (added.length > 0) {
        setTasks([...added, ...next]);
        const finishedTreeIds = new Set(
          next
            .filter((task) => task.status === 'completed')
            .map((task) => task.tree_record_id || task.tree_id)
            .filter((id): id is string => Boolean(id))
        );
        const opensAnotherTree = added.some((task) => {
          if (task.status !== 'assigned' && task.status !== 'in_progress') return false;
          const linkedId = task.tree_record_id || task.tree_id;
          return !linkedId || !finishedTreeIds.has(linkedId);
        });
        const stayOnCompleted =
          useTaskStore.getState().pendingTaskTab === 'completed' ||
          Date.now() < holdCompletedUntil.current;
        if (opensAnotherTree && !stayOnCompleted) {
          setActiveTab('assigned');
        }
        return;
      }
      if (!moved && next.every((task, index) => task === current[index])) return;
      setTasks(next);
      // A reviewed audit leaves Completed for the one matching tab.
      if (moved) setActiveTab(moved === 'rejected' ? 'rejected' : 'approved');
    };
    const timer = setInterval(watchReview, 12000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [userId, setTasks]);

  // Instantly reload whenever the active project changes (refreshKey incremented
  // by setActiveProjectId in authStore — fires even when this screen is not focused)
  useEffect(() => {
    loadTasks();
  }, [refreshKey, activeProjectId, loadTasks]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTasks();
    setRefreshing(false);
  };

  const handleStartTask = async (task: Task) => {
    setActiveTaskId(task.id);
    if (!task.started_at) {
      await startTask(task.id);
      setTasks(tasks.map((t) => (t.id === task.id ? { ...t, started_at: new Date().toISOString(), status: 'in_progress' } : t)));
    }
    navigation.navigate('Capture');
  };

  const handleOpenMap = (location: string) => {
    navigation.getParent()?.navigate('Map');
  };

  const headerDateParts = useMemo(() => {
    const selected =
      selectedDate === 'all' || selectedDate === 'today'
        ? new Date()
        : new Date(`${selectedDate}T00:00:00`);
    const safe = Number.isNaN(selected.getTime()) ? new Date() : selected;
    return {
      primary: safe.toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    };
  }, [selectedDate]);

  // Ensure trees are filtered by active project
  const projectTrees = useMemo(() => {
    if (!activeProjectId) return trees;
    return trees.filter((t) => t.project_id === activeProjectId);
  }, [trees, activeProjectId]);

  // Counts and cards use only this project's live tasks.
  const projectTasks = useMemo(() => {
    const liveTasks = tasks.filter((task) => !String(task.id).startsWith('local_'));
    if (!activeProjectId) return liveTasks;
    const treeIds = new Set(projectTrees.map((tree) => tree.id));
    return liveTasks.filter((task) => {
      if (task.project_id === activeProjectId) return true;
      // A planting task has no tree yet. Keep it when the admin left project_id empty.
      if (!task.project_id && (task.status === 'assigned' || task.status === 'in_progress')) return true;
      if (task.project_id) return false;
      const linkedId = task.tree_record_id || task.tree_id;
      return Boolean(linkedId && treeIds.has(linkedId));
    });
  }, [tasks, projectTrees, activeProjectId]);

  // One card per tasks row. An audit and the next audit of the same tree are
  // different rows, so each follows its own database status.
  const currentTasks = useMemo(() => {
    const seen = new Set<string>();
    return projectTasks.filter((task) => {
      if (!task.id || seen.has(task.id)) return false;
      seen.add(task.id);
      return true;
    });
  }, [projectTasks]);

  // assigned + in_progress both show in the Assigned tab
  const assignedTasks = currentTasks.filter((t) => t.status === 'assigned' || t.status === 'in_progress');
  const rejectedTasks = currentTasks
    .filter((t) => t.status === 'rejected')
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

  // Planting and audit cards share one list, newest first, so they are not grouped apart.
  const assignedItems = useMemo(() => {
    return [...assignedTasks].sort((a, b) => {
      const aTime = new Date(a.created_at || a.due_date || 0).getTime();
      const bTime = new Date(b.created_at || b.due_date || 0).getTime();
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
  }, [assignedTasks]);

  // Admin approval moves the same task card onto the Approved tab only.
  // A rejected audit stays on Rejected and is never copied here.
  const approvedItems = useMemo(() => {
    const list = currentTasks
      .filter((t) => t.status === 'approved')
      .map((t) => {
        // Monitoring rows can be keyed by the tree record id, the task's
        // tree_record_id, or its tree_id — accept any so the audit is never missed.
        const auditRows = [t.tree_record_id, t.tree_id, t.id]
          .filter(Boolean)
          .map((key) => auditsByTree[key as string])
          .find((rows) => rows && rows.length > 0);
        const latestAudit = getLatestAudit(auditRows || []);
        if (!latestAudit) return t;
        return {
          ...t,
          photo_url: latestAudit.photo_url || t.photo_url,
          tree_condition: latestAudit.tree_condition || t.tree_condition,
          audit_round: latestAudit.monitoring_round || t.audit_round || null,
          task_type: 'audit',
        };
      });
    return list.sort(
      (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );
  }, [currentTasks, auditsByTree]);

  // A completed task stays here until an admin approves or rejects that card.
  const completedItems = useMemo(() => {
    const list: Task[] = [];
    const seenIds = new Set<string>();

    currentTasks.forEach((t) => {
      if (t.status !== 'completed') return;
      // Use the same three-key lookup as approvedItems so the audit is never missed
      // when monitoring rows are keyed by tree_record_id, tree_id, or task id.
      const auditRows = [t.tree_record_id, t.tree_id, t.id]
        .filter(Boolean)
        .map((key) => auditsByTree[key as string])
        .find((rows) => rows && rows.length > 0);
      const latestAudit = getLatestAudit(auditRows || []);
      const latestAuditDate = latestAudit?.submitted_at || latestAudit?.survey_date || null;
      list.push({
        ...t,
        status: 'completed',
        completed_at: latestAuditDate || t.completed_at || t.created_at,
        photo_url: latestAudit?.photo_url || t.photo_url,
        tree_condition: latestAudit?.tree_condition || t.tree_condition,
        audit_round: latestAudit?.monitoring_round || t.audit_round || null,
        task_type: latestAudit ? 'audit' : t.task_type,
      });
      seenIds.add(t.id);
      if (t.tree_id) seenIds.add(t.tree_id);
      if (t.tree_record_id) seenIds.add(t.tree_record_id);
    });

    return list.sort((a, b) => {
      const aTime = new Date(a.completed_at || a.created_at || 0).getTime();
      const bTime = new Date(b.completed_at || b.created_at || 0).getTime();
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
  }, [currentTasks, auditsByTree]);

  // One count per tree. A later audit of a tree that is already counted is not another tree.
  const isAuditItem = (item: Task) =>
    item.task_type === 'audit' || !!item.audit_round || String(item.id).startsWith('audit-');
  const treeCounts = useMemo(() => {
    const statusByTree = new Map<string, 'assigned' | 'completed' | 'approved' | 'rejected'>();
    const knownTreeIds = new Set(projectTrees.map((tree) => tree.id));

    projectTrees.forEach((tree) => {
      const linked = tasks.find(
        (task) =>
          !isAuditItem(task) &&
          (task.tree_id === tree.id || task.tree_record_id === tree.id || task.id === tree.id)
      );
      if (!linked && !tree.locked) return;
      if (tree.locked || linked?.status === 'approved') statusByTree.set(tree.id, 'approved');
      else if (linked?.status === 'rejected') statusByTree.set(tree.id, 'rejected');
      else if (linked?.status === 'assigned' || linked?.status === 'in_progress') statusByTree.set(tree.id, 'assigned');
      else if (linked?.status === 'completed') statusByTree.set(tree.id, 'completed');
    });

    tasks.forEach((task) => {
      if (isAuditItem(task)) return;
      const key = task.tree_record_id || task.tree_id || task.id;
      if (!key || knownTreeIds.has(key) || (task.tree_id && knownTreeIds.has(task.tree_id))) return;
      if (task.status === 'approved') statusByTree.set(key, 'approved');
      else if (task.status === 'rejected') statusByTree.set(key, 'rejected');
      else if (task.status === 'completed') statusByTree.set(key, 'completed');
      else if (task.status === 'assigned' || task.status === 'in_progress') statusByTree.set(key, 'assigned');
    });

    let assigned = 0;
    let completed = 0;
    let approved = 0;
    let rejected = 0;
    statusByTree.forEach((status) => {
      if (status === 'assigned') assigned += 1;
      else if (status === 'completed') completed += 1;
      else if (status === 'approved') approved += 1;
      else rejected += 1;
    });
    return { assigned, completed, approved, rejected };
  }, [tasks, projectTrees]);

  const todayKey = localDateKey(new Date());
  const completedTodayCount = tasks.filter((item) => {
    if (item.status !== 'completed' && item.status !== 'approved' && item.status !== 'rejected') return false;
    return localDateKeyFromValue(item.completed_at || item.created_at) === todayKey;
  }).length;
  const assignedCount = completedTodayCount;
  const assignedTotal = assignedItems.length;
  const completedCount = treeCounts.completed;
  const approvedCount = treeCounts.approved;
  const rejectedCount = treeCounts.rejected;
  const reviewedCount = approvedCount + rejectedCount;

  // Date selector — pull dates from active tasks and trees so every tab's date filter works
  const dates = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = localDateKey(today);
    const dateSet = new Set<string>();
    dateSet.add(todayStr);
    projectTasks.forEach((t) => {
      const isAssignedTask = t.status === 'assigned' || t.status === 'in_progress';
      const key = isAssignedTask
        ? localDateKeyFromValue(t.due_date) || localDateKeyFromValue(t.created_at)
        : localDateKeyFromValue(t.reviewed_at) ||
          localDateKeyFromValue(t.completed_at) ||
          localDateKeyFromValue(t.created_at);
      if (key) dateSet.add(key);
    });
    projectTrees.forEach((t) => {
      const key = localDateKeyFromValue(t.survey_date) || localDateKeyFromValue(t.submitted_at);
      if (key) dateSet.add(key);
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
  }, [projectTasks, projectTrees]);

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
      const labeled = splitLabeledTreeName(task.name);
      const token = (labeled.code || task.name.match(/\(([A-Za-z0-9-]+)\)/)?.[1] || '').toLowerCase();
      if (token) {
        treeRecord = trees.find((t) => {
          const labeledTree = splitLabeledTreeName(t.species);
          return (
            t.id.toLowerCase().startsWith(token) ||
            resolveTreeId(t).toLowerCase() === token ||
            labeledTree.code.toLowerCase() === token
          );
        });
      }
    }

    const isAuditTask = (task.task_type === 'audit' || !!task.audit_round) && (task.status === 'assigned' || task.status === 'in_progress');
    const isCompletedAudit = task.status === 'completed' && (task.task_type === 'audit' || !!task.audit_round);
    const targetId = treeRecord?.id || task.tree_record_id || task.tree_id || task.id;
    const labeledId = splitLabeledTreeName(treeRecord?.species || task.name).code;
    const projectTreeId = labeledId
      || (treeRecord ? treeIds[treeRecord.id] || resolveTreeId(treeRecord) || displayTreeId(treeRecord) : undefined);
    const isAssigned = task.status === 'assigned' || task.status === 'in_progress';
    const isRejected = task.status === 'rejected';
    const isApproved = task.status === 'approved';
    // Audit rows may be keyed by the tree record id, the task's tree_record_id,
    // or its tree_id — accept any of them so the card always finds its audits.
    const treeAudits =
      [treeRecord?.id, task.tree_record_id, task.tree_id, task.id]
        .filter(Boolean)
        .map((key) => auditsByTree[key as string])
        .find((rows) => rows && rows.length > 0) || [];
    const isRejectedAudit =
      isRejected && (task.task_type === 'audit' || !!task.audit_round || treeAudits.length > 0);
    const cardTask =
      isRejectedAudit && task.task_type !== 'audit'
        ? { ...task, task_type: 'audit' as const, audit_round: task.audit_round || treeAudits.length || 1 }
        : task;

    const handlePress = () => {
      // An assigned audit opens the tree details first. The audit button on that
      // page starts the audit; the card itself does not open the audit form.
      // A completed or approved audit card also opens the audit profile view.
      navigation.navigate('TreeDetail', {
        treeId: targetId,
        asAuditProfile: isAuditTask || isCompletedAudit || (isApproved && treeAudits.length > 0),
      });
    };

    const handleUpdate = () => {
      if (isRejectedAudit) {
        navigation.navigate('EditTree', {
          treeId: targetId,
          taskId: task.id,
          auditRound: task.audit_round || 1,
          rejectionNotes: task.review_notes || null,
        });
        return;
      }
      navigation.navigate('TreeDetail', {
        treeId: targetId,
        taskId: task.id,
        rejectionNotes: task.review_notes || null,
      });
    };

    return (
      <TreeCard
        key={task.id}
        tree={treeRecord ? { ...treeRecord, locked: isApproved } : null}
        task={cardTask}
        status={isApproved && !isAuditTask ? 'approved' : task.status}
        audits={treeAudits}
        displayId={isAssigned && !isAuditTask ? (task.task_code || undefined) : projectTreeId}
        showSurveyor={false}
        onPress={isAssigned && !isAuditTask ? undefined : handlePress}
        onAction={
          isAssigned && !isAuditTask
            ? () => handleStartTask(task)
            : isRejected
            ? handleUpdate
            : undefined
        }
        actionLabel={
          isAssigned && !isAuditTask
            ? 'Planting'
            : isRejected
            ? 'Edit'
            : undefined
        }
        actionVariant={
          isAssigned && !isAuditTask
            ? 'start'
            : isRejected
            ? 'update'
            : undefined
        }
        onLocationPress={
          ((task.latitude && task.longitude) || (treeRecord?.latitude && treeRecord?.longitude))
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
      {/* Header stays fixed; the rest of the page scrolls */}
      <LinearGradient colors={['#123f24', '#1a5c2a', '#2e7d43']} style={[s.header, { paddingTop: insets.top + 8 }]}>
          <View style={s.headerRow}>
            <View style={s.headerLeft}>
              <Text style={s.headerDate} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{headerDateParts.primary}</Text>
              <Text style={s.headerSub} numberOfLines={1}>{activeProject?.name ?? 'No project selected'}</Text>
            </View>
            <View style={s.headerDivider} />
            <TouchableOpacity
              style={s.headerLocation}
              onPress={() => handleOpenMap(activeProject?.name ?? '')}
              activeOpacity={0.7}
            >
              <View style={s.headerLocationImage}>
                <Ionicons name="map" size={22} color="#fff" />
              </View>
              <Text style={s.headerLocationLabel}>OPEN MAP</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1a5c2a" />}
      >
        {/* Tabs with CircularProgress rings */}
        <View style={s.tabsWrap}>
          <View style={s.tabsRow}>
            {TABS.map((tab) => {
              const active = activeTab === tab.key;
              const openCount = assignedItems.length;
              const doneCount = completedItems.length;
              const approvedCountNow = approvedItems.length;
              const rejectedCountNow = rejectedTasks.length;
              const assignedPool = openCount + doneCount + approvedCountNow + rejectedCountNow;
              const completedPool = doneCount + approvedCountNow + rejectedCountNow;
              const share = (part: number, total: number) =>
                total > 0 ? Math.min(100, (part / total) * 100) : 0;
              // Completed is out of every assigned task. Approved and rejected are
              // out of the tasks the user completed. Assigned fills as its count falls.
              const ratio = (part: number, total: number) =>
                total > 0 ? `${part}/${total}` : String(part);
              const countLabel =
                tab.key === 'assigned'
                  ? String(openCount)
                  : tab.key === 'completed'
                  ? ratio(doneCount, assignedPool)
                  : tab.key === 'approved'
                  ? ratio(approvedCountNow, completedPool)
                  : ratio(rejectedCountNow, completedPool);
              const pct =
                tab.key === 'assigned'
                  ? openCount === 0
                    ? 100
                    : share(assignedPool - openCount, assignedPool)
                  : tab.key === 'completed'
                  ? share(doneCount, assignedPool)
                  : tab.key === 'approved'
                  ? share(approvedCountNow, completedPool)
                  : share(rejectedCountNow, completedPool);
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
                    size={50}
                    progress={pct}
                    color={tab.color}
                    strokeWidth={3.5}
                    trackColor="#E8E8E8"
                  >
                    <Text
                      style={[s.tabCountText, { color: tab.color, fontSize: 10 }]}
                      numberOfLines={1}
                    >
                      {countLabel}
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
              {renderTaskList(filterByDate(assignedItems, 'assigned'))}
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
    paddingBottom: 12,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  headerLeft: { flex: 1 },
  headerDate: { fontSize: 19, fontWeight: '800', color: '#fff' },
  headerSub: { fontSize: 12, fontWeight: '600', color: '#cde8d3', marginTop: 4 },
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
    gap: 5,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#E0ECDD',
  },
  tabBtnActive: {},
  tabText: { fontSize: 11, fontWeight: '800', color: '#888' },
  tabCountText: { fontSize: 11, fontWeight: '800' },
  dateSelectorWrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8, gap: 8 },
  dateAllBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 10,
    minWidth: 52,
    height: 62,
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
    paddingVertical: 8,
    paddingHorizontal: 10,
    minWidth: 52,
    height: 62,
  },
  dateItemActive: { backgroundColor: '#1a5c2a' },
  dateLabel: { fontSize: 9, fontWeight: '800', color: '#888', letterSpacing: 0.5 },
  dateLabelActive: { color: '#fff' },
  dateDay: { fontSize: 16, fontWeight: '800', color: '#222', marginTop: 1 },
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

