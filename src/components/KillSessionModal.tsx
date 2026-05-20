import { AlertTriangle } from 'lucide-react';
import type { C3Session } from '../types';

interface KillSessionModalProps {
  session: C3Session | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function KillSessionModal({ session, onConfirm, onCancel }: KillSessionModalProps) {
  if (!session) return null;

  return (
    <div className="kill-overlay" onClick={onCancel}>
      <div className="kill-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kill-header">
          <div className="kill-icon">
            <AlertTriangle size={18} />
          </div>
          <div>
            <h2>Kill terminal?</h2>
            <p>This will terminate the tmux pane for this session.</p>
          </div>
        </div>

        <div className="kill-body">
          <span className="kill-session-name">{session.projectName}</span>
          {(session.tmuxTarget || session.terminalTty) && (
            <code>{session.tmuxTarget || session.terminalTty}</code>
          )}
        </div>

        <div className="kill-actions">
          <button className="kill-btn secondary" onClick={onCancel}>
            Back
          </button>
          <button className="kill-btn danger" onClick={onConfirm}>
            Proceed
          </button>
        </div>
      </div>
    </div>
  );
}
