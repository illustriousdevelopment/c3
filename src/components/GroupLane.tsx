import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Edit3, Folder, Trash2 } from 'lucide-react';
import { useSessionStore } from '../stores/sessions';
import { SessionCard } from './SessionCard';
import type { C3Session, SessionGroup } from '../types';

interface GroupLaneProps {
  group: SessionGroup;
  sessions: C3Session[];
  shortcutMap?: Record<string, number>;
  onEdit: (group: SessionGroup) => void;
}

const SESSION_DRAG_TYPE = 'application/x-c3-session-id';

function dataTransferHasType(dataTransfer: DataTransfer, type: string): boolean {
  const types = dataTransfer.types;
  const contains = (types as unknown as { contains?: (value: string) => boolean }).contains;
  if (typeof contains === 'function') {
    return contains.call(types, type);
  }

  return Array.from(types).includes(type);
}

function getDraggedSessionId(dataTransfer: DataTransfer): string {
  return dataTransfer.getData(SESSION_DRAG_TYPE) || dataTransfer.getData('text/plain');
}

export function GroupLane({ group, sessions, shortcutMap = {}, onEdit }: GroupLaneProps) {
  const deleteGroup = useSessionStore((state) => state.deleteGroup);
  const assignSessionGroup = useSessionStore((state) => state.assignSessionGroup);
  const draggingSessionId = useSessionStore((state) => state.draggingSessionId);
  const dragTargetGroupId = useSessionStore((state) => state.dragTargetGroupId);
  const setDragTargetGroupId = useSessionStore((state) => state.setDragTargetGroupId);
  const clearSessionDrag = useSessionStore((state) => state.clearSessionDrag);
  const storageKey = `c3-lane-collapsed-group-${group.id}`;
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    return stored === 'true';
  });
  const [isDropTarget, setIsDropTarget] = useState(false);

  useEffect(() => {
    localStorage.setItem(storageKey, String(isCollapsed));
  }, [isCollapsed, storageKey]);

  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit(group);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    onEdit(group);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = window.confirm(`Delete "${group.name}" and return its sessions to normal lanes?`);
    if (!confirmed) return;
    await deleteGroup(group.id);
  };

  const handleDeleteKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    const confirmed = window.confirm(`Delete "${group.name}" and return its sessions to normal lanes?`);
    if (!confirmed) return;
    await deleteGroup(group.id);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const hasSessionPayload = dataTransferHasType(e.dataTransfer, SESSION_DRAG_TYPE)
      || dataTransferHasType(e.dataTransfer, 'text/plain');
    if (!hasSessionPayload) return;

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setIsDropTarget(true);
    setDragTargetGroupId(group.id);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const sessionId = getDraggedSessionId(e.dataTransfer) || draggingSessionId;
    if (!sessionId) return;

    setIsDropTarget(false);
    clearSessionDrag();
    await assignSessionGroup(sessionId, group.id, 'manual');
  };

  const handleDragLeave = () => {
    setIsDropTarget(false);
    if (dragTargetGroupId === group.id) {
      setDragTargetGroupId(null);
    }
  };

  const isActiveDropTarget = isDropTarget || (Boolean(draggingSessionId) && dragTargetGroupId === group.id);

  return (
    <div
      className={`lane lane-group ${isCollapsed ? 'collapsed' : ''} ${isActiveDropTarget ? 'drop-target' : ''}`}
      data-group-id={group.id}
      style={{ '--lane-color': group.color } as React.CSSProperties}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <button
        className="lane-header group-lane-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
        aria-expanded={!isCollapsed}
      >
        <span className="lane-collapse-icon">
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
        <span className="lane-icon group-lane-color" style={{ color: group.color }}>
          <Folder size={16} />
        </span>
        <span className="lane-title">{group.name}</span>
        <span className="lane-count">{sortedSessions.length}</span>
        <span className="group-lane-actions">
          <span
            role="button"
            tabIndex={0}
            className="group-lane-action"
            title="Edit group"
            onClick={handleEdit}
            onKeyDown={handleEditKeyDown}
          >
            <Edit3 size={13} />
          </span>
          <span
            role="button"
            tabIndex={0}
            className="group-lane-action danger"
            title="Delete group"
            onClick={handleDelete}
            onKeyDown={handleDeleteKeyDown}
          >
            <Trash2 size={13} />
          </span>
        </span>
      </button>

      {!isCollapsed && (
        <div className="lane-content group-lane-content">
          {sortedSessions.map((session) => (
            <SessionCard key={session.id} session={session} shortcut={shortcutMap[session.id]} />
          ))}
          {sortedSessions.length === 0 && (
            <div className="group-lane-empty">Drop sessions here or add match text to auto-fill this group.</div>
          )}
        </div>
      )}
    </div>
  );
}
