import { create } from 'zustand';
import { TaskState, Task } from '../types';

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  localTasks: [],
  setTasks: (tasks: Task[]) => set({ tasks }),
  setLocalTasks: (localTasks: Task[]) => set({ localTasks }),
}));