import { supabase } from './supabase';
import { TreeRecord, TreeRecordInsert, ApiResponse } from '../types';

// ─── Insert a new tree record ──────────────────────────────────────────────────
export async function insertTreeRecord(
  record: TreeRecordInsert
): Promise<ApiResponse<TreeRecord>> {
  const { data, error } = await supabase
    .from('tree_records')
    .insert(record)
    .select()
    .single();

  return {
    data: data as TreeRecord | null,
    error: error?.message ?? null,
  };
}

// ─── Fetch my tree records ─────────────────────────────────────────────────────
export async function fetchMyTrees(
  userId: string
): Promise<ApiResponse<TreeRecord[]>> {
  const { data, error } = await supabase
    .from('tree_records')
    .select('*')
    .eq('user_id', userId)
    .order('submitted_at', { ascending: false });

  return {
    data: data as TreeRecord[] | null,
    error: error?.message ?? null,
  };
}

// ─── Fetch single tree record ──────────────────────────────────────────────────
export async function fetchTreeById(
  id: string
): Promise<ApiResponse<TreeRecord>> {
  const { data, error } = await supabase
    .from('tree_records')
    .select('*')
    .eq('id', id)
    .single();

  return {
    data: data as TreeRecord | null,
    error: error?.message ?? null,
  };
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