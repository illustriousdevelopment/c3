#!/usr/bin/env node
/**
 * Persistent test: keeps sessions alive so you can observe C3
 * Run with: node scripts/test-persistent.js
 * Ctrl+C to stop
 */

import WebSocket from 'ws';

const C3_URL = 'ws://localhost:7777';

const PROJECTS = [
  { name: 'api-server', tmux: 'dev:0.0' },
  { name: 'frontend', tmux: 'dev:1.0' },
  { name: 'ml-pipeline', tmux: 'ml:0.0' },
  { name: 'docs', tmux: 'docs:0.0' },
  { name: 'auth-service', tmux: 'dev:2.0' },
];

const STATES = ['processing', 'awaiting_input', 'awaiting_permission', 'complete', 'error'];

function connect(project, initialState) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(C3_URL);
    const id = `test-${project.name}-${Date.now()}`;

    ws.on('open', () => {
      console.log(`[${project.name}] Connected`);

      const session = {
        id,
        projectName: project.name,
        projectPath: `/Users/dev/projects/${project.name}`,
        state: initialState,
        tmuxTarget: project.tmux,
        lastActivity: new Date().toISOString(),
        pendingAction: initialState === 'awaiting_permission' ? {
          type: 'permission',
          description: 'Wants to run a command',
          tool: 'Bash',
          command: 'npm install express cors helmet',
        } : initialState === 'awaiting_input' ? {
          type: 'input',
          description: 'Need clarification on API design',
        } : null,
        metrics: {
          tokensUsed: Math.floor(Math.random() * 100000),
          taskCount: Math.floor(Math.random() * 20),
          startTime: new Date().toISOString(),
        },
      };

      ws.send(JSON.stringify({ type: 'register', session }));
      resolve({ ws, id, project });
    });

    ws.on('message', (data) => {
      console.log(`[${project.name}] Received:`, JSON.parse(data.toString()));
    });

    ws.on('error', (err) => {
      console.error(`[${project.name}] Error:`, err.message);
      reject(err);
    });
  });
}

async function main() {
  console.log('Connecting 5 persistent test sessions to C3...\n');

  const initialStates = ['processing', 'awaiting_input', 'awaiting_permission', 'complete', 'processing'];

  const sessions = [];
  for (let i = 0; i < PROJECTS.length; i++) {
    try {
      const s = await connect(PROJECTS[i], initialStates[i]);
      sessions.push(s);
    } catch (err) {
      console.error('Failed to connect. Is C3 running?');
      process.exit(1);
    }
  }

  console.log(`\n${sessions.length} sessions connected. They will cycle through states.`);
  console.log('Press Ctrl+C to stop.\n');

  // Periodically cycle states
  let tick = 0;
  const interval = setInterval(() => {
    tick++;
    const idx = tick % sessions.length;
    const newState = STATES[tick % STATES.length];
    const { ws, id, project } = sessions[idx];

    const pendingAction = newState === 'awaiting_permission' ? {
      type: 'permission',
      description: 'Wants to run a command',
      tool: 'Bash',
      command: 'npm run build && npm test',
    } : newState === 'awaiting_input' ? {
      type: 'input',
      description: 'How should I structure the database schema?',
    } : null;

    console.log(`[${project.name}] -> ${newState}`);
    ws.send(JSON.stringify({
      type: 'state_change',
      sessionId: id,
      state: newState,
      pendingAction,
    }));
  }, 5000);

  process.on('SIGINT', () => {
    console.log('\nDisconnecting...');
    clearInterval(interval);
    sessions.forEach(({ ws, id }) => {
      ws.send(JSON.stringify({ type: 'disconnect', sessionId: id }));
      ws.close();
    });
    setTimeout(() => process.exit(0), 500);
  });
}

main().catch(console.error);
