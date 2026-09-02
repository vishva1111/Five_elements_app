import { supabase } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TreeRecord, TreeRecordInsert, ApiResponse, Project, User } from '../types';

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

// ─── Detect "column not found in the schema cache" errors from PostgREST ──────
function isMissingColumnError(message?: string | null): boolean {
  return !!message && /Could not find the '(?:[^']*)' column of '(?:[^']*)' in the schema cache|column .*event_type.*does not exist|column .*quantity.*does not exist/i.test(message.trim());
}

// ─── Insert a new tree record ──────────────────────────────────────────────────
export async function insertTreeRecord(
  record: TreeRecordInsert
): Promise<ApiResponse<TreeRecord>> {
  // Try with project join first; fall back to plain select if join fails
  let { data, error } = await supabase
    .from('tree_records')
    .insert(record)
    .select('*, projects(name)')
    .single();

  if (error) {
    // Retry without the join (projects table may not exist yet)
    const retry = await supabase
      .from('tree_records')
      .insert(record)
      .select()
      .single();
    data = retry.data;
    error = retry.error;


  }

  if (error && isMissingColumnError(error.message)) {

    // Schema out of sync — tree_records lacks event_type/quantity columns
    // (run supabase/migrations/000_full_database_setup.sql to add them).
    // Save the record anyway; DB defaults kick in (event_type 'Planting', quantity 1).
    console.warn(
      '[TreeApp] tree_records missing event_type/quantity columns — ' +
      'run supabase/migrations/000_full_database_setup.sql. Saving record without them.'
    );
    const { event_type: _dropEventType, quantity: _dropQuantity, ...baseRecord } = record;
    const retryWithoutExtras = await supabase
      .from('tree_records')
      .insert(baseRecord)
      .select()
      .single();
    data = retryWithoutExtras.data;
    error = retryWithoutExtras.error;
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

// ─── Fetch all trees (admin) ───────────────────────────────────────────────────
export async function fetchAllTrees(): Promise<ApiResponse<TreeRecord[]>> {
  // Try with project join first; fall back to plain select if join fails
  let { data, error } = await supabase
    .from('tree_records')
    .select('*, projects(name)')
    .order('submitted_at', { ascending: false });

  if (error) {
    // Retry without the join (projects table may not exist yet)
    const retry = await supabase
      .from('tree_records')
      .select('*')
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

// ─── Subscribe to realtime tree inserts ───────────────────────────────────────
export function subscribeToTrees(
  onInsert: (tree: TreeRecord) => void
) {
  return supabase
    .channel('tree_records_channel')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'tree_records' },
      (payload) => {
        const tree = mapTreeRecord(payload.new as any);
        attachProjectName(tree)
          .then(onInsert)
          .catch(() => onInsert(tree));
      }
    )
    .subscribe();
}

// ─── Fetch projects list ───────────────────────────────────────────────────────
export async function fetchProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, status')
    .order('name');

  return { data, error: error?.message ?? null };
}

// ─── Create tree record (alias for insertTreeRecord) ──────────────────────────
export async function createTreeRecord(
  record: TreeRecordInsert
): Promise<ApiResponse<TreeRecord>> {
  return insertTreeRecord(record);
}

// ─── Credit calculation helpers ─────────────────────────────────────────────────
// Every user is GIVEN 500 credits upfront. Adding a tree DEDUCTS from that
// balance (credits = 500 − tree count):
// - projects selected → only trees inside those projects deduct credits
// - no projects selected → all of the user's trees deduct credits
export const INITIAL_CREDITS = 500;

export function filterTreesByProjects(
  trees: TreeRecord[] | null,
  projects: Project[]
): TreeRecord[] {
  if (!trees) return [];
  if (!projects || projects.length === 0) return trees;
  const ids = new Set(projects.map((p) => p.id));
  return trees.filter((t) => !t.project_id || ids.has(t.project_id));
}

export function computeCredits(trees: TreeRecord[] | null, projects: Project[]): number {
  const treeCount = filterTreesByProjects(trees, projects).length;
  return Math.max(0, INITIAL_CREDITS - treeCount);
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

  return {
    data: data as Project[] | null,
    error: error?.message ?? null,
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

// ─── Fetch user credits ───────────────────────────────────────────────────────
export async function fetchUserCredits(
  userId: string
): Promise<ApiResponse<number>> {
  const { data, error } = await supabase
    .from('profiles')
    .select('credits')
    .eq('id', userId)
    .maybeSingle();

  // If table doesn't exist or query fails, return null (caller defaults to INITIAL_CREDITS)
  if (error) {
    return { data: null, error: null };
  }

  return { data: data?.credits ?? INITIAL_CREDITS, error: null };
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

// ─── Deduct user credit ───────────────────────────────────────────────────────
export async function deductUserCredit(
  userId: string
): Promise<ApiResponse<number>> {
  const { data, error } = await supabase.rpc('deduct_user_credit', {
    target_user_id: userId,
  });

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as number, error: null };
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
