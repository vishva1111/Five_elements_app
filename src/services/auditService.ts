import { supabase } from './supabase';
import {
  TreeRecord,
  TreeCondition,
  ApiResponse,
} from '../types';
import {
  fetchTreeMonitoringRecords,
  fetchMonitoringRecordsForTrees,
  insertMonitoringRecord,
  updateTreeFromMonitoring,
  isMissingSchemaError,
} from './treeService';
import { uploadTreePhoto } from './storageService';
import { resolveTreeId } from '../utils/treeId';

// ─── Audit schedule constants ────────────────────────────────────────────────
// TESTING: each audit is due 30 minutes after the previous one.
// Production schedule is every 3 months (4 rounds over 1 year).
export const AUDITS_PER_YEAR = 4;
export const AUDIT_INTERVAL_MONTHS = 3;
export const AUDIT_INTERVAL_MINUTES = 30;
export const MAX_AUDIT_ROUND = 4;

// ─── Pure date helpers ───────────────────────────────────────────────────────

/** Add N hours to a date. */
export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

/** Add N minutes to a date. */
export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

/** Add N months to a date (calendar-safe: Jan 31 + 1mo → Feb 28). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1); // avoid overflow past month end
  d.setMonth(d.getMonth() + months);
  // Restore day, clamped to target month length
  const daysInTarget = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, daysInTarget));
  return d;
}

/** Parse survey_date (YYYY-MM-DD) or submitted_at (ISO) into a Date. */
export function parseAuditDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  // Date-only strings: parse as local midnight (not UTC) so +3mo stays correct
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, day] = value.split('-').map(Number);
    if (!y || !m || !day) return null;
    return new Date(y, m - 1, day);
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDateFriendly(value: string | Date | null | undefined): string {
  const d = value instanceof Date ? value : parseAuditDate(value as string);
  if (!d) return '—';
  const hasTime = d.getHours() > 0 || d.getMinutes() > 0;
  if (hasTime) {
    return d.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ─── Audit status (computed — never stored) ──────────────────────────────────

export interface AuditStatus {
  /** Rounds completed (count of monitoring records). */
  completedCount: number;
  /** Highest round number recorded (1..4); 0 if none. */
  maxRound: number;
  /** Round the user should fill next (1..4). */
  currentRound: number;
  /** Round that will be scheduled after currentRound is submitted. */
  nextRound: number;
  /** When the next audit is (or should be) due. */
  nextDate: Date | null;
  /** True when nextDate is today or in the past (and cycle not finished). */
  isDue: boolean;
  /** Days until due (negative = overdue). null when no date. */
  daysUntil: number | null;
  /** True when nextDate has passed. */
  isOverdue: boolean;
  /** True when all 4 rounds are completed — no repeating! */
  allCompleted?: boolean;
}

interface MonitoringLike {
  monitoring_round?: number | null;
  survey_date?: string | null;
  submitted_at?: string | null;
}

/**
 * Compute audit schedule from monitoring records + the original tree record.
 * Single source of truth — never store next_audit_date.
 */
export function getAuditStatus(
  tree: { submitted_at?: string | null } | null | undefined,
  records: MonitoringLike[] | null | undefined
): AuditStatus {
  const list = (records ?? []).filter((r) => r && typeof r.monitoring_round === 'number');
  const completedCount = list.length;

  let maxRound = 0;
  let lastDate: Date | null = null;

  for (const r of list) {
    const round = Number(r.monitoring_round) || 0;
    if (round > maxRound) maxRound = round;
    const d = parseAuditDate(r.submitted_at) ?? parseAuditDate(r.survey_date);
    if (d && (!lastDate || d.getTime() > lastDate.getTime())) lastDate = d;
  }

  // Planting does not start the audit clock. The next interval begins only
  // after an audit record exists, and only an admin-assigned task opens it.

  // 1 -> 2 -> 3 -> 4 progression. No repeating completed audits!
  const completedRounds = new Set(list.map((r) => Number(r.monitoring_round)).filter(Boolean));
  let currentRound = 1;
  let allCompleted = false;

  if (completedRounds.has(1) && completedRounds.has(2) && completedRounds.has(3) && completedRounds.has(4)) {
    allCompleted = true;
    currentRound = 4;
  } else {
    for (let r = 1; r <= 4; r++) {
      if (!completedRounds.has(r)) {
        currentRound = r;
        break;
      }
    }
  }

  const nextRound = currentRound >= 4 ? 4 : currentRound + 1;

  const now = new Date();
  let nextDate: Date | null = null;
  if (!allCompleted) {
    nextDate = lastDate || now;
  }

  let daysUntil: number | null = null;
  let isDue = false;
  let isOverdue = false;

  if (nextDate) {
    const diffMs = nextDate.getTime() - now.getTime();
    daysUntil = Math.round(diffMs / 86_400_000);
    isDue = diffMs <= 0;
    isOverdue = diffMs < 0;
  }

  return {
    completedCount,
    maxRound,
    currentRound,
    nextRound,
    nextDate,
    isDue,
    daysUntil,
    isOverdue,
    allCompleted,
  };
}

/** Human label for due state. */
export function getDueLabel(status: AuditStatus): string {
  if (status.allCompleted) return 'All 4 audits completed';
  if (!status.nextDate) return 'No schedule yet';

  const diffMinutes = Math.round((status.nextDate.getTime() - Date.now()) / 60_000);

  // 1. Overdue (Red) — minute precision while the 30-minute test interval is on.
  if (diffMinutes < 0) {
    const overdueMinutes = Math.abs(diffMinutes);
    if (overdueMinutes === 1) return '1 min overdue';
    return `${overdueMinutes} min overdue`;
  }

  // 2. Due now (Green)
  if (diffMinutes === 0) {
    return 'Audit Now';
  }

  // 3. Remaining time (Blue)
  if (diffMinutes === 1) {
    return '1 min remaining';
  }
  return `${diffMinutes} min remaining`;
}

// ─── Submit an audit (orchestration) ─────────────────────────────────────────

export interface SubmitAuditParams {
  tree: TreeRecord;
  round: number;
  userId: string;
  projectId?: string | null;
  /** Local file URI of the PRIMARY (first) audit photo (captured this visit). */
  photoUri?: string | null;
  /** All 3 audit photo URIs — first becomes photo_url, all stored in photo_urls. */
  photoUris?: string[] | null;
  dbhCm?: number | null;
  heightM?: number | null;
  crownDiameterM?: number | null;
  woodDensity?: number | null;
  ageYears?: number | null;
  multiStem?: string | null;
  treeCondition?: TreeCondition;
  survivalStatus?: 'alive' | 'dead' | 'missing';
  notes?: string;
  surveyor?: string;
  /** YYYY-MM-DD; defaults to today. */
  surveyDate?: string;
}

export interface SubmitAuditResult {
  ok: boolean;
  error?: string;
  auditRecord?: any;
  /** Schedule after this submit. */
  nextRound: number;
  nextDate: string | null;
  /** Auto-created task for the next audit (null if skipped/failed). */
  nextTask?: any;
  taskSkippedReason?: string;
}

/**
 * Postgres reports `column tasks.notes does not exist` — pull the column name
 * out so it can be dropped and the insert retried (the same technique
 * insertTreeRecord / fetchMyTrees use for pre-migration databases).
 */
function missingColumnFromMessage(message?: string | null): string | null {
  const match = String(message ?? '').match(/column\s+(?:\w+\.)?"?([A-Za-z_][\w]*)"?\s+does not exist/i);
  return match ? match[1] : null;
}

/**
 * Insert the next-audit task, dropping any column this database does not have
 * yet (tasks.notes / tasks.tree_record_id / tasks.audit_round until the
 * migration is applied). The task itself is important — it is what the field
 * user sees for the next audit — so it is never skipped just because an
 * optional column is missing.
 */
async function insertNextAuditTask(
  payload: Record<string, any>
): Promise<{ data?: any; error?: any; droppedColumns: string[] }> {
  const attempt: Record<string, any> = { ...payload };
  const droppedColumns: string[] = [];

  for (let tries = 0; tries < 4; tries += 1) {
    const { data, error } = await supabase.from('tasks').insert(attempt).select().single();
    if (!error) return { data, droppedColumns };

    const missing = missingColumnFromMessage(error.message);
    if (missing && missing in attempt) {
      delete attempt[missing];
      droppedColumns.push(missing);
      continue;
    }
    return { error, droppedColumns };
  }

  return {
    error: { message: `tasks insert failed (unsupported columns: ${droppedColumns.join(', ')})` },
    droppedColumns,
  };
}

/**
 * Auto-assign an audit task for a tree whose audit time is NOW.
 * Avoids duplicate insertion if a task for this tree + round already exists.
 */
export async function ensureAuditTaskForTree(params: {
  tree: TreeRecord;
  round: number;
  userId: string;
  dueDate: Date;
  isOverdue?: boolean;
}): Promise<{ task?: any; error?: any }> {
  const { tree, round, userId, dueDate, isOverdue } = params;

  try {
    // 1. A task already open, or already completed, for this tree and round
    //    must not be created again as Assigned.
    const { data: existing } = await supabase
      .from('tasks')
      .select('id, status, audit_round, tree_id, tree_record_id')
      .or(`tree_record_id.eq.${tree.id},tree_id.eq.${tree.id}`)
      .in('status', ['assigned', 'in_progress', 'completed', 'approved'])
      .limit(10);

    const match = (existing ?? []).find((t: any) => {
      const taskRound = Number(t.audit_round);
      return taskRound === round || (!taskRound && (t.status === 'assigned' || t.status === 'in_progress'));
    });

    if (match) {
      return { task: match };
    }
  } catch {
    // Fall through to insert if columns not yet supported in select
  }

  // 2. Build and insert the assigned audit task
  const resolvedId = resolveTreeId(tree);
  const taskTitle = `Audit Round #${round} — ${tree.species || 'Tree'} (${resolvedId})`;
  const locationStr =
    tree.latitude && tree.longitude
      ? `${tree.latitude.toFixed(6)}, ${tree.longitude.toFixed(6)}`
      : undefined;

  const payload: Record<string, any> = {
    name: taskTitle,
    title: taskTitle,
    project_id: tree.project_id,
    assignee_id: userId,
    target_count: 1,
    remaining: 1,
    captured: 0,
    progress: 0,
    status: 'assigned',
    priority: isOverdue ? 'high' : 'medium',
    location: locationStr,
    tree_id: tree.id,
    tree_record_id: tree.id,
    audit_round: round,
    task_type: 'audit',
    due_date: dueDate.toISOString(),
    notes: `Scheduled field audit for Round #${round}.`,
  };

  const { data, error } = await insertNextAuditTask(payload);
  return { task: data, error };
}

/**
 * Submit one audit:
 *  1. Upload new photo (or reuse original as fallback)
 *  2. Insert monitoring record (the audit row)
 *  3. Update the main tree with latest measurements
 *  4. Auto-create a task for the NEXT audit (due = +30 minutes while testing)
 */
export async function submitAudit(params: SubmitAuditParams): Promise<SubmitAuditResult> {
  const {
    tree,
    round,
    userId,
    projectId,
    photoUri,
    photoUris,
    dbhCm,
    heightM,
    crownDiameterM,
    woodDensity,
    ageYears,
    multiStem,
    treeCondition = 'Healthy',
    survivalStatus = 'alive',
    notes,
    surveyor,
    surveyDate,
  } = params;

  const clampedRound = Math.min(Math.max(1, Math.round(round)), MAX_AUDIT_ROUND);
  const liveTreeId = resolveTreeId(tree) || tree.tree_id || '';
  const dateStr = surveyDate || formatDateISO(new Date());

  // 1. Photo: prefer the new capture(s); fall back to the original tree photo
  //    If multiple audit photos are provided, upload all — first becomes photo_url.
  let photoUrl = tree.photo_url || undefined;
  let allAuditPhotoUrls: string[] | undefined;

  const urisToUpload = (photoUris && photoUris.length > 0)
    ? photoUris.filter(Boolean) as string[]
    : photoUri
    ? [photoUri]
    : [];

  if (urisToUpload.length > 0) {
    const uploaded: string[] = [];
    for (const uri of urisToUpload) {
      // Photos kept from a previous visit are already hosted. uploadTreePhoto
      // only reads local files, so pass those URLs straight through instead of
      // dropping them — this keeps the full 3-photo set on the audit record.
      if (/^https?:\/\//i.test(uri)) {
        uploaded.push(uri);
        continue;
      }
      const url = await uploadTreePhoto(uri, userId);
      if (url) uploaded.push(url);
    }
    if (uploaded.length > 0) {
      photoUrl = uploaded[0]; // primary
      allAuditPhotoUrls = uploaded;
    }
    // upload failed for all → keep original (audit still saves)
  }

  const health =
    survivalStatus === 'dead' ? 'dead' : survivalStatus === 'missing' ? 'unknown' : 'healthy';

  const {
    data: auditRecord,
    error: monitorError,
  } = await insertMonitoringRecord({
    tree_record_id: tree.id,
    tree_id: liveTreeId,
    monitoring_round: clampedRound,
    user_id: userId,
    project_id: projectId ?? tree.project_id,
    photo_url: photoUrl,
    // Store all 3 audit photos if available
    ...(allAuditPhotoUrls && allAuditPhotoUrls.length > 1 ? { photo_urls: allAuditPhotoUrls } : {}),
    latitude: tree.latitude,
    longitude: tree.longitude,
    dbh_cm: dbhCm ?? undefined,
    height_m: heightM ?? undefined,
    crown_diameter_m: crownDiameterM ?? undefined,
    wood_density: woodDensity ?? undefined,
    age_years: ageYears ?? undefined,
    multi_stem: multiStem ?? undefined,
    tree_condition: treeCondition,
    health_status: health,
    survival_status: survivalStatus,
    notes: notes?.trim() || undefined,
    surveyor: surveyor?.trim() || undefined,
    survey_date: dateStr,
  });

  if (monitorError) {
    return {
      ok: false,
      error: monitorError,
      nextRound: clampedRound,
      nextDate: null,
    };
  }

  // 3. Mirror latest values onto the main tree record
  const treeUpdates: any = {};
  if (survivalStatus === 'dead') {
    treeUpdates.tree_condition = 'Dead';
    treeUpdates.health_status = 'dead';
  } else if (survivalStatus === 'missing') {
    treeUpdates.health_status = 'unknown';
  } else {
    treeUpdates.dbh_cm = dbhCm ?? tree.dbh_cm;
    treeUpdates.height_m = heightM ?? tree.height_m;
    treeUpdates.crown_diameter_m = crownDiameterM ?? tree.crown_diameter_m;
    treeUpdates.wood_density = woodDensity ?? tree.wood_density;
    treeUpdates.age_years = ageYears ?? (tree as any).age_years;
    treeUpdates.multi_stem = multiStem ?? (tree as any).multi_stem;
    treeUpdates.tree_condition = treeCondition;
    treeUpdates.health_status = 'healthy';
    if (surveyor?.trim()) treeUpdates.surveyor = surveyor.trim();
  }
  treeUpdates.survey_date = dateStr;
  // The task list rebuilds a card from this tree row. Leaving stage as the
  // plantation job makes the audited card look assigned again.
  treeUpdates.stage = 'completed';
  treeUpdates.status = 'completed';
  try {
    await updateTreeFromMonitoring(tree.id, treeUpdates);
  } catch (treeUpdateErr) {
    console.warn('[auditService] tree update after audit failed:', treeUpdateErr);
  }

  // 4. Close the assigned task for THIS round so it leaves the Assigned tab
  //    and appears as completed for the partner panel. The select tries the
  //    linked columns first and falls back to base columns only, so it still works
  //    on a database that has not run migration 001 (tasks.tree_record_id /
  //    tasks.audit_round missing). Without this, the assigned audit card never
  //    moves to Completed and a duplicate completed card is written instead.
  try {
    let openTasks: any[] = [];
    const treeKeys = [...new Set([tree.id, liveTreeId].filter(Boolean))];
    const taskFilters = [
      treeKeys.map((id) => `tree_record_id.eq.${id},tree_id.eq.${id}`).join(','),
      treeKeys.map((id) => `tree_id.eq.${id}`).join(','),
    ];
    const selectColumns = [
      'id, status, audit_round, tree_id, tree_record_id',
      'id, status, audit_round, tree_id',
      'id, status, tree_id',
      'id, status',
    ];
    for (const columns of selectColumns) {
      let found = false;
      for (const filter of taskFilters) {
        const res = await supabase
          .from('tasks')
          .select(columns)
          .or(filter)
          .in('status', ['assigned', 'in_progress', 'rejected'])
          .limit(20);
        if (!res.error) {
          openTasks = (res.data ?? []) as any[];
          found = true;
          break;
        }
      }
      if (found) break;
    }

    const matching = openTasks.filter((task: any) => {
      const taskRound = Number(task.audit_round);
      return !taskRound || taskRound === clampedRound;
    });

    const completedAt = new Date().toISOString();
    const rejectedIds = matching
      .filter((task: any) => task.status === 'rejected')
      .map((task: any) => task.id);
    const finishedIds = matching
      .filter((task: any) => task.status !== 'rejected')
      .map((task: any) => task.id);
    if (finishedIds.length > 0) {
      await supabase
        .from('tasks')
        .update({ status: 'completed', completed_at: completedAt })
        .in('id', finishedIds);
    }
    // A rejected card that was edited is the only completed card marked orange.
    if (rejectedIds.length > 0) {
      await supabase
        .from('tasks')
        .update({ status: 'completed', completed_at: completedAt, review_notes: 'edited' })
        .in('id', rejectedIds);
    }
  } catch (closeErr) {
    console.warn('[auditService] close current audit task failed:', closeErr);
  }

  // The next round is not created here. An admin assigns it after approving this one.
  const nextRound = clampedRound >= MAX_AUDIT_ROUND ? clampedRound : clampedRound + 1;
  const nextDateStr = null;
  const nextTask = null;
  const taskSkippedReason = undefined;

  return {
    ok: true,
    auditRecord,
    nextRound,
    nextDate: nextDateStr,
    nextTask,
    taskSkippedReason,
  };
}

// ─── Fetch helpers for Audit tab / History ───────────────────────────────────

/** Monitoring records for several trees, keyed by tree_record_id. */
export async function fetchAuditsForTrees(
  treeIds: string[]
): Promise<Record<string, any[]>> {
  return fetchMonitoringRecordsForTrees(treeIds);
}

export interface TreeAuditSummary {
  tree: TreeRecord;
  status: AuditStatus;
  records: any[];
}

/**
 * Group trees by which audit round they are due for (or belong to when
 * viewing a completed round).
 * - mode 'due': trees whose currentRound === round (ready to fill)
 * - mode 'done': trees that already have a record for that round
 */
export function groupTreesByAuditRound(
  trees: TreeRecord[],
  auditsByTree: Record<string, any[]>,
  round: number,
  mode: 'due' | 'done' = 'due'
): TreeAuditSummary[] {
  const summaries: TreeAuditSummary[] = [];

  for (const tree of trees) {
    const records = auditsByTree[tree.id] ?? [];
    const status = getAuditStatus(tree, records);

    if (mode === 'due') {
      if (status.currentRound === round) {
        summaries.push({ tree, status, records });
      }
    } else {
      const hasRound = records.some((r) => Number(r.monitoring_round) === round);
      if (hasRound) summaries.push({ tree, status, records });
    }
  }

  // Due soonest first (overdue first), then by tree id
  summaries.sort((a, b) => {
    const da = a.status.daysUntil ?? 9999;
    const db = b.status.daysUntil ?? 9999;
    if (da !== db) return da - db;
    return (a.tree.tree_id ?? '').localeCompare(b.tree.tree_id ?? '');
  });

  return summaries;
}

// ─── Photo timeline (planting → every audit) ─────────────────────────────────
// One place decides which photo is "the" photo of a tree. The tree card shows
// the last entry (the updated photo) on top and keeps the earlier ones behind
// it; the detail page walks the whole list.

export interface TreePhotoEntry {
  /** Stable key for lists — the audit record id, or 'planting'. */
  key: string;
  /** 'Planting' | 'Audit 1' … 'Audit 4'. */
  label: string;
  /** 0 = planting photo, 1..4 = audit round that took it. */
  round: number;
  /** survey_date / submitted_at of that visit. */
  date: string | null;
  uri: string;
}

interface TreePhotoSource {
  photo_url?: string | null;
  submitted_at?: string | null;
}

function photoTime(value?: string | null): number {
  return parseAuditDate(value)?.getTime() ?? 0;
}

/**
 * Every photo of the tree in chronological order: the planting photo first,
 * then each audit that carried a photo. The last entry is the tree's current
 * (updated) photo.
 */
export function getTreePhotoTimeline(
  tree: TreePhotoSource | null | undefined,
  records: MonitoringLike[] | null | undefined
): TreePhotoEntry[] {
  const entries: { entry: TreePhotoEntry; time: number; order: number }[] = [];

  if (tree?.photo_url) {
    entries.push({
      entry: {
        key: 'planting',
        label: 'Planting',
        round: 0,
        date: tree.submitted_at ?? null,
        uri: tree.photo_url,
      },
      time: photoTime(tree.submitted_at),
      order: 0,
    });
  }

  (records ?? []).forEach((record, index) => {
    const raw = record as any;
    if (!raw?.photo_url) return;
    const round = Number(raw.monitoring_round) || 1;
    const date = raw.survey_date ?? raw.submitted_at ?? null;
    entries.push({
      entry: {
        key: raw.id ? String(raw.id) : `audit-${round}-${index}`,
        label: `Audit ${round}`,
        round,
        date,
        uri: raw.photo_url,
      },
      time: photoTime(date),
      order: index + 1,
    });
  });

  return entries
    .sort((a, b) => (a.time - b.time) || (a.order - b.order))
    .map((item) => item.entry);
}

/** The updated (most recent) photo of a tree, or null when it has none. */
export function getLatestTreePhoto(
  tree: TreePhotoSource | null | undefined,
  records: MonitoringLike[] | null | undefined
): TreePhotoEntry | null {
  const timeline = getTreePhotoTimeline(tree, records);
  return timeline.length ? timeline[timeline.length - 1] : null;
}

/** The number of photos taken before the current (latest) one. */
export function countPastTreePhotos(
  tree: TreePhotoSource | null | undefined,
  records: MonitoringLike[] | null | undefined
): number {
  return Math.max(0, getTreePhotoTimeline(tree, records).length - 1);
}

/** The most recent audit of a tree (any round) — drives the "latest values". */
export function getLatestAudit(records: MonitoringLike[] | null | undefined): any | null {
  let latest: any = null;
  let latestTime = -1;
  for (const record of records ?? []) {
    if (!record) continue;
    const time =
      (parseAuditDate(record.survey_date) ?? parseAuditDate((record as any).submitted_at))?.getTime() ?? 0;
    if (!latest || time >= latestTime) {
      latest = record;
      latestTime = time;
    }
  }
  return latest;
}

