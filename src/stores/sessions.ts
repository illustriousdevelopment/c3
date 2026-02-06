import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
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
    const state = get();
    const prevSession = state.sessions[session.id];
    const prevState = prevSession?.state || previousStates[session.id];

    // Check for state transitions that trigger notifications
    if (state.notificationsEnabled) {
      if (session.state === 'awaiting_permission' && prevState !== 'awaiting_permission') {
        triggerNotification(session, 'permission');
      } else if (session.state === 'awaiting_input' && prevState !== 'awaiting_input') {
        triggerNotification(session, 'input');
      } else if (session.state === 'complete' && prevState !== 'complete') {
        triggerNotification(session, 'complete');
      }
    }

    // Track previous state
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

// Notification helper
async function triggerNotification(session: C3Session, type: 'permission' | 'input' | 'complete') {
  try {
    // Load settings to get sound config
    const settings = await invoke<AppSettings>('get_settings');

    // Get the right sound config
    let soundConfig: SoundConfig;
    let title: string;
    let body: string;

    switch (type) {
      case 'permission':
        soundConfig = settings.permission_sound;
        title = `Permission Requested: ${session.projectName}`;
        body = `${session.pendingAction?.tool || 'Action'} requires approval`;
        break;
      case 'input':
        soundConfig = settings.input_sound;
        title = `Input Needed: ${session.projectName}`;
        body = session.pendingAction?.description || 'Awaiting your input';
        break;
      case 'complete':
        soundConfig = settings.complete_sound;
        title = `Task Complete: ${session.projectName}`;
        body = 'Session has finished';
        break;
    }

    // Play sound
    playSound(soundConfig);

    // Send notification if enabled
    if (settings.notifications_enabled) {
      let hasPermission = await isPermissionGranted();
      if (!hasPermission) {
        const permission = await requestPermission();
        hasPermission = permission === 'granted';
      }

      if (hasPermission) {
        sendNotification({ title, body });
      }
    }
  } catch (e) {
    console.error('[C3] Failed to send notification:', e);
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

    console.log('[C3] Event listeners ready');
  } catch (e) {
    console.error('[C3] Failed to set up listeners:', e);
  }

  // Initial fetch
  await useSessionStore.getState().fetchSessions();
  await useSessionStore.getState().loadSessionMeta();
}
