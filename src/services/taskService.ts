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

  return { data: (data ?? []) as Task[], error: null };
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
