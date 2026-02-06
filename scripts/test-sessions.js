#!/usr/bin/env node
/**
 * Test script to simulate Claude Code sessions connecting to C3
 * Run with: node scripts/test-sessions.js
 */

import WebSocket from 'ws';

const C3_URL = 'ws://localhost:7777';

const STATES = [
  'spawning',
  'processing',
  'awaiting_input',
  'awaiting_permission',
  'complete',
  'error',
];

const PROJECTS = [
  { name: 'api-server', tmux: 'dev:0.0' },
  { name: 'frontend', tmux: 'dev:1.0' },
  { name: 'ml-pipeline', tmux: 'ml:0.0' },
  { name: 'docs', tmux: 'docs:0.0' },
  { name: 'auth-service', tmux: 'dev:2.0' },
];

class SimulatedSession {
  constructor(project) {
    this.id = `sim-${project.name}-${Date.now()}`;
    this.project = project;
    this.state = 'spawning';
    this.ws = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(C3_URL);

      this.ws.on('open', () => {
        console.log(`[${this.project.name}] Connected to C3`);
        this.register();
        resolve();
      });

      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        console.log(`[${this.project.name}] Received:`, msg);
      });

      this.ws.on('error', (err) => {
        console.error(`[${this.project.name}] WebSocket error:`, err.message);
        reject(err);
      });

      this.ws.on('close', () => {
        console.log(`[${this.project.name}] Disconnected`);
      });
    });
  }

  register() {
    const session = {
      id: this.id,
      projectName: this.project.name,
      projectPath: `/Users/dev/projects/${this.project.name}`,
      state: this.state,
      tmuxTarget: this.project.tmux,
      lastActivity: new Date().toISOString(),
      pendingAction: null,
      metrics: {
        tokensUsed: Math.floor(Math.random() * 100000),
        taskCount: Math.floor(Math.random() * 20),
        startTime: new Date().toISOString(),
      },
    };

    this.send({ type: 'register', session });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  changeState(newState, pendingAction = null) {
    this.state = newState;
    console.log(`[${this.project.name}] State -> ${newState}`);
    this.send({
      type: 'state_change',
      sessionId: this.id,
      state: newState,
      pendingAction,
    });
  }

  disconnect() {
    this.send({ type: 'disconnect', sessionId: this.id });
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function runSimulation() {
  console.log('Starting C3 test simulation...\n');

  // Connect a few sessions
  const sessions = PROJECTS.slice(0, 3).map((p) => new SimulatedSession(p));

  for (const session of sessions) {
    try {
      await session.connect();
    } catch (err) {
      console.error('Failed to connect. Is C3 running?');
      process.exit(1);
    }
  }

  console.log('\nAll sessions connected. Running state changes...\n');

  // Session 1: Processing
  setTimeout(() => {
    sessions[0].changeState('processing');
  }, 1000);

  // Session 2: Awaiting input
  setTimeout(() => {
    sessions[1].changeState('awaiting_input', {
      type: 'input',
      description: 'Need clarification on API design',
    });
  }, 2000);

  // Session 3: Awaiting permission (bash)
  setTimeout(() => {
    sessions[2].changeState('awaiting_permission', {
      type: 'permission',
      description: 'Wants to run a command',
      tool: 'Bash',
      command: 'npm install express cors helmet',
    });
  }, 3000);

  // Session 1: Complete
  setTimeout(() => {
    sessions[0].changeState('complete');
  }, 6000);

  // Session 2: Processing
  setTimeout(() => {
    sessions[1].changeState('processing');
  }, 8000);

  // Session 2: Complete
  setTimeout(() => {
    sessions[1].changeState('complete');
  }, 12000);

  // Session 3: Processing (approved)
  setTimeout(() => {
    sessions[2].changeState('processing');
  }, 10000);

  // Session 3: Error
  setTimeout(() => {
    sessions[2].changeState('error');
  }, 15000);

  // Cleanup after 20 seconds
  setTimeout(() => {
    console.log('\nSimulation complete. Disconnecting...');
    sessions.forEach((s) => s.disconnect());
    setTimeout(() => process.exit(0), 1000);
  }, 20000);
}

runSimulation().catch(console.error);
