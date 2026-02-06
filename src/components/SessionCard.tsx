import { useState, useEffect, useRef } from 'react';
import { Terminal, ChevronDown, Pin, PinOff, Tag, Trash2 } from 'lucide-react';
import { useSessionStore } from '../stores/sessions';
import type { C3Session } from '../types';
import { STATE_COLORS } from '../types';

interface SessionCardProps {
  session: C3Session;
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 30) return 'just now';
  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function truncatePath(path: string, maxLength: number = 40): string {
  if (!path || path.length <= maxLength) return path || '';
  const parts = path.split('/');
  let result = parts[parts.length - 1];
  for (let i = parts.length - 2; i >= 0 && result.length < maxLength - 3; i--) {
    const newResult = parts[i] + '/' + result;
    if (newResult.length > maxLength - 3) break;
    result = newResult;
  }
  return '.../' + result;
}

function getStateLabel(state: string): string {
  switch (state) {
    case 'awaiting_permission':
      return 'Permission';
    case 'awaiting_input':
      return 'Idle';
    case 'processing':
    case 'spawning':
      return 'Working';
    case 'complete':
      return 'Complete';
    case 'error':
      return 'Error';
    default:
      return state;
  }
}

function truncateCommand(cmd: string | undefined, maxLength: number = 60): string {
  if (!cmd) return '';
  if (cmd.length <= maxLength) return cmd;
  return cmd.slice(0, maxLength - 3) + '...';
}

export function SessionCard({ session }: SessionCardProps) {
  const focusTerminal = useSessionStore((state) => state.focusTerminal);
  const closePane = useSessionStore((state) => state.closePane);
  const selectSession = useSessionStore((state) => state.selectSession);
  const selectedSessionId = useSessionStore((state) => state.selectedSessionId);
  const sessionMeta = useSessionStore((state) => state.sessionMeta);
  const setSessionTag = useSessionStore((state) => state.setSessionTag);
  const setSessionPinned = useSessionStore((state) => state.setSessionPinned);

  const [isHovered, setIsHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  const meta = sessionMeta[session.id] || { pinned: false };
  const isSelected = selectedSessionId === session.id;
  const isPinned = meta.pinned;
  const tag = meta.tag;

  useEffect(() => {
    if (isSelected && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isSelected]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setShowTagInput(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  // Focus tag input when shown
  useEffect(() => {
    if (showTagInput && tagInputRef.current) {
      tagInputRef.current.focus();
      setTagInput(tag || '');
    }
  }, [showTagInput, tag]);

  const color = STATE_COLORS[session.state];
  const isComplete = session.state === 'complete';
  const isPermission = session.state === 'awaiting_permission';
  const isProcessing = session.state === 'processing' || session.state === 'spawning';

  const handleClick = () => {
    selectSession(session.id);
    if (session.tmuxTarget) {
      focusTerminal(session.tmuxTarget);
    }
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (session.tmuxTarget) {
      closePane(session.tmuxTarget);
    }
  };

  const handleMenuToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(!menuOpen);
    setShowTagInput(false);
  };

  const handlePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSessionPinned(session.id, !isPinned);
    setMenuOpen(false);
  };

  const handleTagClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowTagInput(true);
  };

  const handleTagSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSessionTag(session.id, tagInput.trim());
    setShowTagInput(false);
    setMenuOpen(false);
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowTagInput(false);
    }
  };

  const timeAgo = formatTimeAgo(session.lastActivity);
  const lastActivityMs = new Date().getTime() - new Date(session.lastActivity).getTime();
  const isRecentlyActive = lastActivityMs < 30000;
  const isStale = lastActivityMs > 3600000;

  return (
    <div
      ref={cardRef}
      className={`session-card ${isSelected ? 'selected' : ''} ${isStale ? 'stale' : ''} ${isPinned ? 'pinned' : ''}`}
      data-state={session.state}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={`session-indicator ${isProcessing ? 'processing' : ''} ${isPermission ? 'permission' : ''}`}
        style={{ backgroundColor: color }}
      />

      <div className="session-content">
        <div className="session-header">
          <span className="session-name" title={session.projectName}>
            {isRecentlyActive && !isComplete && (
              <span className="activity-dot" />
            )}
            {isPinned && <Pin size={12} className="pin-icon" />}
            {session.projectName}
          </span>
          <div className="session-header-right">
            {tag && (
              <span className="session-tag" title={tag}>
                {tag}
              </span>
            )}
            <span
              className={`session-state-badge state-${session.state}`}
              style={{ borderColor: color, color: color }}
            >
              {getStateLabel(session.state)}
            </span>
          </div>
        </div>

        <div className="session-meta">
          {session.projectPath && (
            <span className="session-path" title={session.projectPath}>
              {truncatePath(session.projectPath)}
            </span>
          )}
          <span className={`session-time ${isRecentlyActive ? 'recent' : ''}`}>
            {timeAgo}
          </span>
        </div>

        {isPermission && session.pendingAction && (
          <div className="session-action">
            <span className="action-tool">
              {session.pendingAction.tool || 'Action'}:
            </span>
            <code className="action-command">
              {truncateCommand(session.pendingAction.command || session.pendingAction.description)}
            </code>
          </div>
        )}

      </div>

      <div className="session-actions">
        {isHovered && session.tmuxTarget && (
          <span className="session-tmux-badge">
            <Terminal size={10} />
            {session.tmuxTarget}
          </span>
        )}

        <div className="session-menu-container" ref={menuRef}>
          <button
            className="session-menu-btn"
            onClick={handleMenuToggle}
            title="Options"
          >
            <ChevronDown size={14} />
          </button>

          {menuOpen && (
            <div className="session-menu">
              {showTagInput ? (
                <form onSubmit={handleTagSubmit} className="tag-input-form">
                  <input
                    ref={tagInputRef}
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    placeholder="Enter tag..."
                    className="tag-input"
                    maxLength={20}
                  />
                  <button type="submit" className="tag-submit">
                    Save
                  </button>
                </form>
              ) : (
                <>
                  <button className="session-menu-item" onClick={handleTagClick}>
                    <Tag size={14} />
                    <span>{tag ? 'Edit tag' : 'Add tag'}</span>
                  </button>
                  <button className="session-menu-item" onClick={handlePin}>
                    {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                    <span>{isPinned ? 'Unpin' : 'Pin'}</span>
                  </button>
                  {session.tmuxTarget && (
                    <button className="session-menu-item danger" onClick={handleClose}>
                      <Trash2 size={14} />
                      <span>Close session</span>
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
