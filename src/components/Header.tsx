import { Search, Bell, BellOff, Settings, Plug, Plus } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSessionStore } from '../stores/sessions';
import { useState, useCallback } from 'react';

interface HeaderProps {
  onSearchClick: () => void;
  onSettingsClick: () => void;
}

export function Header({ onSearchClick, onSettingsClick }: HeaderProps) {
  const sessions = useSessionStore((state) => state.sessions);
  const isConnected = useSessionStore((state) => state.isConnected);
  const notificationsEnabled = useSessionStore((state) => state.notificationsEnabled);
  const setNotificationsEnabled = useSessionStore((state) => state.setNotificationsEnabled);
  const createNewTask = useSessionStore((state) => state.createNewTask);
  const focusTerminal = useSessionStore((state) => state.focusTerminal);
  const [isCreating, setIsCreating] = useState(false);

  const handleNewTask = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const target = await createNewTask();
      // Focus the new terminal
      await focusTerminal(target);
    } catch (e) {
      console.error('Failed to create new task:', e);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    // Only start drag if clicking on the header itself, not on buttons
    if ((e.target as HTMLElement).closest('button, input, .header-right')) return;
    getCurrentWindow().startDragging();
  }, []);

  const sessionList = Object.values(sessions);
  const totalCount = sessionList.length;
  const permissionCount = sessionList.filter(
    (s) => s.state === 'awaiting_permission'
  ).length;
  const awaitingCount = sessionList.filter(
    (s) => s.state === 'awaiting_input'
  ).length;
  const processingCount = sessionList.filter(
    (s) => s.state === 'processing' || s.state === 'spawning'
  ).length;

  return (
    <header className="header" onMouseDown={handleDragStart}>
      <div className="header-left">
        <h1 className="logo">C3</h1>
        <span className="tagline">Claude Command Center</span>
      </div>
      <div className="header-right">
        <button className="search-button" onClick={onSearchClick}>
          <Search size={14} />
          <span className="search-button-text">Search</span>
          <kbd className="search-button-kbd">⌘K</kbd>
        </button>

        <button
          className="new-task-button"
          onClick={handleNewTask}
          disabled={isCreating}
          title="Create new tmux window"
        >
          <Plus size={14} />
          <span>New Task</span>
        </button>

        <button
          className={`header-icon-btn ${notificationsEnabled ? 'active' : ''}`}
          onClick={() => setNotificationsEnabled(!notificationsEnabled)}
          title={notificationsEnabled ? 'Notifications on' : 'Notifications off'}
        >
          {notificationsEnabled ? <Bell size={14} /> : <BellOff size={14} />}
        </button>

        <div className="header-stats">
          {permissionCount > 0 && (
            <span className="stat-badge stat-permission">
              {permissionCount}
            </span>
          )}
          {awaitingCount > 0 && (
            <span className="stat-badge stat-awaiting">
              {awaitingCount}
            </span>
          )}
          {processingCount > 0 && (
            <span className="stat-badge stat-processing">
              {processingCount}
            </span>
          )}
          <span className="stat-total">
            {totalCount} session{totalCount !== 1 ? 's' : ''}
          </span>
        </div>

        <button
          className={`header-icon-btn connection-indicator ${isConnected ? 'connected' : 'disconnected'}`}
          title={isConnected ? 'WebSocket connected' : 'WebSocket disconnected'}
          style={{ cursor: 'default' }}
        >
          <Plug size={14} />
        </button>

        <button
          className="header-icon-btn"
          onClick={onSettingsClick}
          title="Settings"
        >
          <Settings size={14} />
        </button>
      </div>
    </header>
  );
}
