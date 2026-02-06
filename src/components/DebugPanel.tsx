import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface HookEvent {
  timestamp: string;
  hook_type: string;
  cwd: string;
  matched_session: string | null;
  new_state: string;
  skipped: boolean;
  skip_reason: string | null;
}

interface HookTimestamp {
  session_id: string;
  age_secs: number;
  protected: boolean;
}

interface SessionInfo {
  id: string;
  state: string;
  project_name: string;
  project_path: string | null;
}

interface DebugInfo {
  hook_events: HookEvent[];
  hook_timestamps: HookTimestamp[];
  sessions: SessionInfo[];
}

interface DebugPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DebugPanel({ isOpen, onClose }: DebugPanelProps) {
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

  const refresh = useCallback(async () => {
    try {
      const info = await invoke<DebugInfo>('get_debug_info');
      setDebugInfo(info);
    } catch (e) {
      console.error('Failed to get debug info:', e);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    refresh();
    const interval = setInterval(refresh, 1000);
    return () => clearInterval(interval);
  }, [isOpen, refresh]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !debugInfo) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()} style={{ width: 700, maxHeight: '80vh' }}>
        <div className="settings-header">
          <h2>Debug Panel</h2>
          <button className="settings-close" onClick={onClose}>×</button>
        </div>

        <div style={{ padding: 16, overflow: 'auto', maxHeight: '70vh', fontSize: 12, fontFamily: "'Geist Mono', 'SF Mono', monospace" }}>
          <h3 style={{ color: 'var(--accent-blue)', marginBottom: 8 }}>Sessions ({debugInfo.sessions.length})</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '4px 8px' }}>ID</th>
                <th style={{ padding: '4px 8px' }}>Name</th>
                <th style={{ padding: '4px 8px' }}>State</th>
                <th style={{ padding: '4px 8px' }}>Path</th>
              </tr>
            </thead>
            <tbody>
              {debugInfo.sessions.map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '4px 8px', color: 'var(--text-secondary)' }}>{s.id}</td>
                  <td style={{ padding: '4px 8px', color: 'var(--text-primary)' }}>{s.project_name}</td>
                  <td style={{ padding: '4px 8px', color: s.state === 'Complete' ? 'var(--accent-green)' : s.state === 'AwaitingPermission' ? 'var(--accent-red)' : 'var(--accent-amber)' }}>{s.state}</td>
                  <td style={{ padding: '4px 8px', color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.project_path}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ color: 'var(--accent-blue)', marginBottom: 8 }}>Hook Timestamps (Grace Period)</h3>
          {debugInfo.hook_timestamps.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>No hook timestamps recorded</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>
                  <th style={{ padding: '4px 8px' }}>Session</th>
                  <th style={{ padding: '4px 8px' }}>Age</th>
                  <th style={{ padding: '4px 8px' }}>Protected</th>
                </tr>
              </thead>
              <tbody>
                {debugInfo.hook_timestamps.map((t) => (
                  <tr key={t.session_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '4px 8px', color: 'var(--text-secondary)' }}>{t.session_id}</td>
                    <td style={{ padding: '4px 8px', color: 'var(--text-primary)' }}>{t.age_secs}s</td>
                    <td style={{ padding: '4px 8px', color: t.protected ? 'var(--accent-green)' : 'var(--text-muted)' }}>{t.protected ? 'YES' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 style={{ color: 'var(--accent-blue)', marginBottom: 8 }}>Hook Events (last 50)</h3>
          {debugInfo.hook_events.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No hook events received yet</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>
                  <th style={{ padding: '4px 8px' }}>Time</th>
                  <th style={{ padding: '4px 8px' }}>Type</th>
                  <th style={{ padding: '4px 8px' }}>CWD</th>
                  <th style={{ padding: '4px 8px' }}>Matched</th>
                  <th style={{ padding: '4px 8px' }}>State</th>
                  <th style={{ padding: '4px 8px' }}>Skip</th>
                </tr>
              </thead>
              <tbody>
                {[...debugInfo.hook_events].reverse().map((e, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)', opacity: e.skipped ? 0.5 : 1 }}>
                    <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{e.timestamp}</td>
                    <td style={{ padding: '4px 8px', color: 'var(--text-primary)', fontWeight: 600 }}>{e.hook_type}</td>
                    <td style={{ padding: '4px 8px', color: 'var(--text-muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.cwd.split('/').pop()}</td>
                    <td style={{ padding: '4px 8px', color: e.matched_session ? 'var(--accent-green)' : 'var(--accent-red)' }}>{e.matched_session || 'NONE'}</td>
                    <td style={{ padding: '4px 8px', color: 'var(--text-secondary)' }}>{e.new_state}</td>
                    <td style={{ padding: '4px 8px', color: e.skipped ? 'var(--accent-amber)' : 'var(--text-muted)' }}>{e.skipped ? e.skip_reason : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
