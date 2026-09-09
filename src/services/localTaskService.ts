import AsyncStorage from '@react-native-async-storage/async-storage';
import { Task } from '../types';

const LOCAL_TASKS_KEY = '@local_tasks';

export async function loadLocalTasks(): Promise<Task[]> {
  try {
    const stored = await AsyncStorage.getItem(LOCAL_TASKS_KEY);
    if (stored) {
      return JSON.parse(stored) as Task[];
    }
  } catch (error) {
    console.error('[localTaskService] loadLocalTasks error:', error);
  }
  return [];
}

export async function saveLocalTask(task: Task): Promise<void> {
  try {
    const existing = await loadLocalTasks();
    const updated = [task, ...existing];
    await AsyncStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error('[localTaskService] saveLocalTask error:', error);
  }
}

export async function removeLocalTask(taskId: string): Promise<void> {
  try {
    const existing = await loadLocalTasks();
    const updated = existing.filter((t) => t.id !== taskId);
    await AsyncStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error('[localTaskService] removeLocalTask error:', error);
  }
}

export async function clearLocalTasks(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LOCAL_TASKS_KEY);
  } catch (error) {
    console.error('[localTaskService] clearLocalTasks error:', error);
  }
}

export async function saveLocalTasks(tasks: Task[]): Promise<void> {
  try {
    await AsyncStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(tasks));
  } catch (error) {
    console.error('[localTaskService] saveLocalTasks error:', error);
  }
}

export function makeLocalTask(options: {
  name: string;
  target_count: number;
  location?: string;
  priority?: 'high' | 'medium' | 'low';
  due_date?: string;
}): Task {
  return {
    id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name: options.name,
    assignee_id: '',
    target_count: options.target_count,
    location: options.location,
    priority: options.priority ?? 'medium',
    due_date: options.due_date ?? null,
    created_at: new Date().toISOString(),
    captured: 0,
    remaining: options.target_count,
    progress: 0,
    status: 'assigned',
  };
}

export function refreshLocalProgress(tasks: Task[], allTrees: Task[]): Task[] {
  return tasks.map((task) => {
    const captured = allTrees.filter(
      (t) => t.project_id === task.project_id
    ).length;
    const remaining = Math.max(0, task.target_count - captured);
    const progress = task.target_count > 0 ? (captured / task.target_count) * 100 : 0;
    const status = progress >= 100 ? 'completed' : captured > 0 ? 'in_progress' : 'assigned';
    return { ...task, captured, remaining, progress, status };
  });
}

export function isLocalTask(task: Task): boolean {
  return task.id.startsWith('local_');
}
