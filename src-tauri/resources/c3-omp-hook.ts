import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

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

export default function c3NotifyHook(pi: ExtensionAPI): void {
  async function notify(hookType: string, cwd: string): Promise<void> {
    try {
      await pi.exec(
        "bash",
        ["-c", `C3_AGENT_KIND=omp C3_OMP_HOOK_VERSION=2 ${C3_HOOK} ${hookType}`],
        { cwd },
      );
    } catch {
      // C3 may not be running; hooks must never block the agent.
    }
  }


  pi.on("session_stop", async (_event, ctx) => {
    // session_stop is emitted once when the interactive main session settles;
    // OMP intentionally excludes task/subagent sessions from this event.
    if (!ctx.hasUI) return;
    await notify("Notification", ctx.cwd);
  });

}
