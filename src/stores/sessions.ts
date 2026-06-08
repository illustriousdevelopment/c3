import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  AppSettings,
  C3Session,
  GroupAssignment,
  SessionGroup,
  SessionMeta,
  SessionMetaStore,
  SoundConfig,
} from '../types';
import { getVisualSessionOrder } from '../types';

interface SessionStore {
  sessions: Record<string, C3Session>;
  sessionMeta: Record<string, SessionMeta>;
  groups: SessionGroup[];
  draggingSessionId: string | null;
  dragTargetGroupId: string | null;
  selectedSessionId: string | null;
  pendingKillSessionId: string | null;
  isConnected: boolean;
  notificationsEnabled: boolean;

  // Actions
  setSessions: (sessions: C3Session[]) => void;
  updateSession: (session: C3Session) => void;
  removeSession: (sessionId: string) => void;
  selectSession: (sessionId: string | null) => void;
  requestKillSession: (sessionId: string) => void;
  clearKillRequest: () => void;
  setConnected: (connected: boolean) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setDraggingSessionId: (sessionId: string | null) => void;
  setDragTargetGroupId: (groupId: string | null) => void;
  clearSessionDrag: () => void;

  // Session metadata
  setSessionTag: (sessionId: string, tag: string) => Promise<void>;
  setSessionPinned: (sessionId: string, pinned: boolean) => Promise<void>;
  loadSessionMeta: () => Promise<void>;
  upsertGroup: (group: SessionGroup) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  assignSessionGroup: (sessionId: string, groupId: string | null, assignment: GroupAssignment) => Promise<void>;
  autoAssignGroups: (sessions?: C3Session[]) => Promise<void>;

  // Navigation
  selectNextSession: () => void;
  selectPrevSession: () => void;
  focusSelectedSession: () => void;

  // Tauri commands
  fetchSessions: () => Promise<void>;
  focusTerminal: (tmuxTarget: string) => Promise<void>;
  focusSession: (sessionId: string) => Promise<void>;
  sendAction: (sessionId: string, action: string) => Promise<void>;
  closePane: (tmuxTarget: string) => Promise<void>;
  killSession: (sessionId: string) => Promise<void>;
  createNewTask: () => Promise<string>;
}

// Track previous states for notification logic
const previousStates: Record<string, string> = {};
const autoAssigning = new Set<string>();

function applyMetaStore(store: SessionMetaStore): Pick<SessionStore, 'sessionMeta' | 'groups'> {
  return {
    sessionMeta: store.sessions || {},
    groups: store.groups || [],
  };
}

function normalizeNeedle(value: string): string {
  return value.trim().toLowerCase();
}

function sessionMatchesGroup(session: C3Session, group: SessionGroup): boolean {
  const needles = group.matchText.map(normalizeNeedle).filter(Boolean);
  if (needles.length === 0) return false;

  const haystack = `${session.projectName || ''}\n${session.projectPath || ''}`.toLowerCase();
  return needles.some((needle) => haystack.includes(needle));
}

function sortGroupsByCreatedAt(groups: SessionGroup[]): SessionGroup[] {
  return [...groups].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: {},
  sessionMeta: {},
  groups: [],
  draggingSessionId: null,
  dragTargetGroupId: null,
  selectedSessionId: null,
  pendingKillSessionId: null,
  isConnected: false,
  notificationsEnabled: true,

  setSessions: (sessions) => {
    const record: Record<string, C3Session> = {};
    sessions.forEach((s) => {
      record[s.id] = s;
    });
    set({ sessions: record, isConnected: true });
    queueMicrotask(() => {
      get().autoAssignGroups(sessions);
    });
  },

  updateSession: (session) => {
    // Sounds are triggered by the hook-sound event from the backend,
    // not by state transitions (which can also come from the tmux scanner).
    previousStates[session.id] = session.state;

    set((state) => ({
      sessions: { ...state.sessions, [session.id]: session },
    }));
    queueMicrotask(() => {
      get().autoAssignGroups([session]);
    });
  },

  removeSession: (sessionId) => {
    delete previousStates[sessionId];
    set((state) => {
      const { [sessionId]: _, ...rest } = state.sessions;
      return {
        sessions: rest,
        selectedSessionId: state.selectedSessionId === sessionId ? null : state.selectedSessionId,
        pendingKillSessionId: state.pendingKillSessionId === sessionId ? null : state.pendingKillSessionId,
      };
    });
  },

  selectSession: (sessionId) => {
    set({ selectedSessionId: sessionId });
  },

  requestKillSession: (sessionId) => {
    set({ pendingKillSessionId: sessionId });
  },

  clearKillRequest: () => {
    set({ pendingKillSessionId: null });
  },

  setConnected: (connected) => {
    set({ isConnected: connected });
  },

  setNotificationsEnabled: async (enabled) => {
    set({ notificationsEnabled: enabled });
    // Persist to backend so the hook server also respects the toggle
    try {
      const settings = await invoke<AppSettings>('get_settings');
      await invoke('update_settings', { settings: { ...settings, notifications_enabled: enabled } });
    } catch (e) {
      console.error('[C3] Failed to persist notifications_enabled:', e);
    }
  },

  setDraggingSessionId: (sessionId) => {
    set({ draggingSessionId: sessionId });
  },

  setDragTargetGroupId: (groupId) => {
    set({ dragTargetGroupId: groupId });
  },

  clearSessionDrag: () => {
    set({ draggingSessionId: null, dragTargetGroupId: null });
  },

  // Session metadata
  setSessionTag: async (sessionId, tag) => {
    try {
      const result = await invoke<SessionMetaStore>('update_session_meta', {
        sessionId,
        tag,
        pinned: null,
      });
      set(applyMetaStore(result));
    } catch (e) {
      console.error('[C3] Failed to set session tag:', e);
    }
  },

  setSessionPinned: async (sessionId, pinned) => {
    try {
      const result = await invoke<SessionMetaStore>('update_session_meta', {
        sessionId,
        tag: null,
        pinned,
      });
      set(applyMetaStore(result));
    } catch (e) {
      console.error('[C3] Failed to set session pinned:', e);
    }
  },

  loadSessionMeta: async () => {
    try {
      const result = await invoke<SessionMetaStore>('get_session_meta');
      set(applyMetaStore(result));
      queueMicrotask(() => {
        get().autoAssignGroups();
      });
    } catch (e) {
      console.error('[C3] Failed to load session meta:', e);
    }
  },

  upsertGroup: async (group) => {
    try {
      const normalizedGroup: SessionGroup = {
        ...group,
        name: group.name.trim(),
        color: group.color || '#3B82F6',
        matchText: Array.from(new Set(group.matchText.map((text) => text.trim()).filter(Boolean))),
      };
      const result = await invoke<SessionMetaStore>('upsert_session_group', { group: normalizedGroup });
      set(applyMetaStore(result));
      queueMicrotask(() => {
        get().autoAssignGroups();
      });
    } catch (e) {
      console.error('[C3] Failed to save group:', e);
      throw e;
    }
  },

  deleteGroup: async (groupId) => {
    try {
      const result = await invoke<SessionMetaStore>('delete_session_group', { groupId });
      set(applyMetaStore(result));
    } catch (e) {
      console.error('[C3] Failed to delete group:', e);
      throw e;
    }
  },

  assignSessionGroup: async (sessionId, groupId, assignment) => {
    try {
      const result = await invoke<SessionMetaStore>('assign_session_group', {
        sessionId,
        groupId,
        groupAssignment: assignment,
      });
      set(applyMetaStore(result));
    } catch (e) {
      console.error('[C3] Failed to assign session group:', e);
      throw e;
    }
  },

  autoAssignGroups: async (targetSessions) => {
    const { groups, sessions, sessionMeta } = get();
    if (groups.length === 0) return;

    const orderedGroups = sortGroupsByCreatedAt(groups);
    const candidates = targetSessions || Object.values(sessions);

    for (const session of candidates) {
      const meta = sessionMeta[session.id];
      if (meta?.groupId || meta?.groupAssignment === 'manual' || autoAssigning.has(session.id)) {
        continue;
      }

      const group = orderedGroups.find((candidate) => sessionMatchesGroup(session, candidate));
      if (!group) continue;

      autoAssigning.add(session.id);
      try {
        const result = await invoke<SessionMetaStore>('assign_session_group', {
          sessionId: session.id,
          groupId: group.id,
          groupAssignment: 'auto',
        });
        set(applyMetaStore(result));
      } catch (e) {
        console.error('[C3] Failed to auto-assign session group:', e);
      } finally {
        autoAssigning.delete(session.id);
      }
    }
  },

  // Keyboard navigation
  selectNextSession: () => {
    const { sessions, sessionMeta, groups, selectedSessionId } = get();
    const sessionList = getVisualSessionOrder(Object.values(sessions), sessionMeta, groups);
    if (sessionList.length === 0) return;

    const currentIndex = sessionList.findIndex((s) => s.id === selectedSessionId);
    const nextIndex = currentIndex < sessionList.length - 1 ? currentIndex + 1 : 0;
    set({ selectedSessionId: sessionList[nextIndex].id });
  },

  selectPrevSession: () => {
    const { sessions, sessionMeta, groups, selectedSessionId } = get();
    const sessionList = getVisualSessionOrder(Object.values(sessions), sessionMeta, groups);
    if (sessionList.length === 0) return;

    const currentIndex = sessionList.findIndex((s) => s.id === selectedSessionId);
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : sessionList.length - 1;
    set({ selectedSessionId: sessionList[prevIndex].id });
  },

  focusSelectedSession: () => {
    const { selectedSessionId, focusSession } = get();
    if (!selectedSessionId) return;

    focusSession(selectedSessionId);
  },

  fetchSessions: async () => {
    try {
      const sessions = await invoke<C3Session[]>('get_sessions');
      console.log('[C3] Fetched sessions:', sessions.length);
      get().setSessions(sessions);
    } catch (e) {
      console.error('[C3] Failed to fetch sessions:', e);
      get().setConnected(false);
    }
  },

  focusTerminal: async (tmuxTarget) => {
    try {
      await invoke('focus_terminal', { tmuxTarget });
    } catch (e) {
      console.error('[C3] Failed to focus terminal:', e);
    }
  },

  focusSession: async (sessionId) => {
    try {
      await invoke('focus_session', { sessionId });
    } catch (e) {
      console.error('[C3] Failed to focus session:', e);
    }
  },

  sendAction: async (sessionId, action) => {
    try {
      await invoke('send_action', { sessionId, action });
    } catch (e) {
      console.error('[C3] Failed to send action:', e);
    }
  },

  closePane: async (tmuxTarget) => {
    try {
      await invoke('close_pane', { tmuxTarget });
    } catch (e) {
      console.error('[C3] Failed to close pane:', e);
    }
  },

  killSession: async (sessionId) => {
    try {
      await invoke('kill_session', { sessionId });
      get().clearKillRequest();
    } catch (e) {
      console.error('[C3] Failed to kill session:', e);
    }
  },

  createNewTask: async () => {
    try {
      const target = await invoke<string>('create_new_task');
      return target;
    } catch (e) {
      console.error('[C3] Failed to create new task:', e);
      throw e;
    }
  },
}));

// Play sound based on config
async function playSound(config: SoundConfig) {
  if (!config.enabled) return;

  const sound = config.sound || 'Ping'; // Default sound
  try {
    await invoke('play_sound', { sound });
  } catch (e) {
    console.error('[C3] Failed to play sound:', e);
  }
}

// Play the appropriate sound for a hook event type.
// Desktop notifications are handled by the Rust backend via terminal-notifier.
async function triggerSound(type: 'permission' | 'input' | 'complete') {
  try {
    // Check the in-memory toggle first (bell button in header)
    if (!useSessionStore.getState().notificationsEnabled) return;
    const settings = await invoke<AppSettings>('get_settings');
    if (!settings.notifications_enabled) return;
    const soundConfig = type === 'permission' ? settings.permission_sound
      : type === 'input' ? settings.input_sound
      : settings.complete_sound;
    playSound(soundConfig);
  } catch (e) {
    console.error('[C3] Failed to play notification sound:', e);
  }
}

// Initialize event listeners
let initialized = false;
export async function initializeSessionListeners() {
  if (initialized) return;
  initialized = true;

  console.log('[C3] Initializing event listeners...');

  try {
    // Listen for session updates from Rust
    await listen<C3Session>('session-update', (event) => {
      console.log('[C3] Session update:', event.payload.projectName, event.payload.state);
      useSessionStore.getState().updateSession(event.payload);
    });

    await listen<string>('session-removed', (event) => {
      console.log('[C3] Session removed:', event.payload);
      useSessionStore.getState().removeSession(event.payload);
    });

    // Listen for hook-triggered sounds (separate from state changes)
    await listen<string>('hook-sound', (event) => {
      const soundType = event.payload as 'permission' | 'input' | 'complete';
      console.log('[C3] Hook sound:', soundType);
      triggerSound(soundType);
    });

    console.log('[C3] Event listeners ready');
  } catch (e) {
    console.error('[C3] Failed to set up listeners:', e);
  }

  // Initialize notifications toggle from saved settings
  try {
    const settings = await invoke<AppSettings>('get_settings');
    useSessionStore.setState({ notificationsEnabled: settings.notifications_enabled });
  } catch (e) {
    console.error('[C3] Failed to load initial settings:', e);
  }

  await useSessionStore.getState().loadSessionMeta();
  await useSessionStore.getState().fetchSessions();
}
