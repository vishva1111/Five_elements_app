import { create } from 'zustand';
import { TreeRecord, TreeState } from '../types';

export const useTreeStore = create<TreeState>((set) => ({
  trees: [],

  setTrees: (trees: TreeRecord[]) => set({ trees }),
  addTree: (tree: TreeRecord) =>
    set((state) => {
      // If tree already exists (same id), update it instead of duplicating
      const exists = state.trees.find((t) => t.id === tree.id);
      if (exists) {
        return {
          trees: state.trees.map((t) => (t.id === tree.id ? tree : t)),
        };
      }
      return { trees: [tree, ...state.trees] };
    }),
  updateTree: (id: string, updates: Partial<TreeRecord>) =>
    set((state) => ({
      trees: state.trees.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),
  removeTree: (id: string) =>
    set((state) => ({
      trees: state.trees.filter((t) => t.id !== id),
    })),
}));