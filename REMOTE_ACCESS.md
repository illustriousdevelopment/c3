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
- Agent count and search directly under the bar.
- Two-column session cards on wider phones; one column on narrow screens or at accessibility text sizes.
- Project/session name, current task or pending action, explicit state label, agent kind, and a small state light.
- No desktop lanes, charts, metrics, gradients, glass, or decorative dashboard widgets.
- Session detail replaces the board with a monospace pane that preserves safe ANSI foreground/background colors, bold, dim, italic, and underline styling.
- The native app supports portrait and landscape orientation.

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
  "output": "plain-text fallback",
  "styledLines": [[
    { "text": "working", "foreground": "#71b7ef", "bold": true }
  ]],
  "revision": "7fa9c1e52b44a180",
  "capturedAt": "2026-08-24T12:00:00Z"
}
```

### `GET /api/stream?sessionId=<id>`

Returns an authenticated Server-Sent Events stream for one open pane. The server samples tmux every 250 ms and emits a `pane` event only when the content-derived revision changes. Stream events contain styled lines and omit the duplicate plain-text fallback. Browsers use an authenticated `fetch()` stream; iOS uses `URLSessionDataDelegate`.

```text
event: pane
data: {"sessionId":"tmux:0:22.0","styledLines":[…],"revision":"…"}
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
- Live streams are revoked when remote access is disabled, rebound, or its token rotates; at most four streams may run concurrently.
- The static client contains no session data and may load without authentication.
- The API exposes session summaries, pane capture, and text submission only—no arbitrary command endpoint.
- Tailscale supplies encrypted transport and device/network authorization. Plain HTTP must not be used outside Tailscale.

## Why C3 does not use `tmux pipe-pane`

`pipe-pane -O` can forward new pane bytes immediately, but it is not a copy of the rendered tmux screen:

- A pane has only one output pipe, so C3 could replace a user's existing logger or automation and cannot reliably restore its command.
- The pipe starts with future output only; it does not provide the current screen needed when a phone opens a session.
- It emits the raw terminal byte stream—cursor movement, alternate-screen operations, erases, and partial frames. Reproducing that stream correctly would require a full terminal emulator in both the browser and SwiftUI client.
- Control mode avoids the one-pipe conflict but still sends raw pane output and therefore has the same terminal-emulation requirement.

C3 instead samples tmux's already-rendered pane, preserves safe ANSI styling, and streams only changed revisions. This keeps tmux authoritative, avoids modifying panes, and measured under 1% C3 CPU with two live clients. If process-launch overhead becomes material later, the next optimization is a persistent tmux control connection for capture commands or line-level capture diffs—not taking ownership of `pipe-pane`.

## Reliability

- Clients poll session summaries every 3 seconds.
- An open pane defaults to a bounded 250 ms SSE stream that sends only changed revisions. **Saver** mode uses the prior 1.5-second snapshot polling path.
- Capture revisions prevent unchanged streams from rebuilding the terminal view.
- Stream failures preserve the last readable pane, fall back to snapshot polling, and reconnect with bounded backoff.
- Server configuration changes restart only the remote listener, not C3 or tmux scanning.
- Sending input resolves the session ID against C3’s current in-memory map immediately before writing.

## Acceptance criteria

- With remote access disabled, C3 opens no remote listener.
- Enabling with a detected Tailscale address produces a working pairing URL.
- Requests without the token return 401 and never disclose sessions or pane content.
- Binding to `0.0.0.0` or a non-Tailscale address is rejected.
- A phone browser can list sessions, open a pane, and submit text to the correct pane.
- The web board is usable at 390×844 and does not exceed two columns.
- Session search filters by title, project, agent kind, and pending-action text.
- Native portrait and landscape layouts preserve the two-column ceiling.
- The iOS app accepts the same pairing URL and completes the same read/respond workflow.
- Live mode refreshes an active pane several times per second; Saver mode remains selectable on web and iOS.
- Existing local hooks on `127.0.0.1:9398` continue unchanged.
