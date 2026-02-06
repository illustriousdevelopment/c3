interface KeyboardHintsProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ['⌘', 'K'], description: 'Open search' },
  { keys: ['↑', '↓'], description: 'Navigate sessions' },
  { keys: ['j', 'k'], description: 'Navigate sessions (vim)' },
  { keys: ['↵'], description: 'Focus selected session' },
  { keys: ['1-9'], description: 'Quick access to session' },
  { keys: ['⌫'], description: 'Close completed session' },
  { keys: ['?'], description: 'Show keyboard shortcuts' },
  { keys: ['esc'], description: 'Deselect / Close modal' },
];

export function KeyboardHints({ isOpen, onClose }: KeyboardHintsProps) {
  if (!isOpen) return null;

  return (
    <div className="keyboard-overlay" onClick={onClose}>
      <div className="keyboard-modal" onClick={(e) => e.stopPropagation()}>
        <div className="keyboard-header">
          <h2>Keyboard Shortcuts</h2>
          <button className="keyboard-close" onClick={onClose}>×</button>
        </div>
        <div className="keyboard-list">
          {SHORTCUTS.map((shortcut, index) => (
            <div key={index} className="keyboard-item">
              <div className="keyboard-keys">
                {shortcut.keys.map((key, keyIndex) => (
                  <kbd key={keyIndex}>{key}</kbd>
                ))}
              </div>
              <span className="keyboard-description">{shortcut.description}</span>
            </div>
          ))}
        </div>
        <div className="keyboard-footer">
          Press <kbd>?</kbd> anytime to show this help
        </div>
      </div>
    </div>
  );
}
