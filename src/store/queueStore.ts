/**
 * queueStore — the pending-capture count behind the sync badge.
 *
 * The badge is the single most important trust element in the field app
 * (FRD #3 §5): it is what tells Priya her work is held safely, so it must be
 * visible from every screen and must never lag behind the real queue.
 */
import { create } from 'zustand';
import { pendingCount, syncQueue } from '../services/captureQueue';

interface QueueState {
  pending: number;
  syncing: boolean;
  /** Re-read the on-disk queue. Cheap; safe to call often. */
  refresh: () => Promise<void>;
  /**
   * Drain the queue, then refresh the count. Used on app foreground and after
   * a capture — there is no connectivity listener in this build, so these are
   * the moments we know are worth a retry.
   */
  drain: () => Promise<void>;
}

export const useQueueStore = create<QueueState>((set, get) => ({
  pending: 0,
  syncing: false,

  refresh: async () => {
    try {
      set({ pending: await pendingCount() });
    } catch {
      /* a badge that fails to update must not break the screen behind it */
    }
  },

  drain: async () => {
    if (get().syncing) return;
    set({ syncing: true });
    try {
      await syncQueue();
    } catch {
      /* failures are recorded per entry inside syncQueue */
    } finally {
      set({ syncing: false });
      await get().refresh();
    }
  },
}));
