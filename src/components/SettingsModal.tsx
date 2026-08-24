import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Volume2, Check, X, AlertTriangle, Download, RefreshCw, Copy, RotateCw, Wifi } from 'lucide-react';
import type { AppSettings, SoundConfig, HookStatus, SetupResult, RemoteAccessInfo } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SOUND_OPTIONS = [
  { id: '', label: 'Default (Ping)' },
  { id: 'Basso', label: 'Basso' },
  { id: 'Blow', label: 'Blow' },
  { id: 'Bottle', label: 'Bottle' },
  { id: 'Frog', label: 'Frog' },
  { id: 'Funk', label: 'Funk' },
  { id: 'Glass', label: 'Glass' },
  { id: 'Hero', label: 'Hero' },
  { id: 'Morse', label: 'Morse' },
  { id: 'Ping', label: 'Ping' },
  { id: 'Pop', label: 'Pop' },
  { id: 'Purr', label: 'Purr' },
  { id: 'Sosumi', label: 'Sosumi' },
  { id: 'Submarine', label: 'Submarine' },
  { id: 'Tink', label: 'Tink' },
  { id: 'custom', label: 'Custom file...' },
];

const defaultSettings: AppSettings = {
  terminal_app: 'auto',
  default_agent: 'codex',
  notifications_enabled: true,
  permission_sound: { enabled: true, sound: null },
  input_sound: { enabled: true, sound: null },
  complete_sound: { enabled: false, sound: null },
  remote_access_enabled: false,
  remote_bind_address: 'auto',
  remote_port: 9399,
  remote_access_token: '',
};

interface SoundConfigRowProps {
  label: string;
  config: SoundConfig;
  onChange: (config: SoundConfig) => void;
}

function SoundConfigRow({ label, config, onChange }: SoundConfigRowProps) {
  const isCustom = config.sound?.startsWith('/') ?? false;
  const selectValue = isCustom ? 'custom' : (config.sound || '');

  const handleSelectChange = async (value: string) => {
    if (value === 'custom') {
      // Open file picker
      const file = await open({
        filters: [{ name: 'Audio', extensions: ['aiff', 'wav', 'mp3', 'caf'] }],
        directory: false,
        multiple: false,
      });
      if (file) {
        onChange({ ...config, sound: file as string });
      }
    } else {
      onChange({ ...config, sound: value || null });
    }
  };

  const playTest = async () => {
    const sound = config.sound || 'Ping';
    try {
      await invoke('play_sound', { sound });
    } catch (e) {
      console.error('Could not play sound:', e);
    }
  };

  return (
    <div className="sound-config-row">
      <label className="settings-checkbox">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
        />
        <span>{label}</span>
      </label>
      {config.enabled && (
        <div className="sound-config-controls">
          <select
            className="settings-select sound-select"
            value={selectValue}
            onChange={(e) => handleSelectChange(e.target.value)}
          >
            {SOUND_OPTIONS.map((sound) => (
              <option key={sound.id} value={sound.id}>
                {sound.label}
              </option>
            ))}
          </select>
          {isCustom && (
            <span className="custom-sound-path" title={config.sound || ''}>
              {config.sound?.split('/').pop()}
            </span>
          )}
          <button
            className="sound-test-btn"
            onClick={playTest}
            title="Test sound"
          >
            <Volume2 size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [availableTerminals, setAvailableTerminals] = useState<string[]>(['auto']);
  const [isSaving, setIsSaving] = useState(false);
  const [hookStatus, setHookStatus] = useState<HookStatus | null>(null);
  const [isInstallingHooks, setIsInstallingHooks] = useState(false);
  const [setupMessage, setSetupMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [remoteInfo, setRemoteInfo] = useState<RemoteAccessInfo | null>(null);
  const [isCheckingRemoteInfo, setIsCheckingRemoteInfo] = useState(true);
  const [remoteInfoError, setRemoteInfoError] = useState<string | null>(null);
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);
  const [copiedPairingLink, setCopiedPairingLink] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const refreshHookStatus = () => {
    invoke<HookStatus>('check_hook_status').then(setHookStatus).catch(console.error);
  };

  const refreshRemoteInfo = async () => {
    setIsCheckingRemoteInfo(true);
    setRemoteInfoError(null);
    try {
      setRemoteInfo(await invoke<RemoteAccessInfo>('get_remote_access_info'));
    } catch (error) {
      setRemoteInfo(null);
      setRemoteInfoError(String(error));
    } finally {
      setIsCheckingRemoteInfo(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      invoke<AppSettings>('get_settings').then(setSettings).catch(console.error);
      invoke<string[]>('get_available_terminals').then(setAvailableTerminals).catch(console.error);
      refreshHookStatus();
      void refreshRemoteInfo();
    } else {
      setSetupMessage(null);
      setCopiedPairingLink(false);
      setSaveError(null);
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await invoke('update_settings', { settings });
      onClose();
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setIsSaving(false);
    }
  };

  const setRemoteEnabled = async (enabled: boolean) => {
    let token = settings.remote_access_token;
    if (enabled && !token) {
      setIsGeneratingToken(true);
      try {
        token = await invoke<string>('generate_remote_access_token');
        refreshRemoteInfo();
      } catch (e) {
        setSaveError(`Could not generate an access token: ${e}`);
        setIsGeneratingToken(false);
        return;
      }
      setIsGeneratingToken(false);
    }
    setSettings((current) => ({
      ...current,
      remote_access_enabled: enabled,
      remote_access_token: token,
    }));
  };

  const regenerateRemoteToken = async () => {
    setIsGeneratingToken(true);
    setCopiedPairingLink(false);
    try {
      const token = await invoke<string>('generate_remote_access_token');
      setSettings((current) => ({ ...current, remote_access_token: token }));
      refreshRemoteInfo();
    } catch (e) {
      setSaveError(`Could not regenerate the access token: ${e}`);
    } finally {
      setIsGeneratingToken(false);
    }
  };

  const pairingHost = remoteInfo?.bindAddress?.includes(':')
    ? `[${remoteInfo.bindAddress}]`
    : remoteInfo?.bindAddress;
  const pairingUrl = pairingHost && settings.remote_access_token
    ? `http://${pairingHost}:${settings.remote_port}/#token=${settings.remote_access_token}`
    : null;

  const copyPairingLink = async () => {
    if (!pairingUrl) return;
    await navigator.clipboard.writeText(pairingUrl);
    setCopiedPairingLink(true);
    window.setTimeout(() => setCopiedPairingLink(false), 1800);
  };

  if (!isOpen) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose}>×</button>
        </div>

        <div className="settings-content">
          <div className="settings-group">
            <label className="settings-label">Terminal Application</label>
            <p className="settings-description">
              Terminal app to focus when clicking a session.
            </p>
            <select
              className="settings-select"
              value={settings.terminal_app}
              onChange={(e) => setSettings({ ...settings, terminal_app: e.target.value })}
            >
              {availableTerminals.map((term) => (
                <option key={term} value={term}>
                  {term === 'auto' ? 'Auto-detect' : term}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-group">
            <label className="settings-label">Default Agent</label>
            <p className="settings-description">
              Agent to start when creating a new tmux task.
            </p>
            <select
              className="settings-select"
              value={settings.default_agent}
              onChange={(e) => setSettings({ ...settings, default_agent: e.target.value as AppSettings['default_agent'] })}
            >
              <option value="codex">Codex</option>
              <option value="claude">Claude Code</option>
            </select>
          </div>

          <div className="settings-group">
            <label className="settings-label">Notifications</label>
            <div className="settings-row">
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={settings.notifications_enabled}
                  onChange={(e) => setSettings({ ...settings, notifications_enabled: e.target.checked })}
                />
                <span>Show system notifications</span>
              </label>
            </div>
          </div>

          <div className="settings-group">
            <label className="settings-label">Sounds</label>
            <p className="settings-description">
              Configure sounds for each notification type.
            </p>
            <div className="sound-configs">
              <SoundConfigRow
                label="Permission requested"
                config={settings.permission_sound}
                onChange={(c) => setSettings({ ...settings, permission_sound: c })}
              />
              <SoundConfigRow
                label="Input needed"
                config={settings.input_sound}
                onChange={(c) => setSettings({ ...settings, input_sound: c })}
              />
              <SoundConfigRow
                label="Task complete"
                config={settings.complete_sound}
                onChange={(c) => setSettings({ ...settings, complete_sound: c })}
              />
            </div>
          </div>

          <div className="settings-group remote-access-settings">
            <div className="remote-access-heading">
              <div>
                <label className="settings-label">Remote access</label>
                <p className="settings-description">
                  Check agent status, read a tmux pane, and send a response from your phone.
                </p>
              </div>
              <span className={`remote-network-badge ${remoteInfo?.tailscaleAvailable ? 'available' : ''} ${remoteInfoError ? 'error' : ''}`}>
                <Wifi size={13} />
                {isCheckingRemoteInfo
                  ? 'Checking Tailscale…'
                  : remoteInfoError
                    ? 'Tailscale check failed'
                    : remoteInfo?.tailscaleAvailable
                      ? 'Tailscale ready'
                      : 'Tailscale unavailable'}
              </span>
            </div>

            <label className="settings-checkbox remote-access-toggle">
              <input
                type="checkbox"
                checked={settings.remote_access_enabled}
                disabled={isGeneratingToken || (!settings.remote_access_enabled && (isCheckingRemoteInfo || !remoteInfo?.tailscaleAvailable))}
                onChange={(event) => setRemoteEnabled(event.target.checked)}
              />
              <span>Serve C3 on this Mac&apos;s Tailscale address</span>
            </label>
            {!settings.remote_access_enabled && !isCheckingRemoteInfo && !remoteInfo?.tailscaleAvailable && (
              <p className="remote-network-help">
                {remoteInfoError
                  ? 'C3 could not check Tailscale. Close Settings, confirm Tailscale is running, and try again.'
                  : 'Connect Tailscale on this Mac before enabling remote access.'}
              </p>
            )}

            {settings.remote_access_enabled && (
              <div className="remote-access-panel">
                {remoteInfo?.error ? (
                  <div className="remote-access-warning">
                    <AlertTriangle size={14} />
                    <span>{remoteInfo.error}</span>
                  </div>
                ) : (
                  <div className="remote-access-address">
                    <span>Private address</span>
                    <strong>{remoteInfo?.tailscaleIp || 'Detecting…'}</strong>
                  </div>
                )}

                <label className="remote-port-field">
                  <span>Port</span>
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={settings.remote_port}
                    onChange={(event) => setSettings({
                      ...settings,
                      remote_port: Number(event.target.value),
                    })}
                  />
                </label>

                <div className="pairing-link-field">
                  <label htmlFor="remote-pairing-link">Pairing link</label>
                  <div>
                    <input
                      id="remote-pairing-link"
                      type="text"
                      readOnly
                      value={pairingUrl || 'Connect Tailscale to create a pairing link'}
                    />
                    <button
                      type="button"
                      className="remote-icon-btn"
                      onClick={copyPairingLink}
                      disabled={!pairingUrl}
                      aria-label="Copy pairing link"
                      title="Copy pairing link"
                    >
                      {copiedPairingLink ? <Check size={15} /> : <Copy size={15} />}
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  className="remote-token-btn"
                  onClick={regenerateRemoteToken}
                  disabled={isGeneratingToken}
                >
                  <RotateCw size={13} className={isGeneratingToken ? 'spin' : ''} />
                  Replace access token
                </button>

                <ol className="remote-setup-tips">
                  <li>Connect this Mac and your iPhone to Tailscale.</li>
                  <li>Save settings, then open the pairing link in Safari or C3 Remote.</li>
                  <li>In Safari, use Share → Add to Home Screen for an app-like shortcut.</li>
                </ol>
                <p className="remote-security-note">
                  Keep this private: do not port-forward this address or bind C3 to your LAN.
                </p>
              </div>
            )}
          </div>

          <div className="settings-group">
            <label className="settings-label">Setup Hooks</label>
            <p className="settings-description">
              Install C3 hooks into Claude Code, Codex, and OMP for real-time session tracking.
            </p>

            <div className="hook-status">
              <div className="hook-status-row">
                <span className="hook-status-label">Any hooks installed</span>
                <span className={`hook-status-badge ${hookStatus?.hooks_installed ? 'installed' : 'not-installed'}`}>
                  {hookStatus?.hooks_installed ? <><Check size={12} /> Installed</> : <><X size={12} /> Not installed</>}
                </span>
              </div>
              <div className="hook-status-row">
                <span className="hook-status-label">Claude hooks</span>
                <span className={`hook-status-badge ${hookStatus?.claude_hooks_installed ? 'installed' : 'not-installed'}`}>
                  {hookStatus?.claude_hooks_installed ? <><Check size={12} /> Installed</> : <><X size={12} /> Not installed</>}
                </span>
              </div>
              <div className="hook-status-row">
                <span className="hook-status-label">Codex hooks</span>
                <span className={`hook-status-badge ${hookStatus?.codex_hooks_installed ? 'installed' : 'not-installed'}`}>
                  {hookStatus?.codex_hooks_installed ? <><Check size={12} /> Installed</> : <><X size={12} /> Not installed</>}
                </span>
              </div>

              <div className="hook-status-row">
                <span className="hook-status-label">OMP hooks</span>
                <span className={`hook-status-badge ${hookStatus?.omp_hooks_installed ? 'installed' : 'not-installed'}`}>
                  {hookStatus?.omp_hooks_installed ? <><Check size={12} /> Installed</> : <><X size={12} /> Not installed</>}
                </span>
              </div>

              <div className="hook-deps">
                <div className="hook-dep-row">
                  <span>jq</span>
                  {hookStatus?.jq_installed
                    ? <span className="dep-ok"><Check size={12} /></span>
                    : <span className="dep-missing"><AlertTriangle size={12} /> missing</span>
                  }
                </div>
                <div className="hook-dep-row">
                  <span>terminal-notifier</span>
                  {hookStatus?.terminal_notifier_installed
                    ? <span className="dep-ok"><Check size={12} /></span>
                    : <span className="dep-warn"><AlertTriangle size={12} /> optional</span>
                  }
                </div>
                <div className="hook-dep-row">
                  <span>tmux</span>
                  {hookStatus?.tmux_installed
                    ? <span className="dep-ok"><Check size={12} /></span>
                    : <span className="dep-missing"><AlertTriangle size={12} /> missing</span>
                  }
                </div>
              </div>

              {setupMessage && (
                <div className={`setup-message ${setupMessage.success ? 'success' : 'error'}`}>
                  {setupMessage.text}
                </div>
              )}

              <div className="hook-actions">
                <button
                  className="settings-btn primary hook-install-btn"
                  disabled={isInstallingHooks}
                  onClick={async () => {
                    setIsInstallingHooks(true);
                    setSetupMessage(null);
                    try {
                      const result = await invoke<SetupResult>('setup_hooks');
                      setSetupMessage({ text: result.message, success: result.success });
                      refreshHookStatus();
                    } catch (e) {
                      setSetupMessage({ text: `Setup failed: ${e}`, success: false });
                    } finally {
                      setIsInstallingHooks(false);
                    }
                  }}
                >
                  {isInstallingHooks ? (
                    <><RefreshCw size={14} className="spin" /> Installing...</>
                  ) : (
                    <><Download size={14} /> Install Agent Hooks</>
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="settings-info">
            <h3>About C3</h3>
            <p>
              C3 monitors your tmux panes for Claude Code, Codex, and OMP sessions and
              displays them in a unified dashboard.
            </p>
            <p className="settings-requirements">
              <strong>Requirements:</strong> tmux and Claude Code, Codex, or OMP
            </p>
          </div>
        </div>

          {saveError && (
            <div className="settings-save-error" role="alert">
              <AlertTriangle size={14} />
              <span>{saveError}</span>
            </div>
          )}

        <div className="settings-footer">
          <button className="settings-btn" onClick={onClose}>Cancel</button>
          <button
            className="settings-btn primary"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
