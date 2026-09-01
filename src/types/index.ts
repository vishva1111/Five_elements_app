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

export interface TreeRecord {
  id: string;
  user_id: string;
  project_id?: string;
  photo_url: string;
  latitude: number;
  longitude: number;
  species: string;
  health_status: HealthStatus;
  notes?: string;
  submitted_at: string;
  synced: boolean;
  event_type?: EventType;
  quantity?: number;
  // Joined fields
  submitted_by?: string;
  project_name?: string;
}

export interface TreeRecordInsert {
  user_id: string;
  project_id?: string;
  photo_url: string;
  latitude: number;
  longitude: number;
  species: string;
  health_status: HealthStatus;
  notes?: string;
  synced?: boolean;
  event_type?: EventType;
  quantity?: number;
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

// ─── Navigation Types ──────────────────────────────────────────────────────────

export type RootStackParamList = {
  Splash: undefined;
  Login: undefined;
  Main: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Capture: undefined;
  History: undefined;
  Profile: undefined;
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
};

// ─── Store Types ───────────────────────────────────────────────────────────────

export interface AuthState {
  user: User | null;
  session: any | null;
  loading: boolean;
  assignedProjects: Project[];
  // True while the user is choosing their projects on the login page
  projectSelectionPending: boolean;
  setUser: (user: User | null) => void;
  setSession: (session: any | null) => void;
  setLoading: (loading: boolean) => void;
  setAssignedProjects: (projects: Project[]) => void;
  setProjectSelectionPending: (pending: boolean) => void;
  setUserCredits: (credits: number) => void;
  refreshCredits: () => Promise<void>;
  signOut: () => void;
}

// ─── User Project Assignment Types ─────────────────────────────────────────────

export interface UserProject {
  id: string;
  user_id: string;
  project_id: string;
  assigned_at: string;
}

export interface TreeState {
  trees: TreeRecord[];
  loading: boolean;
  setTrees: (trees: TreeRecord[]) => void;
  addTree: (tree: TreeRecord) => void;
  setLoading: (loading: boolean) => void;
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
  health_status: HealthStatus;
  notes: string;
  project_id: string;
  event_type: EventType;
  quantity: number;
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
