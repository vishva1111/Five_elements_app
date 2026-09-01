import { supabase } from './supabase';
import { TreeRecord, TreeRecordInsert, ApiResponse, Project, User } from '../types';

// ─── Transform raw Supabase row into TreeRecord with joined project_name ───────
function mapTreeRecord(raw: any): TreeRecord {
  if (!raw) return null as any;
  return {
    ...raw,
    project_name: raw.projects?.name ?? raw.project_name,
  };
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

  return { data: mapTreeRecord(data), error: null };
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

  const trees = (data ?? []).map(mapTreeRecord);
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

  return { data: mapTreeRecord(data), error: null };
}

// ─── Fetch all trees (admin) ───────────────────────────────────────────────────
export async function fetchAllTrees(): Promise<ApiResponse<TreeRecord[]>> {
  const { data, error } = await supabase
    .from('tree_records')
    .select('*')
    .order('submitted_at', { ascending: false });

  return {
    data: data as TreeRecord[] | null,
    error: error?.message ?? null,
  };
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
        onInsert(payload.new as TreeRecord);
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

  // If table doesn't exist or query fails, return null (caller defaults to 10)
  if (error) {
    return { data: null, error: null };
  }

  return { data: data?.credits ?? 10, error: null };
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
    credits: credits ?? profile?.credits ?? 10,
  };
}
