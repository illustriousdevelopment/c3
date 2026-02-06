import { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Header } from './components/Header';
import { WarRoom } from './components/WarRoom';
import { ToastContainer } from './components/Toast';
import { SearchModal } from './components/SearchModal';
import { KeyboardHints } from './components/KeyboardHints';
import { SettingsModal } from './components/SettingsModal';
import { DebugPanel } from './components/DebugPanel';
import { initializeSessionListeners, useSessionStore } from './stores/sessions';
import './App.css';

function App() {
  const fetchSessions = useSessionStore((state) => state.fetchSessions);
  const selectNextSession = useSessionStore((state) => state.selectNextSession);
  const selectPrevSession = useSessionStore((state) => state.selectPrevSession);
  const focusSelectedSession = useSessionStore((state) => state.focusSelectedSession);
  const selectedSessionId = useSessionStore((state) => state.selectedSessionId);
  const sessions = useSessionStore((state) => state.sessions);
  const closePane = useSessionStore((state) => state.closePane);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [showKeyboardHints, setShowKeyboardHints] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    // Initialize event listeners and fetch initial sessions
    initializeSessionListeners();

    // Poll for sessions every 5 seconds as a fallback
    const interval = setInterval(() => {
      fetchSessions();
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchSessions]);

  // Global keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't handle shortcuts when search is open (it has its own handlers)
    if (isSearchOpen) return;

    // Don't handle if focus is in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    // Cmd+K or Ctrl+K to open search
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setIsSearchOpen(true);
      return;
    }

    // Arrow key navigation
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      selectNextSession();
      return;
    }

    if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      selectPrevSession();
      return;
    }

    // Enter to focus selected session
    if (e.key === 'Enter') {
      e.preventDefault();
      focusSelectedSession();
      return;
    }

    // Delete/Backspace to close completed session
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedSessionId) {
      const session = sessions[selectedSessionId];
      if (session?.state === 'complete' && session.tmuxTarget) {
        e.preventDefault();
        closePane(session.tmuxTarget);
      }
      return;
    }

    // Number keys 1-9 for quick access
    if (e.key >= '1' && e.key <= '9' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const sessionList = Object.values(sessions);
      const index = parseInt(e.key) - 1;
      if (index < sessionList.length) {
        const session = sessionList[index];
        useSessionStore.getState().selectSession(session.id);
        if (session.tmuxTarget) {
          useSessionStore.getState().focusTerminal(session.tmuxTarget);
        }
      }
      return;
    }

    // D to show debug panel
    if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      setShowDebug(true);
      return;
    }

    // ? to show keyboard hints
    if (e.key === '?') {
      e.preventDefault();
      setShowKeyboardHints(true);
      return;
    }

    // Escape to close hints or deselect
    if (e.key === 'Escape') {
      if (showKeyboardHints) {
        setShowKeyboardHints(false);
      } else if (selectedSessionId) {
        useSessionStore.getState().selectSession(null);
      }
      return;
    }
  }, [isSearchOpen, selectNextSession, selectPrevSession, focusSelectedSession, selectedSessionId, sessions, closePane, showKeyboardHints]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="app">
      <Header
        onSearchClick={() => setIsSearchOpen(true)}
        onSettingsClick={() => setShowSettings(true)}
      />
      <main className="main">
        <WarRoom />
      </main>
      <ToastContainer />
      <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
      <KeyboardHints isOpen={showKeyboardHints} onClose={() => setShowKeyboardHints(false)} />
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
      <DebugPanel isOpen={showDebug} onClose={() => setShowDebug(false)} />
    </div>
  );
}

export default App;
