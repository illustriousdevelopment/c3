# C3 Hooks Setup

This document explains how to configure Claude Code to send real-time notifications to the C3 (Claude Command Center) app.

## Quick Setup

**Recommended:** Use the in-app setup (Settings > Install C3 Hooks) or run:
```bash
./setup.sh
```

## Manual Setup

1. **Copy the hook script** to a permanent location:
   ```bash
   mkdir -p ~/.local/bin
   cp hooks/c3-hook.sh ~/.local/bin/c3-hook.sh
   chmod +x ~/.local/bin/c3-hook.sh
   ```

2. **Add hooks to Claude Code settings** (`~/.claude/settings.json`):
   ```json
   {
     "hooks": {
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
       "PreToolUse": [
         {
           "matcher": "",
           "hooks": [{ "type": "command", "command": "$HOME/.local/bin/c3-hook.sh PreToolUse" }]
         }
       ],
       "SessionStart": [
         {
           "matcher": "",
           "hooks": [{ "type": "command", "command": "$HOME/.local/bin/c3-hook.sh SessionStart" }]
         }
       ]
     }
   }
   ```

3. **Restart Claude Code** to pick up the new hooks.

## How It Works

- **PreToolUse**: Fires before Claude uses a tool (triggers "Awaiting Permission" state)
- **Notification**: Fires when Claude wants your attention (triggers "Awaiting Input" state)
- **Stop**: Fires when Claude finishes responding (triggers "Complete" state)
- **SessionStart**: Fires when a new session starts (triggers "Processing" state)

The hook script sends a JSON notification to C3's HTTP endpoint at `http://127.0.0.1:9398/hook`.

## Requirements

- `jq` - JSON processor (install via `brew install jq`)
- `curl` - HTTP client (pre-installed on macOS)
- C3 app must be running

## Optional

- `terminal-notifier` - for macOS desktop notifications (`brew install terminal-notifier`)

## Troubleshooting

### Verify the hook is being called
Add logging to the hook script:
```bash
echo "$(date): $HOOK_TYPE from $CWD" >> /tmp/c3-hook.log
```

### Verify C3 is receiving hooks
Check C3's logs for "Hook received:" messages, or open the Debug panel (press `D` in C3).

### Test the endpoint manually
```bash
curl -X POST http://127.0.0.1:9398/hook \
  -H "Content-Type: application/json" \
  -d '{"hook_type":"PreToolUse","cwd":"/path/to/project","tool_name":"Bash"}'
```

## Configuration

Set environment variable to use a different C3 endpoint:
```bash
export C3_HOOK_URL="http://127.0.0.1:9398/hook"
```
