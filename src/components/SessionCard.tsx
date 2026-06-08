import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Terminal, ChevronDown, CircleSlash, FolderInput, Pin, PinOff, Tag, Trash2 } from 'lucide-react';
import { useSessionStore } from '../stores/sessions';
import type { C3Session } from '../types';
import { STATE_COLORS } from '../types';

interface SessionCardProps {
  session: C3Session;
  shortcut?: number;
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
      return '!';
    case 'awaiting_input':
      return '○';
    case 'processing':
    case 'spawning':
      return '↻';
    case 'complete':
      return '✓';
    case 'error':
      return '×';
    default:
      return state;
  }
}

function getStateTitle(state: string): string {
  switch (state) {
    case 'awaiting_permission':
      return 'Permission required';
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

function getAgentLabel(agentKind: string | undefined): string {
  switch (agentKind) {
    case 'codex':
      return 'Codex';
    case 'claude':
      return 'Claude';
    default:
      return 'Agent';
  }
}

function truncateCommand(cmd: string | undefined, maxLength: number = 60): string {
  if (!cmd) return '';
  if (cmd.length <= maxLength) return cmd;
  return cmd.slice(0, maxLength - 3) + '...';
}

export function SessionCard({ session, shortcut }: SessionCardProps) {
  const focusSession = useSessionStore((state) => state.focusSession);
  const requestKillSession = useSessionStore((state) => state.requestKillSession);
  const selectSession = useSessionStore((state) => state.selectSession);
  const selectedSessionId = useSessionStore((state) => state.selectedSessionId);
  const sessionMeta = useSessionStore((state) => state.sessionMeta);
  const groups = useSessionStore((state) => state.groups);
  const setSessionTag = useSessionStore((state) => state.setSessionTag);
  const setSessionPinned = useSessionStore((state) => state.setSessionPinned);
  const assignSessionGroup = useSessionStore((state) => state.assignSessionGroup);
  const setDraggingSessionId = useSessionStore((state) => state.setDraggingSessionId);
  const setDragTargetGroupId = useSessionStore((state) => state.setDragTargetGroupId);
  const clearSessionDrag = useSessionStore((state) => state.clearSessionDrag);

  const [isHovered, setIsHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number; width: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const ignoreNextClickRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const pointerDraggingRef = useRef(false);

  const meta = sessionMeta[session.id] || { pinned: false };
  const isSelected = selectedSessionId === session.id;
  const isPinned = meta.pinned;
  const tag = meta.tag;
  const group = groups.find((candidate) => candidate.id === meta.groupId);

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

  useEffect(() => {
    if (!isDragging) return;

    document.body.classList.add('session-dragging-active');
    return () => {
      document.body.classList.remove('session-dragging-active');
    };
  }, [isDragging]);

  const color = STATE_COLORS[session.state];
  const isComplete = session.state === 'complete';
  const isPermission = session.state === 'awaiting_permission';
  const isProcessing = session.state === 'processing' || session.state === 'spawning';

  const handleClick = () => {
    if (ignoreNextClickRef.current) return;
    selectSession(session.id);
    focusSession(session.id);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    selectSession(session.id);
    setShowTagInput(false);
    setMenuOpen(true);
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    requestKillSession(session.id);
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

  const handleGroupAssign = async (e: React.MouseEvent, groupId: string | null) => {
    e.stopPropagation();
    await assignSessionGroup(session.id, groupId, 'manual');
    setMenuOpen(false);
  };

  const targetGroupIdAtPoint = (clientX: number, clientY: number): string | null => {
    const element = document.elementFromPoint(clientX, clientY);
    const groupElement = element?.closest<HTMLElement>('[data-group-id]');
    return groupElement?.dataset.groupId || null;
  };

  const shouldSkipPointerDrag = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('button, input, textarea, .session-menu, .session-menu-container'));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || shouldSkipPointerDrag(e.target)) return;
    pointerStartRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    pointerDraggingRef.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    if (!start) return;

    const distance = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (!pointerDraggingRef.current && distance < 6) return;

    e.preventDefault();
    pointerDraggingRef.current = true;
    setIsDragging(true);
    setDragPreview((current) => ({
      x: e.clientX,
      y: e.clientY,
      width: current?.width ?? Math.min(Math.max(cardRef.current?.getBoundingClientRect().width ?? 280, 260), 420),
    }));
    setDraggingSessionId(session.id);
    setDragTargetGroupId(targetGroupIdAtPoint(e.clientX, e.clientY));
  };

  const finishPointerDrag = async (e: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const wasDragging = pointerDraggingRef.current;
    pointerStartRef.current = null;
    pointerDraggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);

    if (!wasDragging) return;

    ignoreNextClickRef.current = true;
    window.setTimeout(() => {
      ignoreNextClickRef.current = false;
    }, 0);

    const groupId = cancelled ? null : targetGroupIdAtPoint(e.clientX, e.clientY);
    setIsDragging(false);
    setDragPreview(null);
    clearSessionDrag();

    if (groupId) {
      await assignSessionGroup(session.id, groupId, 'manual');
    }
  };

  const timeAgo = formatTimeAgo(session.lastActivity);
  const lastActivityMs = new Date().getTime() - new Date(session.lastActivity).getTime();
  const isRecentlyActive = lastActivityMs < 30000;
  const isStale = lastActivityMs > 3600000;
  const pathLabel = session.projectPath
    ? (isSelected ? session.projectPath : truncatePath(session.projectPath))
    : '';

  const dragPreviewNode = isDragging && dragPreview && typeof document !== 'undefined'
    ? createPortal(
      <div
        className="session-drag-preview"
        style={{
          left: dragPreview.x,
          top: dragPreview.y,
          width: dragPreview.width,
          '--drag-color': color,
        } as React.CSSProperties}
      >
        <span className="session-drag-preview-indicator" />
        <span className="session-drag-preview-body">
          <span className="session-drag-preview-title-row">
            <span className="session-drag-preview-title">
              {isPinned && <Pin size={12} className="pin-icon" />}
              {session.projectName}
            </span>
            <span className={`session-agent-badge agent-${session.agentKind || 'unknown'}`}>
              {getAgentLabel(session.agentKind)}
            </span>
          </span>
          {session.projectPath && (
            <span className="session-drag-preview-path">{truncatePath(session.projectPath, 54)}</span>
          )}
        </span>
        <span className="session-drag-preview-state">{getStateLabel(session.state)}</span>
      </div>,
      document.body
    )
    : null;

  return (
    <>
      <div
        ref={cardRef}
        className={`session-card ${isSelected ? 'selected' : ''} ${isStale ? 'stale' : ''} ${isPinned ? 'pinned' : ''} ${isDragging ? 'dragging' : ''}`}
        data-state={session.state}
        draggable={false}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => { void finishPointerDrag(e); }}
        onPointerCancel={(e) => { void finishPointerDrag(e, true); }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {shortcut && (
          <span className="session-shortcut">{shortcut}</span>
        )}
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
            <span className={`session-agent-badge agent-${session.agentKind || 'unknown'}`}>
              {getAgentLabel(session.agentKind)}
            </span>
            {tag && (
              <span className="session-tag" title={tag}>
                {tag}
              </span>
            )}
            {group && (
              <span
                className="session-group-badge"
                title={`Group: ${group.name}`}
                style={{ '--group-color': group.color } as React.CSSProperties}
              >
                {group.name}
              </span>
            )}
            <span
              className={`session-state-badge state-${session.state}`}
              style={{ borderColor: color, color: color }}
              title={getStateTitle(session.state)}
            >
              {getStateLabel(session.state)}
            </span>
          </div>
        </div>

        <div className="session-meta">
          {session.projectPath && (
            <span className="session-path" title={session.projectPath}>
              <span className="session-path-track">
                <span className="session-path-text">{pathLabel}</span>
                {isSelected && (
                  <span className="session-path-text duplicate">{pathLabel}</span>
                )}
              </span>
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
        {isHovered && !isSelected && (session.tmuxTarget || session.terminalTty) && (
          <span className="session-tmux-badge">
            <Terminal size={10} />
            {session.tmuxTarget || session.terminalTty}
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
                  <div className="session-menu-divider" />
                  <div className="session-menu-label">Send to Group</div>
                  {groups.length === 0 ? (
                    <div className="session-menu-empty">No groups yet</div>
                  ) : (
                    groups.map((candidate) => (
                      <button
                        key={candidate.id}
                        className={`session-menu-item ${meta.groupId === candidate.id ? 'active' : ''}`}
                        onClick={(e) => handleGroupAssign(e, candidate.id)}
                      >
                        <FolderInput size={14} />
                        <span className="session-menu-color-dot" style={{ backgroundColor: candidate.color }} />
                        <span>{candidate.name}</span>
                      </button>
                    ))
                  )}
                  <button
                    className={`session-menu-item ${!meta.groupId && meta.groupAssignment === 'manual' ? 'active' : ''}`}
                    onClick={(e) => handleGroupAssign(e, null)}
                  >
                    <CircleSlash size={14} />
                    <span>No group</span>
                  </button>
                  <div className="session-menu-divider" />
                  <button className="session-menu-item danger" onClick={handleClose}>
                    <Trash2 size={14} />
                    <span>Kill terminal</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      </div>
      {dragPreviewNode}
    </>
  );
}
