import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, Pin } from 'lucide-react';
import { SessionCard } from './SessionCard';
import type { C3Session } from '../types';

interface PinnedLaneProps {
  sessions: C3Session[];
}

export function PinnedLane({ sessions }: PinnedLaneProps) {
  const storageKey = 'c3-lane-collapsed-pinned';
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    return stored === 'true';
  });

  useEffect(() => {
    localStorage.setItem(storageKey, String(isCollapsed));
  }, [isCollapsed]);

  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );

  if (sortedSessions.length === 0) {
    return null;
  }

  return (
    <div
      className={`lane lane-pinned ${isCollapsed ? 'collapsed' : ''}`}
      style={{ '--lane-color': '#8B5CF6' } as React.CSSProperties}
    >
      <button
        className="lane-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
        aria-expanded={!isCollapsed}
      >
        <span className="lane-collapse-icon">
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
        <span className="lane-icon" style={{ color: '#8B5CF6' }}>
          <Pin size={16} />
        </span>
        <span className="lane-title">PINNED</span>
        <span className="lane-count">{sortedSessions.length}</span>
      </button>

      {!isCollapsed && (
        <div className="lane-content">
          {sortedSessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  );
}
