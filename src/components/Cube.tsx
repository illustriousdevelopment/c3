import { useSessionStore } from '../stores/sessions';
import type { C3Session } from '../types';
import { STATE_COLORS } from '../types';

interface CubeProps {
  session: C3Session;
}

export function Cube({ session }: CubeProps) {
  const focusTerminal = useSessionStore((state) => state.focusTerminal);
  const closePane = useSessionStore((state) => state.closePane);
  const selectSession = useSessionStore((state) => state.selectSession);
  const selectedSessionId = useSessionStore((state) => state.selectedSessionId);

  const isSelected = selectedSessionId === session.id;
  const color = STATE_COLORS[session.state];
  const isComplete = session.state === 'complete';

  const handleClick = () => {
    selectSession(session.id);
    if (session.tmuxTarget) {
      focusTerminal(session.tmuxTarget);
    }
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (session.tmuxTarget) {
      closePane(session.tmuxTarget);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    selectSession(session.id);
    // TODO: Show context menu
  };

  const getAnimationClass = () => {
    switch (session.state) {
      case 'awaiting_input':
        return 'bounce';
      case 'awaiting_permission':
        return 'pulse';
      case 'processing':
      case 'spawning':
        return 'rotate';
      case 'complete':
        return 'glow';
      case 'error':
        return 'flicker';
      default:
        return '';
    }
  };

  const getStatusText = () => {
    if (session.pendingAction) {
      if (session.pendingAction.tool) {
        return `🔐 ${session.pendingAction.tool}?`;
      }
      return session.pendingAction.description.slice(0, 20);
    }
    switch (session.state) {
      case 'processing':
      case 'spawning':
        return 'working...';
      case 'complete':
        return 'done ✓';
      case 'error':
        return 'error';
      case 'awaiting_input':
        return 'input?';
      default:
        return '';
    }
  };

  return (
    <div
      className={`cube-container ${isSelected ? 'selected' : ''}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      title={`${session.projectName}\n${session.tmuxTarget || 'No tmux target'}`}
    >
      {isComplete && session.tmuxTarget && (
        <button
          className="cube-close"
          onClick={handleClose}
          title="Close pane"
        >
          ×
        </button>
      )}
      <div className={`cube ${getAnimationClass()}`}>
        {/* CSS 3D Isometric Cube */}
        <div className="cube-face cube-top" style={{ backgroundColor: color }} />
        <div className="cube-face cube-left" style={{ backgroundColor: color }} />
        <div className="cube-face cube-right" style={{ backgroundColor: color }} />
      </div>
      <div className="cube-label">
        <span className="cube-name">{session.projectName}</span>
        <span className="cube-status">{getStatusText()}</span>
      </div>
    </div>
  );
}
