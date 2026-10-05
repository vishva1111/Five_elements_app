import { supabase } from './supabase';
import {
  ProjectGeofence,
  GeofenceCoordinate,
  GeofenceChangeRequest,
  ApiResponse,
  User,
} from '../types';
import { isMissingSchemaError } from './treeService';

// ─── Mathematical & Geometric Helpers ────────────────────────────────────────

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculates the spherical surface area of a polygon in square meters.
 * Uses the spherical excess / l'Huilier formula on Earth's authalic radius.
 */
export function calculatePolygonArea(coords: GeofenceCoordinate[]): number {
  if (!coords || coords.length < 3) return 0;
  const R = 6378137; // WGS84 earth radius in meters
  let total = 0;
  const n = coords.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p1 = coords[i];
    const p2 = coords[j];
    total +=
      toRadians(p2.longitude - p1.longitude) *
      (2 + Math.sin(toRadians(p1.latitude)) + Math.sin(toRadians(p2.latitude)));
  }

  const area = Math.abs((total * R * R) / 2);
  return Math.round(area * 100) / 100;
}

/**
 * Calculates the perimeter of a polygon in meters.
 */
export function calculatePolygonPerimeter(coords: GeofenceCoordinate[]): number {
  if (!coords || coords.length < 2) return 0;
  let dist = 0;
  for (let i = 0; i < coords.length; i++) {
    const next = coords[(i + 1) % coords.length];
    dist += haversineDistance(coords[i].latitude, coords[i].longitude, next.latitude, next.longitude);
  }
  return Math.round(dist * 10) / 10;
}

export function sqMetersToHectares(sqM: number): number {
  return Math.round((sqM / 10000) * 100) / 100;
}

export function sqMetersToAcres(sqM: number): number {
  return Math.round(sqM * 0.000247105 * 100) / 100;
}

/**
 * Point-in-polygon ray-casting algorithm to test whether a coordinate is inside the boundary.
 */
export function isPointInPolygon(
  point: { latitude: number; longitude: number },
  polygon: GeofenceCoordinate[]
): boolean {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  const x = point.longitude;
  const y = point.latitude;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].longitude;
    const yi = polygon[i].latitude;
    const xj = polygon[j].longitude;
    const yj = polygon[j].latitude;

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

// ─── Fetch Project Geofence ──────────────────────────────────────────────────

export async function fetchProjectGeofence(projectId: string): Promise<ApiResponse<ProjectGeofence | null>> {
  if (!projectId) return { data: null, error: 'No project ID specified' };

  try {
    // 1. Try Supabase first
    const { data, error } = await supabase
      .from('project_geofences')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };

    const parsedCoords = typeof data.coordinates === 'string' ? JSON.parse(data.coordinates) : data.coordinates;
    const geofence: ProjectGeofence = {
      ...data,
      coordinates: parsedCoords || [],
      area_hectares: sqMetersToHectares(data.area_sq_m || 0),
      area_acres: sqMetersToAcres(data.area_sq_m || 0),
    };
    return { data: geofence, error: null };
  } catch (err: any) {
    return { data: null, error: err?.message ?? 'Could not load the land boundary.' };
  }
}

// ─── Check if Project has Geofence Completed ────────────────────────────────

export async function isProjectGeofenceCompleted(projectId: string): Promise<boolean> {
  if (!projectId) return false;
  const res = await fetchProjectGeofence(projectId);
  return !!res.data && res.data.coordinates && res.data.coordinates.length >= 3 && !!res.data.locked;
}

// ─── Save Project Geofence ───────────────────────────────────────────────────

export async function saveProjectGeofence(
  geofenceData: {
    project_id: string;
    project_name?: string;
    coordinates: GeofenceCoordinate[];
    area_sq_m?: number;
    perimeter_m?: number;
    status?: 'draft' | 'pending_admin' | 'locked';
    locked?: boolean;
    locked_by?: string;
    locked_by_name?: string;
    notes?: string;
    user?: User | null;
  }
): Promise<ApiResponse<ProjectGeofence>> {
  const {
    project_id,
    project_name,
    coordinates,
    notes,
    user,
  } = geofenceData;

  if (!coordinates || coordinates.length < 3) {
    return { data: null, error: 'A minimum of 3 corner points is required to form a closed land area.' };
  }

  const area_sq_m = geofenceData.area_sq_m ?? calculatePolygonArea(coordinates);
  const perimeter_m = geofenceData.perimeter_m ?? calculatePolygonPerimeter(coordinates);

  // If user is admin, lock immediately. If field user, can be locked or pending admin
  const isAdmin = user?.role === 'admin';
  const locked = geofenceData.locked ?? true; // default lock once completed
  const status = geofenceData.status ?? (locked ? 'locked' : (isAdmin ? 'locked' : 'pending_admin'));
  const now = new Date().toISOString();

  const record: ProjectGeofence = {
    id: `geo-${project_id}-${Date.now()}`,
    project_id,
    project_name,
    coordinates,
    area_sq_m,
    area_hectares: sqMetersToHectares(area_sq_m),
    area_acres: sqMetersToAcres(area_sq_m),
    perimeter_m,
    status,
    locked,
    locked_at: locked ? now : undefined,
    locked_by: locked ? (geofenceData.locked_by || user?.id) : undefined,
    locked_by_name: locked ? (geofenceData.locked_by_name || user?.full_name || 'Admin') : undefined,
    created_at: now,
    updated_at: now,
    created_by: user?.id,
    notes,
  };

  // Persist to the database. The partner panel reads this row.
  try {
    const dbPayload = {
      project_id,
      project_name,
      coordinates: JSON.stringify(coordinates),
      area_sq_m,
      perimeter_m,
      status,
      locked,
      locked_at: record.locked_at,
      locked_by: record.locked_by,
      locked_by_name: record.locked_by_name,
      created_by: record.created_by,
      notes,
      updated_at: now,
    };

    const { data, error } = await supabase
      .from('project_geofences')
      .upsert(dbPayload, { onConflict: 'project_id' })
      .select()
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    return { data: { ...record, id: data?.id || record.id }, error: null };
  } catch (err: any) {
    return { data: null, error: err?.message ?? 'Could not save the land boundary.' };
  }
}

// ─── Admin Confirm & Lock Geofence ──────────────────────────────────────────

export async function confirmAndLockGeofence(
  projectId: string,
  user: User
): Promise<ApiResponse<ProjectGeofence>> {
  const current = await fetchProjectGeofence(projectId);
  if (!current.data) {
    return { data: null, error: 'No geofence found for this project.' };
  }

  const now = new Date().toISOString();
  const updated: ProjectGeofence = {
    ...current.data,
    locked: true,
    status: 'locked',
    locked_at: now,
    locked_by: user.id,
    locked_by_name: user.full_name || 'Admin',
    updated_at: now,
  };

  const { error } = await supabase
    .from('project_geofences')
    .update({
      locked: true,
      status: 'locked',
      locked_at: now,
      locked_by: user.id,
      locked_by_name: user.full_name || 'Admin',
      updated_at: now,
    })
    .eq('project_id', projectId);

  if (error) return { data: null, error: error.message };
  return { data: updated, error: null };
}

// ─── Admin Unlock Geofence ──────────────────────────────────────────────────

export async function adminUnlockGeofence(
  projectId: string,
  user: User
): Promise<ApiResponse<ProjectGeofence>> {
  if (user.role !== 'admin') {
    return { data: null, error: 'Only administrators can directly unlock a project boundary.' };
  }

  const current = await fetchProjectGeofence(projectId);
  if (!current.data) {
    return { data: null, error: 'No geofence found for this project.' };
  }

  const now = new Date().toISOString();
  const updated: ProjectGeofence = {
    ...current.data,
    locked: false,
    status: 'draft',
    updated_at: now,
  };

  const { error } = await supabase
    .from('project_geofences')
    .update({
      locked: false,
      status: 'draft',
      updated_at: now,
    })
    .eq('project_id', projectId);

  if (error) return { data: null, error: error.message };
  return { data: updated, error: null };
}

// ─── Submit Change Request ──────────────────────────────────────────────────

export async function submitChangeRequest(
  projectId: string,
  projectName: string,
  user: User,
  reason: string
): Promise<ApiResponse<GeofenceChangeRequest>> {
  if (!reason || reason.trim().length < 5) {
    return { data: null, error: 'Please provide a clear reason for requesting a boundary change.' };
  }

  const { data, error } = await supabase
    .from('geofence_change_requests')
    .insert({
      project_id: projectId,
      project_name: projectName,
      requested_by: user.id,
      requested_by_name: user.full_name || user.email || 'User',
      reason: reason.trim(),
      status: 'pending',
    })
    .select()
    .maybeSingle();

  if (error) return { data: null, error: error.message };
  return { data: data as GeofenceChangeRequest, error: null };
}

// ─── Fetch Change Requests ──────────────────────────────────────────────────

export async function fetchChangeRequests(projectId?: string): Promise<ApiResponse<GeofenceChangeRequest[]>> {
  try {
    let query = supabase.from('geofence_change_requests').select('*').order('created_at', { ascending: false });
    if (projectId) query = query.eq('project_id', projectId);

    const { data, error } = await query;
    if (error) return { data: [], error: error.message };
    return { data: data ?? [], error: null };
  } catch (err: any) {
    return { data: [], error: err?.message ?? 'Could not load change requests.' };
  }
}

// ─── Review Change Request (Approve or Reject) ──────────────────────────────

export async function reviewChangeRequest(
  requestId: string,
  approved: boolean,
  adminUser: User,
  reviewNotes?: string
): Promise<ApiResponse<GeofenceChangeRequest>> {
  if (adminUser.role !== 'admin') {
    return { data: null, error: 'Only administrators can review boundary change requests.' };
  }

  const now = new Date().toISOString();
  const status = approved ? 'approved' : 'rejected';

  const { data, error } = await supabase
    .from('geofence_change_requests')
    .update({
      status,
      reviewed_at: now,
      reviewed_by: adminUser.id,
      reviewed_by_name: adminUser.full_name || 'Admin',
      review_notes: reviewNotes,
    })
    .eq('id', requestId)
    .select()
    .maybeSingle();

  if (error) return { data: null, error: error.message };
  if (approved && data?.project_id) {
    await adminUnlockGeofence(data.project_id, adminUser);
  }
  return { data: data as GeofenceChangeRequest, error: null };
}
