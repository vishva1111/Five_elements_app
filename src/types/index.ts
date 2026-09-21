// ─── Auth Types ───────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  full_name?: string;
  role: 'admin' | 'field_user' | 'partner';
  avatar_url?: string;
  created_at: string;
  credits: number;
}

// ─── Tree Record Types ─────────────────────────────────────────────────────────

export type HealthStatus = 'healthy' | 'sick' | 'dead' | 'unknown';
export type TreeCondition = 'Healthy' | 'Stressed' | 'Diseased' | 'Dead';
export type MultiStemOption = 'Yes' | 'No';
export type LandType = 'Roadside' | 'Park' | 'Residential' | 'Institutional' | 'Forest' | 'Other';

export interface TreeRecord {
  id: string;
  tree_id?: string;
  user_id: string;
  project_id?: string;
  photo_url: string;
  latitude: number;
  longitude: number;
  species: string;
  scientific_name?: string;
  health_status: HealthStatus;
  notes?: string;
  submitted_at: string;
  synced: boolean;
  event_type?: EventType;
  quantity?: number;
  dbh_cm?: number;
  height_m?: number;
  wood_density?: number;
  crown_diameter_m?: number;
  tree_condition?: TreeCondition;
  multi_stem?: MultiStemOption;
  age_years?: number;
  land_type?: LandType;
  surveyor?: string;
  survey_date?: string;
  locked: boolean;
  // Joined fields
  submitted_by?: string;
  project_name?: string;
}

export interface TreeRecordInsert {
  user_id: string;
  tree_id?: string;
  project_id?: string;
  photo_url: string;
  latitude: number;
  longitude: number;
  species: string;
  scientific_name?: string;
  health_status: HealthStatus;
  notes?: string;
  synced?: boolean;
  event_type?: EventType;
  quantity?: number;
  dbh_cm?: number;
  height_m?: number;
  wood_density?: number;
  crown_diameter_m?: number;
  tree_condition?: TreeCondition;
  multi_stem?: MultiStemOption;
  age_years?: number;
  land_type?: LandType;
  surveyor?: string;
  survey_date?: string;
  locked?: boolean;
}

// ─── Location Types ────────────────────────────────────────────────────────────

export interface Coordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

// ─── Project Types ─────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description?: string;
  status: string;
}

// ─── Task Types ────────────────────────────────────────────────────────────────

export type TaskStatus = 'assigned' | 'in_progress' | 'completed' | 'approved' | 'rejected';

export interface Task {
  id: string;
  name: string;
  project_id?: string;
  assignee_id: string;
  target_count: number;
  location?: string;
  priority: 'high' | 'medium' | 'low';
  due_date?: string | null;
  started_at?: string | null;
  created_at: string;
  // Derived live from actual tree captures (never stored — fully automatic)
  captured: number;
  remaining: number;
  progress: number; // 0..100
  status: TaskStatus;
  // Joined fields
  project_name?: string;
  notes?: string;
  // Tree capture fields (for completed tasks from tree captures)
  photo_url?: string;
  latitude?: number;
  longitude?: number;
  tree_condition?: string;
  tree_condition_color?: string;
  surveyor?: string;
}

// ─── Task Store Types ──────────────────────────────────────────────────────────

export interface TaskState {
  tasks: Task[];
  localTasks: Task[]; // tasks created in the UI, stored on-device (no DB needed)
  setTasks: (tasks: Task[]) => void;
  setLocalTasks: (localTasks: Task[]) => void;
}

// ─── Navigation Types ──────────────────────────────────────────────────────────

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
};

export type CaptureStackParamList = {
  CaptureCamera: undefined;
  MapPicker: { photoUri: string; initialCoords?: Coordinates };
  TreeForm: { photoUri: string; coords: Coordinates };
  SubmitSuccess: { treeId: string };
};

export type HistoryStackParamList = {
  HistoryList: undefined;
  TreeDetail: { treeId: string };
  UpdateTree: { treeId: string; treeIdDisplay: string; currentRound: number };
};

// ─── Store Types ───────────────────────────────────────────────────────────────

export interface AuthState {
  user: User | null;
  session: any | null;
  assignedProjects: Project[];
  activeProjectId: string | null;
  // True while the user is choosing their projects on the login page
  projectSelectionPending: boolean;
  setUser: (user: User | null) => void;
  setSession: (session: any | null) => void;
  setAssignedProjects: (projects: Project[]) => void;
  setActiveProjectId: (projectId: string | null) => void;
  setProjectSelectionPending: (pending: boolean) => void;
  setUserCredits: (credits: number) => void;
  refreshCredits: () => Promise<void>;
  signOut: () => Promise<void>;
}

// ─── User Project Assignment Types ─────────────────────────────────────────────

export interface TreeState {
  trees: TreeRecord[];
  setTrees: (trees: TreeRecord[]) => void;
  addTree: (tree: TreeRecord) => void;
  updateTree: (id: string, updates: Partial<TreeRecord>) => void;
  removeTree: (id: string) => void;
}

// ─── API Response Types ────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

// ─── Form Types ────────────────────────────────────────────────────────────────

export type EventType = 'Planting' | 'Installation' | 'Restoration' | 'Measurement' | 'Survey' | 'Other';

export const EVENT_TYPES: EventType[] = [
  'Planting',
  'Installation',
  'Restoration',
  'Measurement',
  'Survey',
  'Other',
];

export interface TreeFormData {
  species: string;
  scientific_name: string;
  health_status: HealthStatus;
  notes: string;
  project_id: string;
  event_type: EventType;
  quantity: number;
  tree_id: string;
  dbh_cm: string;
  height_m: string;
  wood_density: string;
  crown_diameter_m: string;
  tree_condition: TreeCondition;
  multi_stem: MultiStemOption;
  age_years: string;
  land_type: LandType;
  surveyor: string;
  survey_date: string;
}

// ─── Monitoring Record Types ────────────────────────────────────────────────

export interface TreeMonitoringRecord {
  id: string;
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
  tree_condition?: TreeCondition;
  health_status?: HealthStatus;
  survival_status?: 'alive' | 'dead' | 'missing';
  notes?: string;
  surveyor?: string;
  survey_date?: string;
  submitted_at: string;
}

export interface MonitoringFormData {
  dbh_cm: string;
  height_m: string;
  crown_diameter_m: string;
  tree_condition: TreeCondition;
  survival_status: 'alive' | 'dead' | 'missing';
  notes: string;
  surveyor: string;
  survey_date: string;
}

export const TREE_SPECIES = [
  'Teak (Sagwan)',
  'Neem',
  'Peepal',
  'Banyan (Vad)',
  'Mango (Keri)',
  'Coconut (Nariyal)',
  'Bamboo (Vans)',
  'Eucalyptus',
  'Acacia',
  'Gulmohar',
  'Ashoka',
  'Jamun',
  'Amla (Awla)',
  'Arjun',
  'Sheesham (Dalbergia)',
  'Other',
] as const;

export const HEALTH_STATUS_OPTIONS: { label: string; value: HealthStatus; color: string }[] = [
  { label: 'Healthy', value: 'healthy', color: '#22c55e' },
  { label: 'Sick', value: 'sick', color: '#f59e0b' },
  { label: 'Dead', value: 'dead', color: '#ef4444' },
  { label: 'Unknown', value: 'unknown', color: '#6b7280' },
];

export const TREE_CONDITION_OPTIONS: { label: TreeCondition; color: string }[] = [
  { label: 'Healthy', color: '#22c55e' },
  { label: 'Stressed', color: '#f59e0b' },
  { label: 'Diseased', color: '#ef4444' },
  { label: 'Dead', color: '#6b7280' },
];

export const LAND_TYPE_OPTIONS: LandType[] = [
  'Roadside',
  'Park',
  'Residential',
  'Institutional',
  'Forest',
  'Other',
];

// ─── Monitoring Round Types ──────────────────────────────────────────────────

export type MonitoringRound = 1 | 2 | 3 | 4;

export interface MonitoringRoundInfo {
  round: MonitoringRound;
  label: string;
  subtitle: string;
  icon: string;
  color: string;
}

export const MONITORING_ROUNDS: MonitoringRoundInfo[] = [
  { round: 1, label: 'Planting', subtitle: 'Baseline Survey / Plantation Record', icon: 'leaf', color: '#22c55e' },
  { round: 2, label: 'Survival', subtitle: '1st Monitoring', icon: 'heart', color: '#3b82f6' },
  { round: 3, label: 'Growth', subtitle: '2nd Monitoring', icon: 'trending-up', color: '#f59e0b' },
  { round: 4, label: 'Periodic', subtitle: '3rd Monitoring+', icon: 'time', color: '#8b5cf6' },
];

export function getMonitoringRoundInfo(round: number): MonitoringRoundInfo {
  if (round >= 4) return MONITORING_ROUNDS[3];
  return MONITORING_ROUNDS[Math.max(0, Math.min(round - 1, 3))];
}

// ─── Geofence Types ──────────────────────────────────────────────────────────

export interface GeofenceZone {
  id: string;
  treeId: string;
  latitude: number;
  longitude: number;
  radius: number; // meters
  label?: string;
}

export type GeofenceEvent = 'enter' | 'exit';

export interface GeofenceAlert {
  zone: GeofenceZone;
  event: GeofenceEvent;
  timestamp: number;
}

// ─── Map Screen Navigation ──────────────────────────────────────────────────

export type MainTabParamList = {
  Home: undefined;
  Capture: undefined;
  Map: { focusTreeId?: string } | undefined;
  Task: undefined;
  History: undefined;
  Update: undefined;
  Profile: undefined;
};

export type UpdateLookupStackParamList = {
  UpdateLookup: undefined;
  UpdateTree: { treeId: string; treeIdDisplay: string; currentRound: number };
};
