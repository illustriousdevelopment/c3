use crate::cmd;
use crate::{
    is_unresolved_hook_session, AppState, C3Session, PendingAction, SessionState, StateDiagnostic,
};
use chrono::{DateTime, Utc};
use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;
use tauri::{AppHandle, Emitter};

/// Info about a tmux pane running an AI coding agent
#[derive(Debug)]
struct AgentPane {
    target: String,
    cwd: String,
    pane_title: String,
    window_name: String,
    pane_command: String,
    agent_kind: String,
}

/// State derived from reading JSONL conversation files
#[derive(Debug)]
struct ConversationState {
    state: SessionState,
    pending_action: Option<PendingAction>,
    last_message_time: Option<DateTime<Utc>>,
}

/// Scan tmux for all panes running Claude Code or Codex
fn find_agent_panes() -> Vec<AgentPane> {
    let output = cmd("tmux")
        .args([
            "list-panes",
            "-a",
            "-F",
            "#{session_name}:#{window_index}.#{pane_index}\t#{pane_pid}\t#{pane_current_command}\t#{pane_current_path}\t#{pane_title}\t#{window_name}",
        ])
        .output();

    let output = match output {
        Ok(o) if o.status.success() => o,
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            log::error!(
                "tmux list-panes failed (status {:?}): {}",
                o.status.code(),
                stderr
            );
            return vec![];
        }
        Err(e) => {
            log::error!("tmux command failed to execute: {}", e);
            return vec![];
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut panes = Vec::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 6 {
            continue;
        }

        let target = parts[0];
        let pane_pid = parts[1];
        let pane_command = parts[2];
        let cwd = parts[3];
        let pane_title = parts[4];
        let window_name = parts[5];

        // Detect Claude sessions:
        // 1. pane_current_command contains "claude"
        // 2. pane_current_command is "node" and child is claude
        // 3. pane_current_command is a versioned Claude binary (e.g. "2.1.37")
        let is_active_claude = pane_command.contains("claude")
            || (pane_command == "node" && is_child_claude(pane_pid))
            || is_claude_version_binary(pane_command);
        let is_active_codex =
            pane_command.contains("codex") || (pane_command == "node" && is_child_codex(pane_pid));

        // Also detect completed sessions (back to shell but title has marker)
        let has_claude_title = pane_title.contains('✳') || pane_title.contains("Claude");
        let has_codex_title = pane_title.contains("Codex") || pane_title.contains("codex");

        if is_active_claude
            || is_active_codex
            || ((has_claude_title || has_codex_title) && pane_command == "zsh")
        {
            panes.push(AgentPane {
                target: target.to_string(),
                cwd: cwd.to_string(),
                pane_title: pane_title.to_string(),
                window_name: window_name.to_string(),
                pane_command: pane_command.to_string(),
                agent_kind: if is_active_codex || has_codex_title {
                    "codex".to_string()
                } else {
                    "claude".to_string()
                },
            });
        }
    }

    panes
}

/// Check if any child process of the given PID is claude
fn is_child_claude(pane_pid: &str) -> bool {
    // pgrep for claude as a child of the pane process
    cmd("pgrep")
        .args(["-P", pane_pid, "-f", "claude"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Check if any child process of the given PID is codex
fn is_child_codex(pane_pid: &str) -> bool {
    cmd("pgrep")
        .args(["-P", pane_pid, "-f", "codex"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Check if the command name looks like a versioned Claude Code binary.
/// Enterprise Claude Code installs to ~/.local/share/claude/versions/<version>,
/// and tmux reports pane_current_command as the binary name (e.g. "2.1.37").
/// Old versions get cleaned up, so we pattern-match instead of checking the file.
fn is_claude_version_binary(command: &str) -> bool {
    // Match semver-like patterns: digits.digits.digits (e.g. "2.1.75")
    let parts: Vec<&str> = command.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

/// Convert a cwd to the Claude projects directory path
fn cwd_to_project_dir(cwd: &str) -> PathBuf {
    let home = dirs_next().unwrap_or_else(|| PathBuf::from("/tmp"));
    let claude_projects = home.join(".claude").join("projects");

    // Claude uses cwd with / replaced by -
    // e.g. /Users/jon/code/foo → -Users-jon-code-foo
    let dir_name = cwd.replace('/', "-");
    claude_projects.join(dir_name)
}

fn dirs_next() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(PathBuf::from)
}

/// Find the most recently modified JSONL file in a project directory
fn find_active_jsonl(project_dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(project_dir).ok()?;

    entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "jsonl")
                .unwrap_or(false)
        })
        .max_by_key(|e| {
            e.metadata()
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH)
        })
        .map(|e| e.path())
}

fn codex_sessions_dir() -> PathBuf {
    dirs_next()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".codex")
        .join("sessions")
}

fn collect_jsonl_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, out);
        } else if path.extension().map(|ext| ext == "jsonl").unwrap_or(false) {
            out.push(path);
        }
    }
}

fn codex_jsonl_matches_cwd(path: &Path, cwd: &str) -> bool {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };

    for line in BufReader::new(file).lines().filter_map(|l| l.ok()).take(20) {
        let parsed: serde_json::Value = match serde_json::from_str(&line) {
            Ok(parsed) => parsed,
            Err(_) => continue,
        };

        let session_cwd = parsed
            .get("payload")
            .and_then(|p| p.get("cwd"))
            .and_then(|v| v.as_str());

        if session_cwd == Some(cwd) {
            return true;
        }
    }

    false
}

fn find_active_codex_jsonl(cwd: &str) -> Option<PathBuf> {
    let mut files = Vec::new();
    collect_jsonl_files(&codex_sessions_dir(), &mut files);
    files.sort_by_key(|path| {
        fs::metadata(path)
            .and_then(|m| m.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH)
    });
    files.reverse();

    files
        .into_iter()
        .take(200)
        .find(|path| codex_jsonl_matches_cwd(path, cwd))
}

/// Read the last N lines of a file (reads from end)
fn read_last_lines(path: &Path, n: usize) -> Vec<String> {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return vec![],
    };

    let reader = BufReader::new(file);
    let lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();

    let start = if lines.len() > n { lines.len() - n } else { 0 };
    lines[start..].to_vec()
}

fn file_age_secs(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .map(|d| d.as_secs())
}

fn awaiting_input_state(last_message_time: Option<DateTime<Utc>>) -> ConversationState {
    ConversationState {
        state: SessionState::AwaitingInput,
        pending_action: Some(PendingAction {
            action_type: "input".to_string(),
            description: "Waiting for user input".to_string(),
            tool: None,
            command: None,
        }),
        last_message_time,
    }
}

fn is_codex_spinner_title(title: &str) -> bool {
    title
        .trim()
        .chars()
        .next()
        .map(|c| ('\u{2800}'..='\u{28ff}').contains(&c))
        .unwrap_or(false)
}

fn reconcile_codex_state_with_title(
    title: &str,
    conv_state: ConversationState,
    jsonl_age_secs: Option<u64>,
) -> ConversationState {
    if is_codex_spinner_title(title) && conv_state.state != SessionState::AwaitingPermission {
        return ConversationState {
            state: SessionState::Processing,
            pending_action: None,
            last_message_time: conv_state.last_message_time,
        };
    }

    if conv_state.state == SessionState::Processing
        && !is_codex_spinner_title(title)
        && jsonl_age_secs.map(|age| age > 15).unwrap_or(true)
    {
        return awaiting_input_state(conv_state.last_message_time);
    }

    conv_state
}

/// Check if a JSONL message is a real conversation message (not system noise)
fn is_conversation_message(parsed: &serde_json::Value) -> bool {
    let msg_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");

    // Skip non-conversation message types entirely
    if matches!(
        msg_type,
        "progress" | "system" | "file-history-snapshot" | "summary"
    ) {
        return false;
    }

    // Skip messages with isMeta flag
    if parsed
        .get("isMeta")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        return false;
    }

    // For user messages, skip internal Claude Code bookkeeping
    if msg_type == "user" {
        let content = parsed.get("message").and_then(|m| m.get("content"));

        if let Some(serde_json::Value::String(text)) = content {
            // These are Claude Code internal messages, not real user input
            if text.starts_with("<local-command-caveat>")
                || text.starts_with("<bash-input>")
                || text.starts_with("<bash-stdout>")
                || text.starts_with("<bash-stderr>")
                || text == "[Request interrupted by user]"
            {
                return false;
            }
        }

        // Also check array content for interrupt markers
        if let Some(serde_json::Value::Array(blocks)) = content {
            let has_interrupt = blocks.iter().any(|b| {
                b.get("type").and_then(|t| t.as_str()) == Some("text")
                    && b.get("text")
                        .and_then(|t| t.as_str())
                        .map(|t| t.contains("[Request interrupted by user]"))
                        .unwrap_or(false)
            });
            if has_interrupt {
                return false;
            }
        }
    }

    // Must be "user" or "assistant" type with a role
    let role = parsed
        .get("message")
        .and_then(|m| m.get("role"))
        .and_then(|r| r.as_str())
        .unwrap_or("");

    matches!(
        (msg_type, role),
        ("user", "user") | ("assistant", "assistant")
    )
}

/// Extract a timestamp from a JSONL message
fn extract_message_timestamp(parsed: &serde_json::Value) -> Option<DateTime<Utc>> {
    // Try top-level timestamp first (ISO 8601 string)
    if let Some(ts) = parsed.get("timestamp").and_then(|v| v.as_str()) {
        if let Ok(dt) = ts.parse::<DateTime<Utc>>() {
            return Some(dt);
        }
    }
    // Try nested message timestamp
    if let Some(ts) = parsed
        .get("message")
        .and_then(|m| m.get("timestamp"))
        .and_then(|v| v.as_str())
    {
        if let Ok(dt) = ts.parse::<DateTime<Utc>>() {
            return Some(dt);
        }
    }
    // Try nested data.message.timestamp (progress messages)
    if let Some(ts) = parsed
        .get("data")
        .and_then(|d| d.get("message"))
        .and_then(|m| m.get("timestamp"))
        .and_then(|v| v.as_str())
    {
        if let Ok(dt) = ts.parse::<DateTime<Utc>>() {
            return Some(dt);
        }
    }
    None
}

/// Determine state from JSONL conversation file
fn detect_state_from_jsonl(jsonl_path: &Path) -> ConversationState {
    // Read more lines to look past system noise
    let last_lines = read_last_lines(jsonl_path, 30);

    if last_lines.is_empty() {
        return ConversationState {
            state: SessionState::Processing,
            pending_action: None,
            last_message_time: None,
        };
    }

    // Check file modification time for staleness
    let file_age_secs = file_age_secs(jsonl_path).unwrap_or(0);

    // Find the latest timestamp from any message in the last lines
    let mut latest_timestamp: Option<DateTime<Utc>> = None;
    for line in last_lines.iter().rev() {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(ts) = extract_message_timestamp(&parsed) {
                if latest_timestamp.is_none() || ts > latest_timestamp.unwrap() {
                    latest_timestamp = Some(ts);
                    break; // Lines are in order, so the last one with a timestamp is the most recent
                }
            }
        }
    }

    // Walk backwards through lines, skipping noise, to find last real message
    for line in last_lines.iter().rev() {
        let parsed: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if !is_conversation_message(&parsed) {
            continue;
        }

        let msg_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let message = parsed.get("message").unwrap_or(&serde_json::Value::Null);
        let content = message.get("content");

        match msg_type {
            "user" => {
                // Check if this is a tool_result (part of ongoing tool use chain)
                if let Some(serde_json::Value::Array(blocks)) = content {
                    let has_tool_result = blocks
                        .iter()
                        .any(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_result"));
                    if has_tool_result {
                        return ConversationState {
                            state: SessionState::Processing,
                            pending_action: None,
                            last_message_time: latest_timestamp,
                        };
                    }
                }
                // Real user message — if file is stale, Claude already
                // processed it and is waiting for more input. If fresh,
                // Claude is actively generating a response.
                if file_age_secs > 15 {
                    return ConversationState {
                        state: SessionState::AwaitingInput,
                        pending_action: Some(PendingAction {
                            action_type: "input".to_string(),
                            description: "Waiting for user input".to_string(),
                            tool: None,
                            command: None,
                        }),
                        last_message_time: latest_timestamp,
                    };
                }
                return ConversationState {
                    state: SessionState::Processing,
                    pending_action: None,
                    last_message_time: latest_timestamp,
                };
            }

            "assistant" => {
                if let Some(serde_json::Value::Array(blocks)) = content {
                    let block_types: Vec<&str> = blocks
                        .iter()
                        .filter_map(|b| b.get("type").and_then(|t| t.as_str()))
                        .collect();

                    // Has tool_use → either actively running or awaiting permission
                    if block_types.contains(&"tool_use") {
                        if file_age_secs > 5 {
                            // Stale file + tool_use = likely awaiting permission
                            let tool_name = blocks
                                .iter()
                                .filter(|b| {
                                    b.get("type").and_then(|t| t.as_str()) == Some("tool_use")
                                })
                                .last()
                                .and_then(|b| b.get("name"))
                                .and_then(|n| n.as_str())
                                .map(|s| s.to_string());

                            let command = blocks
                                .iter()
                                .filter(|b| {
                                    b.get("type").and_then(|t| t.as_str()) == Some("tool_use")
                                })
                                .last()
                                .and_then(|b| b.get("input"))
                                .and_then(|i| i.get("command"))
                                .and_then(|c| c.as_str())
                                .map(|s| {
                                    if s.len() > 100 {
                                        format!("{}...", &s[..97])
                                    } else {
                                        s.to_string()
                                    }
                                });

                            return ConversationState {
                                state: SessionState::AwaitingPermission,
                                pending_action: Some(PendingAction {
                                    action_type: "permission".to_string(),
                                    description: format!(
                                        "Wants to use {}",
                                        tool_name.as_deref().unwrap_or("a tool")
                                    ),
                                    tool: tool_name,
                                    command,
                                }),
                                last_message_time: latest_timestamp,
                            };
                        }
                        // Fresh file + tool_use = actively processing
                        return ConversationState {
                            state: SessionState::Processing,
                            pending_action: None,
                            last_message_time: latest_timestamp,
                        };
                    }

                    // Text/thinking only, no tool_use → Claude finished, waiting for input
                    if block_types.contains(&"text") {
                        return ConversationState {
                            state: SessionState::AwaitingInput,
                            pending_action: Some(PendingAction {
                                action_type: "input".to_string(),
                                description: "Waiting for user input".to_string(),
                                tool: None,
                                command: None,
                            }),
                            last_message_time: latest_timestamp,
                        };
                    }

                    // Only thinking block (no text yet) → still processing
                    if block_types.contains(&"thinking") && !block_types.contains(&"text") {
                        return ConversationState {
                            state: SessionState::Processing,
                            pending_action: None,
                            last_message_time: latest_timestamp,
                        };
                    }
                }

                // String content → simple text response, waiting for input
                if content.map(|c| c.is_string()).unwrap_or(false) {
                    return ConversationState {
                        state: SessionState::AwaitingInput,
                        pending_action: Some(PendingAction {
                            action_type: "input".to_string(),
                            description: "Waiting for user input".to_string(),
                            tool: None,
                            command: None,
                        }),
                        last_message_time: latest_timestamp,
                    };
                }
            }

            _ => continue,
        }
    }

    // No real conversation messages found in the last 30 lines.
    // If file is stale, Claude is idle waiting for input.
    if file_age_secs > 15 {
        return ConversationState {
            state: SessionState::AwaitingInput,
            pending_action: Some(PendingAction {
                action_type: "input".to_string(),
                description: "Waiting for user input".to_string(),
                tool: None,
                command: None,
            }),
            last_message_time: latest_timestamp,
        };
    }
    ConversationState {
        state: SessionState::Processing,
        pending_action: None,
        last_message_time: latest_timestamp,
    }
}

fn detect_state_from_codex_jsonl(jsonl_path: &Path) -> ConversationState {
    let last_lines = read_last_lines(jsonl_path, 50);
    if last_lines.is_empty() {
        return ConversationState {
            state: SessionState::Processing,
            pending_action: None,
            last_message_time: None,
        };
    }

    let file_age_secs = file_age_secs(jsonl_path).unwrap_or(0);

    let mut latest_timestamp: Option<DateTime<Utc>> = None;
    for line in last_lines.iter().rev() {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(ts) = extract_message_timestamp(&parsed) {
                latest_timestamp = Some(ts);
                break;
            }
        }
    }

    let mut completed_call_ids: HashSet<String> = HashSet::new();

    for line in last_lines.iter().rev() {
        let parsed: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let top_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let payload = parsed.get("payload").unwrap_or(&serde_json::Value::Null);

        if top_type == "event_msg" {
            match payload.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                "task_complete" => {
                    return ConversationState {
                        state: SessionState::Complete,
                        pending_action: None,
                        last_message_time: latest_timestamp,
                    };
                }
                "turn_aborted" => {
                    return ConversationState {
                        state: SessionState::AwaitingInput,
                        pending_action: Some(PendingAction {
                            action_type: "input".to_string(),
                            description: "Waiting for user input".to_string(),
                            tool: None,
                            command: None,
                        }),
                        last_message_time: latest_timestamp,
                    };
                }
                "agent_message" => {
                    return ConversationState {
                        state: SessionState::AwaitingInput,
                        pending_action: Some(PendingAction {
                            action_type: "input".to_string(),
                            description: "Waiting for user input".to_string(),
                            tool: None,
                            command: None,
                        }),
                        last_message_time: latest_timestamp,
                    };
                }
                "user_message" => {
                    return ConversationState {
                        state: SessionState::Processing,
                        pending_action: None,
                        last_message_time: latest_timestamp,
                    };
                }
                "task_started" | "exec_begin" | "patch_apply_begin" => {
                    return ConversationState {
                        state: SessionState::Processing,
                        pending_action: None,
                        last_message_time: latest_timestamp,
                    };
                }
                "exec_command_end" | "patch_apply_end" | "mcp_tool_call_end" => {
                    if let Some(call_id) = payload.get("call_id").and_then(|v| v.as_str()) {
                        completed_call_ids.insert(call_id.to_string());
                    }
                    continue;
                }
                "token_count"
                | "turn_context"
                | "thread_name_updated"
                | "context_compacted"
                | "web_search_end" => continue,
                _ => {}
            }
        }

        if top_type == "response_item" {
            let payload_type = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let role = payload.get("role").and_then(|v| v.as_str()).unwrap_or("");
            let call_id = payload.get("call_id").and_then(|v| v.as_str());

            if payload_type == "reasoning" {
                return ConversationState {
                    state: SessionState::Processing,
                    pending_action: None,
                    last_message_time: latest_timestamp,
                };
            }

            if payload_type == "function_call_output" || payload_type == "custom_tool_call_output" {
                if let Some(call_id) = call_id {
                    completed_call_ids.insert(call_id.to_string());
                }
                continue;
            }

            if payload_type == "message" && role == "assistant" {
                return ConversationState {
                    state: SessionState::AwaitingInput,
                    pending_action: Some(PendingAction {
                        action_type: "input".to_string(),
                        description: "Waiting for user input".to_string(),
                        tool: None,
                        command: None,
                    }),
                    last_message_time: latest_timestamp,
                };
            }

            if matches!(
                payload_type,
                "function_call" | "local_shell_call" | "custom_tool_call" | "web_search_call"
            ) {
                if call_id
                    .map(|id| completed_call_ids.contains(id))
                    .unwrap_or(false)
                {
                    continue;
                }

                let pending_action = codex_pending_tool_action(payload);
                if codex_tool_requires_approval(payload) || file_age_secs > 15 {
                    return ConversationState {
                        state: SessionState::AwaitingPermission,
                        pending_action: Some(pending_action),
                        last_message_time: latest_timestamp,
                    };
                }

                return ConversationState {
                    state: SessionState::Processing,
                    pending_action: None,
                    last_message_time: latest_timestamp,
                };
            }
        }
    }

    if file_age_secs > 15 {
        return ConversationState {
            state: SessionState::AwaitingInput,
            pending_action: Some(PendingAction {
                action_type: "input".to_string(),
                description: "Waiting for user input".to_string(),
                tool: None,
                command: None,
            }),
            last_message_time: latest_timestamp,
        };
    }

    ConversationState {
        state: SessionState::Processing,
        pending_action: None,
        last_message_time: latest_timestamp,
    }
}

fn codex_pending_tool_action(payload: &serde_json::Value) -> PendingAction {
    let tool_name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .or_else(|| payload.get("type").and_then(|v| v.as_str()))
        .map(|s| s.to_string());

    PendingAction {
        action_type: "permission".to_string(),
        description: format!("Wants to use {}", tool_name.as_deref().unwrap_or("a tool")),
        tool: tool_name,
        command: codex_tool_command(payload),
    }
}

fn codex_tool_requires_approval(payload: &serde_json::Value) -> bool {
    codex_tool_input(payload)
        .and_then(|input| {
            input
                .get("sandbox_permissions")
                .and_then(|v| v.as_str())
                .map(|s| s == "require_escalated")
        })
        .unwrap_or(false)
}

fn codex_tool_command(payload: &serde_json::Value) -> Option<String> {
    codex_tool_input(payload).and_then(|input| {
        input
            .get("cmd")
            .or_else(|| input.get("command"))
            .and_then(|v| v.as_str())
            .map(|s| truncate_chars(s, 100))
    })
}

fn codex_tool_input(payload: &serde_json::Value) -> Option<serde_json::Value> {
    for key in ["arguments", "input"] {
        match payload.get(key) {
            Some(serde_json::Value::Object(_)) => return payload.get(key).cloned(),
            Some(serde_json::Value::String(s)) => {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(s) {
                    return Some(parsed);
                }
            }
            _ => {}
        }
    }
    None
}

fn codex_permission_diagnostic(jsonl_path: &Path, age_secs: Option<u64>) -> (String, Option<String>) {
    let mut completed_call_ids: HashSet<String> = HashSet::new();

    for line in read_last_lines(jsonl_path, 50).iter().rev() {
        let parsed: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let top_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let payload = parsed.get("payload").unwrap_or(&serde_json::Value::Null);

        if top_type == "event_msg" {
            if matches!(
                payload.get("type").and_then(|v| v.as_str()).unwrap_or(""),
                "exec_command_end" | "patch_apply_end" | "mcp_tool_call_end"
            ) {
                if let Some(call_id) = payload.get("call_id").and_then(|v| v.as_str()) {
                    completed_call_ids.insert(call_id.to_string());
                }
            }
            continue;
        }

        if top_type != "response_item" {
            continue;
        }

        let payload_type = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let call_id = payload.get("call_id").and_then(|v| v.as_str());

        if payload_type == "function_call_output" || payload_type == "custom_tool_call_output" {
            if let Some(call_id) = call_id {
                completed_call_ids.insert(call_id.to_string());
            }
            continue;
        }

        if !matches!(
            payload_type,
            "function_call" | "local_shell_call" | "custom_tool_call" | "web_search_call"
        ) {
            continue;
        }

        if call_id
            .map(|id| completed_call_ids.contains(id))
            .unwrap_or(false)
        {
            continue;
        }

        let tool_name = payload
            .get("name")
            .and_then(|v| v.as_str())
            .or_else(|| payload.get("type").and_then(|v| v.as_str()))
            .map(|s| s.to_string());
        let reason = if codex_tool_requires_approval(payload) {
            "jsonl unpaired tool call has sandbox_permissions=require_escalated".to_string()
        } else {
            format!(
                "jsonl stale unpaired tool call without explicit approval flag; age={}s",
                age_secs
                    .map(|age| age.to_string())
                    .unwrap_or_else(|| "unknown".to_string())
            )
        };
        return (reason, tool_name);
    }

    (
        format!(
            "jsonl classified permission but no unpaired tool call found in last 50 lines; age={}s",
            age_secs
                .map(|age| age.to_string())
                .unwrap_or_else(|| "unknown".to_string())
        ),
        None,
    )
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let keep = max_chars.saturating_sub(3);
    format!("{}...", value.chars().take(keep).collect::<String>())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_temp_jsonl(name: &str, lines: &[&str]) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "c3-{name}-{}-{}.jsonl",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let mut file = fs::File::create(&path).unwrap();
        for line in lines {
            writeln!(file, "{line}").unwrap();
        }
        path
    }

    #[test]
    fn codex_task_complete_wins_over_trailing_bookkeeping() {
        let path = write_temp_jsonl(
            "codex-complete",
            &[
                r#"{"timestamp":"2026-05-29T16:00:00Z","type":"event_msg","payload":{"type":"task_started"}}"#,
                r#"{"timestamp":"2026-05-29T16:00:01Z","type":"event_msg","payload":{"type":"task_complete"}}"#,
                r#"{"timestamp":"2026-05-29T16:00:02Z","type":"event_msg","payload":{"type":"token_count"}}"#,
            ],
        );

        let state = detect_state_from_codex_jsonl(&path);
        let _ = fs::remove_file(path);

        assert_eq!(state.state, SessionState::Complete);
        assert!(state.pending_action.is_none());
    }

    #[test]
    fn codex_unpaired_escalated_tool_call_is_permission() {
        let path = write_temp_jsonl(
            "codex-permission",
            &[
                r#"{"timestamp":"2026-05-29T16:00:00Z","type":"event_msg","payload":{"type":"task_started"}}"#,
                r#"{"timestamp":"2026-05-29T16:00:01Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"call_1","arguments":"{\"cmd\":\"npm install\",\"sandbox_permissions\":\"require_escalated\",\"justification\":\"Needs network\"}"}}"#,
            ],
        );

        let state = detect_state_from_codex_jsonl(&path);
        let _ = fs::remove_file(path);

        assert_eq!(state.state, SessionState::AwaitingPermission);
        assert_eq!(
            state
                .pending_action
                .as_ref()
                .and_then(|a| a.tool.as_deref()),
            Some("exec_command")
        );
    }

    #[test]
    fn codex_paired_tool_call_is_not_permission() {
        let path = write_temp_jsonl(
            "codex-paired-tool",
            &[
                r#"{"timestamp":"2026-05-29T16:00:00Z","type":"event_msg","payload":{"type":"task_started"}}"#,
                r#"{"timestamp":"2026-05-29T16:00:01Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"call_1","arguments":"{\"cmd\":\"npm install\",\"sandbox_permissions\":\"require_escalated\",\"justification\":\"Needs network\"}"}}"#,
                r#"{"timestamp":"2026-05-29T16:00:02Z","type":"response_item","payload":{"type":"function_call_output","call_id":"call_1","output":"ok"}}"#,
                r#"{"timestamp":"2026-05-29T16:00:03Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Done"}]}}"#,
            ],
        );

        let state = detect_state_from_codex_jsonl(&path);
        let _ = fs::remove_file(path);

        assert_eq!(state.state, SessionState::AwaitingInput);
        assert_eq!(
            state
                .pending_action
                .as_ref()
                .map(|a| a.action_type.as_str()),
            Some("input")
        );
    }

    #[test]
    fn codex_idle_title_downgrades_stale_processing_state() {
        let state = reconcile_codex_state_with_title(
            "3d-text-blender",
            ConversationState {
                state: SessionState::Processing,
                pending_action: None,
                last_message_time: None,
            },
            Some(60),
        );

        assert_eq!(state.state, SessionState::AwaitingInput);
        assert_eq!(
            state
                .pending_action
                .as_ref()
                .map(|a| a.action_type.as_str()),
            Some("input")
        );
    }

    #[test]
    fn codex_spinner_title_keeps_processing_state() {
        let state = reconcile_codex_state_with_title(
            "⠋ infinite-job-works",
            ConversationState {
                state: SessionState::Processing,
                pending_action: None,
                last_message_time: None,
            },
            Some(60),
        );

        assert_eq!(state.state, SessionState::Processing);
        assert!(state.pending_action.is_none());
    }

    #[test]
    fn codex_spinner_title_promotes_idle_jsonl_state_to_processing() {
        let state = reconcile_codex_state_with_title(
            "⠋ infinite-job-works",
            ConversationState {
                state: SessionState::AwaitingInput,
                pending_action: Some(PendingAction {
                    action_type: "input".to_string(),
                    description: "Waiting for user input".to_string(),
                    tool: None,
                    command: None,
                }),
                last_message_time: None,
            },
            Some(1),
        );

        assert_eq!(state.state, SessionState::Processing);
        assert!(state.pending_action.is_none());
    }

    #[test]
    fn codex_recent_reasoning_is_processing() {
        let path = write_temp_jsonl(
            "codex-reasoning",
            &[
                r#"{"timestamp":"2026-05-30T06:52:27Z","type":"event_msg","payload":{"type":"agent_message"}}"#,
                r#"{"timestamp":"2026-05-30T06:52:27Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Working"}]}}"#,
                r#"{"timestamp":"2026-05-30T06:52:42Z","type":"response_item","payload":{"type":"reasoning"}}"#,
            ],
        );

        let state = detect_state_from_codex_jsonl(&path);
        let _ = fs::remove_file(path);

        assert_eq!(state.state, SessionState::Processing);
        assert!(state.pending_action.is_none());
    }

    #[test]
    fn codex_idle_title_preserves_permission_state() {
        let state = reconcile_codex_state_with_title(
            "work-project",
            ConversationState {
                state: SessionState::AwaitingPermission,
                pending_action: Some(PendingAction {
                    action_type: "permission".to_string(),
                    description: "Wants to use exec_command".to_string(),
                    tool: Some("exec_command".to_string()),
                    command: None,
                }),
                last_message_time: None,
            },
            Some(60),
        );

        assert_eq!(state.state, SessionState::AwaitingPermission);
        assert_eq!(
            state
                .pending_action
                .as_ref()
                .map(|a| a.action_type.as_str()),
            Some("permission")
        );
    }
}

fn latest_timestamp_from_jsonl(jsonl_path: &Path) -> Option<DateTime<Utc>> {
    let lines = read_last_lines(jsonl_path, 50);
    for line in lines.iter().rev() {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(ts) = extract_message_timestamp(&parsed) {
                return Some(ts);
            }
        }
    }
    None
}

/// Derive a display name from pane info
fn derive_project_name(pane: &AgentPane) -> String {
    // Best source: pane_title (set by Claude, e.g. "✳ R2 Upload Failure")
    let title = pane.pane_title.trim();
    if !title.is_empty() && title != "MacBookPro.localdomain" && !title.contains("localhost") {
        // Strip the ✳ prefix if present
        let clean = title.trim_start_matches('✳').trim_start_matches("✴").trim();
        if !clean.is_empty() {
            return clean.to_string();
        }
    }

    // Fallback: last path component of cwd, then tmux window name
    Path::new(&pane.cwd)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .or_else(|| {
            let window_name = pane.window_name.trim();
            if window_name.is_empty() {
                None
            } else {
                Some(window_name.to_string())
            }
        })
        .unwrap_or_else(|| pane.agent_kind.clone())
}

/// Run a single scan cycle
pub fn scan_tmux(state: &Arc<AppState>, app_handle: &AppHandle) {
    let panes = find_agent_panes();
    let mut found_targets: HashSet<String> = HashSet::new();

    for pane in &panes {
        found_targets.insert(pane.target.clone());
        let session_id = format!("tmux:{}", pane.target);
        let mut codex_jsonl_for_debug: Option<(PathBuf, Option<u64>)> = None;

        // Determine state using pane title as primary signal:
        // - ✳ = Claude Code idle (waiting for user input)
        // - Braille spinner (U+2800..U+28FF) = actively processing
        // - No special Claude prefix = transitional (tool exec, output) — still active
        // - Codex without a spinner is idle unless JSONL says complete/permission
        // - zsh = session ended, back at shell
        let title_trimmed = pane.pane_title.trim();
        let title_starts_with_idle_marker = title_trimmed.starts_with('✳');

        let conv_state = if pane.pane_command == "zsh" {
            // Session ended — still grab the last message timestamp from JSONL
            let last_msg_time = if pane.agent_kind == "codex" {
                find_active_codex_jsonl(&pane.cwd)
                    .and_then(|jsonl| latest_timestamp_from_jsonl(&jsonl))
            } else {
                let project_dir = cwd_to_project_dir(&pane.cwd);
                find_active_jsonl(&project_dir)
                    .and_then(|jsonl| latest_timestamp_from_jsonl(&jsonl))
            };
            ConversationState {
                state: SessionState::Complete,
                pending_action: None,
                last_message_time: last_msg_time,
            }
        } else if pane.agent_kind == "codex" {
            match find_active_codex_jsonl(&pane.cwd) {
                Some(jsonl) => {
                    let jsonl_age_secs = file_age_secs(&jsonl);
                    codex_jsonl_for_debug = Some((jsonl.clone(), jsonl_age_secs));
                    let detected = detect_state_from_codex_jsonl(&jsonl);
                    reconcile_codex_state_with_title(&pane.pane_title, detected, jsonl_age_secs)
                }
                None if is_codex_spinner_title(&pane.pane_title) => ConversationState {
                    state: SessionState::Processing,
                    pending_action: None,
                    last_message_time: None,
                },
                None => awaiting_input_state(None),
            }
        } else if title_starts_with_idle_marker {
            // ✳ means Claude Code is idle — check JSONL for AwaitingInput vs AwaitingPermission
            let project_dir = cwd_to_project_dir(&pane.cwd);
            match find_active_jsonl(&project_dir) {
                Some(jsonl) => detect_state_from_jsonl(&jsonl),
                None => ConversationState {
                    state: SessionState::AwaitingInput,
                    pending_action: Some(PendingAction {
                        action_type: "input".to_string(),
                        description: "Waiting for user input".to_string(),
                        tool: None,
                        command: None,
                    }),
                    last_message_time: None,
                },
            }
        } else {
            // No ✳ = Claude is actively working (spinner or transitional)
            // Still grab the last message timestamp
            let project_dir = cwd_to_project_dir(&pane.cwd);
            let last_msg_time = find_active_jsonl(&project_dir).and_then(|jsonl| {
                let lines = read_last_lines(&jsonl, 30);
                for line in lines.iter().rev() {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) {
                        if let Some(ts) = extract_message_timestamp(&parsed) {
                            return Some(ts);
                        }
                    }
                }
                None
            });
            ConversationState {
                state: SessionState::Processing,
                pending_action: None,
                last_message_time: last_msg_time,
            }
        };

        let project_name = derive_project_name(pane);

        // Check if this session was recently updated by a hook — if so, don't override
        let hook_protected = {
            let timestamps = state.hook_timestamps.read();
            timestamps
                .get(&session_id)
                .map(|t| t.elapsed().as_secs() < crate::HOOK_GRACE_PERIOD_SECS)
                .unwrap_or(false)
        };

        let mut sessions = state.sessions.write();
        let existing = sessions.get(&session_id);

        if hook_protected && existing.is_some() {
            // Hook recently set this state — only update non-state fields (path, name, etc.)
            if let Some(session) = sessions.get_mut(&session_id) {
                session.project_path = Some(pane.cwd.clone());
                session.tmux_target = Some(pane.target.clone());
                session.agent_kind = Some(pane.agent_kind.clone());
                // Don't touch state, pending_action, or last_activity
            }
            drop(sessions);
            continue;
        }

        // Use the JSONL message timestamp for last_activity when available,
        // fall back to JSONL file modification time, then Utc::now() as last resort
        let jsonl_activity = conv_state.last_message_time.unwrap_or_else(|| {
            let jsonl = if pane.agent_kind == "codex" {
                find_active_codex_jsonl(&pane.cwd)
            } else {
                let project_dir = cwd_to_project_dir(&pane.cwd);
                find_active_jsonl(&project_dir)
            };
            jsonl
                .and_then(|p| fs::metadata(&p).ok())
                .and_then(|m| m.modified().ok())
                .and_then(|t| {
                    let duration = t.duration_since(SystemTime::UNIX_EPOCH).ok()?;
                    DateTime::from_timestamp(duration.as_secs() as i64, duration.subsec_nanos())
                })
                .unwrap_or_else(Utc::now)
        });

        let (changed, last_activity) = match existing {
            Some(prev) if prev.state == conv_state.state => {
                if conv_state.state == SessionState::Complete {
                    // Complete sessions: freeze last_activity so they don't re-sort
                    (false, prev.last_activity)
                } else {
                    // Active sessions: update from JSONL so sorting reflects recency
                    (false, jsonl_activity)
                }
            }
            Some(_) => {
                // State changed
                (true, jsonl_activity)
            }
            None => {
                // New session
                (true, jsonl_activity)
            }
        };

        if changed
            && pane.agent_kind == "codex"
            && conv_state.state == SessionState::AwaitingPermission
        {
            let (reason, tool_name) = codex_jsonl_for_debug
                .as_ref()
                .map(|(jsonl, age)| codex_permission_diagnostic(jsonl, *age))
                .unwrap_or_else(|| {
                    (
                        "codex scanner classified permission without matching JSONL".to_string(),
                        None,
                    )
                });
            state.log_state_diagnostic(StateDiagnostic {
                timestamp: Utc::now().format("%H:%M:%S%.3f").to_string(),
                source: "tmux-jsonl".to_string(),
                session_id: Some(session_id.clone()),
                agent_kind: pane.agent_kind.clone(),
                cwd: pane.cwd.clone(),
                state: "AwaitingPermission".to_string(),
                reason,
                tool_name,
                tmux_target: Some(pane.target.clone()),
                pane_title: Some(pane.pane_title.clone()),
                skipped: false,
            });
        }

        let session = C3Session {
            id: session_id.clone(),
            project_name,
            project_path: Some(pane.cwd.clone()),
            agent_kind: Some(pane.agent_kind.clone()),
            state: conv_state.state,
            tmux_target: Some(pane.target.clone()),
            terminal_tty: None,
            last_activity,
            pending_action: conv_state.pending_action,
            metrics: None,
        };

        if changed {
            log::info!(
                "{} ({}) → {:?}",
                pane.target,
                session.project_name,
                session.state
            );
        }

        sessions.insert(session_id.clone(), session.clone());
        drop(sessions);

        if changed {
            let _ = app_handle.emit("session-update", session);
        }
    }

    // Remove sessions for panes that no longer exist
    let mut sessions = state.sessions.write();
    let tmux_ids: Vec<String> = sessions
        .keys()
        .filter(|id| id.starts_with("tmux:"))
        .cloned()
        .collect();

    for id in tmux_ids {
        let target = id.strip_prefix("tmux:").unwrap_or("");
        if !found_targets.contains(target) {
            sessions.remove(&id);
            let _ = app_handle.emit("session-removed", id);
        }
    }

    let orphan_hook_ids: Vec<String> = sessions
        .iter()
        .filter(|(_, session)| is_unresolved_hook_session(session))
        .map(|(id, _)| id.clone())
        .collect();

    for id in orphan_hook_ids {
        sessions.remove(&id);
        let _ = app_handle.emit("session-removed", id);
    }
}

/// Start the periodic tmux scanner
pub async fn start_tmux_scanner(
    state: Arc<AppState>,
    app_handle: AppHandle,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    log::info!("Starting tmux scanner (polling every 3s)");

    loop {
        scan_tmux(&state, &app_handle);
        tokio::select! {
            _ = tokio::time::sleep(tokio::time::Duration::from_secs(3)) => {}
            _ = shutdown.changed() => {
                log::info!("Tmux scanner shutting down");
                break;
            }
        }
    }
}
