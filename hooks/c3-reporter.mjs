/**
 * C3 Reporter Hook for Claude Code
 *
 * Install this hook to report Claude Code session state to C3.
 *
 * Installation:
 * 1. Copy this file to ~/.claude/hooks/c3-reporter.mjs
 * 2. Make sure C3 is running on ws://localhost:7777
 *
 * Or add to your Claude Code settings:
 * {
 *   "hooks": {
 *     "PreToolUse": "~/.claude/hooks/c3-reporter.mjs",
 *     "PostToolUse": "~/.claude/hooks/c3-reporter.mjs"
 *   }
 * }
 */

import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { basename } from 'path';

const C3_URL = process.env.C3_URL || 'ws://localhost:7777';
const SESSION_ID = process.env.C3_SESSION_ID || randomUUID();
const PROJECT_NAME = process.env.C3_PROJECT_NAME || basename(process.cwd());
const TMUX_TARGET = process.env.C3_TMUX_TARGET || process.env.TMUX_PANE;

let ws = null;
let connected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

function connect() {
  return new Promise((resolve, reject) => {
    if (ws && connected) {
      resolve();
      return;
    }

    ws = new WebSocket(C3_URL);

    ws.on('open', () => {
      connected = true;
      reconnectAttempts = 0;

      // Register session
      send({
        type: 'register',
        session: {
          id: SESSION_ID,
          projectName: PROJECT_NAME,
          projectPath: process.cwd(),
          state: 'processing',
          tmuxTarget: TMUX_TARGET,
          lastActivity: new Date().toISOString(),
          pendingAction: null,
          metrics: null,
        },
      });

      resolve();
    });

    ws.on('error', (err) => {
      // Silently fail - C3 might not be running
      connected = false;
      resolve();
    });

    ws.on('close', () => {
      connected = false;
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        // Handle server messages (e.g., approve/deny)
        if (msg.type === 'action' && msg.sessionId === SESSION_ID) {
          // Could integrate with Claude Code's permission system
          console.log(`[C3] Received action: ${msg.action}`);
        }
      } catch (e) {
        // Ignore parse errors
      }
    });

    // Timeout after 1 second
    setTimeout(() => resolve(), 1000);
  });
}

function send(msg) {
  if (ws && connected) {
    ws.send(JSON.stringify(msg));
  }
}

function reportState(state, pendingAction = null) {
  send({
    type: 'state_change',
    sessionId: SESSION_ID,
    state,
    pendingAction,
  });
}

// Hook handler
export default async function handler(event) {
  await connect();

  if (!connected) {
    return; // C3 not available, continue normally
  }

  const { hook, tool, input } = event;

  if (hook === 'PreToolUse') {
    // About to use a tool - might need permission
    if (tool === 'Bash' || tool === 'Write' || tool === 'Edit') {
      reportState('awaiting_permission', {
        type: 'permission',
        description: `Wants to use ${tool}`,
        tool,
        command: tool === 'Bash' ? input?.command?.slice(0, 100) : null,
      });
    } else {
      reportState('processing');
    }
  } else if (hook === 'PostToolUse') {
    // Tool completed
    reportState('processing');
  } else if (hook === 'Stop') {
    // Session ending
    reportState('complete');
    send({ type: 'disconnect', sessionId: SESSION_ID });
  }
}

// Heartbeat every 30 seconds
setInterval(() => {
  if (connected) {
    send({ type: 'heartbeat', sessionId: SESSION_ID });
  }
}, 30000);

// Cleanup on exit
process.on('exit', () => {
  if (connected) {
    send({ type: 'disconnect', sessionId: SESSION_ID });
  }
});
