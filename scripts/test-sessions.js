#!/usr/bin/env node
/**
 * Test script to simulate agent hook events against C3.
 * Run with: node scripts/test-sessions.js
 */

const C3_HOOK_URL = process.env.C3_HOOK_URL || 'http://127.0.0.1:9398/hook';

const PROJECTS = [
  { name: 'api-server', cwd: '/Users/dev/projects/api-server', tmux: ['dev', '0', '0'], agent: 'codex' },
  { name: 'frontend', cwd: '/Users/dev/projects/frontend', tmux: ['dev', '1', '0'], agent: 'claude' },
  { name: 'ml-pipeline', cwd: '/Users/dev/projects/ml-pipeline', tmux: ['ml', '0', '0'], agent: 'codex' },
];

async function sendHook(project, hookType, extra = {}) {
  const [session, window, pane] = project.tmux;
  const payload = {
    hook_type: hookType,
    agent_kind: project.agent,
    cwd: project.cwd,
    session_id: `sim-${project.name}`,
    tmux: {
      session,
      window,
      pane,
      window_name: project.name,
    },
    ...extra,
  };

  const response = await fetch(C3_HOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  console.log(`[${project.name}] ${hookType} -> ${response.status} ${await response.text()}`);
}

async function main() {
  console.log(`Sending simulated hooks to ${C3_HOOK_URL}\n`);

  await sendHook(PROJECTS[0], 'SessionStart');
  await sendHook(PROJECTS[1], 'Notification');
  await sendHook(PROJECTS[2], 'PermissionRequest', {
    tool_name: 'Bash',
    tool_input: { command: 'npm run build && npm test' },
  });

  setTimeout(() => sendHook(PROJECTS[0], 'Stop').catch(console.error), 3000);
  setTimeout(() => sendHook(PROJECTS[1], 'SessionStart').catch(console.error), 5000);
  setTimeout(() => sendHook(PROJECTS[2], 'Stop').catch(console.error), 7000);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
