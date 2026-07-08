#!/bin/bash
# C3 Setup Script
# Installs hooks and checks dependencies for C3 (Carmelo Command Center)
#
# Supports Claude Code, Codex, and OMP (Oh My Pi).
#
# Usage:
#   ./setup.sh
#   curl -fsSL https://raw.githubusercontent.com/illustriousdevelopment/c3/main/setup.sh | bash

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[info]${NC} $1"; }
ok()    { echo -e "${GREEN}[ok]${NC} $1"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $1"; }
fail()  { echo -e "${RED}[error]${NC} $1"; }

echo ""
echo -e "${BLUE}C3${NC} — Carmelo Command Center Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ─── Check dependencies ────────────────────────────────────────────

MISSING=()

info "Checking dependencies..."

# jq (required)
if command -v jq &>/dev/null; then
    ok "jq $(jq --version 2>/dev/null || echo '')"
else
    fail "jq not found (required by c3-hook.sh)"
    MISSING+=("jq")
fi

# terminal-notifier (optional but recommended)
if command -v terminal-notifier &>/dev/null; then
    ok "terminal-notifier"
else
    warn "terminal-notifier not found (optional — enables macOS notifications)"
    MISSING+=("terminal-notifier")
fi

# tmux (required)
if command -v tmux &>/dev/null; then
    ok "tmux $(tmux -V 2>/dev/null || echo '')"
else
    fail "tmux not found (required — C3 monitors tmux sessions)"
    MISSING+=("tmux")
fi

# curl (required)
if command -v curl &>/dev/null; then
    ok "curl"
else
    fail "curl not found (required by c3-hook.sh)"
    MISSING+=("curl")
fi

echo ""

# ─── Offer to install missing deps ─────────────────────────────────

if [ ${#MISSING[@]} -gt 0 ] && command -v brew &>/dev/null; then
    echo -e "Missing: ${YELLOW}${MISSING[*]}${NC}"
    read -rp "Install missing dependencies with Homebrew? [Y/n] " answer
    answer=${answer:-Y}
    if [[ "$answer" =~ ^[Yy]$ ]]; then
        for dep in "${MISSING[@]}"; do
            info "Installing $dep..."
            brew install "$dep"
            ok "$dep installed"
        done
        echo ""
    fi
elif [ ${#MISSING[@]} -gt 0 ]; then
    warn "Install missing dependencies manually: brew install ${MISSING[*]}"
    echo ""
fi

# ─── Install c3-hook.sh ─────────────────────────────────────────────

HOOK_SRC=""
HOOK_DEST="$HOME/.local/bin/c3-hook.sh"

# Find the hook script — check several locations
if [ -f "hooks/c3-hook.sh" ]; then
    HOOK_SRC="hooks/c3-hook.sh"
elif [ -f "src-tauri/resources/c3-hook.sh" ]; then
    HOOK_SRC="src-tauri/resources/c3-hook.sh"
elif [ -f "$HOME/.local/share/c3/c3-hook.sh" ]; then
    HOOK_SRC="$HOME/.local/share/c3/c3-hook.sh"
fi

if [ -z "$HOOK_SRC" ]; then
    # Download from GitHub if not found locally
    info "Hook script not found locally, downloading..."
    HOOK_SRC="/tmp/c3-hook.sh"
    curl -fsSL "https://raw.githubusercontent.com/illustriousdevelopment/c3/main/hooks/c3-hook.sh" -o "$HOOK_SRC" 2>/dev/null || {
        fail "Could not download c3-hook.sh"
        fail "Please run this script from the C3 repo directory"
        exit 1
    }
fi

info "Installing c3-hook.sh..."
mkdir -p "$(dirname "$HOOK_DEST")"
cp "$HOOK_SRC" "$HOOK_DEST"
chmod +x "$HOOK_DEST"
ok "Installed to $HOOK_DEST"

# Copy icon for terminal-notifier
ICON_SRC=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for candidate in "$SCRIPT_DIR/src-tauri/icons/icon.png" "$SCRIPT_DIR/public/logo.png"; do
    if [ -f "$candidate" ]; then
        ICON_SRC="$candidate"
        break
    fi
done
if [ -n "$ICON_SRC" ]; then
    mkdir -p "$HOME/.config/c3"
    cp "$ICON_SRC" "$HOME/.config/c3/icon.png"
    ok "Installed notification icon to ~/.config/c3/icon.png"
fi

echo ""

# ─── Configure Claude Code hooks ────────────────────────────────────

SETTINGS_FILE="$HOME/.claude/settings.json"

info "Configuring Claude Code hooks..."

# Ensure ~/.claude directory exists
mkdir -p "$HOME/.claude"

# Back up existing settings
if [ -f "$SETTINGS_FILE" ]; then
    BACKUP="$SETTINGS_FILE.backup.$(date +%s)"
    cp "$SETTINGS_FILE" "$BACKUP"
    ok "Backed up settings to $BACKUP"
fi

# Define the Claude Code hooks we want to add
C3_HOOKS=$(cat <<'HOOKS_JSON'
{
  "Stop": [
    {
      "matcher": "",
      "hooks": [{ "type": "command", "command": "C3_AGENT_KIND=claude $HOME/.local/bin/c3-hook.sh Stop" }]
    }
  ],
  "Notification": [
    {
      "matcher": "",
      "hooks": [{ "type": "command", "command": "C3_AGENT_KIND=claude $HOME/.local/bin/c3-hook.sh Notification" }]
    }
  ],
  "PermissionRequest": [
    {
      "matcher": "",
      "hooks": [{ "type": "command", "command": "C3_AGENT_KIND=claude $HOME/.local/bin/c3-hook.sh PermissionRequest" }]
    }
  ],
  "SessionStart": [
    {
      "matcher": "",
      "hooks": [{ "type": "command", "command": "C3_AGENT_KIND=claude $HOME/.local/bin/c3-hook.sh SessionStart" }]
    }
  ]
}
HOOKS_JSON
)

CODEX_C3_HOOKS=$(cat <<'HOOKS_JSON'
{
  "Stop": [
    {
      "matcher": "",
      "hooks": [{ "type": "command", "command": "C3_AGENT_KIND=codex $HOME/.local/bin/c3-hook.sh Stop" }]
    }
  ],
  "Notification": [
    {
      "matcher": "",
      "hooks": [{ "type": "command", "command": "C3_AGENT_KIND=codex $HOME/.local/bin/c3-hook.sh Notification" }]
    }
  ],
  "PermissionRequest": [
    {
      "matcher": "",
      "hooks": [{ "type": "command", "command": "C3_AGENT_KIND=codex $HOME/.local/bin/c3-hook.sh PermissionRequest" }]
    }
  ],
  "SessionStart": [
    {
      "matcher": "",
      "hooks": [{ "type": "command", "command": "C3_AGENT_KIND=codex $HOME/.local/bin/c3-hook.sh SessionStart" }]
    }
  ]
}
HOOKS_JSON
)

if ! command -v jq &>/dev/null; then
    warn "jq not installed — writing hooks config directly"
    if [ -f "$SETTINGS_FILE" ]; then
        warn "Cannot merge with existing settings without jq"
        warn "Please install jq and re-run, or manually add hooks to $SETTINGS_FILE"
        echo ""
        echo "Hooks to add:"
        echo "$C3_HOOKS"
    else
        echo "{\"hooks\": $C3_HOOKS}" > "$SETTINGS_FILE"
        ok "Created $SETTINGS_FILE with C3 hooks"
    fi
else
    if [ -f "$SETTINGS_FILE" ]; then
        # Read existing settings and merge hooks
        EXISTING=$(cat "$SETTINGS_FILE")

        # Check if hooks already exist
        EXISTING_HOOKS=$(echo "$EXISTING" | jq -r '.hooks // empty' 2>/dev/null)

        if [ -n "$EXISTING_HOOKS" ]; then
            # Merge: C3 hooks take priority for the 4 hook types we manage,
            # but preserve any other hook types the user has configured
            MERGED=$(echo "$EXISTING" | jq --argjson c3hooks "$C3_HOOKS" '
                .hooks = ((.hooks // {}) * $c3hooks)
            ')
            echo "$MERGED" | jq '.' > "$SETTINGS_FILE"
            ok "Merged C3 hooks into existing settings (preserved other hooks)"
        else
            # No existing hooks — just add ours
            MERGED=$(echo "$EXISTING" | jq --argjson c3hooks "$C3_HOOKS" '
                .hooks = $c3hooks
            ')
            echo "$MERGED" | jq '.' > "$SETTINGS_FILE"
            ok "Added C3 hooks to existing settings"
        fi
    else
        echo "{\"hooks\": $C3_HOOKS}" | jq '.' > "$SETTINGS_FILE"
        ok "Created $SETTINGS_FILE with C3 hooks"
    fi
fi

CODEX_HOOKS_FILE="$HOME/.codex/hooks.json"
info "Configuring Codex hooks..."
mkdir -p "$HOME/.codex"
if [ -f "$CODEX_HOOKS_FILE" ]; then
    BACKUP="$CODEX_HOOKS_FILE.backup.$(date +%s)"
    cp "$CODEX_HOOKS_FILE" "$BACKUP"
    ok "Backed up Codex hooks to $BACKUP"
fi

if command -v jq &>/dev/null; then
    if [ -f "$CODEX_HOOKS_FILE" ]; then
        EXISTING=$(cat "$CODEX_HOOKS_FILE")
        MERGED=$(echo "$EXISTING" | jq --argjson c3hooks "$CODEX_C3_HOOKS" '
            .hooks = ((.hooks // {}) * $c3hooks)
        ')
        echo "$MERGED" | jq '.' > "$CODEX_HOOKS_FILE"
        ok "Merged C3 hooks into Codex hooks"
    else
        echo "{\"hooks\": $CODEX_C3_HOOKS}" | jq '.' > "$CODEX_HOOKS_FILE"
        ok "Created $CODEX_HOOKS_FILE with C3 hooks"
    fi
else
    warn "jq not installed — cannot safely merge Codex hooks"
fi

echo ""

# ─── Install OMP hook ──────────────────────────────────────────────

OMP_HOOK_SRC=""
OMP_HOOK_DIR="$HOME/.omp/agent/hooks/post"
OMP_HOOK_DEST="$OMP_HOOK_DIR/c3-notify.ts"

info "Configuring OMP hook..."

for candidate in "hooks/c3-omp-hook.ts" "src-tauri/resources/c3-omp-hook.ts" "$HOME/.local/share/c3/c3-omp-hook.ts"; do
    if [ -f "$candidate" ]; then
        OMP_HOOK_SRC="$candidate"
        break
    fi
done

if [ -z "$OMP_HOOK_SRC" ]; then
    info "OMP hook not found locally, downloading..."
    OMP_HOOK_SRC="/tmp/c3-omp-hook.ts"
    curl -fsSL "https://raw.githubusercontent.com/illustriousdevelopment/c3/main/hooks/c3-omp-hook.ts" -o "$OMP_HOOK_SRC" 2>/dev/null || {
        warn "Could not download c3-omp-hook.ts; OMP hook will not be installed"
        OMP_HOOK_SRC=""
    }
fi

if [ -n "$OMP_HOOK_SRC" ]; then
    mkdir -p "$OMP_HOOK_DIR"
    cp "$OMP_HOOK_SRC" "$OMP_HOOK_DEST"
    ok "Installed OMP hook to $OMP_HOOK_DEST"
fi

echo ""

# ─── Summary ─────────────────────────────────────────────────────────

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo "  Hook script:  $HOOK_DEST"
echo "  Settings:     $SETTINGS_FILE"
echo "  Codex hooks:  $CODEX_HOOKS_FILE"
if [ -n "$OMP_HOOK_SRC" ]; then
    echo "  OMP hook:     $OMP_HOOK_DEST"
fi
echo ""
echo "Next steps:"
echo "  1. Open C3"
echo "  2. Restart any running Claude Code, Codex, or OMP sessions"
echo "  3. Sessions will now appear in C3 automatically"
echo ""
