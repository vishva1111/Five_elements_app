import { supabase } from './supabase';
import { Task } from '../types';

function normalizeTaskStatus(status: unknown, row: Record<string, any>): Task['status'] {
  const value = String(status ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (value === 'in_progress' || value === 'inprogress' || value === 'started' || value === 'ongoing') return 'in_progress';
  if (value === 'completed' || value === 'complete' || value === 'done' || value === 'submitted') return 'completed';
  if (value === 'approved' || value === 'approve') return 'approved';
  if (value === 'rejected' || value === 'reject') return 'rejected';
  if (value === 'assigned' || value === 'assign' || value === 'pending' || value === 'open' || value === 'new') return 'assigned';
  if (!value && !row.completed_at && !row.reviewed_at) return 'assigned';
  return (value || 'assigned') as Task['status'];
}

function isPlantingTask(row: Record<string, any>) {
  const kind = String(row.task_type ?? row.event_type ?? row.type ?? '').trim().toLowerCase();
  if (kind === 'audit' || Number(row.audit_round) > 0) return false;
  if (!kind || kind === 'planting' || kind === 'capture' || kind === 'task') return true;
  const name = String(row.name ?? row.title ?? '').toLowerCase();
  return name.includes('plant');
}

/** Auth id plus the profile id, when the admin panel stores a different user id. */
async function assigneeIdsFor(userId: string): Promise<string[]> {
  const ids = new Set<string>([userId]);
  const { data } = await supabase
    .from('profiles')
    .select('id, auth_id')
    .eq('auth_id', userId)
    .limit(5);
  (data ?? []).forEach((row: { id?: string | null; auth_id?: string | null }) => {
    if (row.id) ids.add(row.id);
    if (row.auth_id) ids.add(row.auth_id);
  });
  return [...ids];
}

export async function fetchAgentTasks(userId: string) {
  const ids = await assigneeIdsFor(userId);
  const columns = ['assignee_id', 'user_id', 'assigned_to', 'agent_id'];
  const byId = new Map<string, Task>();
  let lastError: string | null = null;
  let sawRows = false;

  for (const column of columns) {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .in(column, ids)
      .order('created_at', { ascending: false });

    if (error) {
      lastError = error.message;
      const missing = /column|schema cache|does not exist/i.test(error.message);
      if (missing) continue;
      // A failed assignee_id read must not hide rows stored on another user column.
      if (column === 'assignee_id') continue;
      break;
    }

    const rows = data ?? [];
    if (rows.length > 0) sawRows = true;
    rows.forEach((row: any) => {
      if (!row?.id || byId.has(row.id)) return;
      const task = {
        ...row,
        assignee_id: row.assignee_id || row.user_id || row.assigned_to || row.agent_id || userId,
        project_id: row.project_id || row.project || null,
        status: normalizeTaskStatus(row.status, row),
        task_type: row.task_type || (isPlantingTask(row) ? 'planting' : row.task_type),
        name: row.name || row.title || 'Planting',
      } as Task;
      byId.set(row.id, task);
    });
    // The live table uses assignee_id. Only stop when that read actually found rows.
    if (column === 'assignee_id' && rows.length > 0) break;
  }

  if (!sawRows && lastError) {
    console.error('[taskService] fetchAgentTasks error:', lastError);
    return { data: [] as Task[], error: lastError };
  }

  const tasks = [...byId.values()];

  // Resolve created_by -> assigner's display name (who assigned me this task).
  // No FK-based embed available for this relationship, so it's a second lookup.
  const assignerIds = [...new Set(tasks.map(t => t.created_by).filter(Boolean))] as string[];
  if (assignerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('auth_id, display_name')
      .in('auth_id', assignerIds);
    const nameMap = Object.fromEntries((profiles ?? []).map(p => [p.auth_id, p.display_name]));
    tasks.forEach(t => {
      if (t.created_by) t.assigned_by_name = nameMap[t.created_by] || undefined;
    });
  }

  return { data: tasks, error: null };
}

export async function createTask(task: Omit<Task, 'id' | 'created_at' | 'captured' | 'remaining' | 'progress'>) {
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      ...task,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('[taskService] createTask error:', error.message);
    return { data: null, error: error.message };
  }

  return { data: data as Task, error: null };
}

export async function updateTaskStatus(taskId: string, status: Task['status']) {
  const { error } = await supabase
    .from('tasks')
    .update({ status })
    .eq('id', taskId);

  if (error) {
    console.error('[taskService] updateTaskStatus error:', error.message);
    return { error: error.message };
  }

  return { error: null };
}

export async function startTask(taskId: string) {
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'in_progress', started_at: new Date().toISOString() })
    .eq('id', taskId);

  if (error) {
    console.error('[taskService] startTask error:', error.message);
    return { error: error.message };
  }

  return { error: null };
}

/**
 * Mark a task as completed (status = 'completed').
 * Called automatically when a field user submits a tree capture linked to this task.
 * The task then goes into the partner/admin review queue.
 */
function missingColumnName(message?: string | null): string | null {
  const text = String(message ?? '');
  return (
    text.match(/column\s+(?:\w+\.)?"?([A-Za-z_][\w]*)"?\s+does not exist/i)?.[1] ??
    text.match(/could not find the '([^']+)' column/i)?.[1] ??
    null
  );
}

export async function completeTask(
  taskId: string,
  treeId?: string,
  location?: string,
  options?: { editedAfterReject?: boolean }
) {
  const updates: Record<string, any> = {
    status: 'completed',
    completed_at: new Date().toISOString(),
  };
  // Only a card edited after rejection is marked. A normal completion stays green.
  if (options?.editedAfterReject) updates.review_notes = 'edited';
  if (treeId) {
    updates.tree_id = treeId;
    updates.tree_record_id = treeId;
  }
  if (location) updates.location = location;

  // Status must land even when the live tasks table is missing the extra columns.
  for (let attempt = 0; attempt < 6; attempt++) {
    const { error } = await supabase.from('tasks').update(updates).eq('id', taskId);
    if (!error) return { error: null };

    const column = missingColumnName(error.message);
    if (!column || !(column in updates) || column === 'status' || column === 'completed_at') {
      console.error('[taskService] completeTask error:', error.message);
      return { error: error.message };
    }
    delete updates[column];
  }

  return { error: 'Could not mark the task completed.' };
}

/**
 * Fetch a single task by ID.
 */
export async function fetchTaskById(taskId: string) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  if (error) {
    console.error('[taskService] fetchTaskById error:', error.message);
    return { data: null, error: error.message };
  }

  return { data: data as Task, error: null };
}
