import { create } from 'zustand';

/**
 * Global "refresh key" store.
 *
 * When the active project changes, call `triggerProjectRefresh()`.
 * Every screen that depends on the active project subscribes to
 * `refreshKey` via a `useEffect` and re-fetches its data.
 *
 * This is the fastest pattern — no navigation round-trips, no
 * polling, no prop-drilling. The update is synchronous in the
 * Zustand store and each screen's useEffect fires in the same
 * JS microtask batch.
 */
interface ProjectRefreshState {
  refreshKey: number;
  triggerProjectRefresh: () => void;
}

export const useProjectRefreshStore = create<ProjectRefreshState>((set) => ({
  refreshKey: 0,
  triggerProjectRefresh: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
}));
