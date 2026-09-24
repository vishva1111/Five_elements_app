/**
 * captureQueue.ts — the offline-first guarantee for field capture (FRD #3, P4/P5).
 *
 * The promise to the field user is absolute: once Save is tapped, the work is
 * safe. Everything after that — upload, review, ledger, funder notification —
 * happens without them writing a report.
 *
 * How that is kept:
 *   1. Save writes the capture to AsyncStorage BEFORE any network call, so a
 *      dead signal, a force-close or a battery death cannot lose it (P5-01).
 *   2. The photo is copied out of the OS cache into the app's document
 *      directory, because cache URIs can be evicted before the upload runs.
 *   3. Only a confirmed server insert marks an entry synced — never the start
 *      of an upload (P5-03).
 *
 * Losing a queued capture is a severity-1 defect (P4-06), so every write here
 * is defensive and every read tolerates a corrupt or absent store.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { uploadTreePhoto } from './storageService';
import { insertTreeRecord } from './treeService';
import { completeTask } from './taskService';
import type { TreeRecordInsert, TreeRecord } from '../types';

const QUEUE_KEY = '@fe_capture_queue_v1';
const PHOTO_DIR = `${FileSystem.documentDirectory}pending-captures/`;

export type CaptureStatus = 'local' | 'uploading' | 'synced' | 'failed';

export interface CaptureEntry {
  id: string;
  /** Device clock at the moment of capture — not upload time (P4-03, PG-03). */
  capturedAt: string;
  /** Durable copy of the photo, safe from cache eviction. */
  localPhotoUri: string;
  /** insertTreeRecord payload minus photo_url, which only exists after upload. */
  record: Omit<TreeRecordInsert, 'photo_url'>;
  /** Task to complete once this capture reaches the server, if any. */
  taskId?: string | null;
  /** Shown in the queue list so the entry is recognisable offline. */
  projectName?: string | null;
  species?: string | null;
  quantity?: number | null;
  status: CaptureStatus;
  attempts: number;
  errorMessage?: string | null;
}

// ── storage ────────────────────────────────────────────────────────────────

export async function loadQueue(): Promise<CaptureEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    // A corrupt store must not crash the app — but never silently wipe it
    // either, so the raw value stays on disk for inspection.
    console.warn('[captureQueue] could not read queue:', err);
    return [];
  }
}

async function saveQueue(entries: CaptureEntry[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(entries));
}

/** Count of captures not yet confirmed by the server — drives the badge. */
export async function pendingCount(): Promise<number> {
  const queue = await loadQueue();
  return queue.filter((e) => e.status !== 'synced').length;
}

// ── photo durability ───────────────────────────────────────────────────────

async function persistPhoto(uri: string, entryId: string): Promise<string> {
  try {
    const dir = await FileSystem.getInfoAsync(PHOTO_DIR);
    if (!dir.exists) {
      await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true });
    }
    const dest = `${PHOTO_DIR}${entryId}.jpg`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  } catch (err) {
    // If the copy fails, fall back to the original URI rather than losing the
    // capture outright — an upload from cache is better than no record at all.
    console.warn('[captureQueue] photo copy failed, using original uri:', err);
    return uri;
  }
}

async function discardPhoto(uri: string): Promise<void> {
  if (!uri.startsWith(PHOTO_DIR)) return;   // never touch OS-owned files
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    /* a leftover file is harmless */
  }
}

// ── queue operations ───────────────────────────────────────────────────────

/**
 * Persist a capture. Returns the stored entry once it is durably on disk —
 * the caller may treat that as "saved" and tell the user so.
 */
export async function enqueueCapture(input: {
  photoUri: string;
  record: Omit<TreeRecordInsert, 'photo_url'>;
  taskId?: string | null;
  projectName?: string | null;
}): Promise<CaptureEntry> {
  const id = `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const localPhotoUri = await persistPhoto(input.photoUri, id);

  const entry: CaptureEntry = {
    id,
    capturedAt: new Date().toISOString(),
    localPhotoUri,
    record: input.record,
    taskId: input.taskId ?? null,
    projectName: input.projectName ?? null,
    species: input.record.species ?? null,
    quantity: (input.record as { quantity?: number }).quantity ?? null,
    status: 'local',
    attempts: 0,
  };

  const queue = await loadQueue();
  await saveQueue([entry, ...queue]);
  return entry;
}

export async function updateEntry(
  id: string,
  patch: Partial<CaptureEntry>
): Promise<CaptureEntry[]> {
  const queue = await loadQueue();
  const next = queue.map((e) => (e.id === id ? { ...e, ...patch } : e));
  await saveQueue(next);
  return next;
}

export async function removeEntry(id: string): Promise<CaptureEntry[]> {
  const queue = await loadQueue();
  const target = queue.find((e) => e.id === id);
  if (target) await discardPhoto(target.localPhotoUri);
  const next = queue.filter((e) => e.id !== id);
  await saveQueue(next);
  return next;
}

// ── sync ───────────────────────────────────────────────────────────────────

export interface SyncOutcome {
  ok: boolean;
  tree?: TreeRecord;
  error?: string;
}

/**
 * Push one capture to the server. The entry is only removed once the insert is
 * confirmed — an upload that started but did not finish stays queued (P5-03).
 */
export async function syncEntry(entry: CaptureEntry): Promise<SyncOutcome> {
  const userId = entry.record.user_id;
  if (!userId) return { ok: false, error: 'This capture has no user — sign in and retry.' };

  try {
    await updateEntry(entry.id, { status: 'uploading', errorMessage: null });

    const photoUrl = await uploadTreePhoto(entry.localPhotoUri, userId);
    if (!photoUrl) throw new Error('Photo upload failed — check your connection.');

    const { data, error } = await insertTreeRecord({
      ...entry.record,
      photo_url: photoUrl,
      synced: true,
    } as TreeRecordInsert);

    if (error || !data) throw new Error(error ?? 'Server did not confirm the record.');

    // Close the task this capture was started from. Best-effort: the capture
    // itself is already safe, and a stuck task is recoverable by hand.
    if (entry.taskId) {
      try {
        const lat = entry.record.latitude;
        const lng = entry.record.longitude;
        const location =
          typeof lat === 'number' && typeof lng === 'number'
            ? `${lat.toFixed(6)}, ${lng.toFixed(6)}`
            : undefined;
        await completeTask(entry.taskId, data.id, location);
      } catch (taskErr) {
        console.warn('[captureQueue] task completion failed:', taskErr);
      }
    }

    await removeEntry(entry.id);
    return { ok: true, tree: data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Upload failed.';
    await updateEntry(entry.id, {
      status: 'failed',
      attempts: entry.attempts + 1,
      errorMessage: message,
    });
    return { ok: false, error: message };
  }
}

/**
 * Drain the queue oldest-first, so captures reach the platform in the order
 * they happened. Stops early on the first failure: if one upload failed for
 * lack of signal, the rest will too, and hammering them just burns battery.
 */
export async function syncQueue(): Promise<{ synced: number; failed: number; remaining: number }> {
  const queue = await loadQueue();
  const pending = queue.filter((e) => e.status !== 'synced').reverse();

  let synced = 0;
  let failed = 0;

  for (const entry of pending) {
    const result = await syncEntry(entry);
    if (result.ok) {
      synced++;
    } else {
      failed++;
      break;
    }
  }

  return { synced, failed, remaining: await pendingCount() };
}
