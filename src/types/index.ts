export type SessionState =
  | 'spawning'
  | 'processing'
  | 'awaiting_input'
  | 'awaiting_permission'
  | 'complete'
  | 'error';

export interface PendingAction {
  type: 'input' | 'permission';
  description: string;
  tool?: string;
  command?: string;
}

export interface SessionMetrics {
  tokensUsed?: number;
  taskCount?: number;
  startTime?: string;
}

export interface SessionMeta {
  tag?: string;
  pinned: boolean;
}

export interface SessionMetaStore {
  sessions: Record<string, SessionMeta>;
}

export interface C3Session {
  id: string;
  projectName: string;
  projectPath?: string;
  state: SessionState;
  tmuxTarget?: string;
  lastActivity: string;
  pendingAction?: PendingAction;
  metrics?: SessionMetrics;
}

export interface SoundConfig {
  enabled: boolean;
  sound: string | null; // null = default, string = system sound name or file path
}

export interface AppSettings {
  terminal_app: string;
  notifications_enabled: boolean;
  permission_sound: SoundConfig;
  input_sound: SoundConfig;
  complete_sound: SoundConfig;
}

export interface HookStatus {
  hooks_installed: boolean;
  hook_script_exists: boolean;
  jq_installed: boolean;
  terminal_notifier_installed: boolean;
  tmux_installed: boolean;
}

export interface SetupResult {
  success: boolean;
  message: string;
  backup_path: string | null;
}

export interface Lane {
  id: string;
  title: string;
  icon: string;
  states: SessionState[];
  color: string;
}

export const PINNED_LANE: Lane = {
  id: 'pinned',
  title: 'PINNED',
  icon: 'Pin',
  states: [], // Special handling - not based on state
  color: '#8B5CF6',
};

export const LANES: Lane[] = [
  {
    id: 'permission',
    title: 'PERMISSION REQUESTED',
    icon: 'ShieldAlert',
    states: ['awaiting_permission'],
    color: '#EF4444',
  },
  {
    id: 'processing',
    title: 'PROCESSING',
    icon: 'Loader',
    states: ['processing', 'spawning'],
    color: '#3B82F6',
  },
  {
    id: 'idle',
    title: 'IDLE',
    icon: 'Coffee',
    states: ['awaiting_input', 'complete'],
    color: '#F59E0B',
  },
  {
    id: 'error',
    title: 'ERROR',
    icon: 'AlertTriangle',
    states: ['error'],
    color: '#6B7280',
  },
];

export const STATE_COLORS: Record<SessionState, string> = {
  spawning: '#2563EB',
  processing: '#2563EB',
  awaiting_input: '#D97706',
  awaiting_permission: '#DC2626',
  complete: '#059669',
  error: '#7C3AED',
};
