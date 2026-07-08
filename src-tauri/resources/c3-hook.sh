#!/bin/bash
# C3 Hook Script for Claude Code, Codex, and OMP
# Replaces notify-with-tmux.sh — C3 handles notifications, sounds, and UI updates.
#
# Install:
#   mkdir -p ~/.local/bin
#   cp c3-hook.sh ~/.local/bin/c3-hook.sh
#   chmod +x ~/.local/bin/c3-hook.sh
#
# Then configure Claude Code, Codex, or OMP hooks to call this script.

C3_HOOK_URL="${C3_HOOK_URL:-http://127.0.0.1:9398/hook}"

# Hook type is passed as first argument (Stop, Notification, PermissionRequest, SessionStart)
# Note: We use PermissionRequest (not PreToolUse) — it only fires when user approval is needed.
HOOK_TYPE="${1:-unknown}"
AGENT_KIND="${C3_AGENT_KIND:-}"

# Read the hook data from stdin
HOOK_DATA=$(cat)

# Get the current working directory
CWD=$(pwd)
TERMINAL_TTY=$(tty 2>/dev/null || true)

# Extract tool information if present
TOOL_NAME=$(echo "$HOOK_DATA" | jq -r '.tool_name // .tool // empty' 2>/dev/null)
TOOL_INPUT=$(echo "$HOOK_DATA" | jq -c '.tool_input // .input // null' 2>/dev/null)
SESSION_ID=$(echo "$HOOK_DATA" | jq -r '.session_id // empty' 2>/dev/null)

# Check if running with a dangerous/no-approval mode.
# Hooks are often launched through shell shims, so inspect the ancestor process tree.
SKIP_PERMS=false
APPROVAL_HINT=""
PROCESS_TREE=""
CURRENT_PID=$$
ANCESTOR_DEPTH=0
while [ -n "$CURRENT_PID" ] && [ "$CURRENT_PID" != "0" ] && [ "$CURRENT_PID" != "1" ] && [ "$ANCESTOR_DEPTH" -lt 12 ]; do
    PROC_CMD=$(ps -o command= -p "$CURRENT_PID" 2>/dev/null || true)
    PROC_PPID=$(ps -o ppid= -p "$CURRENT_PID" 2>/dev/null | tr -d ' ' || true)
    if [ -n "$PROC_CMD" ]; then
        PROCESS_TREE="${PROCESS_TREE}
${PROC_CMD}"
    fi
    CURRENT_PID="$PROC_PPID"
    ANCESTOR_DEPTH=$((ANCESTOR_DEPTH + 1))
done

if [ -z "$AGENT_KIND" ]; then
    if echo "$PROCESS_TREE" | grep -qi "codex"; then
        AGENT_KIND="codex"
    elif echo "$PROCESS_TREE" | grep -qi "omp"; then
        AGENT_KIND="omp"
    elif echo "$PROCESS_TREE" | grep -qi "claude"; then
        AGENT_KIND="claude"
    fi
fi

if echo "$PROCESS_TREE" | grep -Eq "dangerously-skip-permissions|dangerously-bypass-approvals-and-sandbox|--ask-for-approval[= ]never|-a[= ]?never"; then
    SKIP_PERMS=true
    APPROVAL_HINT="process-flag"
elif echo "$HOOK_DATA" | jq -e '.. | strings | select(test("dangerously-skip-permissions|dangerously-bypass-approvals-and-sandbox|--ask-for-approval[= ]never|approval[_-]?policy[=: ]+never|ask[_-]?for[_-]?approval[=: ]+never"; "i"))' >/dev/null 2>&1; then
    SKIP_PERMS=true
    APPROVAL_HINT="hook-payload"
fi

HOOK_PAYLOAD_KEYS=$(echo "$HOOK_DATA" | jq -c 'if type == "object" then keys else [] end' 2>/dev/null || echo "[]")

if [ -z "$AGENT_KIND" ]; then
    if echo "$HOOK_DATA" | jq -e '.. | strings | select(test("codex"; "i"))' >/dev/null 2>&1; then
        AGENT_KIND="codex"
    elif echo "$HOOK_DATA" | jq -e '.. | strings | select(test("omp"; "i"))' >/dev/null 2>&1; then
        AGENT_KIND="omp"
    else
        AGENT_KIND="claude"
    fi
fi

# Gather tmux context
TMUX_SESSION_NAME=""
TMUX_WINDOW_INDEX=""
TMUX_PANE_INDEX=""
TMUX_WINDOW_NAME=""

if [ -n "$TMUX" ] && [ -n "$TMUX_PANE" ]; then
    TMUX_SESSION_NAME=$(tmux display-message -p -t "$TMUX_PANE" '#S' 2>/dev/null)
    TMUX_WINDOW_INDEX=$(tmux display-message -p -t "$TMUX_PANE" '#I' 2>/dev/null)
    TMUX_PANE_INDEX=$(tmux display-message -p -t "$TMUX_PANE" '#P' 2>/dev/null)
    TMUX_WINDOW_NAME=$(tmux display-message -p -t "$TMUX_PANE" '#W' 2>/dev/null)
fi

# Build the notification payload
PAYLOAD=$(jq -n \
  --arg hook_type "$HOOK_TYPE" \
  --arg agent_kind "$AGENT_KIND" \
  --arg cwd "$CWD" \
  --arg terminal_tty "$TERMINAL_TTY" \
  --arg session_id "$SESSION_ID" \
  --arg tool_name "$TOOL_NAME" \
  --argjson tool_input "${TOOL_INPUT:-null}" \
  --argjson skip_perms "$SKIP_PERMS" \
  --arg approval_hint "$APPROVAL_HINT" \
  --argjson hook_payload_keys "${HOOK_PAYLOAD_KEYS:-[]}" \
  --arg tmux_session "$TMUX_SESSION_NAME" \
  --arg tmux_window "$TMUX_WINDOW_INDEX" \
  --arg tmux_pane "$TMUX_PANE_INDEX" \
  --arg tmux_window_name "$TMUX_WINDOW_NAME" \
  '{
    hook_type: $hook_type,
    agent_kind: $agent_kind,
    cwd: $cwd,
    terminal_tty: (if $terminal_tty == "" or $terminal_tty == "not a tty" then null else $terminal_tty end),
    session_id: (if $session_id == "" then null else $session_id end),
    tool_name: (if $tool_name == "" then null else $tool_name end),
    tool_input: $tool_input,
    skip_permissions: $skip_perms,
    approval_hint: (if $approval_hint == "" then null else $approval_hint end),
    hook_payload_keys: $hook_payload_keys,
    tmux: {
      session: $tmux_session,
      window: $tmux_window,
      pane: $tmux_pane,
      window_name: $tmux_window_name
    }
  }')

# Send to C3 (fire and forget, don't block the agent)
curl -s -X POST "$C3_HOOK_URL" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  --connect-timeout 1 \
  --max-time 2 \
  >/dev/null 2>&1 &

exit 0
