/**
 * Health Sentinel — incident files, inbox summaries, and TTL cleanup.
 *
 * - Writes structured markdown incident reports on escalation
 * - Writes categorised inbox summaries after every sentinel run
 * - Cleans up old incident files, inbox summaries, and history entries
 */

import fs from "node:fs";
import path from "node:path";
import type { TrendAnalysis } from "./health-sentinel-history.js";
import type {
  ClassifiedIssue,
  RemediationAttempt,
  SentinelReport,
} from "./health-sentinel-types.js";
import { createSubsystemLogger } from "./subsystem.js";

const log = createSubsystemLogger("health-sentinel/incidents");

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const INCIDENTS_DIR = "incidents";
const INBOX_DIR = "inbox";

// ═══════════════════════════════════════════════════════════════════════════
// Incident File Writer
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Write structured markdown incident files for each escalated issue.
 * One file per issue, named `YYYY-MM-DD-HH-mm-{sanitized-key}.md`.
 */
export function writeIncidentFiles(report: SentinelReport, stateDir: string): string[] {
  if (!report.escalatedToAgent || report.issues.length === 0) {
    return [];
  }

  const dir = path.join(stateDir, INCIDENTS_DIR);
  fs.mkdirSync(dir, { recursive: true });

  const ts = new Date(report.timestamp);
  const datePrefix = formatDatePrefix(ts);
  const written: string[] = [];

  // Only write incidents for issues that warranted escalation
  const escalatedIssues = report.issues.filter(
    (i) => i.classification === "needs-agent" || i.classification === "auto-fixable",
  );

  for (const issue of escalatedIssues) {
    const remediation = report.remediations.find((r) => r.issueKey === issue.key);
    const sanitizedKey = issue.key.replace(/[^a-zA-Z0-9._-]/g, "-");
    const filename = `${datePrefix}-${sanitizedKey}.md`;
    const filePath = path.join(dir, filename);

    const content = composeIncidentMarkdown(issue, remediation, report.timestamp);

    try {
      fs.writeFileSync(filePath, content, "utf8");
      written.push(filePath);
    } catch (err) {
      log.warn?.(`failed to write incident file: ${String(err)}`);
    }
  }

  if (written.length > 0) {
    log.info?.(`wrote ${written.length} incident file(s)`);
  }

  return written;
}

function composeIncidentMarkdown(
  issue: ClassifiedIssue,
  remediation: RemediationAttempt | undefined,
  timestamp: string,
): string {
  const lines: string[] = [];

  lines.push(`# Incident: ${issue.key}`);
  lines.push("");
  lines.push(`**Time:** ${timestamp}`);
  lines.push(`**Severity:** ${issue.classification}`);
  lines.push(`**Impact:** ${issue.summary}`);
  lines.push("");

  // Evidence
  lines.push("## Evidence");
  if ("kind" in issue.source && issue.source.kind === "channel") {
    lines.push(`- Channel: ${issue.source.channelId}`);
    lines.push(`- Account: ${issue.source.accountId}`);
    lines.push(`- Reason: ${issue.source.reason}`);
    if (issue.source.lastError) {
      lines.push(`- Last error: ${issue.source.lastError}`);
    }
  } else if ("name" in issue.source) {
    lines.push(`- Check: ${issue.source.name}`);
    lines.push(`- Status: ${issue.source.status}`);
    lines.push(`- Detail: ${issue.source.detail}`);
  }
  lines.push("");

  // Repair attempted
  lines.push("## Repair Attempted");
  if (remediation) {
    lines.push(`- Playbook: ${remediation.playbook}`);
    lines.push(`- Result: ${remediation.status}`);
    if (remediation.error) {
      lines.push(`- Error: ${remediation.error}`);
    }
    if (remediation.verified !== undefined) {
      lines.push(`- Verified: ${remediation.verified ? "yes" : "no"}`);
    }
    lines.push(`- Duration: ${remediation.durationMs}ms`);
  } else {
    lines.push("- No automated repair available for this issue type");
  }
  lines.push("");

  // Status + next action
  lines.push("## Current Status");
  lines.push("- **Unresolved** — escalated to agent for investigation");
  lines.push("");

  lines.push("## Suggested Next Action");
  lines.push(issue.suggestedAction ?? "Investigate and resolve manually.");
  lines.push("");

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// Inbox Summary Writer
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Write a categorised inbox summary after each sentinel run.
 */
export function writeInboxSummary(
  report: SentinelReport,
  trends: TrendAnalysis | null,
  stateDir: string,
): string | null {
  const dir = path.join(stateDir, INBOX_DIR);
  fs.mkdirSync(dir, { recursive: true });

  const ts = new Date(report.timestamp);
  const datePrefix = formatDatePrefix(ts);
  const filename = `${datePrefix}.md`;
  const filePath = path.join(dir, filename);

  const content = composeInboxMarkdown(report, trends);

  try {
    fs.writeFileSync(filePath, content, "utf8");
    return filePath;
  } catch (err) {
    log.warn?.(`failed to write inbox summary: ${String(err)}`);
    return null;
  }
}

function composeInboxMarkdown(report: SentinelReport, trends: TrendAnalysis | null): string {
  const lines: string[] = [];

  lines.push(`# Sentinel Inbox — ${report.timestamp}`);
  lines.push("");

  if (report.healthy) {
    lines.push("## ✅ Healthy");
    lines.push("All checks passed.");
    lines.push("");
  }

  // Repaired
  const repaired = report.remediations.filter((r) => r.status === "success" && r.verified === true);
  if (repaired.length > 0) {
    lines.push("## 🔧 Repaired");
    for (const r of repaired) {
      lines.push(`- \`${r.issueKey}\` — ${r.playbook} playbook (verified, ${r.durationMs}ms)`);
    }
    lines.push("");
  }

  // Incidents (escalated)
  const incidents = report.issues.filter((i) => i.classification === "needs-agent");
  if (incidents.length > 0) {
    lines.push("## 🚨 Incidents");
    for (const i of incidents) {
      lines.push(`- \`${i.key}\` — ${i.summary}`);
    }
    lines.push("");
  }

  // Warnings
  const warnings = report.issues.filter((i) => i.classification === "warning");
  if (warnings.length > 0) {
    lines.push("## ⚠️ Warnings");
    for (const w of warnings) {
      lines.push(`- \`${w.key}\` — ${w.summary}`);
    }
    lines.push("");
  }

  // Trends
  if (
    trends &&
    (trends.persistent.length > 0 || trends.flapping.length > 0 || trends.improving.length > 0)
  ) {
    lines.push("## 📊 Trends");
    if (trends.persistent.length > 0) {
      lines.push(`- Persistent: ${trends.persistent.join(", ")}`);
    }
    if (trends.flapping.length > 0) {
      lines.push(`- Flapping: ${trends.flapping.join(", ")}`);
    }
    if (trends.improving.length > 0) {
      lines.push(`- Improving: ${trends.improving.join(", ")}`);
    }
    lines.push("");
  }

  // Blockers
  const blockers = report.issues.filter(
    (i) =>
      i.classification === "needs-agent" &&
      report.remediations.some((r) => r.issueKey === i.key && r.status === "failed"),
  );
  if (blockers.length > 0) {
    lines.push("## ⛔ Blockers (failed auto-repair)");
    for (const b of blockers) {
      const failedRemediation = report.remediations.find(
        (r) => r.issueKey === b.key && r.status === "failed",
      );
      lines.push(
        `- \`${b.key}\` — ${failedRemediation?.playbook ?? "unknown"} failed: ${failedRemediation?.error ?? "unknown error"}`,
      );
    }
    lines.push("");
  }

  // Rate limiting
  if (report.suppressedByRateLimit > 0) {
    lines.push(`## 🕐 Rate Limited`);
    lines.push(`${report.suppressedByRateLimit} remediation(s) suppressed by rate limiting.`);
    lines.push("");
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// TTL Cleanup
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Delete files in `dir` older than `maxAgeDays`.
 * Returns paths of deleted files.
 */
export function cleanupOldFiles(dir: string, maxAgeDays: number): string[] {
  const deleted: string[] = [];
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60_000;

  try {
    if (!fs.existsSync(dir)) {
      return deleted;
    }
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const filePath = path.join(dir, entry);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          deleted.push(filePath);
        }
      } catch {
        // skip — best effort
      }
    }
  } catch (err) {
    log.warn?.(`cleanup failed for ${dir}: ${String(err)}`);
  }

  if (deleted.length > 0) {
    log.info?.(`cleaned up ${deleted.length} old file(s) from ${path.basename(dir)}`);
  }

  return deleted;
}

/**
 * Prune sentinel history entries older than `maxAgeDays`.
 * Rewrites the JSONL file in place.
 */
export function cleanupOldHistory(stateDir: string, maxAgeDays: number): number {
  const filePath = path.join(stateDir, "sentinel-history.jsonl");
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60_000;

  try {
    if (!fs.existsSync(filePath)) {
      return 0;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    let pruned = 0;

    const kept: string[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const entryTime = new Date(entry.timestamp).getTime();
        if (entryTime >= cutoff) {
          kept.push(line);
        } else {
          pruned++;
        }
      } catch {
        // malformed line — drop it
        pruned++;
      }
    }

    if (pruned > 0) {
      fs.writeFileSync(filePath, kept.join("\n") + (kept.length > 0 ? "\n" : ""), "utf8");
      log.info?.(`pruned ${pruned} old history entries`);
    }

    return pruned;
  } catch (err) {
    log.warn?.(`history cleanup failed: ${String(err)}`);
    return 0;
  }
}

/**
 * Run all TTL cleanup tasks:
 * - Delete old incident files
 * - Delete old inbox summaries
 * - Prune old history entries
 */
export function runCleanup(
  stateDir: string,
  incidentRetentionDays: number = 7,
  historyRetentionDays: number = 14,
): void {
  cleanupOldFiles(path.join(stateDir, INCIDENTS_DIR), incidentRetentionDays);
  cleanupOldFiles(path.join(stateDir, INBOX_DIR), incidentRetentionDays);
  cleanupOldHistory(stateDir, historyRetentionDays);
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatDatePrefix(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d}-${h}-${mi}`;
}
