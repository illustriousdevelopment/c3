import { useState, useEffect } from 'react';
import {
  ChevronRight,
  ChevronDown,
  ShieldAlert,
  MessageCircle,
  Loader,
  Coffee,
  AlertTriangle,
  Pin,
} from 'lucide-react';
import { SessionCard } from './SessionCard';
import type { C3Session, Lane as LaneType } from '../types';

interface LaneProps {
  lane: LaneType;
  sessions: C3Session[];
}

const LANE_ICONS: Record<string, React.ReactNode> = {
  ShieldAlert: <ShieldAlert size={16} />,
  MessageCircle: <MessageCircle size={16} />,
  Loader: <Loader size={16} className="spin" />,
  Coffee: <Coffee size={16} />,
  AlertTriangle: <AlertTriangle size={16} />,
  Pin: <Pin size={16} />,
};

export function Lane({ lane, sessions }: LaneProps) {
  const storageKey = `c3-lane-collapsed-${lane.id}`;
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    return stored === 'true';
  });

  const filteredSessions = sessions
    .filter((s) => lane.states.includes(s.state))
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

  useEffect(() => {
    localStorage.setItem(storageKey, String(isCollapsed));
  }, [isCollapsed, storageKey]);

  if (filteredSessions.length === 0) {
    return null;
  }

  const isUrgent = lane.id === 'permission';

  return (
    <div
      className={`lane ${isUrgent ? 'lane-urgent' : ''} ${isCollapsed ? 'collapsed' : ''}`}
      style={{ '--lane-color': lane.color } as React.CSSProperties}
    >
      <button
        className="lane-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
        aria-expanded={!isCollapsed}
      >
        <span className="lane-collapse-icon">
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
        <span className="lane-icon" style={{ color: lane.color }}>
          {LANE_ICONS[lane.icon] || lane.icon}
        </span>
        <span className="lane-title">{lane.title}</span>
        <span className="lane-count">{filteredSessions.length}</span>
      </button>

      {!isCollapsed && (
        <div className="lane-content">
          {filteredSessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  );
}
