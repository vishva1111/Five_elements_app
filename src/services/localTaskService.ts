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
