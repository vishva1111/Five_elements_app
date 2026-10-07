import { supabase } from './supabase';
import { Task } from '../types';
import { isAutoTreeId, splitLabeledTreeName } from '../utils/treeId';
import { pickBestTree } from './treeService';

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

function quoteFilterValue(value: string) {
  return `"${value.replace(/"/g, '')}"`;
}

/** Auth id, profile id, and the names the new tree assignment column stores. */
async function assigneeIdentity(userId: string): Promise<{ ids: string[]; names: string[] }> {
  const ids = new Set<string>([userId]);
  const names = new Set<string>();
  const addRow = (row: {
    id?: string | null;
    auth_id?: string | null;
    name?: string | null;
    display_name?: string | null;
    full_name?: string | null;
  }) => {
    if (row.id) ids.add(row.id);
    if (row.auth_id) ids.add(row.auth_id);
    [row.name, row.display_name, row.full_name].forEach((name) => {
      const value = String(name ?? '').trim();
      if (value) names.add(value);
    });
  };

  const joined = await supabase
    .from('profiles')
    .select('id, auth_id, name, display_name, full_name')
    .or(`auth_id.eq.${userId},id.eq.${userId}`)
    .limit(5);
  if (!joined.error) {
    (joined.data ?? []).forEach(addRow);
  } else {
    const fallback = await supabase
      .from('profiles')
      .select('id, auth_id, name, display_name, full_name')
      .eq('auth_id', userId)
      .limit(5);
    (fallback.data ?? []).forEach(addRow);
  }
  return { ids: [...ids], names: [...names] };
}

function taskStatusFromTree(row: Record<string, any>): Task['status'] {
  // locked = true means the planting was approved by admin.
  // Audit tasks must only be approved via the tasks table row — never auto-approved
  // from the tree record's locked flag, because that would bypass admin review.
  const isAudit = row.task_type === 'audit' || Number(row.audit_round) > 0;
  if (row.locked === true && !isAudit) return 'approved';
  const raw = String(row.status ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (raw === 'approved' || raw === 'rejected' || raw === 'completed') {
    return normalizeTaskStatus(row.status, row);
  }
  // The new rows keep status "inprogress" for both jobs. A planted tree already
  // has the photo and location the card must show; only a plantation job stays assigned.
  const stage = String(row.stage ?? '').trim().toLowerCase();
  if (stage === 'planted' || stage.includes('completed')) return 'completed';
  return 'assigned';
}

function taskFromTreeRecord(row: Record<string, any>, userId: string): Task {
  const status = taskStatusFromTree(row);
  const labeled = splitLabeledTreeName(row.species);
  const storedCode = String(row.tree_id ?? '').trim();
  const taskCode = storedCode && !isAutoTreeId(storedCode) ? storedCode : labeled.code || storedCode || null;
  const photos = Array.isArray(row.photo_urls)
    ? row.photo_urls.filter((url: unknown): url is string => typeof url === 'string' && !!url)
    : [];
  const name = labeled.name || String(row.species ?? '').trim() || taskCode || 'Planting';
  const latitude = typeof row.latitude === 'number' ? row.latitude : undefined;
  const longitude = typeof row.longitude === 'number' ? row.longitude : undefined;

  return {
    id: String(row.id),
    task_code: taskCode,
    name,
    title: name,
    project_id: row.project_id || null,
    assignee_id: userId,
    target_count: Number(row.quantity) > 0 ? Number(row.quantity) : 1,
    location: latitude != null && longitude != null ? `${latitude},${longitude}` : row.location || undefined,
    priority: 'medium',
    due_date: row.due_date || null,
    started_at: status === 'in_progress' ? row.submitted_at || null : null,
    completed_at: status === 'completed' || status === 'approved' ? row.submitted_at || row.survey_date || null : null,
    created_at: row.submitted_at || row.survey_date || row.created_at || new Date().toISOString(),
    captured: status === 'assigned' || status === 'in_progress' ? 0 : 1,
    remaining: status === 'assigned' || status === 'in_progress' ? 1 : 0,
    progress: status === 'assigned' || status === 'in_progress' ? 0 : 100,
    status,
    tree_id: row.id,
    tree_record_id: row.id,
    notes: row.notes || undefined,
    photo_url: row.photo_url || photos[0],
    scientific_name: row.scientific_name || undefined,
    latitude,
    longitude,
    tree_condition: row.tree_condition || undefined,
    surveyor: row.surveyor || row.assigned_to || undefined,
    task_type: row.task_type || 'planting',
  };
}

/**
 * The changed database stores the assignment on the tree instead of a tasks row.
 * assigned_to is the person's name, and team_member_id is the other user key.
 */
async function fetchAssignedTreeTasks(userId: string, ids: string[], names: string[]) {
  const filters = [
    ...ids.flatMap((id) => [`team_member_id.eq.${id}`, `assigned_to.eq.${id}`]),
    ...names.map((name) => `assigned_to.eq.${quoteFilterValue(name)}`),
  ];
  if (filters.length === 0) return [] as Task[];

  for (let attempt = 0; attempt < 6 && filters.length > 0; attempt++) {
    const { data, error } = await supabase.from('tree_records').select('*').or(filters.join(','));
    if (!error) {
      return (data ?? [])
        .filter((row: any) => row?.id && (row.assigned_to || row.team_member_id))
        .map((row: any) => taskFromTreeRecord(row, userId));
    }
    const column = missingColumnName(error.message);
    if (!column) {
      console.error('[taskService] fetchAssignedTreeTasks error:', error.message);
      return [] as Task[];
    }
    for (let index = filters.length - 1; index >= 0; index--) {
      if (filters[index].startsWith(`${column}.`)) filters.splice(index, 1);
    }
  }
  return [] as Task[];
}

function taskLinkKeys(task: Partial<Task>) {
  return [task.id, task.tree_id, task.tree_record_id, task.task_code]
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** The tasks table no longer stores the card photo, place, or condition. Copy them from the tree. */
async function hydrateTaskDetails(tasks: Task[]) {
  const ids = new Set<string>();
  const codes = new Set<string>();
  tasks.forEach((task) => {
    [task.id, task.tree_id, task.tree_record_id, task.task_code].forEach((value) => {
      const text = String(value ?? '').trim();
      if (!text) return;
      if (isUuid(text)) ids.add(text);
      else codes.add(text);
    });
  });
  if (ids.size === 0 && codes.size === 0) return tasks;

  const rows: Record<string, any>[] = [];
  if (ids.size > 0) {
    const byId = await supabase.from('tree_records').select('*').in('id', [...ids]);
    if (!byId.error) rows.push(...(byId.data ?? []));
  }
  if (codes.size > 0) {
    const byCode = await supabase.from('tree_records').select('*').in('tree_id', [...codes]);
    if (!byCode.error) rows.push(...(byCode.data ?? []));
  }

  const byUuid = new Map(rows.filter((row) => row?.id).map((row) => [String(row.id), row]));
  const rowsByCode = new Map<string, any[]>();
  rows.forEach((row) => {
    const code = String(row?.tree_id ?? '').trim().toLowerCase();
    if (!code) return;
    const list = rowsByCode.get(code) ?? [];
    list.push(row);
    rowsByCode.set(code, list);
  });
  const byCode = new Map(
    [...rowsByCode.entries()].map(([code, list]) => [code, pickBestTree(list)])
  );
  const treeFor = (task: Task) =>
    (task.tree_record_id && byUuid.get(task.tree_record_id)) ||
    (task.tree_id && (byUuid.get(task.tree_id) || byCode.get(String(task.tree_id).trim().toLowerCase()))) ||
    (task.task_code && byCode.get(task.task_code.trim().toLowerCase())) ||
    byUuid.get(task.id);

  return tasks.map((task) => {
    const row = treeFor(task);
    if (!row) return task;
    const card = taskFromTreeRecord(row, task.assignee_id || '');
    const genericName = !task.name || task.name === 'Planting' || task.name === 'Task' || task.name === 'Tree';
    return {
      ...task,
      name: genericName ? card.name : task.name,
      title: task.title || card.name,
      tree_id: isUuid(String(task.tree_id ?? '')) ? task.tree_id : row.id,
      tree_record_id: task.tree_record_id || row.id,
      task_code: task.task_code || card.task_code,
      photo_url: task.photo_url || card.photo_url,
      latitude: task.latitude ?? card.latitude,
      longitude: task.longitude ?? card.longitude,
      location: task.location || card.location,
      tree_condition: task.tree_condition || card.tree_condition,
      surveyor: task.surveyor || card.surveyor,
    };
  });
}

export async function fetchAgentTasks(userId: string) {
  const { ids, names } = await assigneeIdentity(userId);
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
        scientific_name: row.scientific_name || row.scientific || null,
      } as Task;
      byId.set(row.id, task);
    });
    // The live table uses assignee_id. Only stop when that read actually found rows.
    if (column === 'assignee_id' && rows.length > 0) break;
  }

  const tasks = [...byId.values()];
  const treeCards = await fetchAssignedTreeTasks(userId, ids, names);
  const linked = new Set(tasks.flatMap(taskLinkKeys));
  treeCards.forEach((card) => {
    const keys = taskLinkKeys(card);
    if (keys.some((key) => linked.has(key))) return;
    tasks.push(card);
    keys.forEach((key) => linked.add(key));
  });

  if (tasks.length === 0 && lastError) {
    console.error('[taskService] fetchAgentTasks error:', lastError);
    return { data: [] as Task[], error: lastError };
  }

  // Rejected, completed, and approved task rows no longer carry the tree photo,
  // location, or condition. Fill those card details from the linked tree.
  const detailed = await hydrateTaskDetails(tasks);

  // Resolve created_by -> assigner's display name (who assigned me this task).
  // No FK-based embed available for this relationship, so it's a second lookup.
  const assignerIds = [...new Set(detailed.map(t => t.created_by).filter(Boolean))] as string[];
  if (assignerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('auth_id, display_name')
      .in('auth_id', assignerIds);
    const nameMap = Object.fromEntries((profiles ?? []).map(p => [p.auth_id, p.display_name]));
    detailed.forEach(t => {
      if (t.created_by) t.assigned_by_name = nameMap[t.created_by] || undefined;
    });
  }

  return { data: detailed, error: null };
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
