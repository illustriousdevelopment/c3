# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

C3 is for developers running multiple coding-agent sessions in tmux. The primary user moves between a Mac workstation and an iPhone and needs to see which agents are working, waiting, complete, or blocked without staying at the desk.

## Product Purpose

C3 turns concurrent Claude Code, Codex, and Oh My Pi sessions into one operational queue. Success means the user can identify the session needing attention, inspect enough terminal context to decide what to do, and return a response to that exact tmux pane.

## Positioning

C3 derives its operational view from the user's existing tmux sessions and agent hooks instead of requiring agents to run inside a new orchestration system.

## Operating Context

- The Mac app runs continuously near the tmux server and remains the source of truth.
- Agent sessions are commonly long-running and grouped by project.
- The user checks sessions from the Mac dashboard and, optionally, from an iPhone connected to the same Tailscale network.
- Remote access is personal infrastructure, not a multi-user hosted service.

## Capabilities and Constraints

- Supports Claude Code, Codex, and Oh My Pi sessions running in tmux.
- Remote access is optional and disabled by default.
- The remote server binds only to loopback or a Tailscale address, never all interfaces.
- Remote clients can list and group sessions, keep a device-local recent-interaction order, inspect a pane capture, send text or allowlisted navigation keys to a pane, and start a supported agent in an allowed project directory.
- A high-entropy token is required in addition to Tailscale network access.
- The browser client should work immediately; the native iOS client should be suitable for TestFlight distribution.
- C3 does not replace tmux, expose a general shell, or provide internet-facing hosting.

## Brand Commitments

- Product name: C3, Carmelo Command Center.
- Preserve the existing cube mark and dark operational interface.
- The remote view should be restrained and compact, using the supplied k-stack screenshot as a density and hierarchy reference rather than adding a full desktop dashboard to a phone.
- Voice is plain, direct, and operational.

## Evidence on Hand

- Existing macOS Tauri application and session state model.
- Existing agent hooks and tmux scanner.
- User-provided k-stack mobile screenshot showing a compact two-column agent board.
- Existing C3 icon and visual tokens in `src/App.css` and `src-tauri/icons`.

## Product Principles

1. Show attention state before metadata.
2. Keep the Mac authoritative; remote clients stay thin.
3. Require deliberate opt-in and private-network binding.
4. Make the common mobile action—read context, send a response—take one drill-in.
5. Prefer a dependable operational surface over a feature-heavy remote terminal.

## Accessibility & Inclusion

Remote web and iOS surfaces must support Dynamic Type or browser text scaling, visible focus, semantic labels, sufficient contrast, reduced motion, and touch targets appropriate for one-handed use.
