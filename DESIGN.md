---
name: C3
description: A restrained dark operational system for finding and resolving agent attention.
colors:
  desktop-bg-primary: "#0a0a0f"
  desktop-bg-secondary: "#12121a"
  desktop-bg-tertiary: "#1a1a25"
  desktop-bg-card: "#16161f"
  desktop-text-primary: "#e4e4e7"
  desktop-text-secondary: "#a1a1aa"
  desktop-text-muted: "#71717a"
  desktop-accent-blue: "#3B82F6"
  desktop-accent-amber: "#F59E0B"
  desktop-accent-red: "#EF4444"
  desktop-accent-green: "#10B981"
  desktop-accent-gray: "#6B7280"
  desktop-border: "#27272a"
  desktop-border-subtle: "#1f1f28"
  desktop-state-permission: "#DC2626"
  desktop-state-awaiting: "#D97706"
  desktop-state-processing: "#2563EB"
  desktop-state-complete: "#059669"
  desktop-state-error: "#7C3AED"
  remote-bg: "#111318"
  remote-bar: "#1a1e26"
  remote-panel: "#1b1f27"
  remote-panel-pressed: "#242a34"
  remote-line: "#6e7684"
  remote-text: "#f4f6f8"
  remote-muted: "#a8b0bc"
  remote-faint: "#737b88"
  remote-blue: "#71b7ef"
  remote-yellow: "#ffc107"
  remote-red: "#ff6b6b"
  remote-green: "#75d29a"
  remote-button-ink: "#07131c"
  remote-terminal-bg: "#0b0d11"
  remote-terminal-text: "#dce2e8"
typography:
  desktop-body:
    fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif"
  desktop-mark:
    fontFamily: "'Geist Mono', 'SF Mono', 'Monaco', monospace"
    fontSize: "24px"
    fontWeight: 700
    letterSpacing: "2px"
  desktop-lane-label:
    fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "1.5px"
  remote-brand:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif"
    fontSize: "21px"
    fontWeight: 760
    letterSpacing: "-0.025em"
  remote-card-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif"
    fontSize: "18px"
    fontWeight: 780
    lineHeight: 1.18
    letterSpacing: "-0.022em"
  remote-body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif"
    fontSize: "14px"
    lineHeight: 1.35
  terminal:
    fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, Monaco, Consolas, monospace"
    fontSize: "11.5px"
    lineHeight: 1.48
rounded:
  remote-card: "3px"
  terminal: "4px"
  compact-control: "5px"
  desktop-card: "6px"
  brand-mark: "7px"
  touch-control: "8px"
  response-control: "9px"
  modal: "12px"
  pill: "20px"
  round: "50%"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "10px"
  md: "12px"
  card: "14px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
components:
  desktop-filter-chip:
    backgroundColor: "{colors.desktop-bg-secondary}"
    textColor: "{colors.desktop-text-secondary}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  desktop-filter-chip-active:
    backgroundColor: "{colors.desktop-bg-tertiary}"
    textColor: "{colors.desktop-text-primary}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  desktop-session-card:
    backgroundColor: "{colors.desktop-bg-card}"
    textColor: "{colors.desktop-text-primary}"
    rounded: "{rounded.desktop-card}"
    padding: "8px 12px"
  desktop-settings-select:
    backgroundColor: "{colors.desktop-bg-tertiary}"
    textColor: "{colors.desktop-text-primary}"
    rounded: "{rounded.desktop-card}"
    padding: "10px 12px"
  remote-topbar:
    backgroundColor: "{colors.remote-bar}"
    textColor: "{colors.remote-text}"
    height: "58px"
    padding: "10px 16px"
  remote-search-field:
    backgroundColor: "{colors.remote-panel}"
    textColor: "{colors.remote-text}"
    rounded: "{rounded.brand-mark}"
    height: "44px"
    padding: "9px 12px 9px 38px"
  remote-session-card:
    backgroundColor: "{colors.remote-panel}"
    textColor: "{colors.remote-text}"
    rounded: "{rounded.remote-card}"
    padding: "15px 15px 13px"
  remote-response-field:
    backgroundColor: "{colors.remote-panel}"
    textColor: "{colors.remote-text}"
    rounded: "{rounded.response-control}"
    padding: "12px 13px"
  remote-send-button:
    backgroundColor: "{colors.remote-blue}"
    textColor: "{colors.remote-button-ink}"
    rounded: "{rounded.response-control}"
    height: "48px"
  remote-terminal:
    backgroundColor: "{colors.remote-terminal-bg}"
    textColor: "{colors.remote-terminal-text}"
    typography: "{typography.terminal}"
    rounded: "{rounded.terminal}"
    padding: "14px"
---

# Design System: C3

## Overview

**Creative North Star: "The Attention Board"**

C3 is a restrained, compact operational world built around a near-black and graphite field. It should feel like dependable workstation infrastructure: information-dense without looking busy, quiet until a session changes state, and direct about the action the user needs to take.

The desktop dashboard and remote clients share that hierarchy without sharing a page template. Desktop can use lanes and denser management controls; remote uses a compact board and one drill-in to terminal context. The remote board's two-column ceiling and detail-only response composer are surface rules, not universal layout rules.

**Key Characteristics:**
- Near-black foundations with shallow graphite layering.
- State color used as a signal, never as ambient decoration.
- Attention text before secondary metadata.
- Compact typography with strong labels and monospaced terminal or path data.
- Native controls and semantic type on iOS, preserving hierarchy rather than copying web pixels.

## Colors

The palette separates structural darkness from sparse operational signals. Desktop uses a deeper violet-black family; remote lightens graphite and text for small-screen legibility while retaining the same cool operational character.

### Primary
- **Cool Activity Blue** (`desktop-accent-blue`, `desktop-state-processing`, `remote-blue`): active selection, focus, working or spawning state, and affirmative remote actions.

### Secondary
- **Attention Amber** (`desktop-accent-amber`, `desktop-state-awaiting`, `remote-yellow`): input-needed and completion/idle signals that deserve a board scan, plus update attention on desktop.

### Tertiary
- **Permission Red** (`desktop-accent-red`, `desktop-state-permission`, `remote-red`): permission, error, disconnected, and destructive states.
- **Connection Green** (`desktop-accent-green`, `desktop-state-complete`, `remote-green`): positive connection or completion where the surface explicitly defines it.
- **Exceptional Violet** (`desktop-state-error`): the incumbent desktop error-state lane signal; do not generalize it to remote, which uses red for errors.

### Neutral
- **Desktop Near-Black** (`desktop-bg-primary`): desktop canvas.
- **Desktop Graphite Layers** (`desktop-bg-secondary`, `desktop-bg-card`, `desktop-bg-tertiary`): shell, card, hover, and selected layers.
- **Desktop Text Ladder** (`desktop-text-primary`, `desktop-text-secondary`, `desktop-text-muted`): content, supporting copy, and quiet metadata.
- **Desktop Dividers** (`desktop-border`, `desktop-border-subtle`): structure between compact regions.
- **Remote Near-Black** (`remote-bg`): web remote canvas and theme color.
- **Remote Graphite Layers** (`remote-bar`, `remote-panel`, `remote-panel-pressed`): sticky bar, cards and fields, then pressed feedback.
- **Remote Text Ladder** (`remote-text`, `remote-muted`, `remote-faint`): content, supporting copy, then timestamps and low-priority status.
- **Remote Structural Line** (`remote-line`): deliberately visible card and pairing-field boundaries.
- **Terminal Pair** (`remote-terminal-bg`, `remote-terminal-text`): isolated pane capture with terminal contrast.

### Named Rules

**The Signals, Not Decoration Rule.** Cool blue means activity or action, amber means attention, and red means permission/error pressure; keep these colors sparse enough to scan.

**The Surface Owns the State Mapping Rule.** Preserve each implemented surface's exact semantic mapping; desktop completion is green, while remote completion/idle is amber and remote errors are red.

## Typography

**Display Font:** System sans on remote and SwiftUI system roles on iOS
**Body Font:** Geist with the system sans fallback stack on desktop; system sans on remote
**Label/Mono Font:** Geist Mono on desktop; `ui-monospace`/SF Mono family for pane output

**Character:** The system pairs compact neutral sans text with monospaced operational data. Tight negative tracking strengthens remote names and brand text; positive tracking and uppercase strengthen state and lane labels.

### Hierarchy
- **Product Mark** (`desktop-mark`): the desktop C3 mark; bold, blue, monospaced, and widely tracked.
- **Remote Brand** (`remote-brand`): strong top-bar identity without turning the board into a marketing header.
- **Card Title** (`remote-card-title`): the dominant identity inside each remote session card.
- **Body** (`remote-body`): task summaries and supporting operational copy.
- **Lane Label** (`desktop-lane-label`): compact uppercase desktop grouping labels.
- **Terminal** (`terminal`): dense pane capture; retain preserved whitespace and wrapping.
- **Native Hierarchy:** use SwiftUI semantic roles (`headline`, `subheadline`, `caption`, `caption2`) and primary/secondary/tertiary foreground styles so Dynamic Type controls the rendered scale.

### Named Rules

**The Operational Type Rule.** Use monospaced type for terminal output, paths, commands, ports, tokens, and keyboard hints—not for ordinary prose.

**The Native Adaptation Rule.** On iOS, preserve emphasis and reading order with semantic font roles; do not freeze the web font sizes into SwiftUI.

## Layout

Desktop is a full-height shell with a draggable header, a scrollable main region padded by 20px, and a centered war room capped at 1200px. Its lanes stack vertically at a 16px rhythm; lane contents use an auto-filling grid with a 280px minimum card column. This density belongs to the workstation surface.

Remote web uses a centered container capped at 920px, safe-area-aware top and bottom padding, and a two-column session grid with a 10px gap. Below 360px it becomes one column; from 700px it increases outer padding, gap, card padding, and card height. The iOS board mirrors the two-column default and switches to one flexible column at accessibility Dynamic Type sizes, lifting restrictive line limits at the same time.

Response controls live only in session detail. Web keeps the composer sticky above the bottom safe area; iOS places it in a bottom safe-area inset. The board remains a scan-and-select surface.

### Named Rules

**The Two Columns Are a Ceiling Rule.** Remote boards use two columns at most and fall back to one when width or Dynamic Type makes two columns hostile; this does not constrain desktop lanes.

**The Response Belongs in Detail Rule.** Do not place a composer on session tiles or the board. One drill-in reveals pane context and the response action together.

## Elevation & Depth

C3 is tonally layered at rest and uses shadows selectively. Desktop cards primarily separate through adjacent graphite tones; urgent lanes add a colored halo, transient drag surfaces lift strongly, and modals receive a deep structural shadow over a blurred scrim. Remote web cards use a small shadow because visible separation matters on the compact board. Native iOS relies on system backgrounds, separators, and bars rather than reproducing web shadows.

### Shadow Vocabulary
- **Remote Card:** `0 2px 8px rgba(0, 0, 0, .22)` for compact board-card separation.
- **Urgent Lane:** `0 0 0 1px rgba(220, 38, 38, 0.2), 0 0 20px rgba(220, 38, 38, 0.1)` only when a desktop lane is urgent.
- **Modal Lift:** `0 20px 60px rgba(0, 0, 0, 0.5)` for desktop search, settings, and keyboard modal surfaces.

### Named Rules

**The Flat Until It Matters Rule.** Use tonal contrast and borders for ordinary hierarchy; reserve pronounced shadow for transient elevation or urgent attention.

## Shapes

The form language is compact and mostly restrained: remote board cards are nearly square (3px), desktop session cards use 6px corners, touch controls and fields use 8–9px, and modals use 12px. Pills are reserved for filters, counts, and status badges; circles are reserved for connection/state lights, native send action, and platform window controls. One-pixel borders carry more structural weight than ornament.

Native cards translate the near-square remote silhouette to a 4px rounded rectangle with a system separator. Native controls may use platform-standard shapes where this improves touch ergonomics or accessibility, while retaining the same visual hierarchy.

## Components

### Desktop Filter Chip
Compact pill filter with a secondary graphite background, subtle border, 6px × 12px padding, and 12px text. Hover raises the graphite tone; active state uses the tertiary graphite layer, blue border, and primary text.

### Desktop Session Card
A dense horizontal row with 8px × 12px padding and 6px corners. Hover changes the graphite tone; selection adds a 3px inset blue bar rather than lifting the card.

### Desktop Settings Select
A full-width 13px control with 10px × 12px padding, tertiary graphite fill, 1px structural border, and 6px corners. Focus changes the border to desktop activity blue.

### Remote Top Bar
A sticky graphite bar with a 58px minimum height plus top safe-area inset. It pairs the 31px cube mark and strong product name with a trailing connection label and 8px semantic status light; the connection region maintains a 44px touch height.

### Remote Search Field
A full-width 44px native-feeling search field sits between agent count and cards. It filters session title, project, agent kind, and pending-action text without changing attention ordering. Web uses a 7px graphite field with a leading search icon; iOS uses the system searchable navigation drawer.

### Remote Session Card
The signature attention tile: minimum 174px high, 15px × 15px × 13px padding, a visible 1px line, 3px corners, and a small structural shadow. Reading order is name, task context, strong state label, attention text, then agent kind. The 9px state light is redundant with a text label, never the only state cue.

### Remote Response Field
A detail-only multiline field with a 48px minimum height, 12px × 13px padding, visible line, 9px corners, and a global 2px blue focus outline offset by 3px. It grows only to 150px on web; native uses a one-to-five-line rounded text field.

### Remote Send Button
A 48px-high blue action with 9px corners and dark ink. Disabled state becomes muted graphite. Native adapts the action to a circular 44px control with a bold upward arrow and an explicit accessibility label.

### Remote Terminal Pane
A flexible black pane with 14px padding, a 1px graphite border, 4px corners, selectable monospaced text, preserved whitespace, and anywhere wrapping. Safe ANSI foreground/background colors, bold, dim, italic, and underline styling recreate terminal hierarchy without embedding a full terminal emulator. Capture revisions prevent unchanged panes from rebuilding. It remains a viewer, not a general shell.

## Do's and Don'ts

### Do:
- **Do** lead every session tile with identity and the attention-relevant state before quiet metadata.
- **Do** keep activity blue, attention amber, and permission/error red sparse and semantic.
- **Do** preserve visible focus, semantic labels, reduced-motion behavior, safe areas, and at least 44px touch targets on remote actions.
- **Do** let Dynamic Type move the native board to one column and remove restrictive line limits.
- **Do** adapt materials natively on iOS with system backgrounds, separators, bars, and semantic type roles.

### Don't:
- **Don't** promote the remote two-column board into a global desktop grid rule; desktop lanes remain an auto-filling workstation composition.
- **Don't** put response controls on the board or inside session tiles; keep them with terminal context in detail.
- **Don't** use state color as decoration or as the sole carrier of meaning.
- **Don't** copy fixed web typography or shadow values into SwiftUI when semantic native equivalents already express the hierarchy.
- **Don't** turn pane capture into a general shell or add feature-heavy terminal chrome.