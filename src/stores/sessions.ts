import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { C3Session, SessionMeta, SessionMetaStore, AppSettings, SoundConfig } from '../types';

interface SessionStore {
  sessions: Record<string, C3Session>;
  sessionMeta: Record<string, SessionMeta>;
  selectedSessionId: string | null;
  isConnected: boolean;
  notificationsEnabled: boolean;

  // Actions
  setSessions: (sessions: C3Session[]) => void;
  updateSession: (session: C3Session) => void;
  removeSession: (sessionId: string) => void;
  selectSession: (sessionId: string | null) => void;
  setConnected: (connected: boolean) => void;
  setNotificationsEnabled: (enabled: boolean) => void;

  // Session metadata
  setSessionTag: (sessionId: string, tag: string) => Promise<void>;
  setSessionPinned: (sessionId: string, pinned: boolean) => Promise<void>;
  loadSessionMeta: () => Promise<void>;

  // Navigation
  selectNextSession: () => void;
  selectPrevSession: () => void;
  focusSelectedSession: () => void;

  // Tauri commands
  fetchSessions: () => Promise<void>;
  focusTerminal: (tmuxTarget: string) => Promise<void>;
  sendAction: (sessionId: string, action: string) => Promise<void>;
  closePane: (tmuxTarget: string) => Promise<void>;
  createNewTask: () => Promise<string>;
}

// Track previous states for notification logic
const previousStates: Record<string, string> = {};

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: {},
  sessionMeta: {},
  selectedSessionId: null,
  isConnected: false,
  notificationsEnabled: true,

  setSessions: (sessions) => {
    const record: Record<string, C3Session> = {};
    sessions.forEach((s) => {
      record[s.id] = s;
    });
    set({ sessions: record, isConnected: true });
  },

  updateSession: (session) => {
    // Sounds are triggered by the hook-sound event from the backend,
    // not by state transitions (which can also come from the tmux scanner).
    previousStates[session.id] = session.state;

    set((state) => ({
      sessions: { ...state.sessions, [session.id]: session },
    }));
  },

  removeSession: (sessionId) => {
    delete previousStates[sessionId];
    set((state) => {
      const { [sessionId]: _, ...rest } = state.sessions;
      return { sessions: rest };
    });
  },

  selectSession: (sessionId) => {
    set({ selectedSessionId: sessionId });
  },

  setConnected: (connected) => {
    set({ isConnected: connected });
  },

  setNotificationsEnabled: (enabled) => {
    set({ notificationsEnabled: enabled });
  },

  // Session metadata
  setSessionTag: async (sessionId, tag) => {
    try {
      const result = await invoke<SessionMetaStore>('update_session_meta', {
        sessionId,
        tag,
        pinned: null,
      });
      set({ sessionMeta: result.sessions });
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
      set({ sessionMeta: result.sessions });
    } catch (e) {
      console.error('[C3] Failed to set session pinned:', e);
    }
  },

  loadSessionMeta: async () => {
    try {
      const result = await invoke<SessionMetaStore>('get_session_meta');
      set({ sessionMeta: result.sessions });
    } catch (e) {
      console.error('[C3] Failed to load session meta:', e);
    }
  },

  // Keyboard navigation
  selectNextSession: () => {
    const { sessions, selectedSessionId } = get();
    const sessionList = Object.values(sessions);
    if (sessionList.length === 0) return;

    const currentIndex = sessionList.findIndex((s) => s.id === selectedSessionId);
    const nextIndex = currentIndex < sessionList.length - 1 ? currentIndex + 1 : 0;
    set({ selectedSessionId: sessionList[nextIndex].id });
  },

  selectPrevSession: () => {
    const { sessions, selectedSessionId } = get();
    const sessionList = Object.values(sessions);
    if (sessionList.length === 0) return;

    const currentIndex = sessionList.findIndex((s) => s.id === selectedSessionId);
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : sessionList.length - 1;
    set({ selectedSessionId: sessionList[prevIndex].id });
  },

  focusSelectedSession: () => {
    const { sessions, selectedSessionId, focusTerminal } = get();
    if (!selectedSessionId) return;

    const session = sessions[selectedSessionId];
    if (session?.tmuxTarget) {
      focusTerminal(session.tmuxTarget);
    }
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

  // Initial fetch
  await useSessionStore.getState().fetchSessions();
  await useSessionStore.getState().loadSessionMeta();
}
