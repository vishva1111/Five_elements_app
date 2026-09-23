import { create } from 'zustand';
import { Task, TaskState } from '../types';

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  localTasks: [],
  setTasks: (tasks: Task[]) => set({ tasks }),
  setLocalTasks: (localTasks: Task[]) => set({ localTasks }),
  activeTaskId: null,
  setActiveTaskId: (taskId: string | null) => set({ activeTaskId: taskId }),
}));
