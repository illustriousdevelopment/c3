# C3 Remote Access — Feature Design

## Problem

C3 currently answers “which agent needs me?” only on the Mac running tmux. That breaks when the user leaves the workstation: active jobs continue, but input requests and terminal context are not available from a phone.

## Decision

Add an optional remote server to the existing C3 Mac process, plus two thin clients:

1. A mobile-first web client served directly by C3.
2. A native SwiftUI iPhone client distributed through TestFlight.

The Mac remains authoritative. Both clients use the same small HTTP API and never access tmux directly.

## Goals

- See all detected sessions and their attention state from an iPhone.
- Open one session and read a recent tmux pane capture.
- Type or dictate through the standard iOS keyboard, then send the response to that pane.
- Work over Tailscale without opening C3 to the public internet or local LAN.
- Remain optional, off by default, and understandable from C3 Settings.

## Non-goals

- A general-purpose remote shell or full terminal emulator.
- Internet hosting, account management, teams, or multi-user authorization.
- Replacing Tailscale with custom networking.
- Mirroring every desktop grouping and administrative control on mobile.
- Sending arbitrary tmux key sequences in the first release.

## User flow

### Enable on Mac

1. Open C3 Settings → Remote access.
2. Enable remote access.
3. C3 detects the Mac’s Tailscale IPv4 address and generates a private access token.
4. Save settings. C3 binds the configured port on that Tailscale address only.
5. Copy the pairing link for Safari or the iOS app.

### Check from phone

1. Open the pairing link while connected to Tailscale.
2. See a compact session board ordered by attention and recency.
3. Tap a session.
4. Read the latest pane output.
5. Enter a response using typing or iOS keyboard dictation and tap Send.
6. C3 pastes the text into the exact tmux pane and sends Enter.

## Interface

The mobile board follows the supplied k-stack reference:

- Dark, low-chrome top bar with C3 identity and connection state.
- Agent count directly under the bar.
- Two-column session cards on wider phones; one column on narrow screens.
- Project/session name, current task or pending action, explicit state label, agent kind, and a small state light.
- No desktop lanes, charts, metrics, gradients, glass, or decorative dashboard widgets.
- Session detail replaces the board with a readable monospace pane and a persistent response composer.

## API

All `/api/*` requests require `Authorization: Bearer <token>`.

### `GET /api/health`

Returns server version and status for pairing validation.

### `GET /api/sessions`

Returns the current serialized C3 session list. Clients order sessions locally by attention state and recency.

### `GET /api/capture?sessionId=<id>`

Returns up to 200 recent lines from the session’s tmux pane:

```json
{
  "sessionId": "tmux:0:22.0",
  "projectName": "carmelo-command-center",
  "output": "…",
  "capturedAt": "2026-08-24T12:00:00Z"
}
```

### `POST /api/input`

```json
{
  "sessionId": "tmux:0:22.0",
  "text": "Continue with the safe option.",
  "submit": true
}
```

C3 writes the text through a temporary tmux buffer and sends Enter only when `submit` is true. Request text is capped at 64 KiB.

## Security model

- Disabled by default.
- Bind address must be loopback or within Tailscale’s `100.64.0.0/10` IPv4 range.
- `0.0.0.0`, LAN addresses, and public addresses are rejected.
- A random UUID token is required for every API request.
- The browser receives the token in the URL fragment, which is not sent in HTTP requests or server logs; it stores the token locally and removes the fragment from visible history.
- The static client contains no session data and may load without authentication.
- The API exposes session summaries, pane capture, and text submission only—no arbitrary command endpoint.
- Tailscale supplies encrypted transport and device/network authorization. Plain HTTP must not be used outside Tailscale.

## Reliability

- Clients poll session summaries every 3 seconds and the open pane every 1.5 seconds.
- Loss of connection preserves the last readable state and shows a direct reconnect message.
- Server configuration changes restart only the remote listener, not C3 or tmux scanning.
- Sending input resolves the session ID against C3’s current in-memory map immediately before writing.

## Acceptance criteria

- With remote access disabled, C3 opens no remote listener.
- Enabling with a detected Tailscale address produces a working pairing URL.
- Requests without the token return 401 and never disclose sessions or pane content.
- Binding to `0.0.0.0` or a non-Tailscale address is rejected.
- A phone browser can list sessions, open a pane, and submit text to the correct pane.
- The web board is usable at 390×844 and does not exceed two columns.
- The iOS app accepts the same pairing URL and completes the same read/respond workflow.
- Existing local hooks on `127.0.0.1:9398` continue unchanged.
