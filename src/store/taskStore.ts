import { create } from 'zustand';
import { Task, TaskState } from '../types';

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  setTasks: (tasks: Task[]) => set({ tasks }),
  activeTaskId: null,
  setActiveTaskId: (taskId: string | null) => set({ activeTaskId: taskId }),
  pendingTaskTab: null,
  pendingTaskTabAt: 0,
  openTaskTab: (tab) => set({ pendingTaskTab: tab, pendingTaskTabAt: tab ? Date.now() : 0 }),
}));
