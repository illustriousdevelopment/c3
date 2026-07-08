import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

/**
 * C3 notification hook for OMP (Oh My Pi).
 *
 * This hook notifies the C3 app (Carmelo Command Center) whenever an OMP
 * session needs attention, so it can be tracked alongside Claude Code and Codex
 * sessions.
 *
 * Install:
 *   mkdir -p ~/.omp/agent/hooks/post
 *   cp c3-omp-hook.ts ~/.omp/agent/hooks/post/c3-notify.ts
 *   # restart OMP sessions
 *
 * The companion c3-hook.sh must also be installed:
 *   cp c3-hook.sh ~/.local/bin/c3-hook.sh
 *   chmod +x ~/.local/bin/c3-hook.sh
 */

const C3_HOOK = "$HOME/.local/bin/c3-hook.sh";

export default function c3NotifyHook(pi: HookAPI): void {
  async function notify(hookType: string, cwd: string): Promise<void> {
    try {
      await pi.exec(
        "bash",
        ["-c", `C3_AGENT_KIND=omp ${C3_HOOK} ${hookType}`],
        { cwd },
      );
    } catch {
      // C3 may not be running; hooks must never block the agent.
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    await notify("SessionStart", ctx.cwd);
  });

  pi.on("turn_end", async (_event, ctx) => {
    // OMP has finished a turn and is waiting for the user to respond.
    await notify("Notification", ctx.cwd);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    await notify("Stop", ctx.cwd);
  });
}
