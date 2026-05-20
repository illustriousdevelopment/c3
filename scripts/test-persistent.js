#!/usr/bin/env node
/**
 * Persistent hook simulation for observing C3 state changes.
 * Run with: node scripts/test-persistent.js
 * Ctrl+C to stop.
 */

const C3_HOOK_URL = process.env.C3_HOOK_URL || 'http://127.0.0.1:9398/hook';

const PROJECTS = [
  { name: 'api-server', cwd: '/Users/dev/projects/api-server', tmux: ['dev', '0', '0'], agent: 'codex' },
  { name: 'frontend', cwd: '/Users/dev/projects/frontend', tmux: ['dev', '1', '0'], agent: 'claude' },
  { name: 'ml-pipeline', cwd: '/Users/dev/projects/ml-pipeline', tmux: ['ml', '0', '0'], agent: 'codex' },
  { name: 'docs', cwd: '/Users/dev/projects/docs', tmux: ['docs', '0', '0'], agent: 'claude' },
];

const HOOKS = ['SessionStart', 'Notification', 'PermissionRequest', 'Stop'];

async function sendHook(project, hookType) {
  const [session, window, pane] = project.tmux;
  const payload = {
    hook_type: hookType,
    agent_kind: project.agent,
    cwd: project.cwd,
    session_id: `persistent-${project.name}`,
    tmux: {
      session,
      window,
      pane,
      window_name: project.name,
    },
  };

  if (hookType === 'PermissionRequest') {
    payload.tool_name = 'Bash';
    payload.tool_input = { command: 'npm run build && npm test' };
  }

  const response = await fetch(C3_HOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  console.log(`[${project.name}] ${hookType} -> ${response.status} ${await response.text()}`);
}

async function main() {
  console.log(`Cycling simulated hooks against ${C3_HOOK_URL}`);
  console.log('Press Ctrl+C to stop.\n');

  let tick = 0;
  const interval = setInterval(() => {
    const project = PROJECTS[tick % PROJECTS.length];
    const hookType = HOOKS[tick % HOOKS.length];
    tick += 1;
    sendHook(project, hookType).catch(console.error);
  }, 3000);

  process.on('SIGINT', () => {
    clearInterval(interval);
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
