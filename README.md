# C3 — Claude Command Center

A visual session manager for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Monitor all your Claude sessions across tmux panes from a single dashboard.

<!-- TODO: screenshots -->

## Features

- **Real-time session monitoring** — See all active Claude Code sessions at a glance
- **State tracking** — Know which sessions need permission, are processing, waiting for input, or complete
- **Instant notifications** — macOS desktop notifications with configurable sounds per event type
- **Keyboard-driven** — Navigate sessions with vim-style keys, fuzzy search with `Cmd+K`
- **Click-to-focus** — Jump directly to any session's tmux pane
- **Session tagging & pinning** — Organize sessions by project or priority
- **Hook-based updates** — Sub-second state changes via Claude Code hooks (with tmux scanner fallback)

## Requirements

- macOS
- [tmux](https://github.com/tmux/tmux)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [jq](https://jqlang.github.io/jq/) — for hook script JSON processing
- [terminal-notifier](https://github.com/julienXX/terminal-notifier) — optional, for desktop notifications

## Install

### Homebrew (recommended)

```bash
brew tap illustriousdevelopment/c3
brew install --cask c3
```

### Manual

Download the latest `.dmg` from [Releases](https://github.com/illustriousdevelopment/c3/releases), open it, and drag C3 to Applications.

## Setup

### Automatic (recommended)

Open C3, go to **Settings** (gear icon), and click **Install C3 Hooks**. This will:

1. Check for required dependencies
2. Install the hook script to `~/.local/bin/c3-hook.sh`
3. Configure Claude Code hooks in `~/.claude/settings.json`

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
2. Open Claude Code in tmux panes as usual
3. Sessions appear automatically in the C3 dashboard

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Cmd+K` | Fuzzy search sessions |
| `j` / `k` | Navigate sessions |
| `Enter` | Focus session terminal |
| `1-9` | Quick jump to session |
| `D` | Toggle debug panel |
| `?` | Show keyboard shortcuts |
| `Esc` | Close dialog / deselect |

## How it works

C3 uses two mechanisms to track Claude Code sessions:

1. **Hooks** (primary) — Claude Code hooks fire shell commands on events like `PreToolUse`, `Notification`, `Stop`, and `SessionStart`. The `c3-hook.sh` script sends these events to C3's local HTTP endpoint (`http://127.0.0.1:9398/hook`).

2. **Tmux scanner** (fallback) — Periodically scans tmux for panes running Claude, parsing conversation files from `~/.claude/projects/` to determine state. Lower frequency, but ensures nothing is missed.

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

## Architecture

```
┌─────────────────────────────────────────────┐
│                   C3 App                    │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  │
│  │ React   │  │ Hook     │  │ WebSocket │  │
│  │ UI      │  │ Server   │  │ Server    │  │
│  │ :1420   │  │ :9398    │  │ :7777     │  │
│  └─────────┘  └──────────┘  └───────────┘  │
│                     ▲                       │
│                     │ HTTP POST             │
│  ┌──────────────────┘                       │
│  │  Tmux Scanner (fallback)                 │
│  └──────────────────────────────────────────│
└─────────────────────────────────────────────┘
        ▲
        │ c3-hook.sh
┌───────┴─────────────────────────────────────┐
│            Claude Code (in tmux)            │
│  Hook events: PreToolUse, Notification,     │
│               Stop, SessionStart            │
└─────────────────────────────────────────────┘
```

## License

[MIT](LICENSE)
