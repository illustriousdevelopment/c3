import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { HexColorInput, HexColorPicker } from 'react-colorful';
import { useSessionStore } from '../stores/sessions';
import type { SessionGroup } from '../types';

interface GroupModalProps {
  isOpen: boolean;
  group?: SessionGroup | null;
  onClose: () => void;
}

const DEFAULT_GROUP_COLORS = [
  '#3B82F6',
  '#059669',
  '#D97706',
  '#DC2626',
  '#8B5CF6',
  '#0891B2',
  '#DB2777',
  '#64748B',
];

function parseMatchText(value: string): string[] {
  const seen = new Set<string>();
  const entries: string[] = [];

  for (const raw of value.split(/[\n,]/)) {
    const text = raw.trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    entries.push(text);
  }

  return entries;
}

export function GroupModal({ isOpen, group, onClose }: GroupModalProps) {
  const upsertGroup = useSessionStore((state) => state.upsertGroup);
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_GROUP_COLORS[0]);
  const [matchText, setMatchText] = useState('');
  const isEditing = Boolean(group);

  useEffect(() => {
    if (!isOpen) return;
    setName(group?.name || '');
    setColor(group?.color || DEFAULT_GROUP_COLORS[0]);
    setMatchText(group?.matchText?.join('\n') || '');
  }, [group, isOpen]);

  const matchPreview = useMemo(() => parseMatchText(matchText), [matchText]);
  const derivedName = name.trim() || matchPreview[0] || '';
  const canSave = derivedName.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;

    await upsertGroup({
      id: group?.id || crypto.randomUUID(),
      name: derivedName,
      color,
      matchText: matchPreview,
      createdAt: group?.createdAt || new Date().toISOString(),
    });
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="settings-overlay group-modal-overlay" onKeyDown={handleKeyDown}>
      <form className="settings-modal group-modal" onSubmit={handleSubmit}>
        <div className="settings-header">
          <h2>{isEditing ? 'Edit Group' : 'New Group'}</h2>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="settings-content">
          <div className="settings-group">
            <label className="settings-label" htmlFor="group-name">Name</label>
            <input
              id="group-name"
              className="group-text-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder="oncall"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
            />
          </div>

          <div className="settings-group">
            <label className="settings-label">Color</label>
            <div className="group-color-row">
              {DEFAULT_GROUP_COLORS.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  className={`group-color-swatch ${color.toLowerCase() === swatch.toLowerCase() ? 'active' : ''}`}
                  style={{ backgroundColor: swatch }}
                  title={swatch}
                  onClick={() => setColor(swatch)}
                />
              ))}
            </div>
            <div className="group-color-picker-panel">
              <HexColorPicker color={color} onChange={setColor} />
              <div className="group-color-hex-row">
                <span className="group-color-preview" style={{ backgroundColor: color }} />
                <HexColorInput
                  className="group-hex-input"
                  color={color}
                  onChange={setColor}
                  prefixed
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
            </div>
          </div>

          <div className="settings-group">
            <label className="settings-label" htmlFor="group-match-text">Auto-match text</label>
            <p className="settings-description">
              One item per line, or comma-separated. Matches title or directory path.
            </p>
            <textarea
              id="group-match-text"
              className="group-textarea"
              value={matchText}
              onChange={(e) => setMatchText(e.target.value)}
              onInput={(e) => setMatchText(e.currentTarget.value)}
              placeholder={'/oncall\nincident-'}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              rows={5}
            />
            {matchPreview.length > 0 && (
              <div className="group-match-preview">
                {matchPreview.map((text) => (
                  <span key={text} className="group-match-chip">{text}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="settings-footer">
          <button type="button" className="settings-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="settings-btn primary" disabled={!canSave}>
            {isEditing ? 'Save Changes' : 'Create Group'}
          </button>
        </div>
      </form>
    </div>
  );
}
