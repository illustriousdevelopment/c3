import { useState, useEffect, useRef, useMemo } from 'react';
import { Pin } from 'lucide-react';
import { useSessionStore } from '../stores/sessions';
import type { C3Session, SessionMeta } from '../types';
import { STATE_COLORS } from '../types';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function getStateLabel(state: string): string {
  switch (state) {
    case 'awaiting_permission':
      return 'Permission';
    case 'awaiting_input':
      return 'Awaiting';
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

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) return text;

  return (
    <>
      {text.slice(0, index)}
      <mark className="search-highlight">{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

function fuzzyMatch(text: string, query: string): number {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  // Exact match gets highest score
  if (lowerText === lowerQuery) return 100;

  // Starts with query
  if (lowerText.startsWith(lowerQuery)) return 90;

  // Contains query
  if (lowerText.includes(lowerQuery)) return 70;

  // Fuzzy character matching
  let queryIndex = 0;
  let score = 0;
  for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[queryIndex]) {
      score += 10;
      queryIndex++;
    }
  }

  return queryIndex === lowerQuery.length ? score : 0;
}

function searchSessions(
  sessions: C3Session[],
  sessionMeta: Record<string, SessionMeta>,
  query: string
): C3Session[] {
  if (!query.trim()) return sessions;

  const scored = sessions.map((session) => {
    const meta = sessionMeta[session.id];
    const nameScore = fuzzyMatch(session.projectName, query);
    const pathScore = session.projectPath ? fuzzyMatch(session.projectPath, query) * 0.8 : 0;
    const actionScore = session.pendingAction?.description
      ? fuzzyMatch(session.pendingAction.description, query) * 0.6
      : 0;
    const tmuxScore = session.tmuxTarget
      ? fuzzyMatch(session.tmuxTarget, query) * 0.4
      : 0;
    const tagScore = meta?.tag
      ? fuzzyMatch(meta.tag, query) * 0.9 // Tags have high priority
      : 0;

    return {
      session,
      score: Math.max(nameScore, pathScore, actionScore, tmuxScore, tagScore),
    };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.session);
}

export function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sessions = useSessionStore((state) => state.sessions);
  const sessionMeta = useSessionStore((state) => state.sessionMeta);
  const focusTerminal = useSessionStore((state) => state.focusTerminal);
  const selectSession = useSessionStore((state) => state.selectSession);

  const sessionList = Object.values(sessions);
  const filteredSessions = useMemo(
    () => searchSessions(sessionList, sessionMeta, query),
    [sessionList, sessionMeta, query]
  );

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    // Scroll selected item into view
    if (listRef.current) {
      const selectedItem = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) =>
          Math.min(prev + 1, filteredSessions.length - 1)
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredSessions[selectedIndex]) {
          handleSelect(filteredSessions[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  };

  const handleSelect = (session: C3Session) => {
    selectSession(session.id);
    if (session.tmuxTarget) {
      focusTerminal(session.tmuxTarget);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-wrapper">
          <span className="search-icon">⌘K</span>
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Search sessions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {query && (
            <button
              className="search-clear"
              onClick={() => setQuery('')}
              tabIndex={-1}
            >
              ×
            </button>
          )}
        </div>

        <div className="search-results" ref={listRef}>
          {filteredSessions.length === 0 ? (
            <div className="search-empty">
              {query ? 'No matching sessions' : 'Start typing to search...'}
            </div>
          ) : (
            filteredSessions.map((session, index) => {
              const meta = sessionMeta[session.id];
              return (
                <div
                  key={session.id}
                  className={`search-result ${index === selectedIndex ? 'selected' : ''}`}
                  onClick={() => handleSelect(session)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div
                    className="search-result-indicator"
                    style={{ backgroundColor: STATE_COLORS[session.state] }}
                  />
                  <div className="search-result-content">
                    <div className="search-result-header">
                      <span className="search-result-name">
                        {meta?.pinned && <Pin size={12} className="search-result-pin" />}
                        {highlightMatch(session.projectName, query)}
                      </span>
                      <div className="search-result-badges">
                        {meta?.tag && (
                          <span className="search-result-tag">
                            {highlightMatch(meta.tag, query)}
                          </span>
                        )}
                        <span
                          className="search-result-badge"
                          style={{ color: STATE_COLORS[session.state] }}
                        >
                          {getStateLabel(session.state)}
                        </span>
                      </div>
                    </div>
                    {session.projectPath && (
                      <div className="search-result-path">
                        {highlightMatch(session.projectPath, query)}
                      </div>
                    )}
                    {session.pendingAction && (
                      <div className="search-result-action">
                        {session.pendingAction.tool && (
                          <span className="search-result-tool">
                            {session.pendingAction.tool}:
                          </span>
                        )}
                        <span>{session.pendingAction.description}</span>
                      </div>
                    )}
                  </div>
                  <div className="search-result-hint">
                    {session.tmuxTarget && (
                      <code>{session.tmuxTarget}</code>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="search-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
          <span><kbd>↵</kbd> Focus</span>
          <span><kbd>esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
