import { supabase } from './supabase';
import { Task } from '../types';

export async function fetchAgentTasks(userId: string) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('assignee_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[taskService] fetchAgentTasks error:', error.message);
    return { data: [] as Task[], error: error.message };
  }

  const tasks = (data ?? []) as Task[];

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
export async function completeTask(taskId: string, treeId?: string, location?: string) {
  const updates: Record<string, any> = {
    status: 'completed',
    completed_at: new Date().toISOString(),
  };
  if (treeId) updates.tree_id = treeId;
  if (location) updates.location = location;

  const { error } = await supabase
    .from('tasks')
    .update(updates)
    .eq('id', taskId);

  if (error) {
    console.error('[taskService] completeTask error:', error.message);
    return { error: error.message };
  }

  return { error: null };
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
