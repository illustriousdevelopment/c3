import { useEffect, useState, useRef } from 'react';
import { ShieldAlert, MessageCircle, X, ExternalLink } from 'lucide-react';
import { useSessionStore } from '../stores/sessions';
import type { C3Session } from '../types';

interface ToastData {
  id: string;
  session: C3Session;
  timestamp: number;
}

function getToastTitle(session: C3Session): string {
  if (session.state === 'awaiting_permission') {
    return 'Permission Required';
  }
  return 'Input Needed';
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const sessions = useSessionStore((state) => state.sessions);
  const focusTerminal = useSessionStore((state) => state.focusTerminal);
  const seenRef = useRef<Set<string>>(new Set());

  // Detect new awaiting sessions
  useEffect(() => {
    Object.values(sessions).forEach((session) => {
      if (
        (session.state === 'awaiting_input' || session.state === 'awaiting_permission') &&
        !seenRef.current.has(session.id)
      ) {
        seenRef.current.add(session.id);
        setToasts((prev) => [
          ...prev,
          {
            id: `${session.id}-${Date.now()}`,
            session,
            timestamp: Date.now(),
          },
        ]);
      } else if (
        session.state !== 'awaiting_input' &&
        session.state !== 'awaiting_permission'
      ) {
        seenRef.current.delete(session.id);
      }
    });
  }, [sessions]);

  const dismissToast = (toastId: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== toastId));
  };

  const dismissAll = () => {
    setToasts([]);
  };

  const handleFocus = (session: C3Session) => {
    if (session.tmuxTarget) {
      focusTerminal(session.tmuxTarget);
    }
    const toast = toasts.find((t) => t.session.id === session.id);
    if (toast) dismissToast(toast.id);
  };

  // Auto-dismiss after 15 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.timestamp < 15000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Escape key dismisses all toasts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && toasts.length > 0) {
        dismissAll();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [toasts.length]);

  if (toasts.length === 0) return null;

  const isPermission = (s: C3Session) => s.state === 'awaiting_permission';

  return (
    <div className="toast-container">
      {toasts.length > 1 && (
        <button className="toast-dismiss-all" onClick={dismissAll}>
          Dismiss all ({toasts.length})
        </button>
      )}
      {toasts.slice(0, 3).map((toast) => (
        <div
          key={toast.id}
          className={`toast ${isPermission(toast.session) ? 'toast-permission' : ''}`}
        >
          <div className="toast-header">
            <span className="toast-icon">
              {isPermission(toast.session) ? (
                <ShieldAlert size={16} />
              ) : (
                <MessageCircle size={16} />
              )}
            </span>
            <span className="toast-title">{getToastTitle(toast.session)}</span>
            <button className="toast-close" onClick={() => dismissToast(toast.id)}>
              <X size={14} />
            </button>
          </div>
          <div className="toast-body">
            <strong>{toast.session.projectName}</strong>
            {toast.session.pendingAction && (
              <div className="toast-action">
                {toast.session.pendingAction.tool && (
                  <span className="toast-tool">{toast.session.pendingAction.tool}:</span>
                )}
                {toast.session.pendingAction.command ? (
                  <code>{toast.session.pendingAction.command.slice(0, 50)}</code>
                ) : (
                  <span>{toast.session.pendingAction.description}</span>
                )}
              </div>
            )}
          </div>
          <div className="toast-buttons">
            <button
              className="toast-btn primary"
              onClick={() => handleFocus(toast.session)}
            >
              <ExternalLink size={12} />
              Focus
            </button>
            <button
              className="toast-btn"
              onClick={() => dismissToast(toast.id)}
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
