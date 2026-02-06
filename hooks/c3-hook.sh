#!/bin/bash
# C3 Hook Script for Claude Code
# Replaces notify-with-tmux.sh — C3 handles notifications, sounds, and UI updates.
#
# Install:
#   mkdir -p ~/.local/bin
#   cp c3-hook.sh ~/.local/bin/c3-hook.sh
#   chmod +x ~/.local/bin/c3-hook.sh
#
# Then configure ~/.claude/settings.json hooks to call this script.

C3_HOOK_URL="${C3_HOOK_URL:-http://127.0.0.1:9398/hook}"

# Hook type is passed as first argument (Stop, Notification, PermissionRequest, SessionStart)
HOOK_TYPE="${1:-unknown}"

# Read the hook data from stdin
HOOK_DATA=$(cat)

# Get the current working directory
CWD=$(pwd)

# Extract tool information if present
TOOL_NAME=$(echo "$HOOK_DATA" | jq -r '.tool_name // .tool // empty' 2>/dev/null)
TOOL_INPUT=$(echo "$HOOK_DATA" | jq -c '.tool_input // .input // null' 2>/dev/null)
SESSION_ID=$(echo "$HOOK_DATA" | jq -r '.session_id // empty' 2>/dev/null)

# Check if running with --dangerously-skip-permissions
# Look at the parent Claude process command line
SKIP_PERMS=false
CLAUDE_PID=$(pgrep -P "$$" -f claude 2>/dev/null || echo "")
if [ -z "$CLAUDE_PID" ]; then
    # Try finding claude in the process tree
    CLAUDE_PID=$(ps -o ppid= -p $$ 2>/dev/null | tr -d ' ')
fi
if [ -n "$CLAUDE_PID" ]; then
    CLAUDE_CMD=$(ps -o command= -p "$CLAUDE_PID" 2>/dev/null)
    if echo "$CLAUDE_CMD" | grep -q "dangerously-skip-permissions"; then
        SKIP_PERMS=true
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
  --arg cwd "$CWD" \
  --arg session_id "$SESSION_ID" \
  --arg tool_name "$TOOL_NAME" \
  --argjson tool_input "${TOOL_INPUT:-null}" \
  --argjson skip_perms "$SKIP_PERMS" \
  --arg tmux_session "$TMUX_SESSION_NAME" \
  --arg tmux_window "$TMUX_WINDOW_INDEX" \
  --arg tmux_pane "$TMUX_PANE_INDEX" \
  --arg tmux_window_name "$TMUX_WINDOW_NAME" \
  '{
    hook_type: $hook_type,
    cwd: $cwd,
    session_id: (if $session_id == "" then null else $session_id end),
    tool_name: (if $tool_name == "" then null else $tool_name end),
    tool_input: $tool_input,
    skip_permissions: $skip_perms,
    tmux: {
      session: $tmux_session,
      window: $tmux_window,
      pane: $tmux_pane,
      window_name: $tmux_window_name
    }
  }')

# Send to C3 (fire and forget, don't block Claude)
curl -s -X POST "$C3_HOOK_URL" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  --connect-timeout 1 \
  --max-time 2 \
  >/dev/null 2>&1 &

exit 0
