use crate::ansi::{parse_ansi_capture, AnsiSpan, ParsedAnsi};
use crate::{
    agent_launch_command, cmd, launch_agent_in_tmux, load_session_meta, load_settings, AppSettings,
    AppState, C3Session, SessionMetaStore,
};
use chrono::Utc;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write as _;
use std::net::{IpAddr, Ipv4Addr};
use std::process::Stdio;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{watch, Semaphore};
use tokio::time::MissedTickBehavior;
use uuid::Uuid;

const REMOTE_INDEX: &str = include_str!("../remote/index.html");
const REMOTE_ICON: &[u8] = include_bytes!("../resources/icon.png");
const MAX_HEADER_BYTES: usize = 16 * 1024;
const MAX_INPUT_BYTES: usize = 64 * 1024;
const MAX_CAPTURE_BYTES: usize = 512 * 1024;
const REMOTE_STREAM_INTERVAL: Duration = Duration::from_millis(250);
const REMOTE_STREAM_LIMIT: usize = 4;
const MAX_STREAM_FRAME_BYTES: usize = 8 * 1024 * 1024;
static REMOTE_STREAM_SLOTS: LazyLock<Arc<Semaphore>> =
    LazyLock::new(|| Arc::new(Semaphore::new(REMOTE_STREAM_LIMIT)));
static LAST_REMOTE_LAUNCH: LazyLock<Mutex<Option<Instant>>> = LazyLock::new(|| Mutex::new(None));
const MANIFEST: &str = r##"{
  "name": "C3 Remote",
  "short_name": "C3",
  "description": "Check and respond to C3 agent sessions",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#111318",
  "theme_color": "#111318",
  "icons": [{ "src": "/icon.png", "sizes": "512x512", "type": "image/png" }]
}"##;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccessInfo {
    pub enabled: bool,
    pub tailscale_available: bool,
    pub tailscale_ip: Option<String>,
    pub bind_address: Option<String>,
    pub port: u16,
    pub url: Option<String>,
    pub pairing_url: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    target: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteInputRequest {
    session_id: String,
    text: String,
    #[serde(default = "default_submit")]
    submit: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteKeyRequest {
    session_id: String,
    key: String,
    #[serde(default = "default_key_repeat")]
    repeat: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PaneCapture {
    session_id: String,
    project_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<String>,
    styled_lines: Vec<Vec<AnsiSpan>>,
    revision: String,
    captured_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteDashboard {
    sessions: Vec<C3Session>,
    session_meta: SessionMetaStore,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteProject {
    name: String,
    path: String,
    active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteLaunchRequest {
    agent_kind: String,
    project_path: String,
    #[serde(default)]
    prompt: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteLaunchResult {
    tmux_target: String,
    agent_kind: String,
    project_path: String,
}

fn default_submit() -> bool {
    true
}

pub fn generate_access_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

pub fn remote_access_info(settings: &AppSettings) -> RemoteAccessInfo {
    let tailscale_ip = detect_tailscale_ipv4().map(|ip| ip.to_string());
    let resolved = resolve_bind_address(settings);
    let (bind_address, error) = match resolved {
        Ok(address) => (Some(address.to_string()), None),
        Err(error) => (None, Some(error)),
    };
    let url = bind_address
        .as_ref()
        .map(|address| format_remote_url(address, settings.remote_port));
    let pairing_url = url.as_ref().and_then(|url| {
        (!settings.remote_access_token.is_empty())
            .then(|| format!("{url}/#token={}", settings.remote_access_token))
    });

    RemoteAccessInfo {
        enabled: settings.remote_access_enabled,
        tailscale_available: tailscale_ip.is_some(),
        tailscale_ip,
        bind_address,
        port: settings.remote_port,
        url,
        pairing_url,
        error,
    }
}

pub fn validate_settings(settings: &AppSettings) -> Result<(), String> {
    if !settings.remote_access_enabled {
        return Ok(());
    }
    if settings.remote_port < 1024 {
        return Err("Remote access port must be between 1024 and 65535.".to_string());
    }
    if settings.remote_access_token.len() < 32 {
        return Err("Generate an access token before enabling Remote access.".to_string());
    }
    resolve_bind_address(settings).map(|_| ())
}

fn sorted_sessions(state: &Arc<AppState>) -> Vec<C3Session> {
    let mut sessions: Vec<C3Session> = state.sessions.read().values().cloned().collect();
    sessions.sort_by(|left, right| right.last_activity.cmp(&left.last_activity));
    sessions
}

fn effective_session_meta(sessions: &[C3Session]) -> SessionMetaStore {
    let mut store = load_session_meta();
    store.groups.sort_by_key(|group| group.created_at);
    for session in sessions {
        let existing = store.sessions.get(&session.id);
        if existing.and_then(|meta| meta.group_id.as_ref()).is_some()
            || existing.and_then(|meta| meta.group_assignment.as_deref()) == Some("manual")
        {
            continue;
        }
        let haystack = format!(
            "{}\n{}",
            session.project_name,
            session.project_path.as_deref().unwrap_or_default()
        )
        .to_lowercase();
        if let Some(group) = store.groups.iter().find(|group| {
            group.match_text.iter().any(|needle| {
                let needle = needle.trim().to_lowercase();
                !needle.is_empty() && haystack.contains(&needle)
            })
        }) {
            let meta = store.sessions.entry(session.id.clone()).or_default();
            meta.group_id = Some(group.id.clone());
            meta.group_assignment = Some("auto".to_string());
        }
    }
    store
}

fn remote_dashboard(state: &Arc<AppState>) -> RemoteDashboard {
    let sessions = sorted_sessions(state);
    let session_meta = effective_session_meta(&sessions);
    RemoteDashboard {
        sessions,
        session_meta,
    }
}

fn expand_home_path(value: &str) -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    if value == "~" {
        return PathBuf::from(home);
    }
    if let Some(rest) = value.strip_prefix("~/") {
        return PathBuf::from(home).join(rest);
    }
    PathBuf::from(value)
}

fn configured_project_roots(settings: &AppSettings) -> Vec<PathBuf> {
    settings
        .remote_project_roots
        .iter()
        .filter_map(|root| fs::canonicalize(expand_home_path(root)).ok())
        .filter(|root| root.is_dir())
        .collect()
}

fn remote_project_catalog(state: &Arc<AppState>, settings: &AppSettings) -> Vec<RemoteProject> {
    let mut projects: HashMap<String, RemoteProject> = HashMap::new();
    for root in configured_project_roots(settings) {
        let entries = match fs::read_dir(&root) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.filter_map(Result::ok).take(500) {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let path = match fs::canonicalize(entry.path()) {
                Ok(path) if path.is_dir() && path.starts_with(&root) => path,
                _ => continue,
            };
            let path_string = path.to_string_lossy().to_string();
            projects.entry(path_string.clone()).or_insert(RemoteProject {
                name,
                path: path_string,
                active: false,
            });
        }
    }

    for session in state.sessions.read().values() {
        let Some(path) = session.project_path.as_deref() else {
            continue;
        };
        let path = match fs::canonicalize(path) {
            Ok(path) if path.is_dir() => path,
            _ => continue,
        };
        let path_string = path.to_string_lossy().to_string();
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| path_string.clone());
        projects.insert(
            path_string.clone(),
            RemoteProject {
                name,
                path: path_string,
                active: true,
            },
        );
    }

    let mut projects: Vec<RemoteProject> = projects.into_values().collect();
    projects.sort_by(|left, right| {
        right
            .active
            .cmp(&left.active)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.path.cmp(&right.path))
    });
    projects.truncate(500);
    projects
}

fn allowed_project_path(
    state: &Arc<AppState>,
    settings: &AppSettings,
    requested: &str,
) -> Result<PathBuf, String> {
    let requested = Path::new(requested);
    if !requested.is_absolute() {
        return Err("Project path must be absolute.".to_string());
    }
    let canonical = fs::canonicalize(requested)
        .map_err(|_| "Project is unavailable. Refresh the project list and try again.".to_string())?;
    let allowed: HashSet<String> = remote_project_catalog(state, settings)
        .into_iter()
        .map(|project| project.path)
        .collect();
    if allowed.contains(canonical.to_string_lossy().as_ref()) {
        Ok(canonical)
    } else {
        Err("Project is not inside a configured C3 project folder.".to_string())
    }
}

fn claim_remote_launch_slot() -> Result<(), String> {
    let mut last_launch = LAST_REMOTE_LAUNCH.lock();
    if last_launch
        .as_ref()
        .map(|instant| instant.elapsed() < Duration::from_secs(2))
        .unwrap_or(false)
    {
        return Err("Wait a moment before starting another agent.".to_string());
    }
    *last_launch = Some(Instant::now());
    Ok(())
}

fn detect_tailscale_ipv4() -> Option<Ipv4Addr> {
    let mut candidates = vec![("tailscale".to_string(), vec!["ip", "-4"])];
    let app_binary = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
    if std::path::Path::new(app_binary).exists() {
        candidates.push((app_binary.to_string(), vec!["ip", "-4"]));
    }

    for (program, args) in candidates {
        let output = match cmd(&program).args(args).output() {
            Ok(output) => output,
            Err(_) => continue,
        };
        if !output.status.success() {
            continue;
        }
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Ok(address) = line.trim().parse::<Ipv4Addr>() {
                if is_tailscale_ipv4(address) {
                    return Some(address);
                }
            }
        }
    }
    None
}

fn resolve_bind_address(settings: &AppSettings) -> Result<IpAddr, String> {
    let address = if settings.remote_bind_address.trim().is_empty()
        || settings.remote_bind_address == "auto"
    {
        IpAddr::V4(detect_tailscale_ipv4().ok_or_else(|| {
            "Tailscale is not connected. Open Tailscale, then save Remote access again.".to_string()
        })?)
    } else {
        settings
            .remote_bind_address
            .parse::<IpAddr>()
            .map_err(|_| "Remote access requires a numeric loopback or Tailscale address.".to_string())?
    };

    if is_safe_bind_address(address) {
        Ok(address)
    } else {
        Err("C3 only binds Remote access to loopback or a Tailscale 100.64.0.0/10 address."
            .to_string())
    }
}

fn format_remote_url(address: &str, port: u16) -> String {
    let host = if address.contains(':') {
        format!("[{address}]")
    } else {
        address.to_string()
    };
    format!("http://{host}:{port}")
}

fn is_tailscale_ipv4(address: Ipv4Addr) -> bool {
    let octets = address.octets();
    octets[0] == 100 && (64..=127).contains(&octets[1])
}

fn is_safe_bind_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => address.is_loopback() || is_tailscale_ipv4(address),
        IpAddr::V6(address) => address.is_loopback(),
    }
}

fn listener_key(settings: &AppSettings) -> String {
    format!(
        "{}:{}:{}",
        settings.remote_access_enabled, settings.remote_bind_address, settings.remote_port
    )
}

pub async fn start_remote_server(
    state: Arc<AppState>,
    mut shutdown: watch::Receiver<bool>,
) {
    loop {
        if *shutdown.borrow() {
            return;
        }

        let settings = load_settings();
        if !settings.remote_access_enabled {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(1)) => {}
                _ = shutdown.changed() => return,
            }
            continue;
        }

        let address = match resolve_bind_address(&settings) {
            Ok(address) => address,
            Err(error) => {
                log::warn!("Remote access unavailable: {error}");
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(3)) => {}
                    _ = shutdown.changed() => return,
                }
                continue;
            }
        };
        let bind = std::net::SocketAddr::new(address, settings.remote_port);
        let listener = match TcpListener::bind(bind).await {
            Ok(listener) => listener,
            Err(error) => {
                log::error!("Could not bind C3 Remote at {bind}: {error}");
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(3)) => {}
                    _ = shutdown.changed() => return,
                }
                continue;
            }
        };

        let active_key = listener_key(&settings);
        log::info!("C3 Remote listening on http://{bind}");

        loop {
            tokio::select! {
                accepted = listener.accept() => {
                    match accepted {
                        Ok((stream, peer)) => {
                            let state = state.clone();
                            tokio::spawn(async move {
                                if let Err(error) = handle_remote_request(stream, state).await {
                                    log::debug!("Remote request from {peer} failed: {error}");
                                }
                            });
                        }
                        Err(error) => log::warn!("C3 Remote accept failed: {error}"),
                    }
                }
                _ = tokio::time::sleep(Duration::from_secs(2)) => {
                    if listener_key(&load_settings()) != active_key {
                        log::info!("C3 Remote settings changed; restarting listener");
                        break;
                    }
                }
                _ = shutdown.changed() => return,
            }
        }
    }
}

async fn handle_remote_request(
    mut stream: TcpStream,
    state: Arc<AppState>,
) -> Result<(), String> {
    let request = tokio::time::timeout(Duration::from_secs(5), read_request(&mut stream))
        .await
        .map_err(|_| "Remote request timed out".to_string())??;
    let path = request.target.split('?').next().unwrap_or("/");

    match (request.method.as_str(), path) {
        ("GET", "/") | ("GET", "/index.html") => {
            return write_response(
                &mut stream,
                200,
                "text/html; charset=utf-8",
                REMOTE_INDEX.as_bytes(),
            )
            .await;
        }
        ("GET", "/manifest.webmanifest") => {
            return write_response(
                &mut stream,
                200,
                "application/manifest+json; charset=utf-8",
                MANIFEST.as_bytes(),
            )
            .await;
        }
        ("GET", "/icon.png") => {
            return write_response(&mut stream, 200, "image/png", REMOTE_ICON).await;
        }
        _ => {}
    }

    if !path.starts_with("/api/") {
        return json_error(&mut stream, 404, "Not found").await;
    }

    let settings = load_settings();
    if !settings.remote_access_enabled {
        return json_error(&mut stream, 503, "Remote access is disabled.").await;
    }
    let expected_address = match resolve_bind_address(&settings) {
        Ok(address) => std::net::SocketAddr::new(address, settings.remote_port),
        Err(error) => return json_error(&mut stream, 503, &error).await,
    };
    if stream.local_addr().ok() != Some(expected_address) {
        return json_error(
            &mut stream,
            503,
            "Remote access settings changed. Reconnect using the current pairing link.",
        )
        .await;
    }
    if settings.remote_access_token.is_empty()
        || !request_is_authorized(&request, &settings.remote_access_token)
    {
        return json_error(&mut stream, 401, "A valid C3 access token is required.").await;
    }

    match (request.method.as_str(), path) {
        ("GET", "/api/health") => {
            let body = serde_json::to_vec(&serde_json::json!({
                "ok": true,
                "name": "C3 Remote",
                "version": env!("CARGO_PKG_VERSION"),
            }))
            .map_err(|error| error.to_string())?;
            write_response(&mut stream, 200, "application/json", &body).await
        }
        ("GET", "/api/sessions") => {
            let body =
                serde_json::to_vec(&sorted_sessions(&state)).map_err(|error| error.to_string())?;
            write_response(&mut stream, 200, "application/json", &body).await
        }
        ("GET", "/api/dashboard") => {
            let body =
                serde_json::to_vec(&remote_dashboard(&state)).map_err(|error| error.to_string())?;
            write_response(&mut stream, 200, "application/json", &body).await
        }
        ("GET", "/api/projects") => {
            let projects = remote_project_catalog(&state, &settings);
            let body = serde_json::to_vec(&projects).map_err(|error| error.to_string())?;
            write_response(&mut stream, 200, "application/json", &body).await
        }
        ("GET", "/api/capture") => {
            let session_id = query_value(&request.target, "sessionId")
                .ok_or_else(|| "Missing sessionId".to_string());
            let session_id = match session_id {
                Ok(session_id) => session_id,
                Err(error) => return json_error(&mut stream, 400, &error).await,
            };
            let session = match find_session(&state, &session_id) {
                Some(session) => session,
                None => return json_error(&mut stream, 404, "Session not found").await,
            };
            let target = match session.tmux_target.as_deref() {
                Some(target) => target.to_string(),
                None => return json_error(&mut stream, 409, "Session has no tmux pane").await,
            };
            let capture = tokio::task::spawn_blocking(move || capture_pane(&target))
                .await
                .map_err(|error| error.to_string())?;
            let capture = match capture {
                Ok(capture) => capture,
                Err(error) => return json_error(&mut stream, 502, &error).await,
            };
            let body = serde_json::to_vec(&PaneCapture {
                session_id: session.id,
                project_name: session.project_name,
                output: Some(capture.plain),
                styled_lines: capture.styled_lines,
                revision: capture.revision,
                captured_at: Utc::now().to_rfc3339(),
            })
            .map_err(|error| error.to_string())?;
            write_response(&mut stream, 200, "application/json", &body).await
        }
        ("GET", "/api/stream") => {
            let session_id = match query_value(&request.target, "sessionId") {
                Some(session_id) => session_id,
                None => return json_error(&mut stream, 400, "Missing sessionId").await,
            };
            stream_pane_events(
                stream,
                state,
                session_id,
                settings.remote_access_token.clone(),
            )
            .await
        }
        ("POST", "/api/launch") => {
            let input: RemoteLaunchRequest = match serde_json::from_slice(&request.body) {
                Ok(input) => input,
                Err(_) => return json_error(&mut stream, 400, "Launch request must be valid JSON").await,
            };
            if input.prompt.as_deref().map(str::len).unwrap_or(0) > 16 * 1024 {
                return json_error(&mut stream, 413, "Initial prompt exceeds 16 KiB").await;
            }
            let agent_kind = input.agent_kind.to_lowercase();
            if let Err(error) = agent_launch_command(&agent_kind, input.prompt.as_deref()) {
                return json_error(&mut stream, 400, &error).await;
            }
            let project_path = match allowed_project_path(&state, &settings, &input.project_path) {
                Ok(path) => path,
                Err(error) => return json_error(&mut stream, 400, &error).await,
            };
            if let Err(error) = claim_remote_launch_slot() {
                return json_error(&mut stream, 429, &error).await;
            }
            let project_path_string = project_path.to_string_lossy().to_string();
            let launch_agent_kind = agent_kind.clone();
            let launch_project_path = project_path.clone();
            let prompt = input.prompt;
            let launched = tokio::task::spawn_blocking(move || {
                launch_agent_in_tmux(
                    &launch_agent_kind,
                    &launch_project_path,
                    prompt.as_deref(),
                )
            })
            .await
            .map_err(|error| error.to_string())?;
            let tmux_target = match launched {
                Ok(target) => target,
                Err(error) => return json_error(&mut stream, 502, &error).await,
            };
            let body = serde_json::to_vec(&RemoteLaunchResult {
                tmux_target,
                agent_kind,
                project_path: project_path_string,
            })
            .map_err(|error| error.to_string())?;
            write_response(&mut stream, 200, "application/json", &body).await
        }
        ("POST", "/api/input") => {
            let input: RemoteInputRequest = match serde_json::from_slice(&request.body) {
                Ok(input) => input,
                Err(_) => return json_error(&mut stream, 400, "Input must be valid JSON").await,
            };
            if input.text.is_empty() {
                return json_error(&mut stream, 400, "Response text cannot be empty").await;
            }
            if input.text.len() > MAX_INPUT_BYTES {
                return json_error(&mut stream, 413, "Response text exceeds 64 KiB").await;
            }
            let session = match find_session(&state, &input.session_id) {
                Some(session) => session,
                None => return json_error(&mut stream, 404, "Session not found").await,
            };
            let target = match session.tmux_target {
                Some(target) => target,
                None => return json_error(&mut stream, 409, "Session has no tmux pane").await,
            };
            let text = input.text;
            let submit = input.submit;
            let sent = tokio::task::spawn_blocking(move || send_tmux_input(&target, &text, submit))
                .await
                .map_err(|error| error.to_string())?;
            if let Err(error) = sent {
                return json_error(&mut stream, 502, &error).await;
            }
            let body = serde_json::to_vec(&serde_json::json!({ "ok": true }))
                .map_err(|error| error.to_string())?;
            write_response(&mut stream, 200, "application/json", &body).await
        }
        ("POST", "/api/key") => {
            let input: RemoteKeyRequest = match serde_json::from_slice(&request.body) {
                Ok(input) => input,
                Err(_) => return json_error(&mut stream, 400, "Key input must be valid JSON").await,
            };
            let key = match tmux_key_name(&input.key) {
                Some(key) => key,
                None => {
                    return json_error(
                        &mut stream,
                        400,
                        "Key must be up, down, left, right, escape, tab, or enter",
                    )
                    .await
                }
            };
            if !(1..=10).contains(&input.repeat) {
                return json_error(&mut stream, 400, "Key repeat must be between 1 and 10").await;
            }
            let session = match find_session(&state, &input.session_id) {
                Some(session) => session,
                None => return json_error(&mut stream, 404, "Session not found").await,
            };
            let target = match session.tmux_target {
                Some(target) => target,
                None => return json_error(&mut stream, 409, "Session has no tmux pane").await,
            };
            let repeat = input.repeat;
            let sent = tokio::task::spawn_blocking(move || send_tmux_key(&target, key, repeat))
                .await
                .map_err(|error| error.to_string())?;
            if let Err(error) = sent {
                return json_error(&mut stream, 502, &error).await;
            }
            let body = serde_json::to_vec(&serde_json::json!({ "ok": true }))
                .map_err(|error| error.to_string())?;
            write_response(&mut stream, 200, "application/json", &body).await
        }
        _ => json_error(&mut stream, 404, "API route not found").await,
    }
}


fn remote_stream_slots() -> Arc<Semaphore> {
    Arc::clone(&REMOTE_STREAM_SLOTS)
}

async fn stream_pane_events(
    mut stream: TcpStream,
    state: Arc<AppState>,
    session_id: String,
    access_token: String,
) -> Result<(), String> {
    let initial_session = match find_session(&state, &session_id) {
        Some(session) => session,
        None => return json_error(&mut stream, 404, "Session not found").await,
    };
    if initial_session.tmux_target.is_none() {
        return json_error(&mut stream, 409, "Session has no tmux pane").await;
    }
    let _permit = match remote_stream_slots().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => {
            return json_error(
                &mut stream,
                429,
                "Too many live pane streams. Close another live session and try again.",
            )
            .await
        }
    };

    let stream_key = listener_key(&load_settings());
    let headers = concat!(
        "HTTP/1.1 200 OK\r\n",
        "Content-Type: text/event-stream; charset=utf-8\r\n",
        "Cache-Control: no-store\r\n",
        "X-Content-Type-Options: nosniff\r\n",
        "Referrer-Policy: no-referrer\r\n",
        "Transfer-Encoding: chunked\r\n",
        "Connection: keep-alive\r\n\r\n"
    );
    write_raw_stream(&mut stream, headers.as_bytes()).await?;
    write_stream_chunk(&mut stream, b"retry: 1000\n\n").await?;
    let (mut reader, mut writer) = stream.into_split();

    let mut interval = tokio::time::interval(REMOTE_STREAM_INTERVAL);
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut last_revision = String::new();
    let mut last_write = Instant::now();
    let mut tick_count = 0_u8;

    let mut disconnect_probe = [0_u8; 1];
    loop {
        tokio::select! {
            read = reader.read(&mut disconnect_probe) => {
                match read {
                    Ok(0) | Err(_) => break,
                    Ok(_) => continue,
                }
            }
            _ = interval.tick() => {}
        }
        tick_count = tick_count.wrapping_add(1);
        if tick_count % 4 == 1 {
            let settings = load_settings();
            if !settings.remote_access_enabled
                || settings.remote_access_token != access_token
                || listener_key(&settings) != stream_key
            {
                break;
            }
        }

        let session = match find_session(&state, &session_id) {
            Some(session) => session,
            None => {
                let frame = sse_frame("error", r#"{"error":"Session no longer exists"}"#);
                let _ = write_stream_chunk(&mut writer, frame.as_bytes()).await;
                break;
            }
        };
        let target = match session.tmux_target.as_deref() {
            Some(target) => target.to_string(),
            None => break,
        };
        let capture = match tokio::task::spawn_blocking(move || capture_pane(&target)).await {
            Ok(Ok(capture)) => capture,
            Ok(Err(error)) => {
                let data = serde_json::to_string(&serde_json::json!({ "error": error }))
                    .map_err(|error| error.to_string())?;
                let frame = sse_frame("error", &data);
                let _ = write_stream_chunk(&mut writer, frame.as_bytes()).await;
                break;
            }
            Err(error) => return Err(error.to_string()),
        };

        if capture.revision == last_revision {
            if last_write.elapsed() >= Duration::from_secs(15) {
                write_stream_chunk(&mut writer, b": keepalive\n\n").await?;
                last_write = Instant::now();
            }
            continue;
        }

        let revision = capture.revision.clone();
        let payload = PaneCapture {
            session_id: session.id,
            project_name: session.project_name,
            output: None,
            styled_lines: capture.styled_lines,
            revision,
            captured_at: Utc::now().to_rfc3339(),
        };
        let data = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
        let frame = sse_frame("pane", &data);
        if frame.len() > MAX_STREAM_FRAME_BYTES {
            let error = sse_frame(
                "error",
                r#"{"error":"Pane is too large for Live mode. Switch to Saver."}"#,
            );
            let _ = write_stream_chunk(&mut writer, error.as_bytes()).await;
            break;
        }
        write_stream_chunk(&mut writer, frame.as_bytes()).await?;
        last_revision = capture.revision;
        last_write = Instant::now();
    }

    let _ = write_raw_stream(&mut writer, b"0\r\n\r\n").await;
    Ok(())
}

fn sse_frame(event: &str, data: &str) -> String {
    format!("event: {event}\ndata: {data}\n\n")
}

async fn write_stream_chunk<W>(stream: &mut W, bytes: &[u8]) -> Result<(), String>
where
    W: AsyncWrite + Unpin,
{
    let mut chunk = format!("{:x}\r\n", bytes.len()).into_bytes();
    chunk.extend_from_slice(bytes);
    chunk.extend_from_slice(b"\r\n");
    write_raw_stream(stream, &chunk).await
}

async fn write_raw_stream<W>(stream: &mut W, bytes: &[u8]) -> Result<(), String>
where
    W: AsyncWrite + Unpin,
{
    tokio::time::timeout(Duration::from_secs(5), stream.write_all(bytes))
        .await
        .map_err(|_| "Remote stream write timed out".to_string())?
        .map_err(|error| error.to_string())
}

fn find_session(state: &Arc<AppState>, session_id: &str) -> Option<C3Session> {
    state.sessions.read().get(session_id).cloned()
}

fn capture_pane(target: &str) -> Result<ParsedAnsi, String> {
    let output = cmd("tmux")
        .args(["capture-pane", "-p", "-e", "-t", target, "-S", "-200"])
        .output()
        .map_err(|error| format!("Could not capture tmux pane: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "tmux capture failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let mut output = String::from_utf8_lossy(&output.stdout).into_owned();
    if output.len() > MAX_CAPTURE_BYTES {
        let mut start = output.len() - MAX_CAPTURE_BYTES;
        while !output.is_char_boundary(start) {
            start += 1;
        }
        if let Some(line_end) = output[start..].find('\n') {
            start += line_end + 1;
        }
        output = output[start..].to_string();
    }
    Ok(parse_ansi_capture(&output))
}

fn send_tmux_input(target: &str, text: &str, submit: bool) -> Result<(), String> {
    let buffer_name = format!("c3-remote-{}", Uuid::new_v4().simple());
    let mut child = cmd("tmux")
        .args(["load-buffer", "-b", &buffer_name, "-"])
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start tmux input: {error}"))?;
    child
        .stdin
        .as_mut()
        .ok_or_else(|| "Could not open tmux input buffer".to_string())?
        .write_all(text.as_bytes())
        .map_err(|error| format!("Could not write tmux input: {error}"))?;
    let loaded = child
        .wait_with_output()
        .map_err(|error| format!("Could not load tmux input: {error}"))?;
    if !loaded.status.success() {
        return Err(format!(
            "tmux load-buffer failed: {}",
            String::from_utf8_lossy(&loaded.stderr).trim()
        ));
    }

    let pasted = cmd("tmux")
        .args(["paste-buffer", "-b", &buffer_name, "-d", "-t", target])
        .output()
        .map_err(|error| format!("Could not paste tmux input: {error}"))?;
    if !pasted.status.success() {
        let _ = cmd("tmux").args(["delete-buffer", "-b", &buffer_name]).output();
        return Err(format!(
            "tmux paste-buffer failed: {}",
            String::from_utf8_lossy(&pasted.stderr).trim()
        ));
    }

    if submit {
        let submitted = cmd("tmux")
            .args(["send-keys", "-t", target, "Enter"])
            .output()
            .map_err(|error| format!("Could not submit tmux input: {error}"))?;
        if !submitted.status.success() {
            return Err(format!(
                "tmux send-keys failed: {}",
                String::from_utf8_lossy(&submitted.stderr).trim()
            ));
        }
    }
    Ok(())
}

fn default_key_repeat() -> u8 {
    1
}

fn tmux_key_name(key: &str) -> Option<&'static str> {
    match key {
        "up" => Some("Up"),
        "down" => Some("Down"),
        "left" => Some("Left"),
        "right" => Some("Right"),
        "escape" => Some("Escape"),
        "tab" => Some("Tab"),
        "enter" => Some("Enter"),
        _ => None,
    }
}

fn send_tmux_key(target: &str, key: &str, repeat: u8) -> Result<(), String> {
    let mut command = cmd("tmux");
    command.args(["send-keys", "-t", target]);
    for _ in 0..repeat {
        command.arg(key);
    }
    let sent = command
        .output()
        .map_err(|error| format!("Could not send tmux key: {error}"))?;
    if !sent.status.success() {
        return Err(format!(
            "tmux send-keys failed: {}",
            String::from_utf8_lossy(&sent.stderr).trim()
        ));
    }
    Ok(())
}

fn request_is_authorized(request: &HttpRequest, expected_token: &str) -> bool {
    request
        .headers
        .get("authorization")
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(|token| constant_time_eq(token.as_bytes(), expected_token.as_bytes()))
        .unwrap_or(false)
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| difference | (left ^ right))
        == 0
}

fn query_value(target: &str, key: &str) -> Option<String> {
    let query = target.split_once('?')?.1;
    query.split('&').find_map(|pair| {
        let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
        (percent_decode(name) == key).then(|| percent_decode(value))
    })
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                if let (Some(high), Some(low)) = (hex_value(bytes[index + 1]), hex_value(bytes[index + 2])) {
                    decoded.push(high << 4 | low);
                    index += 3;
                    continue;
                }
                decoded.push(bytes[index]);
            }
            b'+' => decoded.push(b' '),
            byte => decoded.push(byte),
        }
        index += 1;
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

async fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let mut raw = Vec::with_capacity(2048);
    let mut chunk = [0_u8; 1024];
    let header_end = loop {
        if raw.len() >= MAX_HEADER_BYTES {
            return Err("HTTP headers are too large".to_string());
        }
        let available = (MAX_HEADER_BYTES - raw.len()).min(chunk.len());
        let count = stream
            .read(&mut chunk[..available])
            .await
            .map_err(|error| error.to_string())?;
        if count == 0 {
            return Err("HTTP connection closed before headers completed".to_string());
        }
        raw.extend_from_slice(&chunk[..count]);
        if let Some(index) = raw.windows(4).position(|window| window == b"\r\n\r\n") {
            break index + 4;
        }
        if let Some(index) = raw.windows(2).position(|window| window == b"\n\n") {
            break index + 2;
        }
    };

    let header_text = std::str::from_utf8(&raw[..header_end])
        .map_err(|_| "HTTP headers must be UTF-8".to_string())?;
    let mut lines = header_text.lines();
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("/").to_string();
    if method.is_empty() {
        return Err("Missing HTTP method".to_string());
    }

    let mut headers = HashMap::new();
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > MAX_INPUT_BYTES + 4096 {
        return Err("HTTP body is too large".to_string());
    }

    let mut body = raw[header_end..].to_vec();
    body.truncate(content_length);
    if body.len() < content_length {
        let existing = body.len();
        body.resize(content_length, 0);
        stream
            .read_exact(&mut body[existing..])
            .await
            .map_err(|error| error.to_string())?;
    }

    Ok(HttpRequest {
        method,
        target,
        headers,
        body,
    })
}

async fn json_error(stream: &mut TcpStream, status: u16, message: &str) -> Result<(), String> {
    let body = serde_json::to_vec(&serde_json::json!({ "error": message }))
        .map_err(|error| error.to_string())?;
    write_response(stream, status, "application/json", &body).await
}

async fn write_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        409 => "Conflict",
        413 => "Payload Too Large",
        429 => "Too Many Requests",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "Error",
    };
    let headers = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n",
        body.len()
    );
    tokio::time::timeout(Duration::from_secs(5), async {
        stream.write_all(headers.as_bytes()).await?;
        stream.write_all(body).await?;
        stream.shutdown().await
    })
    .await
    .map_err(|_| "HTTP response write timed out".to_string())?
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_bind_accepts_only_loopback_or_tailscale_ipv4() {
        assert!(is_safe_bind_address("127.0.0.1".parse().unwrap()));
        assert!(is_safe_bind_address("100.64.0.1".parse().unwrap()));
        assert!(is_safe_bind_address("100.127.255.254".parse().unwrap()));
        assert!(!is_safe_bind_address("0.0.0.0".parse().unwrap()));
        assert!(!is_safe_bind_address("192.168.1.4".parse().unwrap()));
        assert!(!is_safe_bind_address("100.128.0.1".parse().unwrap()));
    }

    #[test]
    fn remote_url_brackets_ipv6_hosts() {
        assert_eq!(format_remote_url("::1", 9399), "http://[::1]:9399");
        assert_eq!(
            format_remote_url("100.126.114.121", 9399),
            "http://100.126.114.121:9399"
        );
    }

    #[test]
    fn bearer_token_requires_exact_match() {
        let request = HttpRequest {
            method: "GET".to_string(),
            target: "/api/sessions".to_string(),
            headers: HashMap::from([(
                "authorization".to_string(),
                "Bearer exact-token".to_string(),
            )]),
            body: Vec::new(),
        };
        assert!(request_is_authorized(&request, "exact-token"));
        assert!(!request_is_authorized(&request, "other-token"));
    }

    #[test]
    fn query_value_decodes_session_identifier() {
        assert_eq!(
            query_value("/api/capture?sessionId=tmux%3A0%3A22.0", "sessionId"),
            Some("tmux:0:22.0".to_string())
        );
    }

    #[test]
    fn generated_tokens_have_256_bits_of_uuid_material() {
        let token = generate_access_token();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|character| character.is_ascii_hexdigit()));
    }

    #[test]
    fn remote_key_input_uses_an_exact_allowlist_and_bounded_default() {
        for (input, expected) in [
            ("up", "Up"),
            ("down", "Down"),
            ("left", "Left"),
            ("right", "Right"),
            ("escape", "Escape"),
            ("tab", "Tab"),
            ("enter", "Enter"),
        ] {
            assert_eq!(tmux_key_name(input), Some(expected));
        }
        assert_eq!(tmux_key_name("C-c"), None);
        assert_eq!(tmux_key_name("Down;run-command"), None);

        let input: RemoteKeyRequest =
            serde_json::from_str(r#"{"sessionId":"tmux:0:1.0","key":"down"}"#).unwrap();
        assert_eq!(input.repeat, 1);
    }

    #[test]
    fn project_catalog_bounds_remote_launch_paths() {
        let base = std::env::temp_dir().join(format!("c3-project-catalog-{}", Uuid::new_v4()));
        let root = base.join("code");
        let project = root.join("allowed-project");
        let outside = base.join("outside-project");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&outside).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, root.join("escaped-link")).unwrap();

        let mut settings = AppSettings::default();
        settings.remote_project_roots = vec![root.to_string_lossy().to_string()];
        let state = Arc::new(AppState::new());
        let catalog = remote_project_catalog(&state, &settings);
        assert_eq!(catalog.len(), 1);
        assert_eq!(catalog[0].name, "allowed-project");
        assert!(allowed_project_path(
            &state,
            &settings,
            project.to_string_lossy().as_ref()
        )
        .is_ok());
        assert!(allowed_project_path(
            &state,
            &settings,
            outside.to_string_lossy().as_ref()
        )
        .is_err());
        assert!(allowed_project_path(&state, &settings, "relative-project").is_err());
        #[cfg(unix)]
        assert!(!catalog.iter().any(|entry| entry.name == "escaped-link"));

        assert_eq!(
            launch_agent_in_tmux("shell", &project, None).unwrap_err(),
            "Agent must be claude, codex, or omp."
        );

        let _ = fs::remove_dir_all(base);
    }
    #[test]
    fn launch_prompt_is_positional_and_rejects_terminal_controls() {
        let (_, command) = agent_launch_command("omp", Some("--approval-mode=yolo")).unwrap();
        assert!(command.starts_with("omp 'Task:\n--approval-mode=yolo'"));

        let (_, quoted) = agent_launch_command("claude", Some("'\u{3b} echo owned #")).unwrap();
        assert!(quoted.contains("'\\''; echo owned #"));

        for prompt in ["erase\u{15}prefix", "cancel\u{3}launch", "nul\0byte"] {
            assert_eq!(
                agent_launch_command("codex", Some(prompt)).unwrap_err(),
                "Initial prompt contains unsupported control characters."
            );
        }
    }


    #[test]
    fn sse_frames_are_single_complete_events() {
        assert_eq!(
            sse_frame("pane", r#"{"revision":"abc","text":"one\ntwo"}"#),
            "event: pane\ndata: {\"revision\":\"abc\",\"text\":\"one\\ntwo\"}\n\n"
        );
    }

    #[test]
    fn stream_payload_omits_plain_text_fallback() {
        let payload = PaneCapture {
            session_id: "tmux:0:1.0".to_string(),
            project_name: "test".to_string(),
            output: None,
            styled_lines: Vec::new(),
            revision: "abc".to_string(),
            captured_at: "now".to_string(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(!json.contains("\"output\""));
        assert!(json.contains("\"revision\":\"abc\""));
    }

    #[tokio::test]
    async fn request_parser_caps_unterminated_headers() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let client = tokio::spawn(async move {
            let mut stream = TcpStream::connect(address).await.unwrap();
            stream.write_all(&vec![b'A'; MAX_HEADER_BYTES]).await.unwrap();
        });
        let (mut server, _) = listener.accept().await.unwrap();
        let error = read_request(&mut server).await.unwrap_err();
        client.await.unwrap();
        assert_eq!(error, "HTTP headers are too large");
    }

    #[tokio::test]
    async fn request_parser_preserves_body_read_with_headers() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let client = tokio::spawn(async move {
            let mut stream = TcpStream::connect(address).await.unwrap();
            stream
                .write_all(b"POST /api/input HTTP/1.1\r\nContent-Length: 5\r\n\r\nhello")
                .await
                .unwrap();
        });
        let (mut server, _) = listener.accept().await.unwrap();
        let request = read_request(&mut server).await.unwrap();
        client.await.unwrap();
        assert_eq!(request.method, "POST");
        assert_eq!(request.target, "/api/input");
        assert_eq!(request.body, b"hello");
    }
}
