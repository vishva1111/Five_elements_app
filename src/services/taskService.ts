import { supabase } from './supabase';
import { Task, ApiResponse } from '../types';

// ─── Map raw DB row to Task ────────────────────────────────────────────────────
function mapTask(raw: any): Task {
  if (!raw) return null as any;
  const captured = raw.captured ?? 0;
  const target = raw.target_count ?? 1;
  const progress = Math.min(100, Math.round((captured / target) * 100));
  const remaining = Math.max(0, target - captured);
  const status =
    raw.status === 'completed' || captured >= target
      ? 'completed'
      : raw.started_at
      ? 'in_progress'
      : 'assigned';
  return {
    id: raw.id,
    name: raw.name,
    project_id: raw.project_id ?? undefined,
    assignee_id: raw.assignee_id,
    target_count: target,
    location: raw.location ?? undefined,
    priority: raw.priority ?? 'medium',
    due_date: raw.due_date ?? null,
    started_at: raw.started_at ?? null,
    created_at: raw.created_at,
    captured,
    remaining,
    progress,
    status,
    project_name: raw.projects?.name ?? raw.project_name ?? undefined,
  };
}

// ─── Fetch tasks assigned to a user ───────────────────────────────────────────
export async function fetchAgentTasks(
  userId: string
): Promise<ApiResponse<Task[]>> {
  // Try with project join first
  let { data, error } = await supabase
    .from('tasks')
    .select('*, projects(name)')
    .eq('assignee_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    // Retry without join (projects table join may fail)
    const retry = await supabase
      .from('tasks')
      .select('*')
      .eq('assignee_id', userId)
      .order('created_at', { ascending: false });
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    // tasks table may not exist yet — return null so caller falls back to local tasks
    return { data: null, error: null };
  }

  return { data: (data ?? []).map(mapTask), error: null };
}

// ─── Mark a task as started ────────────────────────────────────────────────────
export async function startTask(taskId: string): Promise<ApiResponse<null>> {
  const { error } = await supabase
    .from('tasks')
    .update({ started_at: new Date().toISOString(), status: 'in_progress' })
    .eq('id', taskId);

  return { data: null, error: error?.message ?? null };
}

// ─── Mark a task as completed ──────────────────────────────────────────────────
export async function completeTask(taskId: string): Promise<ApiResponse<null>> {
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'completed' })
    .eq('id', taskId);

  return { data: null, error: error?.message ?? null };
}