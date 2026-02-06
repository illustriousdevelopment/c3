#!/bin/bash
# Focus a Claude session in Ghostty + tmux
# Usage: focus-session.sh <session:window.pane>

TMUX_TARGET="$1"

if [ -z "$TMUX_TARGET" ]; then
  echo "Usage: focus-session.sh <session:window.pane>"
  exit 1
fi

# Parse target
SESSION="${TMUX_TARGET%%:*}"
WINDOW_PANE="${TMUX_TARGET#*:}"
WINDOW="${WINDOW_PANE%%.*}"
PANE="${WINDOW_PANE#*.}"

# Default pane to 0 if not specified
[ "$PANE" = "$WINDOW" ] && PANE="0"

# Activate Ghostty
osascript -e 'tell application "Ghostty" to activate' 2>/dev/null

# Small delay to let Ghostty focus
sleep 0.1

# Switch tmux window and pane
tmux select-window -t "${SESSION}:${WINDOW}" 2>/dev/null
tmux select-pane -t "${SESSION}:${WINDOW}.${PANE}" 2>/dev/null

echo "Focused: ${SESSION}:${WINDOW}.${PANE}"
