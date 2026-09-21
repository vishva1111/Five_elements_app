import { supabase } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TreeRecord, TreeRecordInsert, TreeMonitoringRecord, ApiResponse, Project, User } from '../types';
import {
  buildProjectTreeId,
  makeProjectPrefix,
  nextProjectSequence,
  resolveTreeId,
} from '../utils/treeId';

// ─── Schema capability detection ─────────────────────────────────────────────
// The deployed database may not have run the migrations yet: the tree_id column
// or the tree_monitoring_records table can be absent. Detect that once and
// degrade gracefully (device-local IDs, friendly errors) instead of retrying and
// warning on every single call.
export const SETUP_SQL_FILE = 'supabase/migrations/002_create_tree_monitoring.sql';

// Only shown with console.debug — the DB may legitimately lag behind the code
// until the migration is run, and this state is already surfaced in the UI.
let setupNoticeShown = false;
function warnNeedsMigration(what: string): void {
  if (setupNoticeShown) return;
  setupNoticeShown = true;
  console.debug(
    `[TreeApp] Database is missing ${what}. ` +
      `Run ${SETUP_SQL_FILE} once in the Supabase SQL Editor → New query. ` +
      `Until then, tree IDs are stored on this device only and monitoring ` +
      `rounds cannot be saved.`
  );
}

// PostgREST / Postgres "missing column or table" detection
export function isMissingSchemaError(error: any): boolean {
  const code = error?.code;
  if (code === 'PGRST204' || code === 'PGRST205' || code === '42703' || code === '42P01') {
    return true;
  }
  const message = String(error?.message ?? error ?? '').toLowerCase();
  return (
    message.includes('does not exist') ||
    (message.includes('schema cache') && message.includes('could not find'))
  );
}

// True once we know tree_records.tree_id cannot be read/written (pre-migration).
// Re-probed after the TTL so that running the migration is picked up without an
// app restart. Keeps failing queries from being retried on every call.
const TREE_ID_COLUMN_REPROBE_MS = 60_000;
let treeIdColumnMissing = false;
let treeIdColumnCheckedAt = 0;

function treeIdColumnUnavailable(): boolean {
  if (!treeIdColumnMissing) return false;
  if (Date.now() - treeIdColumnCheckedAt > TREE_ID_COLUMN_REPROBE_MS) {
    treeIdColumnMissing = false;
    return false;
  }
  return true;
}

function markTreeIdColumnMissing(): void {
  treeIdColumnMissing = true;
  treeIdColumnCheckedAt = Date.now();
  warnNeedsMigration('the tree_records.tree_id column');
}

// ─── Device-local tree IDs ───────────────────────────────────────────────────
// Keeps the assigned {PREFIX}-{SEQ} stable across app restarts even when the
// database cannot store it yet. The database always wins: this map is only
// consulted when neither the tree_id column nor the legacy ##META## notes have
// an ID, and an entry is dropped as soon as a DB write succeeds.
const LOCAL_TREE_IDS_KEY = 'treeapp_local_tree_ids';
let localTreeIds: Record<string, string> | null = null;
let localTreeIdsLoad: Promise<Record<string, string>> | null = null;

async function loadLocalTreeIds(): Promise<Record<string, string>> {
  if (localTreeIds) return localTreeIds;
  if (!localTreeIdsLoad) {
    localTreeIdsLoad = AsyncStorage.getItem(LOCAL_TREE_IDS_KEY)
      .then((raw) => {
        localTreeIds = raw ? JSON.parse(raw) : {};
        return localTreeIds as Record<string, string>;
      })
      .catch(() => {
        localTreeIds = {};
        return localTreeIds as Record<string, string>;
      })
      .finally(() => {
        localTreeIdsLoad = null;
      });
  }
  return localTreeIdsLoad;
}

async function saveLocalTreeId(recordId: string, treeId: string): Promise<void> {
  try {
    const map = await loadLocalTreeIds();
    if (map[recordId] === treeId) return;
    map[recordId] = treeId;
    await AsyncStorage.setItem(LOCAL_TREE_IDS_KEY, JSON.stringify(map));
  } catch {}
}

async function clearLocalTreeId(recordId: string): Promise<void> {
  try {
    const map = await loadLocalTreeIds();
    if (!(recordId in map)) return;
    delete map[recordId];
    await AsyncStorage.setItem(LOCAL_TREE_IDS_KEY, JSON.stringify(map));
  } catch {}
}

// ─── Transform raw Supabase row into TreeRecord with joined project_name ───────
function mapTreeRecord(raw: any): TreeRecord {
  if (!raw) return null as any;
  return {
    ...raw,
    project_name: raw.projects?.name ?? raw.project_name,
  };
}

// ─── Fetch missing project names in one batched query ──────────────────────────
// Guarantees every tree record carries project_name, even when the projects(name)
// join was skipped (schema fallback) or the record came from a realtime payload.
async function attachProjectNames(trees: TreeRecord[]): Promise<TreeRecord[]> {
  const missing = trees.filter((t) => t?.project_id && !t.project_name);
  if (missing.length === 0) return trees;

  const ids = Array.from(new Set(missing.map((t) => t.project_id as string)));
  const { data, error } = await supabase
    .from('projects')
    .select('id, name')
    .in('id', ids);

  if (error || !data) {
    console.warn('[TreeApp] Could not fetch project names:', error ?? 'no data');
    return trees;
  }

  const nameById = new Map<string, string>(data.map((p: any) => [p.id, p.name]));
  return trees.map((t) =>
    t?.project_id && !t.project_name
      ? { ...t, project_name: nameById.get(t.project_id) ?? t.project_name }
      : t
  );
}

// Enrich a single record (inserts, realtime payloads)
async function attachProjectName(tree: TreeRecord): Promise<TreeRecord> {
  const [enriched] = await attachProjectNames([tree]);
  return enriched;
}

// ─── Insert a new tree record ──────────────────────────────────────────────────
export async function insertTreeRecord(
  record: TreeRecordInsert
): Promise<ApiResponse<TreeRecord>> {
  const NEW_COLUMNS = [
    'event_type', 'quantity', 'dbh_cm', 'height_m', 'wood_density',
    'crown_diameter_m', 'tree_condition', 'multi_stem', 'age_years',
    'land_type', 'surveyor', 'survey_date', 'tree_id', 'scientific_name',
  ];

  const isMissingColumn = (msg: string) => msg.includes('column') && msg.includes('of') && msg.includes('schema cache');

  // Try full insert first
  let { data, error } = await supabase
    .from('tree_records')
    .insert(record)
    .select('*, projects(name)')
    .single();

  if (error) {
    const retry = await supabase
      .from('tree_records')
      .insert(record)
      .select()
      .single();
    data = retry.data;
    error = retry.error;
  }

  // If missing columns, save extra data as ##META## JSON in notes
  if (error && isMissingColumn(error.message)) {
    console.warn(
      '[TreeApp] tree_records missing columns — run supabase/migrations/001_add_tree_columns.sql. Saving extra data in notes.'
    );
    const meta: Record<string, any> = {};
    NEW_COLUMNS.forEach((col) => {
      if ((record as any)[col] !== undefined && (record as any)[col] !== null) {
        meta[col] = (record as any)[col];
      }
    });
    const baseRecord: Record<string, any> = { ...record };
    NEW_COLUMNS.forEach((col) => delete baseRecord[col]);
    // Append meta to notes
    const existingNotes = (baseRecord.notes as string) || '';
    const metaJson = JSON.stringify(meta);
    baseRecord.notes = existingNotes ? `${existingNotes}\n##META##${metaJson}` : `##META##${metaJson}`;

    const retryBase = await supabase
      .from('tree_records')
      .insert(baseRecord)
      .select()
      .single();
    data = retryBase.data;
    error = retryBase.error;
  }

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: await attachProjectName(mapTreeRecord(data)), error: null };
}

// ─── Fetch my tree records ─────────────────────────────────────────────────────
export async function fetchMyTrees(
  userId: string
): Promise<ApiResponse<TreeRecord[]>> {
  // Try with project join first; fall back to plain select if join fails
  let { data, error } = await supabase
    .from('tree_records')
    .select('*, projects(name)')
    .eq('user_id', userId)
    .order('submitted_at', { ascending: false });

  if (error) {
    // Retry without the join (projects table may not exist yet)
    const retry = await supabase
      .from('tree_records')
      .select('*')
      .eq('user_id', userId)
      .order('submitted_at', { ascending: false });
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    return { data: null, error: error.message };
  }

  const trees = await attachProjectNames((data ?? []).map(mapTreeRecord));
  return { data: trees, error: null };
}

// ─── Fetch trees by project ──────────────────────────────────────────────────
export async function fetchTreesByProject(
  projectId: string
): Promise<ApiResponse<TreeRecord[]>> {
  let { data, error } = await supabase
    .from('tree_records')
    .select('*, projects(name)')
    .eq('project_id', projectId)
    .order('submitted_at', { ascending: false });

  if (error) {
    const retry = await supabase
      .from('tree_records')
      .select('*')
      .eq('project_id', projectId)
      .order('submitted_at', { ascending: false });
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    return { data: null, error: error.message };
  }

  const trees = await attachProjectNames((data ?? []).map(mapTreeRecord));
  return { data: trees, error: null };
}

// ─── Fetch single tree record ──────────────────────────────────────────────────
export async function fetchTreeById(
  id: string
): Promise<ApiResponse<TreeRecord>> {
  // Try with project join first; fall back to plain select if join fails
  let { data, error } = await supabase
    .from('tree_records')
    .select('*, projects(name)')
    .eq('id', id)
    .single();

  if (error) {
    // Retry without the join (projects table may not exist yet)
    const retry = await supabase
      .from('tree_records')
      .select('*')
      .eq('id', id)
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: await attachProjectName(mapTreeRecord(data)), error: null };
}

// ─── Credit calculation helpers ─────────────────────────────────────────────────
// Credits are PER PROJECT. Every project is GIVEN 500 credits upfront for the
// user. Adding a tree to a project DEDUCTS from that project's balance.
//   credits for project X = 500 − number of trees the user added in project X
// When no project is active the credits stay at the initial 500 (nothing logs
// against a specific project unless one is selected).
export const INITIAL_CREDITS = 500;

// ─── Credits for a SINGLE project (the active one) ──────────────────────────────
// 500 given − number of trees the user added inside this one project.
export function computeCreditsForProject(
  trees: TreeRecord[] | null,
  projectId: string | null | undefined
): number {
  if (!trees || !projectId) return INITIAL_CREDITS;
  const count = trees.filter((t) => t.project_id === projectId).length;
  return Math.max(0, INITIAL_CREDITS - count);
}

// ─── Device-local cache of the user's project selection ────────────────────────
// Used as a fallback so the app opens directly with the already-selected
// projects even if the DB write/read fails (e.g. RLS migration not applied).
const PROJECT_CACHE_PREFIX = 'treeapp_selected_projects_';

export async function cacheUserProjects(
  userId: string,
  projects: Project[]
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      PROJECT_CACHE_PREFIX + userId,
      JSON.stringify(projects)
    );
  } catch {
    // Cache is best-effort — ignore failures
  }
}

export async function getCachedUserProjects(
  userId: string
): Promise<Project[] | null> {
  try {
    const raw = await AsyncStorage.getItem(PROJECT_CACHE_PREFIX + userId);
    return raw ? (JSON.parse(raw) as Project[]) : null;
  } catch {
    return null;
  }
}

// ─── Fetch all projects (for login selection or fallback) ─────────────────────
export async function fetchAllProjects(): Promise<ApiResponse<Project[]>> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, description, status')
    .order('name');

  if (error) {
    return { data: [], error: error.message };
  }

  return {
    data: (data ?? []) as Project[],
    error: null,
  };
}

// ─── Fetch user's assigned projects ────────────────────────────────────────────
export async function fetchUserProjects(
  userId: string
): Promise<ApiResponse<Project[]>> {
  const { data, error } = await supabase
    .from('user_projects')
    .select('projects(id, name, status)')
    .eq('user_id', userId);

  if (error) {
    // Table may not exist yet — return empty array so caller can fall back
    return { data: [], error: null };
  }

  const projects = data?.map((up: any) => up.projects as Project).filter(Boolean) ?? [];
  return { data: projects, error: null };
}

// ─── Save the user's project selection (from the login-page dropdown) ──────────
// Replaces any previous assignments so only the selected projects are visible.
export async function saveUserProjects(
  userId: string,
  projectIds: string[]
): Promise<ApiResponse<null>> {
  // Preferred path: SECURITY DEFINER RPC — bypasses RLS so the save works for
  // every authenticated user. Install with supabase/migrations/002_save_user_projects_rpc.sql
  const rpc = await supabase.rpc('save_my_projects', {
    target_project_ids: projectIds,
  });

  if (!rpc.error) {
    return { data: null, error: null };
  }

  // Table completely missing (000 migration never applied)? Report it clearly
  // instead of trying direct writes that will fail the same way.
  const tableMissing = /could not find the table .*user_projects/i.test(rpc.error.message);
  if (tableMissing) {
    return {
      data: null,
      error:
        'The user_projects table is missing in your Supabase database. ' +
        'Run supabase/migrations/000_full_database_setup.sql in the Supabase SQL Editor.',
    };
  }

  // RPC not installed yet? Fall back to direct table writes, which need the
  // INSERT/DELETE policies (also included in 000_full_database_setup.sql).
  const rpcMissing = /function .* does not exist|could not find the function|schema cache/i.test(
    rpc.error.message
  );
  if (!rpcMissing) {
    return { data: null, error: rpc.error.message };
  }

  console.warn(
    '[TreeApp] save_my_projects RPC missing — run supabase/migrations/000_full_database_setup.sql. Falling back to direct writes.'
  );

  // Remove old assignments first
  const del = await supabase
    .from('user_projects')
    .delete()
    .eq('user_id', userId);

  if (del.error) {
    return { data: null, error: del.error.message };
  }

  if (projectIds.length === 0) {
    return { data: null, error: null };
  }

  const rows = projectIds.map((projectId) => ({ user_id: userId, project_id: projectId }));
  const { error } = await supabase
    .from('user_projects')
    .upsert(rows, { onConflict: 'user_id,project_id' });

  return { data: null, error: error?.message ?? null };
}

// ─── Fetch user profile (full profile including credits) ──────────────────────
export async function fetchUserProfile(
  userId: string
): Promise<ApiResponse<any>> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  // If table doesn't exist or query fails, return null data (caller handles defaults)
  if (error) {
    return { data: null, error: null };
  }

  return { data, error: null };
}

// ─── Sync remaining credits (= 500 given credits − trees added) into the profile ──
export async function syncUserCredits(
  userId: string,
  credits: number
): Promise<ApiResponse<null>> {
  const { error } = await supabase
    .from('profiles')
    .update({ credits })
    .eq('id', userId);

  return { data: null, error: error?.message ?? null };
}

// ─── Build a User object from profile data ────────────────────────────────────
export function buildUserFromProfile(
  userId: string,
  email: string,
  profile: any | null,
  credits: number | null
): User {
  return {
    id: userId,
    email: profile?.email ?? email,
    full_name: profile?.full_name ?? profile?.display_name ?? profile?.name ?? '',
    role: profile?.role ?? 'field_user',
    avatar_url: profile?.avatar_url ?? profile?.avatar ?? '',
    created_at: profile?.created_at ?? new Date().toISOString(),
    credits: credits ?? profile?.credits ?? INITIAL_CREDITS,
  };
}

// ─── Lock a tree record (enforced at DB level — cannot be undone via UI) ──────
// When locked=true, the tree cannot be edited or deleted. This is enforced both
// here in the data layer AND via Supabase RLS policies (if configured).
export async function lockTree(
  treeId: string,
  locked: boolean = true
): Promise<ApiResponse<TreeRecord>> {
  const { data, error } = await supabase
    .from('tree_records')
    .update({ locked })
    .eq('id', treeId)
    .select('*, projects(name)')
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: await attachProjectName(mapTreeRecord(data)), error: null };
}

// ─── Update a tree record (blocked if locked) ────────────────────────────────
// Checks the locked flag BEFORE attempting the update. Even if the DB has an RLS
// policy, this client-side check prevents wasted network calls and gives the user
// immediate feedback.
export async function updateTree(
  treeId: string,
  updates: Partial<TreeRecordInsert>
): Promise<ApiResponse<TreeRecord>> {
  // First check if the tree is locked
  const { data: existing, error: fetchError } = await supabase
    .from('tree_records')
    .select('locked')
    .eq('id', treeId)
    .single();

  if (fetchError) {
    return { data: null, error: fetchError.message };
  }

  if (existing?.locked) {
    return { data: null, error: 'This tree record is locked and cannot be modified.' };
  }

  const { data, error } = await supabase
    .from('tree_records')
    .update(updates)
    .eq('id', treeId)
    .select('*, projects(name)')
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: await attachProjectName(mapTreeRecord(data)), error: null };
}

// ─── Delete a tree record (blocked if locked) ────────────────────────────────
export async function deleteTree(treeId: string): Promise<ApiResponse<null>> {
  const { data: existing, error: fetchError } = await supabase
    .from('tree_records')
    .select('locked')
    .eq('id', treeId)
    .single();

  if (fetchError) {
    return { data: null, error: fetchError.message };
  }

  if (existing?.locked) {
    return { data: null, error: 'This tree record is locked and cannot be deleted.' };
  }

  const { error } = await supabase
    .from('tree_records')
    .delete()
    .eq('id', treeId);

  return { data: null, error: error?.message ?? null };
}

// ─── Fetch ALL trees (for map view — not filtered by user) ────────────────────
export async function fetchAllTrees(): Promise<ApiResponse<TreeRecord[]>> {
  let { data, error } = await supabase
    .from('tree_records')
    .select('*, projects(name)')
    .order('submitted_at', { ascending: false });

  if (error) {
    const retry = await supabase
      .from('tree_records')
      .select('*')
      .order('submitted_at', { ascending: false });
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    return { data: [], error: error.message };
  }

  const trees = await attachProjectNames((data ?? []).map(mapTreeRecord));
  return { data: trees, error: null };
}

// ─── Fetch trees within a bounding box (for map viewport queries) ─────────────
export async function fetchTreesInBounds(
  north: number,
  south: number,
  east: number,
  west: number
): Promise<ApiResponse<TreeRecord[]>> {
  const { data, error } = await supabase
    .from('tree_records')
    .select('*, projects(name)')
    .gte('latitude', south)
    .lte('latitude', north)
    .gte('longitude', west)
    .lte('longitude', east)
    .order('submitted_at', { ascending: false });

  if (error) {
    return { data: [], error: error.message };
  }

  const trees = await attachProjectNames((data ?? []).map(mapTreeRecord));
  return { data: trees, error: null };
}

// Fallback numbering used when the tree_id column was not deployed yet: keeps
// IDs unique and sequential within the session instead of repeating "-001".
const sessionSequences = new Map<string, number>();

function nextSessionSequence(prefix: string): number {
  const next = (sessionSequences.get(prefix) ?? 0) + 1;
  sessionSequences.set(prefix, next);
  return next;
}

// ─── Project-wise Sequential Tree ID Generator ──────────────────────────────
// Format: {PROJECT_PREFIX}-{SEQ}  e.g. ARAV-001, ARAV-002, BERA-001
// Prefix = first 4 uppercase letters of project name (stripped of spaces/symbols)

export async function generateProjectTreeId(
  projectId: string | null | undefined,
  projectName?: string
): Promise<string> {
  const prefix = projectName ? makeProjectPrefix(projectName) : 'TREE';

  if (!projectId) {
    const seq = String(Date.now()).slice(-4).padStart(4, '0');
    return `TREE-${seq}`;
  }

  // Sequence off the highest ID already used in this project (not the row count,
  // which would hand out duplicates when rows were deleted or never got an ID)
  const { data, error } = await supabase
    .from('tree_records')
    .select('tree_id')
    .eq('project_id', projectId);

  if (error) {
    if (isMissingSchemaError(error)) {
      markTreeIdColumnMissing();
      return buildProjectTreeId(prefix, nextSessionSequence(prefix));
    }
    console.warn('[TreeApp] generateProjectTreeId lookup error:', error.message);
    const seq = String(Date.now()).slice(-4).padStart(4, '0');
    return `${prefix}-${seq}`;
  }

  return buildProjectTreeId(prefix, nextProjectSequence(data, prefix));
}

// ─── Guarantee every tree has a project-based tree_id ────────────────────────
// Used by the tree cards / tree details screens so no screen ever falls back to
// the database uuid. Resolution order:
//   1. tree_id column          → returned as is
//   2. ##META## notes (legacy) → persisted into tree_id, then returned
//   3. nothing yet             → next free {PREFIX}-{SEQ} for the project,
//                                persisted, then returned
// Assignment is serialized per project so two trees can never be given the same
// sequence number, and the value is cached in memory for the session.

const treeIdCache = new Map<string, string>();
const treeIdLocks = new Map<string, Promise<string>>();

async function runEnsureProjectTreeId(tree: TreeRecord): Promise<string> {
  const direct = typeof tree.tree_id === 'string' ? tree.tree_id.trim() : '';
  if (direct) return direct;

  // 1. Legacy records kept the ID inside the ##META## notes blob
  const legacyId = resolveTreeId(tree);
  if (legacyId) {
    if (treeIdColumnUnavailable()) {
      // Cannot move it into the column yet — keep using it
      tree.tree_id = legacyId;
      return legacyId;
    }
    const { error } = await supabase
      .from('tree_records')
      .update({ tree_id: legacyId })
      .eq('id', tree.id);

    if (error) {
      if (isMissingSchemaError(error)) {
        markTreeIdColumnMissing();
      } else {
        console.warn('[TreeApp] Could not persist legacy tree_id:', error.message);
      }
    } else {
      tree.tree_id = legacyId;
      clearLocalTreeId(tree.id);
    }
    return legacyId;
  }

  // 2. An ID assigned on this device earlier (before the migration was run)
  const local = (await loadLocalTreeIds())[tree.id];
  if (local) {
    tree.tree_id = local;
    return local;
  }

  // 3. Build the next project-scoped sequential ID
  let prefix = 'TREE';
  if (tree.project_id) {
    const { data: project } = await supabase
      .from('projects')
      .select('id, name')
      .eq('id', tree.project_id)
      .maybeSingle();

    const projectName = (project as any)?.name ?? tree.project_name;
    if (projectName) prefix = makeProjectPrefix(projectName);
  }

  let rows: Array<{ tree_id?: string | null }> = [];
  let columnUnavailable = treeIdColumnUnavailable();
  if (!columnUnavailable) {
    const query = supabase.from('tree_records').select('tree_id');
    const { data, error } = tree.project_id
      ? await query.eq('project_id', tree.project_id)
      : await query;
    if (error) {
      columnUnavailable = true;
      if (isMissingSchemaError(error)) {
        markTreeIdColumnMissing();
      }
    } else {
      rows = (data ?? []) as any[];
    }
  }

  let seq = columnUnavailable
    ? nextSessionSequence(prefix)
    : nextProjectSequence(rows, prefix);
  let newTreeId = buildProjectTreeId(prefix, seq);

  // 4. Persist it, retrying with the next number if that ID is already taken
  for (let attempt = 0; attempt < 5 && !treeIdColumnUnavailable(); attempt++) {
    const { error } = await supabase
      .from('tree_records')
      .update({ tree_id: newTreeId })
      .eq('id', tree.id);

    if (!error) {
      tree.tree_id = newTreeId;
      clearLocalTreeId(tree.id);
      return newTreeId;
    }

    if (isMissingSchemaError(error)) {
      // Column not deployed yet: keep the ID on the device so it stays stable
      markTreeIdColumnMissing();
      break;
    }

    const message = (error.message || '').toLowerCase();
    const duplicate =
      error.code === '23505' || message.includes('duplicate') || message.includes('unique');
    console.warn('[TreeApp] Could not persist project tree_id:', error.message);
    if (!duplicate) break;

    seq += 1;
    newTreeId = buildProjectTreeId(prefix, seq);
  }

  // Missing column / offline / read-only user: still show a project ID. It is
  // remembered on the device, so the same value comes back on the next load.
  tree.tree_id = newTreeId;
  await saveLocalTreeId(tree.id, newTreeId);
  return newTreeId;
}

export async function ensureProjectTreeId(tree: TreeRecord): Promise<string> {
  if (!tree?.id) return '';
  const cached = treeIdCache.get(tree.id);
  if (cached) return cached;

  const projectKey = tree.project_id ?? 'no-project';
  const previous = treeIdLocks.get(projectKey) ?? Promise.resolve('');
  const task = previous
    .catch(() => '')
    .then(() => runEnsureProjectTreeId(tree))
    .then((id) => {
      if (id) treeIdCache.set(tree.id, id);
      return id;
    });

  treeIdLocks.set(projectKey, task);
  try {
    return await task;
  } catch (err: any) {
    console.warn('[TreeApp] ensureProjectTreeId failed:', err?.message ?? err);
    return resolveTreeId(tree);
  } finally {
    if (treeIdLocks.get(projectKey) === task) treeIdLocks.delete(projectKey);
  }
}

// Backfill a list of records in one go — the same list, with tree_id filled in
export async function backfillProjectTreeIds(
  trees: TreeRecord[]
): Promise<TreeRecord[]> {
  const list = trees ?? [];
  // Pending = the tree_id column is empty. Such a record may still carry a
  // legacy ##META## id that has to be moved into the column.
  const pending = list.filter(
    (t) => t && !(typeof t.tree_id === 'string' && t.tree_id.trim())
  );
  if (pending.length === 0) return list;

  for (const tree of pending) {
    await ensureProjectTreeId(tree);
  }

  return list.map((t) => {
    if (!t) return t;
    const resolved = resolveTreeId(t);
    return resolved && resolved !== t.tree_id ? { ...t, tree_id: resolved } : t;
  });
}

// ─── Migrate ALL existing trees to project-wise sequential IDs ──────────────
// Groups trees by project, sorts by date, assigns ARAV-001, ARAV-002, etc.
export async function migrateAllTreeIds(): Promise<{
  updated: number;
  errors: number;
  details: string[];
}> {
  let updated = 0;
  let errors = 0;
  const details: string[] = [];

  // 1. Fetch all projects
  const { data: projects } = await supabase.from('projects').select('id, name');
  if (!projects) return { updated, errors, details: ['Failed to fetch projects'] };

  // 2. Fetch ALL trees (no project filter)
  const { data: allTrees, error: fetchError } = await supabase
    .from('tree_records')
    .select('id, tree_id, project_id, submitted_at')
    .order('submitted_at', { ascending: true });

  if (fetchError || !allTrees) {
    if (fetchError && isMissingSchemaError(fetchError)) {
      markTreeIdColumnMissing();
    }
    return { updated, errors, details: [fetchError?.message ?? 'Failed to fetch trees'] };
  }

  // 3. Group trees by project
  const treesByProject = new Map<string, typeof allTrees>();
  const noProjectTrees: typeof allTrees = [];

  for (const tree of allTrees) {
    if (tree.project_id) {
      const group = treesByProject.get(tree.project_id) ?? [];
      group.push(tree);
      treesByProject.set(tree.project_id, group);
    } else {
      noProjectTrees.push(tree);
    }
  }

  // 4. For each project, assign sequential IDs
  for (const project of projects) {
    const trees = treesByProject.get(project.id);
    if (!trees || trees.length === 0) continue;

    const prefix = makeProjectPrefix(project.name);
    details.push(`${project.name} (${prefix}): ${trees.length} trees`);

    for (let i = 0; i < trees.length; i++) {
      const newId = `${prefix}-${String(i + 1).padStart(3, '0')}`;
      const tree = trees[i];

      // Skip if already correct
      if (tree.tree_id === newId) continue;

      const { error: updateError } = await supabase
        .from('tree_records')
        .update({ tree_id: newId })
        .eq('id', tree.id);

      if (updateError) {
        errors++;
        details.push(`  ✗ ${tree.tree_id} → ${newId}: ${updateError.message}`);
      } else {
        updated++;
      }
    }
  }

  // 5. Handle trees with no project — use "TREE" prefix
  if (noProjectTrees.length > 0) {
    details.push(`No Project (TREE): ${noProjectTrees.length} trees`);
    for (let i = 0; i < noProjectTrees.length; i++) {
      const newId = `TREE-${String(i + 1).padStart(3, '0')}`;
      const tree = noProjectTrees[i];
      if (tree.tree_id === newId) continue;

      const { error: updateError } = await supabase
        .from('tree_records')
        .update({ tree_id: newId })
        .eq('id', tree.id);

      if (updateError) {
        errors++;
        details.push(`  ✗ ${tree.tree_id} → ${newId}: ${updateError.message}`);
      } else {
        updated++;
      }
    }
  }

  details.unshift(`Done: ${updated} updated, ${errors} errors`);
  return { updated, errors, details };
}

// ─── Search trees by prefix (for Update screen autocomplete) ────────────────
export async function searchTreesByPrefix(
  prefix: string,
  projectId?: string | null
): Promise<ApiResponse<TreeRecord[]>> {
  const search = prefix.toUpperCase();

  let query = supabase
    .from('tree_records')
    .select('*, projects(name)')
    .ilike('tree_id', `${search}%`)
    .order('tree_id', { ascending: true })
    .limit(20);

  if (projectId) {
    query = query.eq('project_id', projectId);
  }

  const { data, error } = await query;

  if (error) {
    return { data: [], error: error.message };
  }

  return { data: (data ?? []).map(mapTreeRecord), error: null };
}

// ─── Fetch recent tree IDs from local storage ──────────────────────────────
const RECENT_TREES_KEY = 'treeapp_recent_searches';

export async function getRecentTreeSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_TREES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveRecentTreeSearch(treeId: string): Promise<void> {
  try {
    const recent = await getRecentTreeSearches();
    const filtered = recent.filter((id) => id !== treeId);
    filtered.unshift(treeId);
    await AsyncStorage.setItem(RECENT_TREES_KEY, JSON.stringify(filtered.slice(0, 10)));
  } catch {}
}

// ─── Migrate a single tree ID to project-wise sequential format ──────────────
// Updates the tree's tree_id and all its monitoring records to match the project.
// Returns the new tree_id.
export async function migrateTreeIdToProject(
  treeId: string, // db primary key of the tree record
  projectId: string,
  projectName: string
): Promise<{ newTreeId: string; errors: string[] }> {
  const errors: string[] = [];

  // 1. Fetch the tree record
  const { data: tree, error: treeError } = await supabase
    .from('tree_records')
    .select('*')
    .eq('id', treeId)
    .single();

  if (treeError) {
    return { newTreeId: '', errors: [treeError.message] };
  }

  // 2. Generate the new project-based tree_id (next free number for the project)
  const prefix = makeProjectPrefix(projectName);
  let sequence = 1;
  let sequenceKnown = false;

  if (!treeIdColumnUnavailable()) {
    const { data: projectTrees, error: seqError } = await supabase
      .from('tree_records')
      .select('tree_id')
      .eq('project_id', projectId);

    if (seqError) {
      if (isMissingSchemaError(seqError)) {
        markTreeIdColumnMissing();
      } else {
        errors.push(`Sequence lookup error: ${seqError.message}`);
        return { newTreeId: '', errors };
      }
    } else {
      sequence = nextProjectSequence(projectTrees, prefix);
      sequenceKnown = true;
    }
  }

  if (!sequenceKnown) sequence = nextSessionSequence(prefix);

  const newTreeId = buildProjectTreeId(prefix, sequence);

  // 3. Check if already correct (same ID)
  if (tree.tree_id === newTreeId) {
    return { newTreeId, errors };
  }

  // 4. Update the tree record's tree_id
  const { error: updateError } = await supabase
    .from('tree_records')
    .update({ tree_id: newTreeId })
    .eq('id', treeId);

  if (updateError) {
    if (isMissingSchemaError(updateError)) {
      markTreeIdColumnMissing();
      // Still hand the new project-format ID to the caller so the UI shows it
      await saveLocalTreeId(treeId, newTreeId);
      return { newTreeId, errors };
    }
    errors.push(`Tree update error: ${updateError.message}`);
    return { newTreeId: '', errors };
  }

  await clearLocalTreeId(treeId);

  // 5. Update all monitoring records to use the new tree_id
  // Use the OLD tree_id (before update) to find monitoring records
  const oldTreeId = resolveTreeId(tree);
  if (oldTreeId) {
    const { error: monitorError } = await supabase
      .from('tree_monitoring_records')
      .update({ tree_id: newTreeId })
      .eq('tree_id', oldTreeId);

    if (monitorError) {
      if (isMissingSchemaError(monitorError)) {
        warnNeedsMigration('the tree_monitoring_records table');
      } else {
        errors.push(`Monitoring records update error: ${monitorError.message}`);
      }
      // Note: tree record already updated, but monitoring not updated
      return { newTreeId, errors };
    }
  }

  return { newTreeId, errors };
}

// ─── Lookup tree by user-facing tree_id (e.g. "ARAV-001") ──────────────────
export async function fetchTreeByTreeId(
  treeId: string
): Promise<ApiResponse<TreeRecord>> {
  // Try exact match first, then case-insensitive
  let { data, error } = await supabase
    .from('tree_records')
    .select('*, projects(name)')
    .eq('tree_id', treeId)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fallback 1: case-insensitive search
  if (!data && !error) {
    const retry = await supabase
      .from('tree_records')
      .select('*, projects(name)')
      .ilike('tree_id', treeId)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    data = retry.data;
    error = retry.error;
  }

  // Fallback 2: If treeId looks like a project-prefixed ID (e.g. "ARAV-001"),
  // but not found, try searching for any tree with that number in ANY project
  // (handles unmigrated trees that may have different prefixes)
  if (!data && !error && treeId.includes('-')) {
    const parts = treeId.split('-');
    if (parts.length === 2) {
      const numPart = parts[1];
      // Search for trees where tree_id ends with this number
      const likePattern = `%${numPart}`;
      const retry2 = await supabase
        .from('tree_records')
        .select('*, projects(name)')
        .ilike('tree_id', likePattern)
        .order('submitted_at', { ascending: false })
        .limit(5)
        .maybeSingle();
      if (retry2.data) {
        data = retry2.data;
        error = retry2.error;
      }
    }
  }

  // Fallback 3: If still not found and treeId looks like old format (no dash),
  // search by the ID directly (might be a raw DB id)
  if (!data && !error && treeId.length <= 12 && !treeId.includes('-')) {
    const retry3 = await supabase
      .from('tree_records')
      .select('*, projects(name)')
      .eq('id', treeId)
      .maybeSingle();
    if (retry3.data) {
      data = retry3.data;
      error = retry3.error;
    }
  }

  if (error) {
    return { data: null, error: error.message };
  }

  if (!data) {
    return { data: null, error: `No tree found with ID "${treeId}"` };
  }

  return { data: await attachProjectName(mapTreeRecord(data)), error: null };
}

// ─── Monitoring Round Functions ──────────────────────────────────────────────

// Shown to the user when the monitoring table has not been created yet
export const MONITORING_SETUP_ERROR =
  'Monitoring rounds are not available yet: the database table is missing. ' +
  `Run ${SETUP_SQL_FILE} once in the Supabase SQL Editor, then reload the app.`;

// Set once the monitoring table is found to be missing (pre-migration). Lets the
// Update screens show a warning instead of silently rendering an empty history.
// Re-probed after the TTL so running the migration is picked up without an
// app restart — same pattern as tree_id column detection.
const MONITORING_TABLE_REPROBE_MS = 30_000; // 30s — monitoring table is cheap to check
let monitoringSetupRequired = false;
let monitoringSetupCheckedAt = 0;

function monitoringTableUnavailable(): boolean {
  if (!monitoringSetupRequired) return false;
  if (Date.now() - monitoringSetupCheckedAt > MONITORING_TABLE_REPROBE_MS) {
    monitoringSetupRequired = false;
    return false;
  }
  return true;
}

function markMonitoringSetupMissing(): void {
  monitoringSetupRequired = true;
  monitoringSetupCheckedAt = Date.now();
  warnNeedsMigration('the tree_monitoring_records table');
}

/** True once a call proved the monitoring table has not been created yet (within TTL). */
export function isMonitoringSetupRequired(): boolean {
  return monitoringTableUnavailable();
}

/** Re-probe the monitoring table immediately — call after running the migration. */
export async function recheckMonitoringSetup(): Promise<boolean> {
  if (!monitoringTableUnavailable()) {
    // Either never flagged, or TTL already expired — do a fresh check
    try {
      const { error } = await supabase
        .from('tree_monitoring_records')
        .select('id')
        .limit(1);
      if (error && isMissingSchemaError(error)) {
        markMonitoringSetupMissing();
        return true; // still missing
      }
      // Table exists (or some other non-schema error) — clear the flag
      monitoringSetupRequired = false;
      return false;
    } catch {
      // Network / unexpected — leave current state alone
      return monitoringSetupRequired;
    }
  }
  // TTL hasn't expired yet — latest known state is "missing"
  return true;
}

export async function fetchTreeMonitoringRecords(
  treeId: string
): Promise<ApiResponse<any[]>> {
  const { data, error } = await supabase
    .from('tree_monitoring_records')
    .select('*')
    .eq('tree_id', treeId)
    .order('monitoring_round', { ascending: true });

  if (error) {
    if (isMissingSchemaError(error)) {
      // Expected until the migration is run — mark missing (TTL-reprobed)
      markMonitoringSetupMissing();
      return { data: [], error: null };
    }
    console.warn('[TreeApp] fetchTreeMonitoringRecords error:', error.message);
    return { data: [], error: null };
  }

  return { data: (data ?? []) as any[], error: null };
}

export async function getTreeMonitoringRound(
  treeId: string
): Promise<number> {
  const { count, error } = await supabase
    .from('tree_monitoring_records')
    .select('*', { count: 'exact', head: true })
    .eq('tree_id', treeId);

  if (error) {
    if (isMissingSchemaError(error)) markMonitoringSetupMissing();
    return 1;
  }

  return (count ?? 0) + 1;
}

export async function insertMonitoringRecord(record: {
  tree_record_id: string;
  tree_id: string;
  monitoring_round: number;
  user_id: string;
  project_id?: string;
  photo_url?: string;
  latitude: number;
  longitude: number;
  dbh_cm?: number;
  height_m?: number;
  crown_diameter_m?: number;
  tree_condition?: string;
  health_status?: string;
  survival_status?: string;
  notes?: string;
  surveyor?: string;
  survey_date?: string;
}): Promise<ApiResponse<any>> {
  const { data, error } = await supabase
    .from('tree_monitoring_records')
    .insert(record)
    .select()
    .single();

  if (error) {
    if (isMissingSchemaError(error)) {
      markMonitoringSetupMissing();
      return { data: null, error: MONITORING_SETUP_ERROR };
    }
    console.warn('[TreeApp] insertMonitoringRecord error:', error.message);
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

export async function updateTreeFromMonitoring(
  treeRecordId: string,
  updates: {
    dbh_cm?: number;
    height_m?: number;
    crown_diameter_m?: number;
    tree_condition?: string;
    health_status?: string;
  }
): Promise<ApiResponse<TreeRecord>> {
  const { data, error } = await supabase
    .from('tree_records')
    .update(updates)
    .eq('id', treeRecordId)
    .select('*, projects(name)')
    .single();

  if (error) {
    if (isMissingSchemaError(error)) {
      // Measurement columns (dbh_cm, height_m, …) are not deployed yet
      warnNeedsMigration('the measurement columns on tree_records');
      return {
        data: null,
        error:
          'Measurements could not be saved: the database is missing the measurement ' +
          `columns. Run ${SETUP_SQL_FILE} once in the Supabase SQL Editor.`,
      };
    }
    return { data: null, error: error.message };
  }

  return { data: await attachProjectName(mapTreeRecord(data)), error: null };
}
