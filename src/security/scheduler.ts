import { Cron } from "croner";
import type { CliDeps } from "../cli/deps.js";
import type { OpenClawConfig } from "../config/config.js";
import { formatCliCommand } from "../cli/command-format.js";
import { requestHeartbeatNow } from "../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import { getChildLogger } from "../logging.js";
import { runSecurityAudit, type SecurityAuditReport } from "./audit.js";

const log = getChildLogger({ module: "security-scheduler" });

function formatSecurityReport(report: SecurityAuditReport): string {
  const date = new Date(report.ts).toLocaleDateString();
  const summary = report.summary;

  // Basic status summary for the table logic
  // We can't easily reproduce the exact table from the gist without re-running specific checks mapping
  // to those table rows, but we can summarize the findings we have.
  // Instead of the specific table, we will list the findings directly.

  let text = `🔒 **SECURITY REPORT - ${date}**\n\n`;
  text += `Summary: ${summary.critical} Critical, ${summary.warn} Warning\n\n`;

  if (report.findings.length > 0) {
    text += `**Issues Found:**\n`;
    for (const f of report.findings) {
      const icon = f.severity === "critical" ? "🔴" : f.severity === "warn" ? "🟡" : "ℹ️";
      text += `${icon} **${f.title}**\n${f.detail}\n`;
      if (f.remediation) {
        text += `_Fix: ${f.remediation}_\n`;
      }
      text += "\n";
    }
    text += `\n🚨 **ACTION REQUIRED** - Check logs or run \`${formatCliCommand("openclaw security audit")}\` for more details.`;
  } else {
    text += "✅ All clear! Your deployment is properly secured.";
  }

  return text;
}

export function startSecurityAuditScheduler(params: { cfg: OpenClawConfig; deps: CliDeps }) {
  const schedule = "0 9 * * *"; // 9am daily

  log.info({ schedule }, "starting daily security audit scheduler");

  new Cron(schedule, async () => {
    log.info("running daily security audit");

    try {
      const report = await runSecurityAudit({
        config: params.cfg,
        includeFilesystem: true,
        includeChannelSecurity: true,
        // We don't do deep probe in the daily cron to avoid network noise/timeouts,
        // unless user explicitly configures it (maybe future).
        deep: false,
      });

      const hasIssues = report.summary.critical > 0 || report.summary.warn > 0;

      if (!hasIssues) {
        log.info("daily security audit passed (clean)");
        return;
      }

      log.warn(
        { critical: report.summary.critical, warn: report.summary.warn },
        "daily security audit found issues",
      );

      const eventText = formatSecurityReport(report);

      // Broadcast to system events (will be picked up by the next agent run or user interaction)
      // We use a specific session key "security-audit" or just put it in the main queue if we knew it.
      // Since system events require a sessionKey, and we want to notify the *owner*,
      // effectively we want to broadcast this to the main user.
      // The previous system-events usage in `server-cron.ts` uses `resolveAgentMainSessionKey`.
      // We really want to reach the default agent's main session.

      // We'll borrow the logic to resolve the main session key from config if possible,
      // or fall back to a known default if we can't find one.
      // For now, we'll try to guess the most likely session key or just log if we can't deliver.

      // Actually, we can use `resolveAgentMainSessionKey` if we import it, similar to `server-cron.ts`.
      // But `server-cron` has `resolveCronAgent` helper.
      // Let's assume for this specific feature we want to target the default agent.

      // For simplicity and robustness given we are in `security/`, we might not have all agent routings.
      // However, we can improve this by taking a `notify` callback or similar.
      // But `enqueueSystemEvent` is global-ish so we just need the key.
      // Let's try to grab the default agent id from config or just use "default".

      // Wait, `server-cron` does:
      // const { agentId, cfg } = resolveCronAgent(job.agentId);
      // const sessionKey = resolveAgentMainSessionKey({ cfg, agentId });

      // We will do a best effort to find a key.
      // Since `resolveAgentMainSessionKey` and `resolveDefaultAgentId` are available:
      const { resolveDefaultAgentId } = await import("../agents/agent-scope.js");
      const { resolveAgentMainSessionKey } = await import("../config/sessions.js");

      const agentId = resolveDefaultAgentId(params.cfg);
      const sessionKey = resolveAgentMainSessionKey({ cfg: params.cfg, agentId });

      enqueueSystemEvent(eventText, { sessionKey, contextKey: "security-audit" });

      // Wake up the system so the message is delivered promptly (if an agent is listening)
      requestHeartbeatNow({
        reason: "security-audit-alert",
      });
    } catch (err) {
      log.error({ err }, "daily security audit failed to run");
    }
  });
}
