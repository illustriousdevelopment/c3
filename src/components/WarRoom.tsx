import { useState } from 'react';
import { useSessionStore } from '../stores/sessions';
import { Lane } from './Lane';
import { PinnedLane } from './PinnedLane';
import { LANES, SessionState, STATE_COLORS } from '../types';

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
  const [activeFilter, setActiveFilter] = useState<FilterOption>('all');

  const sessionList = Object.values(sessions);

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

  if (sessionList.length === 0) {
    return (
      <div className="war-room empty">
        <div className="empty-state">
          <div className="empty-icon">◇</div>
          <h2>No Active Sessions</h2>
          <p>Start a Claude Code session in tmux to see it here.</p>
          <p className="hint">
            C3 scans tmux for Claude panes every few seconds.
          </p>
        </div>
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
      </div>

      {/* Pinned Lane - always at top when not filtering by other criteria */}
      {(activeFilter === 'all' || activeFilter === 'pinned') && pinnedSessions.length > 0 && (
        <PinnedLane sessions={pinnedSessions} />
      )}

      {/* Regular Lanes — exclude pinned sessions to avoid duplication */}
      {activeFilter !== 'pinned' && lanesToShow.map((lane) => {
        const laneSessions = (activeFilter === 'all')
          ? filteredSessions.filter((s) => !sessionMeta[s.id]?.pinned)
          : filteredSessions;
        return <Lane key={lane.id} lane={lane} sessions={laneSessions} />;
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
    </div>
  );
}
