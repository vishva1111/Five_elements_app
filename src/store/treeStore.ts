import { create } from 'zustand';
import { TreeRecord, TreeState } from '../types';

export const useTreeStore = create<TreeState>((set) => ({
  trees: [],

  setTrees: (trees: TreeRecord[]) => set({ trees }),
  addTree: (tree: TreeRecord) =>
    set((state) => ({ trees: [tree, ...state.trees] })),
}));