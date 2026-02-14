import type { CronJob } from "./types.js";
import { logWarn } from "../logger.js";

export type RunTriggerResult = {
  status: "ok" | "skipped" | "error";
  summary?: string;
  output?: string;
  error?: string;
};

export async function runTriggerScript(
  job: CronJob,
  workspaceDir: string,
): Promise<RunTriggerResult> {
  const triggerScript =
    job.payload.kind === "agentTurn"
      ? ((job.payload as Record<string, unknown>).triggerScript as string | undefined)
      : undefined;

  if (!triggerScript?.trim()) {
    return { status: "ok" };
  }

  try {
    // Run the trigger script with a short timeout (e.g. 1 minute)
    // It acts as a gate:
    // - Exit code 0 + Output -> Run agent (with output as context)
    // - Exit code 0 + No Output -> Skip agent (nothing to do)
    // - Exit code != 0 -> Skip agent (check failed or negative result)
    const result = await import("../process/exec.js").then((m) =>
      m.runCommandWithTimeout([triggerScript], {
        timeoutMs: 60 * 1000,
        cwd: workspaceDir,
        env: { ...process.env, CRON_JOB_ID: job.id },
      }),
    );

    if (result.code !== 0) {
      return {
        status: "skipped",
        summary: `Trigger script exited with code ${result.code}`,
      };
    }

    const stdout = result.stdout.trim();
    if (!stdout) {
      return {
        status: "skipped",
        summary: "Trigger script returned no output",
      };
    }
    return { status: "ok", output: stdout };
  } catch (err) {
    logWarn(`[cron:${job.id}] Trigger script failed: ${String(err)}`);
    return {
      status: "error",
      error: `Trigger script failed: ${String(err)}`,
    };
  }
}
