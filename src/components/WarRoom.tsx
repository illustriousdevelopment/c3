import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useSessionStore } from '../stores/sessions';
import { Lane } from './Lane';
import { PinnedLane } from './PinnedLane';
import { GroupLane } from './GroupLane';
import { GroupModal } from './GroupModal';
import { LANES, STATE_COLORS, getVisualSessionOrder } from '../types';
import type { SessionGroup, SessionState } from '../types';

type FilterOption = 'all' | 'pinned' | SessionState;

const FILTER_OPTIONS: { id: FilterOption; label: string; color?: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pinned', label: 'Pinned', color: '#8B5CF6' },
  { id: 'awaiting_permission', label: 'Permission', color: STATE_COLORS.awaiting_permission },
  { id: 'processing', label: 'Working', color: STATE_COLORS.processing },
  { id: 'complete', label: 'Idle', color: STATE_COLORS.complete },
];

export function WarRoom() {
  const sessions = useSessionStore((state) => state.sessions);
  const sessionMeta = useSessionStore((state) => state.sessionMeta);
  const groups = useSessionStore((state) => state.groups);
  const [activeFilter, setActiveFilter] = useState<FilterOption>('all');
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<SessionGroup | null>(null);

  const sessionList = Object.values(sessions);
  const sortedGroups = [...groups].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const groupIds = new Set(sortedGroups.map((group) => group.id));
  const isGrouped = (sessionId: string) => {
    const groupId = sessionMeta[sessionId]?.groupId;
    return Boolean(groupId && groupIds.has(groupId));
  };

  // Build a map of session ID → shortcut number (1-9) based on visual order
  const visualOrder = getVisualSessionOrder(sessionList, sessionMeta, sortedGroups);
  const shortcutMap: Record<string, number> = {};
  visualOrder.forEach((s, i) => {
    if (i < 9) shortcutMap[s.id] = i + 1;
  });

  // Get pinned sessions
  const pinnedSessions = sessionList.filter((s) => sessionMeta[s.id]?.pinned);

  // Filter sessions based on active filter
  const filteredSessions = sessionList.filter((session) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'pinned') return sessionMeta[session.id]?.pinned;
    if (activeFilter === 'complete') {
      return session.state === 'complete' || session.state === 'awaiting_input';
    }
    return session.state === activeFilter;
  });

  // Get counts for each filter option
  const counts: Record<FilterOption, number> = {
    all: sessionList.length,
    pinned: pinnedSessions.length,
    awaiting_permission: sessionList.filter((s) => s.state === 'awaiting_permission').length,
    awaiting_input: 0,
    processing: sessionList.filter((s) => s.state === 'processing' || s.state === 'spawning').length,
    spawning: 0,
    complete: sessionList.filter((s) => s.state === 'complete' || s.state === 'awaiting_input').length,
    error: sessionList.filter((s) => s.state === 'error').length,
  };

  const openNewGroupModal = () => {
    setEditingGroup(null);
    setIsGroupModalOpen(true);
  };

  const openEditGroupModal = (group: SessionGroup) => {
    setEditingGroup(group);
    setIsGroupModalOpen(true);
  };

  const closeGroupModal = () => {
    setEditingGroup(null);
    setIsGroupModalOpen(false);
  };

  if (sessionList.length === 0) {
    return (
      <div className="war-room empty">
        <div className="filter-bar empty-filter-bar">
          <button className="new-group-button" onClick={openNewGroupModal}>
            <Plus size={14} />
            <span>New Group</span>
          </button>
        </div>
        <div className="empty-state">
          <div className="empty-icon">◇</div>
          <h2>No Active Sessions</h2>
          <p>Start a Claude Code or Codex session in tmux to see it here.</p>
          <p className="hint">
            C3 scans tmux for agent panes every few seconds.
          </p>
        </div>
        <GroupModal
          isOpen={isGroupModalOpen}
          group={editingGroup}
          onClose={closeGroupModal}
        />
      </div>
    );
  }

  // Determine which lanes to show based on filter
  const lanesToShow = activeFilter === 'all'
    ? LANES
    : LANES.filter((lane) => lane.states.includes(activeFilter as SessionState));

  return (
    <div className="war-room">
      {/* Filter chips */}
      <div className="filter-bar">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.id}
            className={`filter-chip ${activeFilter === option.id ? 'active' : ''}`}
            onClick={() => setActiveFilter(option.id)}
            style={
              option.color && activeFilter === option.id
                ? { borderColor: option.color, color: option.color }
                : undefined
            }
          >
            {option.color && (
              <span
                className="filter-chip-dot"
                style={{ backgroundColor: option.color }}
              />
            )}
            {option.label}
            {counts[option.id] > 0 && (
              <span className="filter-chip-count">{counts[option.id]}</span>
            )}
          </button>
        ))}
        <button className="new-group-button" onClick={openNewGroupModal}>
          <Plus size={14} />
          <span>New Group</span>
        </button>
      </div>

      {/* Pinned Lane - always at top when not filtering by other criteria */}
      {(activeFilter === 'all' || activeFilter === 'pinned') && pinnedSessions.length > 0 && (
        <PinnedLane sessions={pinnedSessions} shortcutMap={shortcutMap} />
      )}

      {/* Custom group lanes appear below pinned and above status lanes. */}
      {activeFilter === 'all' && sortedGroups.map((group) => {
        const groupSessions = sessionList.filter((session) => (
          !sessionMeta[session.id]?.pinned && sessionMeta[session.id]?.groupId === group.id
        ));

        return (
          <GroupLane
            key={group.id}
            group={group}
            sessions={groupSessions}
            shortcutMap={shortcutMap}
            onEdit={openEditGroupModal}
          />
        );
      })}

      {/* Regular Lanes — exclude pinned/grouped sessions from the all view to avoid duplication. */}
      {activeFilter !== 'pinned' && lanesToShow.map((lane) => {
        const laneSessions = (activeFilter === 'all')
          ? filteredSessions.filter((s) => !sessionMeta[s.id]?.pinned && !isGrouped(s.id))
          : filteredSessions;
        return <Lane key={lane.id} lane={lane} sessions={laneSessions} shortcutMap={shortcutMap} />;
      })}

      {/* No results message when filtering */}
      {filteredSessions.length === 0 && activeFilter !== 'all' && (
        <div className="filter-empty">
          <p>No sessions match the current filter.</p>
          <button
            className="filter-reset"
            onClick={() => setActiveFilter('all')}
          >
            Show all sessions
          </button>
        </div>
      )}
      <GroupModal
        isOpen={isGroupModalOpen}
        group={editingGroup}
        onClose={closeGroupModal}
      />
    </div>
  );
}
