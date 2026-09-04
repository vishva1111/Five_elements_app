import AsyncStorage from '@react-native-async-storage/async-storage';
import { Task, TreeRecord } from '../types';

const LOCAL_TASKS_KEY = 'treeapp_local_tasks';
const LOCAL_TASK_PREFIX = 'local_';

// ─── Check if a task is a local (on-device) task ──────────────────────────────
export function isLocalTask(task: Task): boolean {
  return task.id.startsWith(LOCAL_TASK_PREFIX);
}

// ─── Create a new local task ───────────────────────────────────────────────────
export function makeLocalTask(opts: {
  name: string;
  target_count: number;
  location?: string;
  priority?: 'high' | 'medium' | 'low';
  due_date?: string;
  project_id?: string;
}): Task {
  const id = `${LOCAL_TASK_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: opts.name,
    project_id: opts.project_id,
    assignee_id: 'local',
    target_count: opts.target_count,
    location: opts.location,
    priority: opts.priority ?? 'medium',
    due_date: opts.due_date ?? null,
    started_at: null,
    created_at: new Date().toISOString(),
    captured: 0,
    remaining: opts.target_count,
    progress: 0,
    status: 'assigned',
  };
}

// ─── Refresh a local task's progress from real tree captures ──────────────────
// Only trees captured AFTER the task's started_at count toward progress.
// This prevents pre-existing captures from inflating progress before Start.
export function refreshLocalProgress(task: Task, trees: TreeRecord[]): Task {
  const startedAt = task.started_at ? new Date(task.started_at).getTime() : null;

  const relevant = trees.filter((t) => {
    // If task has a project, only count trees in that project
    if (task.project_id && t.project_id !== task.project_id) return false;
    // Only count trees captured after the task was started
    if (startedAt) {
      const capturedAt = new Date(t.submitted_at).getTime();
      return capturedAt >= startedAt;
    }
    return false; // task not started yet — no progress
  });

  const captured = relevant.length;
  const target = task.target_count;
  const progress = Math.min(100, Math.round((captured / Math.max(1, target)) * 100));
  const remaining = Math.max(0, target - captured);
  const status: Task['status'] =
    captured >= target ? 'completed' : task.started_at ? 'in_progress' : 'assigned';

  return { ...task, captured, remaining, progress, status };
}

// ─── Persist local tasks to AsyncStorage ──────────────────────────────────────
export async function saveLocalTasks(tasks: Task[]): Promise<void> {
  try {
    await AsyncStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(tasks));
  } catch {
    // Best-effort — ignore failures
  }
}

// ─── Load local tasks from AsyncStorage ───────────────────────────────────────
export async function loadLocalTasks(): Promise<Task[]> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_TASKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Task[];
    // Ensure all loaded tasks have the local prefix (safety check)
    return parsed.filter((t) => isLocalTask(t));
  } catch {
    return [];
  }
}