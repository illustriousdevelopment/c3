/**
 * Legacy JS hook reporter for C3.
 *
 * The shell hook (`c3-hook.sh`) is the supported installer path. This module is
 * kept for users who already run JavaScript hooks directly.
 */

const C3_HOOK_URL = process.env.C3_HOOK_URL || 'http://127.0.0.1:9398/hook';
const AGENT_KIND = process.env.C3_AGENT_KIND || 'claude';

function hookTypeFromEvent(event) {
  return event?.hook || event?.hook_type || 'unknown';
}

function tmuxContextFromEnv() {
  const target = process.env.C3_TMUX_TARGET;
  if (!target) return null;

  const [session, windowPane = ''] = target.split(':');
  const [window, pane = '0'] = windowPane.split('.');
  if (!session || !window) return null;

  return {
    session,
    window,
    pane,
    window_name: process.env.C3_PROJECT_NAME || '',
  };
}

export default async function handler(event = {}) {
  const hookType = hookTypeFromEvent(event);
  const toolName = event.tool_name || event.tool;
  const toolInput = event.tool_input || event.input || null;

  const payload = {
    hook_type: hookType,
    agent_kind: AGENT_KIND,
    cwd: process.cwd(),
    session_id: event.session_id || process.env.C3_SESSION_ID || null,
    tool_name: toolName || null,
    tool_input: toolInput,
    skip_permissions: false,
    tmux: tmuxContextFromEnv(),
  };

  try {
    await fetch(C3_HOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(1000),
    });
  } catch {
    // C3 may not be running; hooks should never block the agent.
  }
}
