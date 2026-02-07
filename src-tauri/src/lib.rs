mod tmux_scanner;
mod plugins;

use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, watch};

const HOOK_SERVER_PORT: u16 = 9398;

// Wrapper so we can store the shutdown sender in Tauri state
struct ShutdownHandle(std::sync::Mutex<Option<watch::Sender<bool>>>);

/// Build the full PATH including Homebrew and common tool locations.
/// macOS GUI apps launched from Finder/Dock get a minimal PATH that
/// doesn't include /opt/homebrew/bin, /usr/local/bin, ~/.local/bin, etc.
fn full_path() -> String {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let extra_dirs = [
        format!("{home}/.local/bin"),
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/local/sbin".to_string(),
    ];
    let existing = std::env::var("PATH").unwrap_or_default();
    let mut parts: Vec<&str> = extra_dirs.iter().map(|s| s.as_str()).collect();
    parts.extend(existing.split(':'));
    parts.join(":")
}

/// Create a Command with the full PATH set so that tmux, jq,
/// terminal-notifier, etc. are found even when launched from Finder.
pub(crate) fn cmd(program: &str) -> std::process::Command {
    let mut c = std::process::Command::new(program);
    c.env("PATH", full_path());
    c
}

// Known terminal apps (in preference order for auto-detection)
const KNOWN_TERMINALS: &[&str] = &[
    "Ghostty",
    "iTerm",
    "Alacritty",
    "kitty",
    "WezTerm",
    "Warp",
    "Terminal",
];

// Sound configuration for a specific notification type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoundConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub sound: Option<String>, // None = default, Some("Ping") = system, Some("/path/file.aiff") = custom
}

impl Default for SoundConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            sound: None,
        }
    }
}

// App settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default = "default_terminal")]
    pub terminal_app: String,
    #[serde(default = "default_true")]
    pub notifications_enabled: bool,
    #[serde(default)]
    pub permission_sound: SoundConfig,
    #[serde(default)]
    pub input_sound: SoundConfig,
    #[serde(default)]
    pub complete_sound: SoundConfig,
}

fn default_terminal() -> String {
    "auto".to_string()
}

fn default_true() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            terminal_app: default_terminal(),
            notifications_enabled: true,
            permission_sound: SoundConfig::default(),
            input_sound: SoundConfig::default(),
            complete_sound: SoundConfig { enabled: false, sound: None },
        }
    }
}

fn config_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .map(|p| p.join(".config").join("c3"))
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

fn session_meta_path() -> PathBuf {
    config_dir().join("session-meta.json")
}

// Session metadata (tags, pins)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionMeta {
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub pinned: bool,
}

// All session metadata keyed by tmux target
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionMetaStore {
    #[serde(default)]
    pub sessions: HashMap<String, SessionMeta>,
}

fn load_session_meta() -> SessionMetaStore {
    let path = session_meta_path();
    if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        SessionMetaStore::default()
    }
}

fn save_session_meta(store: &SessionMetaStore) -> Result<(), String> {
    let path = session_meta_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

fn load_settings() -> AppSettings {
    let path = settings_path();
    if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        AppSettings::default()
    }
}

fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

/// Detect which terminal app is installed and running
fn detect_terminal() -> Option<String> {
    for &term in KNOWN_TERMINALS {
        // Check if app is running
        let check = cmd("pgrep")
            .args(["-x", term])
            .output();

        if check.map(|o| o.status.success()).unwrap_or(false) {
            return Some(term.to_string());
        }
    }

    // Fallback: check what's installed
    for &term in KNOWN_TERMINALS {
        let app_path = format!("/Applications/{}.app", term);
        if std::path::Path::new(&app_path).exists() {
            return Some(term.to_string());
        }
    }

    None
}

// Session state enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Spawning,
    Processing,
    AwaitingInput,
    AwaitingPermission,
    Complete,
    Error,
}

// Pending action for sessions awaiting input
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingAction {
    #[serde(rename = "type")]
    pub action_type: String,
    pub description: String,
    pub tool: Option<String>,
    pub command: Option<String>,
}

// Session metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMetrics {
    #[serde(rename = "tokensUsed")]
    pub tokens_used: Option<u64>,
    #[serde(rename = "taskCount")]
    pub task_count: Option<u32>,
    #[serde(rename = "startTime")]
    pub start_time: Option<DateTime<Utc>>,
}

// Main session struct
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct C3Session {
    pub id: String,
    #[serde(rename = "projectName")]
    pub project_name: String,
    #[serde(rename = "projectPath")]
    pub project_path: Option<String>,
    pub state: SessionState,
    #[serde(rename = "tmuxTarget")]
    pub tmux_target: Option<String>,
    #[serde(rename = "lastActivity")]
    pub last_activity: DateTime<Utc>,
    #[serde(rename = "pendingAction")]
    pub pending_action: Option<PendingAction>,
    pub metrics: Option<SessionMetrics>,
}

// WebSocket messages from clients
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    Register { session: C3Session },
    StateChange {
        #[serde(rename = "sessionId")]
        session_id: String,
        state: SessionState,
        #[serde(rename = "pendingAction")]
        pending_action: Option<PendingAction>,
    },
    Heartbeat {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    Disconnect {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
}

// WebSocket messages to clients
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Action {
        #[serde(rename = "sessionId")]
        session_id: String,
        action: String,
    },
    Ping,
}

// Debug hook event log entry
#[derive(Debug, Clone, Serialize)]
pub struct HookEvent {
    pub timestamp: String,
    pub hook_type: String,
    pub cwd: String,
    pub matched_session: Option<String>,
    pub new_state: String,
    pub skipped: bool,
    pub skip_reason: Option<String>,
}

// Shared state
pub struct AppState {
    pub sessions: RwLock<HashMap<String, C3Session>>,
    pub tx: broadcast::Sender<String>,
    /// Tracks when a session was last updated by a hook (session_id -> timestamp)
    /// The tmux scanner won't override states set by hooks for a grace period.
    pub hook_timestamps: RwLock<HashMap<String, std::time::Instant>>,
    /// Tracks when a Stop hook fired for a session (to suppress Notification that follows)
    pub stop_timestamps: RwLock<HashMap<String, std::time::Instant>>,
    /// Tracks when we last sent a notification per session (to debounce rapid-fire events)
    pub notification_timestamps: RwLock<HashMap<String, std::time::Instant>>,
    /// Recent hook events for debugging
    pub hook_events: RwLock<Vec<HookEvent>>,
}

/// How long (seconds) the tmux scanner should defer to hook-set state
/// Also used to suppress Notification hooks that follow a Stop hook
const HOOK_GRACE_PERIOD_SECS: u64 = 10;

impl AppState {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(100);
        Self {
            sessions: RwLock::new(HashMap::new()),
            tx,
            hook_timestamps: RwLock::new(HashMap::new()),
            stop_timestamps: RwLock::new(HashMap::new()),
            notification_timestamps: RwLock::new(HashMap::new()),
            hook_events: RwLock::new(Vec::new()),
        }
    }

    pub fn log_hook_event(&self, event: HookEvent) {
        let mut events = self.hook_events.write();
        events.push(event);
        // Keep last 50 events
        if events.len() > 50 {
            let drain = events.len() - 50;
            events.drain(..drain);
        }
    }
}

// Tauri command: Get all sessions
#[tauri::command]
fn get_sessions(state: tauri::State<Arc<AppState>>) -> Vec<C3Session> {
    state.sessions.read().values().cloned().collect()
}

// Tauri command: Get debug info
#[tauri::command]
fn get_debug_info(state: tauri::State<Arc<AppState>>) -> serde_json::Value {
    let events = state.hook_events.read().clone();
    let timestamps: Vec<serde_json::Value> = {
        let ts = state.hook_timestamps.read();
        ts.iter().map(|(id, instant)| {
            serde_json::json!({
                "session_id": id,
                "age_secs": instant.elapsed().as_secs(),
                "protected": instant.elapsed().as_secs() < HOOK_GRACE_PERIOD_SECS,
            })
        }).collect()
    };
    let sessions: Vec<serde_json::Value> = {
        let s = state.sessions.read();
        s.values().map(|s| {
            serde_json::json!({
                "id": s.id,
                "state": format!("{:?}", s.state),
                "project_name": s.project_name,
                "project_path": s.project_path,
            })
        }).collect()
    };
    serde_json::json!({
        "hook_events": events,
        "hook_timestamps": timestamps,
        "sessions": sessions,
    })
}

// Tauri command: Get settings
#[tauri::command]
fn get_settings() -> AppSettings {
    load_settings()
}

// Tauri command: Update settings
#[tauri::command]
fn update_settings(settings: AppSettings) -> Result<(), String> {
    save_settings(&settings)
}

// Tauri command: Get available terminals
#[tauri::command]
fn get_available_terminals() -> Vec<String> {
    let mut available = vec!["auto".to_string()];

    for &term in KNOWN_TERMINALS {
        let app_path = format!("/Applications/{}.app", term);
        if std::path::Path::new(&app_path).exists() {
            available.push(term.to_string());
        }
    }

    available
}

// Tauri command: Focus terminal
#[tauri::command]
async fn focus_terminal(tmux_target: String) -> Result<(), String> {
    // Parse tmux target: "session:window.pane"
    let parts: Vec<&str> = tmux_target.split(':').collect();
    if parts.len() != 2 {
        return Err("Invalid tmux target format".to_string());
    }

    let session = parts[0];
    let window_pane: Vec<&str> = parts[1].split('.').collect();
    let window = window_pane.get(0).unwrap_or(&"0");
    let pane = window_pane.get(1).unwrap_or(&"0");

    // Get terminal app from settings
    let settings = load_settings();
    let terminal = if settings.terminal_app == "auto" {
        detect_terminal().unwrap_or_else(|| "Terminal".to_string())
    } else {
        settings.terminal_app.clone()
    };

    // Activate terminal using osascript
    let activate_script = format!("tell application \"{}\" to activate", terminal);
    let activate_result = cmd("osascript")
        .args(["-e", &activate_script])
        .output();

    if let Err(e) = activate_result {
        log::warn!("Failed to activate {}: {}", terminal, e);
    }

    // Small delay to let terminal focus
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    // Select tmux window
    let window_result = cmd("tmux")
        .args(["select-window", "-t", &format!("{}:{}", session, window)])
        .output();

    if let Err(e) = window_result {
        return Err(format!("Failed to select tmux window: {}", e));
    }

    // Select tmux pane
    let pane_result = cmd("tmux")
        .args([
            "select-pane",
            "-t",
            &format!("{}:{}.{}", session, window, pane),
        ])
        .output();

    if let Err(e) = pane_result {
        return Err(format!("Failed to select tmux pane: {}", e));
    }

    Ok(())
}

// Tauri command: Send action to session
#[tauri::command]
async fn send_action(
    state: tauri::State<'_, Arc<AppState>>,
    session_id: String,
    action: String,
) -> Result<(), String> {
    let msg = ServerMessage::Action { session_id, action };
    let json = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
    let _ = state.tx.send(json);
    Ok(())
}

// Tauri command: Remove session
#[tauri::command]
fn remove_session(state: tauri::State<Arc<AppState>>, session_id: String) {
    state.sessions.write().remove(&session_id);
}

// Tauri command: Get session metadata
#[tauri::command]
fn get_session_meta() -> SessionMetaStore {
    load_session_meta()
}

// Tauri command: Update session metadata (tag or pin)
#[tauri::command]
fn update_session_meta(session_id: String, tag: Option<String>, pinned: Option<bool>) -> Result<SessionMetaStore, String> {
    let mut store = load_session_meta();

    let meta = store.sessions.entry(session_id).or_default();
    if let Some(t) = tag {
        meta.tag = if t.is_empty() { None } else { Some(t) };
    }
    if let Some(p) = pinned {
        meta.pinned = p;
    }

    // Clean up empty entries
    store.sessions.retain(|_, m| m.tag.is_some() || m.pinned);

    save_session_meta(&store)?;
    Ok(store)
}

// Tauri command: Create new tmux task
#[tauri::command]
async fn create_new_task() -> Result<String, String> {
    // Find the first attached tmux session to create the window in
    let list_output = cmd("tmux")
        .args(["list-sessions", "-F", "#{session_name}:#{session_attached}"])
        .output()
        .map_err(|e| format!("Failed to list tmux sessions: {}", e))?;

    let stdout = String::from_utf8_lossy(&list_output.stdout);
    let session_name = stdout
        .lines()
        .find(|l| l.ends_with(":1")) // attached session
        .and_then(|l| l.split(':').next())
        .unwrap_or("0")
        .to_string();

    // Create a new window in the attached session
    let create_window = cmd("tmux")
        .args(["new-window", "-t", &session_name, "-P", "-F", "#{session_name}:#{window_index}.#{pane_index}"])
        .output()
        .map_err(|e| format!("Failed to create window: {}", e))?;

    if !create_window.status.success() {
        let stderr = String::from_utf8_lossy(&create_window.stderr);
        return Err(format!("Failed to create window: {}", stderr));
    }

    let target = String::from_utf8_lossy(&create_window.stdout)
        .trim()
        .to_string();

    // Start claude in the new window
    let _ = cmd("tmux")
        .args(["send-keys", "-t", &target, "claude", "Enter"])
        .output();

    Ok(target)
}

// Tauri command: Play sound (system or custom file)
#[tauri::command]
async fn play_sound(sound: String) -> Result<(), String> {
    // Determine if it's a custom file path or system sound name
    let sound_file = if sound.starts_with('/') {
        // Custom file path - use directly
        sound
    } else {
        // System sound - look in /System/Library/Sounds/
        format!("/System/Library/Sounds/{}.aiff", sound)
    };

    // Check if sound file exists
    if !std::path::Path::new(&sound_file).exists() {
        return Err(format!("Sound file not found: {}", sound_file));
    }

    // Play using afplay (macOS command-line audio player)
    let result = cmd("afplay")
        .arg(&sound_file)
        .spawn();

    match result {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to play sound: {}", e)),
    }
}

// Hook status response
#[derive(Debug, Clone, Serialize)]
pub struct HookStatus {
    pub hooks_installed: bool,
    pub hook_script_exists: bool,
    pub jq_installed: bool,
    pub terminal_notifier_installed: bool,
    pub tmux_installed: bool,
}

// Setup result response
#[derive(Debug, Clone, Serialize)]
pub struct SetupResult {
    pub success: bool,
    pub message: String,
    pub backup_path: Option<String>,
}

// Tauri command: Check hook installation status
#[tauri::command]
fn check_hook_status(app_handle: AppHandle) -> HookStatus {
    let home = std::env::var("HOME").unwrap_or_default();

    // Check if hook script is installed
    let hook_script_path = format!("{}/.local/bin/c3-hook.sh", home);
    let hook_script_exists = std::path::Path::new(&hook_script_path).exists();

    // Check if hooks are configured in Claude settings
    let settings_path = format!("{}/.claude/settings.json", home);
    let hooks_installed = if let Ok(content) = fs::read_to_string(&settings_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            // Check if any hook references c3-hook.sh
            if let Some(hooks) = json.get("hooks") {
                let hooks_str = hooks.to_string();
                hooks_str.contains("c3-hook.sh")
            } else {
                false
            }
        } else {
            false
        }
    } else {
        false
    };

    // Check dependencies
    let jq_installed = cmd("which")
        .arg("jq")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let terminal_notifier_installed = cmd("which")
        .arg("terminal-notifier")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let tmux_installed = cmd("which")
        .arg("tmux")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    // Try to find the bundled resource (for info purposes, not used in status check)
    let _resource_path = app_handle.path().resource_dir()
        .ok()
        .map(|d| d.join("resources").join("c3-hook.sh"));

    HookStatus {
        hooks_installed: hooks_installed && hook_script_exists,
        hook_script_exists,
        jq_installed,
        terminal_notifier_installed,
        tmux_installed,
    }
}

// Tauri command: Set up C3 hooks
#[tauri::command]
fn setup_hooks(app_handle: AppHandle) -> SetupResult {
    let home = std::env::var("HOME").unwrap_or_default();
    if home.is_empty() {
        return SetupResult {
            success: false,
            message: "Could not determine HOME directory".to_string(),
            backup_path: None,
        };
    }

    // Step 1: Find the bundled c3-hook.sh
    let resource_path = app_handle.path().resource_dir()
        .ok()
        .map(|d| d.join("resources").join("c3-hook.sh"));

    // Fallback: check if hook script exists in common locations
    let hook_source = resource_path
        .filter(|p| p.exists())
        .or_else(|| {
            let local = PathBuf::from(&home).join(".local/bin/c3-hook.sh");
            if local.exists() { Some(local) } else { None }
        });

    // Step 2: Install hook script to ~/.local/bin/
    let hook_dest = PathBuf::from(&home).join(".local/bin/c3-hook.sh");
    if let Some(source) = hook_source {
        if let Err(e) = fs::create_dir_all(hook_dest.parent().unwrap()) {
            return SetupResult {
                success: false,
                message: format!("Failed to create ~/.local/bin/: {}", e),
                backup_path: None,
            };
        }
        if let Err(e) = fs::copy(&source, &hook_dest) {
            return SetupResult {
                success: false,
                message: format!("Failed to copy hook script: {}", e),
                backup_path: None,
            };
        }
        // Make executable
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&hook_dest, fs::Permissions::from_mode(0o755));
        }
    } else if !hook_dest.exists() {
        return SetupResult {
            success: false,
            message: "Could not find c3-hook.sh to install. Please run setup.sh from the C3 repo directory first.".to_string(),
            backup_path: None,
        };
    }

    // Step 3: Copy icon to config directory for terminal-notifier
    let config_dir = PathBuf::from(&home).join(".config/c3");
    let _ = fs::create_dir_all(&config_dir);
    let icon_source = app_handle.path().resource_dir()
        .ok()
        .map(|d| d.join("resources").join("icon.png"))
        .filter(|p| p.exists());
    if let Some(icon_src) = icon_source {
        let icon_dest = config_dir.join("icon.png");
        let _ = fs::copy(&icon_src, &icon_dest);
    }

    // Step 4: Back up existing settings
    let claude_dir = PathBuf::from(&home).join(".claude");
    let settings_file = claude_dir.join("settings.json");
    let mut backup_path_str: Option<String> = None;

    if let Err(e) = fs::create_dir_all(&claude_dir) {
        return SetupResult {
            success: false,
            message: format!("Failed to create ~/.claude/: {}", e),
            backup_path: None,
        };
    }

    if settings_file.exists() {
        let timestamp = chrono::Utc::now().timestamp();
        let backup = claude_dir.join(format!("settings.json.backup.{}", timestamp));
        if let Err(e) = fs::copy(&settings_file, &backup) {
            return SetupResult {
                success: false,
                message: format!("Failed to backup settings: {}", e),
                backup_path: None,
            };
        }
        backup_path_str = Some(backup.to_string_lossy().to_string());
    }

    // Step 4: Read existing settings and merge hooks
    let existing: serde_json::Value = if settings_file.exists() {
        fs::read_to_string(&settings_file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let c3_hooks = serde_json::json!({
        "Stop": [
            {
                "matcher": "",
                "hooks": [{ "type": "command", "command": "$HOME/.local/bin/c3-hook.sh Stop" }]
            }
        ],
        "Notification": [
            {
                "matcher": "",
                "hooks": [{ "type": "command", "command": "$HOME/.local/bin/c3-hook.sh Notification" }]
            }
        ],
        "PermissionRequest": [
            {
                "matcher": "",
                "hooks": [{ "type": "command", "command": "$HOME/.local/bin/c3-hook.sh PermissionRequest" }]
            }
        ],
        "SessionStart": [
            {
                "matcher": "",
                "hooks": [{ "type": "command", "command": "$HOME/.local/bin/c3-hook.sh SessionStart" }]
            }
        ]
    });

    // Merge: preserve user's other settings and other hook types
    let mut settings = existing.clone();
    let settings_obj = settings.as_object_mut().unwrap();

    let mut merged_hooks = if let Some(existing_hooks) = existing.get("hooks").and_then(|h| h.as_object()) {
        existing_hooks.clone()
    } else {
        serde_json::Map::new()
    };

    // Overwrite the 4 C3 hook types
    if let Some(c3_obj) = c3_hooks.as_object() {
        for (key, value) in c3_obj {
            merged_hooks.insert(key.clone(), value.clone());
        }
    }

    settings_obj.insert("hooks".to_string(), serde_json::Value::Object(merged_hooks));

    // Write settings
    match serde_json::to_string_pretty(&settings) {
        Ok(json) => {
            if let Err(e) = fs::write(&settings_file, json) {
                return SetupResult {
                    success: false,
                    message: format!("Failed to write settings: {}", e),
                    backup_path: backup_path_str,
                };
            }
        }
        Err(e) => {
            return SetupResult {
                success: false,
                message: format!("Failed to serialize settings: {}", e),
                backup_path: backup_path_str,
            };
        }
    }

    SetupResult {
        success: true,
        message: "C3 hooks installed successfully! Restart Claude Code to activate.".to_string(),
        backup_path: backup_path_str,
    }
}

// Tauri command: Close tmux pane
#[tauri::command]
async fn close_pane(
    state: tauri::State<'_, Arc<AppState>>,
    app_handle: AppHandle,
    tmux_target: String,
) -> Result<(), String> {
    // Kill the tmux pane
    let result = cmd("tmux")
        .args(["kill-pane", "-t", &tmux_target])
        .output();

    match result {
        Ok(output) if output.status.success() => {
            // Remove the session from our state
            let session_id = format!("tmux:{}", tmux_target);
            state.sessions.write().remove(&session_id);
            let _ = app_handle.emit("session-removed", session_id);
            Ok(())
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("Failed to close pane: {}", stderr))
        }
        Err(e) => Err(format!("Failed to execute tmux: {}", e)),
    }
}

// WebSocket connection handler

// Tmux context from hook
#[derive(Debug, Clone, Deserialize, Default)]
struct TmuxContext {
    #[serde(default)]
    session: String,
    #[serde(default)]
    window: String,
    #[serde(default)]
    pane: String,
    #[serde(default)]
    window_name: String,
}

// Hook notification from Claude Code
#[derive(Debug, Clone, Deserialize)]
struct HookNotification {
    hook_type: String,
    cwd: String,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    tool_name: Option<String>,
    #[serde(default)]
    tool_input: Option<serde_json::Value>,
    #[serde(default)]
    skip_permissions: bool,
    #[serde(default)]
    tmux: Option<TmuxContext>,
}

/// Send an OS notification via terminal-notifier
fn send_os_notification(
    message: &str,
    title: &str,
    subtitle: &str,
    sound: &str,
    tmux: &Option<TmuxContext>,
) {
    let mut notifier = cmd("terminal-notifier");
    notifier.arg("-message").arg(message)
       .arg("-title").arg(title)
       .arg("-subtitle").arg(subtitle);

    if !sound.is_empty() && !sound.starts_with('/') {
        notifier.arg("-sound").arg(sound);
    }

    // Use C3 icon if available
    let home = std::env::var("HOME").unwrap_or_default();
    let icon_path = PathBuf::from(&home).join(".config/c3/icon.png");
    if icon_path.exists() {
        notifier.arg("-appIcon").arg(icon_path.to_string_lossy().as_ref());
    }

    // If we have tmux context, set up click-to-focus
    if let Some(tmux_ctx) = tmux {
        if !tmux_ctx.session.is_empty() && !tmux_ctx.window.is_empty() {
            let home = std::env::var("HOME").unwrap_or_default();
            let switch_script = format!(
                "{home}/.claude/hooks/switch-tmux-pane.sh '{}' '{}' '{}'",
                tmux_ctx.session, tmux_ctx.window, tmux_ctx.pane
            );
            notifier.arg("-execute").arg(&switch_script);
        }
    } else {
        notifier.arg("-activate").arg("com.mitchellh.ghostty");
    }

    if let Err(e) = notifier.spawn() {
        log::error!("Failed to send notification: {}", e);
    }
}

/// Play a sound (system name or custom file path)
fn play_sound_file(sound: &str) {
    let sound_file = if sound.starts_with('/') {
        sound.to_string()
    } else {
        format!("/System/Library/Sounds/{}.aiff", sound)
    };

    if std::path::Path::new(&sound_file).exists() {
        let _ = cmd("afplay")
            .arg(&sound_file)
            .spawn();
    }
}

// Handle HTTP hook request
async fn handle_hook_request(
    mut stream: TcpStream,
    state: Arc<AppState>,
    app_handle: AppHandle,
) {
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

    let mut reader = BufReader::new(&mut stream);
    let mut request_line = String::new();

    // Read request line
    if reader.read_line(&mut request_line).await.is_err() {
        return;
    }

    // Handle GET /sessions (debug endpoint)
    if request_line.starts_with("GET /sessions") {
        // Drain headers
        loop {
            let mut header = String::new();
            if reader.read_line(&mut header).await.is_err() { return; }
            if header == "\r\n" || header == "\n" { break; }
        }
        let body = {
            let sessions = state.sessions.read();
            let debug_info: Vec<serde_json::Value> = sessions.values().map(|s| {
                serde_json::json!({
                    "id": s.id,
                    "project_path": s.project_path,
                    "state": format!("{:?}", s.state),
                    "project_name": s.project_name,
                })
            }).collect();
            serde_json::to_string_pretty(&debug_info).unwrap_or_default()
        };
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            body.len(), body
        );
        let _ = stream.write_all(response.as_bytes()).await;
        return;
    }

    // Only handle POST /hook
    if !request_line.starts_with("POST /hook") {
        let response = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n";
        let _ = stream.write_all(response.as_bytes()).await;
        return;
    }

    // Read headers to find Content-Length
    let mut content_length: usize = 0;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).await.is_err() {
            return;
        }
        if header == "\r\n" || header == "\n" {
            break;
        }
        if header.to_lowercase().starts_with("content-length:") {
            if let Some(len) = header.split(':').nth(1) {
                content_length = len.trim().parse().unwrap_or(0);
            }
        }
    }

    // Read body
    let mut body = vec![0u8; content_length];
    if reader.read_exact(&mut body).await.is_err() {
        let response = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n";
        let _ = stream.write_all(response.as_bytes()).await;
        return;
    }

    // Parse JSON
    let notification: HookNotification = match serde_json::from_slice(&body) {
        Ok(n) => n,
        Err(e) => {
            log::error!("Failed to parse hook notification: {}", e);
            let response = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n";
            let _ = stream.write_all(response.as_bytes()).await;
            return;
        }
    };

    log::info!("Hook received: {} from {} (skip_perms={})",
        notification.hook_type, notification.cwd, notification.skip_permissions);

    // Skip PermissionRequest when running with --dangerously-skip-permissions
    if notification.skip_permissions && notification.hook_type == "PermissionRequest" {
        log::info!("Skipping PermissionRequest (--dangerously-skip-permissions)");
        state.log_hook_event(HookEvent {
            timestamp: Utc::now().format("%H:%M:%S%.3f").to_string(),
            hook_type: notification.hook_type.clone(),
            cwd: notification.cwd.clone(),
            matched_session: None,
            new_state: "n/a".to_string(),
            skipped: true,
            skip_reason: Some("--dangerously-skip-permissions".to_string()),
        });
        let body = "skipped:skip_permissions";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
            body.len(), body
        );
        let _ = stream.write_all(response.as_bytes()).await;
        return;
    }

    // Suppress Notification hooks that fire shortly after a Stop hook for the same session
    // Claude fires both Stop and Notification when finishing, and Notification arrives later
    if notification.hook_type == "Notification" {
        let recently_stopped = {
            let sessions = state.sessions.read();
            let matching_sid = sessions.values()
                .find(|s| s.project_path.as_deref() == Some(&notification.cwd))
                .map(|s| s.id.clone());
            if let Some(ref sid) = matching_sid {
                let stops = state.stop_timestamps.read();
                stops.get(sid)
                    .map(|t| t.elapsed().as_secs() < HOOK_GRACE_PERIOD_SECS)
                    .unwrap_or(false)
            } else {
                false
            }
        };

        if recently_stopped {
            log::info!("Suppressing Notification hook — Stop fired recently for this session");
            state.log_hook_event(HookEvent {
                timestamp: Utc::now().format("%H:%M:%S%.3f").to_string(),
                hook_type: notification.hook_type.clone(),
                cwd: notification.cwd.clone(),
                matched_session: None,
                new_state: "n/a".to_string(),
                skipped: true,
                skip_reason: Some("Stop fired recently".to_string()),
            });
            let body = "skipped:stop_recently";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
                body.len(), body
            );
            let _ = stream.write_all(response.as_bytes()).await;
            return;
        }
    }

    // Load settings for notifications/sounds
    let settings = load_settings();

    // Determine new state and notification info
    let hook_info: Option<(SessionState, &str, &str, &str)> = match notification.hook_type.as_str()
    {
        "PermissionRequest" => Some((
            SessionState::AwaitingPermission,
            "Claude needs permission to continue",
            "Permission Required",
            "permission",
        )),
        "Notification" => Some((
            SessionState::AwaitingInput,
            "Claude is waiting for your response",
            "Input Needed",
            "input",
        )),
        "Stop" => Some((
            SessionState::Complete,
            "Claude has finished processing",
            "Task Complete",
            "complete",
        )),
        "SessionStart" => Some((
            SessionState::Processing,
            "Session started",
            "Welcome Back",
            "none",
        )),
        "PostToolUse" => Some((SessionState::Processing, "", "", "none")),
        _ => None,
    };

    let (new_state, notif_message, notif_subtitle, sound_type) = match hook_info {
        Some(info) => info,
        None => {
            let body = "unknown_hook";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
                body.len(), body
            );
            let _ = stream.write_all(response.as_bytes()).await;
            return;
        }
    };

    // Find matching session by cwd (exact match first, then prefix match)
    let (session_id, project_name) = {
        let sessions = state.sessions.read();
        // Exact match
        let found = sessions
            .values()
            .find(|s| s.project_path.as_deref() == Some(&notification.cwd));
        // Prefix match: hook cwd starts with session path or vice versa
        let found = found.or_else(|| {
            sessions.values().find(|s| {
                if let Some(ref path) = s.project_path {
                    notification.cwd.starts_with(path) || path.starts_with(&notification.cwd)
                } else {
                    false
                }
            })
        });
        found.map(|s| (s.id.clone(), s.project_name.clone())).unzip()
    };
    let session_id: Option<String> = session_id;
    let project_name: Option<String> = project_name;

    if let Some(ref sid) = session_id {
        // Check if we should skip this state change
        let should_skip = {
            let sessions = state.sessions.read();
            sessions.get(sid)
                .map(|s| s.state == SessionState::Complete && new_state == SessionState::AwaitingInput)
                .unwrap_or(false)
        };

        if should_skip {
            log::info!("Hook: ignoring Notification->AwaitingInput, session already Complete");
            state.log_hook_event(HookEvent {
                timestamp: Utc::now().format("%H:%M:%S%.3f").to_string(),
                hook_type: notification.hook_type.clone(),
                cwd: notification.cwd.clone(),
                matched_session: Some(sid.clone()),
                new_state: format!("{:?}", new_state),
                skipped: true,
                skip_reason: Some("session already Complete".to_string()),
            });
            let body = format!("matched:{}", sid);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
                body.len(), body
            );
            let _ = stream.write_all(response.as_bytes()).await;
            return;
        }

        let mut sessions = state.sessions.write();
        if let Some(session) = sessions.get_mut(sid) {
            let old_state = session.state.clone();
            session.state = new_state.clone();
            session.last_activity = Utc::now();

            // Set pending action for permission requests
            if new_state == SessionState::AwaitingPermission {
                session.pending_action = Some(PendingAction {
                    action_type: "permission".to_string(),
                    description: format!(
                        "Wants to use {}",
                        notification.tool_name.as_deref().unwrap_or("a tool")
                    ),
                    tool: notification.tool_name.clone(),
                    command: notification
                        .tool_input
                        .as_ref()
                        .and_then(|i| i.get("command"))
                        .and_then(|c| c.as_str())
                        .map(|s| {
                            if s.len() > 100 {
                                format!("{}...", &s[..97])
                            } else {
                                s.to_string()
                            }
                        }),
                });
            } else {
                session.pending_action = None;
            }

            let session_clone = session.clone();
            drop(sessions);

            log::info!("Hook: {} -> {:?} (was {:?})", sid, new_state, old_state);
            state.log_hook_event(HookEvent {
                timestamp: Utc::now().format("%H:%M:%S%.3f").to_string(),
                hook_type: notification.hook_type.clone(),
                cwd: notification.cwd.clone(),
                matched_session: Some(sid.clone()),
                new_state: format!("{:?}", new_state),
                skipped: false,
                skip_reason: None,
            });
            // Mark this session as recently updated by hook
            state.hook_timestamps.write().insert(sid.clone(), std::time::Instant::now());
            // Track Stop hooks so we can suppress the Notification that follows
            if notification.hook_type == "Stop" {
                state.stop_timestamps.write().insert(sid.clone(), std::time::Instant::now());
            }
            let _ = app_handle.emit("session-update", session_clone);
        }
    } else {
        log::warn!("No session found for cwd: {}", notification.cwd);
        state.log_hook_event(HookEvent {
            timestamp: Utc::now().format("%H:%M:%S%.3f").to_string(),
            hook_type: notification.hook_type.clone(),
            cwd: notification.cwd.clone(),
            matched_session: None,
            new_state: format!("{:?}", new_state),
            skipped: true,
            skip_reason: Some("no matching session".to_string()),
        });
    }

    // Build subtitle with tmux context
    let subtitle = if let Some(ref tmux_ctx) = notification.tmux {
        if !tmux_ctx.session.is_empty() {
            format!(
                "{} | {}:{}.{} ({})",
                notif_subtitle,
                tmux_ctx.session,
                tmux_ctx.window,
                tmux_ctx.pane,
                tmux_ctx.window_name
            )
        } else {
            notif_subtitle.to_string()
        }
    } else {
        notif_subtitle.to_string()
    };

    // Debounce notifications per session — suppress if <1s since last notification for this session
    let should_notify = if let Some(ref sid) = session_id {
        let mut timestamps = state.notification_timestamps.write();
        let now = std::time::Instant::now();
        if let Some(last) = timestamps.get(sid) {
            if now.duration_since(*last).as_millis() < 1000 {
                log::info!("Suppressing notification for {} — debounce (<1s)", sid);
                false
            } else {
                timestamps.insert(sid.clone(), now);
                true
            }
        } else {
            timestamps.insert(sid.clone(), now);
            true
        }
    } else {
        true
    };

    // Send OS notification if enabled and this hook type warrants one
    if should_notify && settings.notifications_enabled && !notif_message.is_empty() {
        // Determine the sound config and sound name for this event type
        let sound_config = match sound_type {
            "permission" => &settings.permission_sound,
            "input" => &settings.input_sound,
            "complete" => &settings.complete_sound,
            _ => &SoundConfig { enabled: false, sound: None },
        };

        // Get the sound name for the notification
        let sound_name = if sound_config.enabled {
            match &sound_config.sound {
                Some(s) if s.starts_with('/') => {
                    // Custom file - play via afplay, don't pass to terminal-notifier
                    play_sound_file(s);
                    String::new() // empty = no sound in notification
                }
                Some(s) => s.clone(), // System sound name
                None => "Ping".to_string(), // Default
            }
        } else {
            String::new() // No sound
        };

        let title = if let Some(ref name) = project_name {
            format!("c3 — {}", name)
        } else {
            "c3".to_string()
        };

        send_os_notification(
            notif_message,
            &title,
            &subtitle,
            &sound_name,
            &notification.tmux,
        );
    }

    // Respond
    let body = if session_id.is_some() {
        format!("matched:{}", session_id.unwrap())
    } else {
        "no_match".to_string()
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
        body.len(), body
    );
    let _ = stream.write_all(response.as_bytes()).await;
}

// Start HTTP hook server
async fn start_hook_server(
    state: Arc<AppState>,
    app_handle: AppHandle,
    mut shutdown: watch::Receiver<bool>,
) {
    let addr = format!("127.0.0.1:{}", HOOK_SERVER_PORT);
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            log::error!("Failed to bind hook server on {}: {} — is another C3 instance running?", addr, e);
            return;
        }
    };

    log::info!("C3 hook server listening on http://{}", addr);

    loop {
        tokio::select! {
            result = listener.accept() => {
                if let Ok((stream, _)) = result {
                    let state = state.clone();
                    let app_handle = app_handle.clone();
                    tokio::spawn(handle_hook_request(stream, state, app_handle));
                }
            }
            _ = shutdown.changed() => {
                log::info!("Hook server shutting down");
                break;
            }
        }
    }
    // listener is dropped here, port is released
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let state = Arc::new(AppState::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            get_sessions,
            get_debug_info,
            focus_terminal,
            send_action,
            remove_session,
            close_pane,
            play_sound,
            get_settings,
            update_settings,
            get_available_terminals,
            get_session_meta,
            update_session_meta,
            create_new_task,
            check_hook_status,
            setup_hooks,
            plugins::mac_rounded_corners::enable_rounded_corners,
            plugins::mac_rounded_corners::enable_modern_window_style,
            plugins::mac_rounded_corners::reposition_traffic_lights
        ])
        .on_window_event(|window, event| {
            // Hide window instead of closing — keep running in tray
            if let WindowEvent::CloseRequested { api, .. } = event {
                window.hide().unwrap_or_default();
                api.prevent_close();
            }
        })
        .setup(move |app| {
            let (shutdown_tx, shutdown_rx) = watch::channel(false);

            // Store the shutdown sender so we can trigger it on exit
            app.manage(ShutdownHandle(std::sync::Mutex::new(Some(shutdown_tx))));

            // Build system tray
            let show = MenuItemBuilder::with_id("show", "Show C3").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .item(&show)
                .separator()
                .item(&quit)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .menu(&tray_menu)
                .menu_on_left_click(true)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            let state_hook = state.clone();
            let state_tmux = state.clone();
            let app_handle_hook = app.handle().clone();
            let app_handle_tmux = app.handle().clone();

            // Start HTTP hook server in background
            let shutdown_hook = shutdown_rx.clone();
            tauri::async_runtime::spawn(async move {
                start_hook_server(state_hook, app_handle_hook, shutdown_hook).await;
            });

            // Start tmux scanner in background (fallback, lower frequency)
            let shutdown_tmux = shutdown_rx.clone();
            tauri::async_runtime::spawn(async move {
                tmux_scanner::start_tmux_scanner(state_tmux, app_handle_tmux, shutdown_tmux).await;
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                log::info!("App exiting, shutting down servers...");
                if let Some(handle) = app_handle.try_state::<ShutdownHandle>() {
                    if let Ok(mut guard) = handle.0.lock() {
                        let _ = guard.take();
                    }
                }
            }
        });
}
