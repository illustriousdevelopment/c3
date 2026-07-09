<p align="center">
  <img src="public/logo.png" width="80" alt="C3 logo" />
</p>

# C3 — Carmelo Command Center

C3 is a visualizer and control center for Claude Code, Codex, and OMP terminal sessions running in tmux.

When running lots of projects in parallel, C3 makes it easier to see which agent needs attention, jump back to the right tmux pane, and keep Claude Code, Codex, and OMP sessions organized from one small desktop app.

<p align="center">
  <img src="public/C3-Example.png" width="800" alt="C3 screenshot" />
</p>

## Features

- **Claude Code + Codex + OMP support** — Track all three agent types with the same session model
- **Real-time session monitoring** — See active Claude Code, Codex, and OMP sessions at a glance
- **State glyphs** — Compact status badges show permission, idle, working, complete, and error states
- **Desktop notifications** — macOS notifications via terminal-notifier with click-to-focus on the right tmux pane
- **Background mode** — Close the window and C3 keeps running in the menu bar, still sending notifications
- **Keyboard-driven** — Navigate sessions with vim-style keys, fuzzy search with `Cmd+K`
- **Click-to-focus** — Jump directly to any session's tmux pane
- **Guarded terminal kill** — Kill a selected tmux-backed session from the menu or keyboard, with confirmation by default
- **Readable paths** — Selected sessions marquee the full project path so long paths are easier to scan
- **Session tagging & pinning** — Organize sessions by project or priority
- **Hook-based updates** — Sub-second state changes via Claude Code and Codex hooks, with tmux scanner fallback

## Requirements

- macOS
- [tmux](https://github.com/tmux/tmux)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Codex, OMP, or any combination
- [jq](https://jqlang.github.io/jq/) — for hook script JSON processing
- [terminal-notifier](https://github.com/julienXX/terminal-notifier) — for desktop notifications with click-to-focus

## Install

### Homebrew (recommended)

```bash
brew tap illustriousdevelopment/c3
brew install --cask c3
```

### Manual

Download the latest `.dmg` from [Releases](https://github.com/illustriousdevelopment/c3/releases), open it, and drag C3 to Applications.

Current release: [v0.2.12](https://github.com/illustriousdevelopment/c3/releases/tag/v0.2.12)

## Setup

### Automatic (recommended)

Open C3, go to **Settings** (gear icon), and click **Install C3 Hooks**. This will:

1. Check for required dependencies
2. Install the hook script to `~/.local/bin/c3-hook.sh`
3. Install the notification icon to `~/.config/c3/icon.png`
4. Configure Claude Code hooks in `~/.claude/settings.json`
5. Configure Codex hooks in `~/.codex/hooks.json`
6. Configure OMP hooks in `~/.omp/agent/hooks/post/c3-notify.ts`

### CLI setup

```bash
./setup.sh
```

Or from anywhere:

```bash
curl -fsSL https://raw.githubusercontent.com/illustriousdevelopment/c3/main/setup.sh | bash
```

### Manual setup

See [hooks/SETUP.md](hooks/SETUP.md) for step-by-step instructions.

## Usage

1. Start C3
2. Open Claude Code, Codex, or OMP in tmux panes as usual
3. Sessions appear automatically in the C3 dashboard
4. Close the window — C3 keeps running in the menu bar and still sends notifications
5. Click the tray icon or use "Show C3" to bring the window back

Sessions can be focused by clicking a card, pressing `Enter` on the selected card, or clicking a notification. C3 focuses tmux-backed sessions exactly when it has a tmux target; hook-only sessions fall back to activating the configured terminal app.

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Cmd+K` | Fuzzy search sessions |
| `j` / `k` | Navigate sessions |
| `Enter` | Focus session terminal |
| `1-9` | Quick jump to session |
| `X` | Kill selected terminal after confirmation |
| `Shift+X` | Kill selected terminal without confirmation |
| `D` | Toggle debug panel |
| `?` | Show keyboard shortcuts |
| `Esc` | Close dialog / deselect |

The kill action only targets tmux-backed sessions. C3 will not kill an arbitrary terminal process if it cannot resolve the selected session to a tmux pane.

## How it works

C3 uses two mechanisms to track agent sessions:

1. **Hooks** (primary) — Claude Code, Codex, and OMP hooks fire shell commands on `PermissionRequest`, `Notification`, `Stop`, and `SessionStart` events. The `c3-hook.sh` script sends these to C3's local HTTP endpoint (`http://127.0.0.1:9398/hook`), which updates session state and fires desktop notifications via terminal-notifier. Hook payloads include agent kind, cwd, terminal tty, and tmux context when available.

2. **Tmux scanner** (fallback) — Periodically scans tmux for panes running Claude Code, Codex, or OMP, parsing conversation files from `~/.claude/projects/`, `~/.codex/sessions/`, and `~/.omp/agent/sessions/` to determine state. Lower frequency, but useful when a hook was missed or a session was already running before C3 started.

Claude Code, Codex, and OMP sessions are intentionally treated as the same kind of work item in the UI: an agent running in a tmux pane that may need focus, approval, input, or cleanup.

## Development

### Prerequisites

- [Rust](https://rustup.rs/)
- [Node.js](https://nodejs.org/) 20+
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)

### Run locally

```bash
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

## License

[MIT](LICENSE)
