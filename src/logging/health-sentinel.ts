/**
 * Health Sentinel — self-healing health check orchestrator.
 *
 * Two-tier architecture:
 * - Tier 1 (deterministic): probes channels + system health, auto-fixes
 *   known issues (channel restarts, log rotation) using playbooks.
 * - Tier 2 (agent-driven): composes a structured report for unresolved
 *   issues and delivers it as a system event to the agent's heartbeat
 *   session, so the agent can reason about and fix the problem.
 *
 * Runs every ~30 minutes via the diagnostic heartbeat in diagnostic.ts.
 *
 * Features:
 * - Configurable thresholds via `SentinelConfig`
 * - Persistent rate-limit state (survives gateway restarts)
 * - Health history with trend detection (enriches escalation messages)
 * - Doctor-derived probes (ephemeral path, state dir existence)
 * - Weekly drift checks (backup freshness, file permissions)
 * - Incident files on escalation + categorised inbox summaries
 * - TTL-based cleanup of old incidents, inbox, and history
 * - Dashboard surface (`getLastSentinelReport()`)
 */

import type { HealthSummary, ChannelHealthSummary } from "../commands/health.js";
import type { CheckResult, HealthCheckReport } from "./diagnostics-toolkit.js";
import {
  appendSentinelReport,
  detectTrends,
  formatTrendContext,
  getRecentReports,
  type TrendAnalysis,
} from "./health-sentinel-history.js";
import { writeIncidentFiles, writeInboxSummary, runCleanup } from "./health-sentinel-incidents.js";
import { buildPlaybooks, findPlaybook } from "./health-sentinel-playbooks.js";
import type {
  ClassifiedIssue,
  ChannelIssueSource,
  RateLimitState,
  RemediationAttempt,
  SentinelConfig,
  SentinelDeps,
  SentinelReport,
} from "./health-sentinel-types.js";
import { createSubsystemLogger } from "./subsystem.js";

const log = createSubsystemLogger("health-sentinel");

// ═══════════════════════════════════════════════════════════════════════════
// Default configuration constants
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULTS: Required<SentinelConfig> = {
  maxRemediationsPerHour: 5,
  issueCooldownMs: 15 * 60_000, // 15 minutes
  escalationCooldownMs: 30 * 60_000, // 30 minutes
  maxEscalationsPerHour: 3,
  maxConsecutiveFailures: 3,
  diskWarnThresholdMB: 500,
  errorRateThreshold: 50,
  incidentRetentionDays: 7,
  historyRetentionDays: 14,
};

const ONE_HOUR_MS = 60 * 60_000;
const ONE_WEEK_MS = 7 * 24 * ONE_HOUR_MS;

// ═══════════════════════════════════════════════════════════════════════════
// Resolve config (merge user overrides with defaults)
// ═══════════════════════════════════════════════════════════════════════════

function resolveConfig(config?: SentinelConfig): Required<SentinelConfig> {
  if (!config) {
    return DEFAULTS;
  }
  return {
    ...DEFAULTS,
    ...Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)),
  } as Required<SentinelConfig>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Module-level rate-limit state (survives across sentinel runs)
// ═══════════════════════════════════════════════════════════════════════════

const rateLimitState: RateLimitState = {
  issueLastAttemptAt: new Map(),
  issueConsecutiveFailures: new Map(),
  remediationsThisHour: [],
  lastEscalationAt: 0,
  escalationsThisHour: [],
};

/** Whether persistent state has been loaded from disk on this process. */
let persistentStateLoaded = false;

/** Timestamp of last weekly probe run (to gate once per week). */
let lastWeeklyProbeRunMs = 0;

/** @internal Exported for tests only. */
export function resetRateLimitStateForTest(): void {
  rateLimitState.issueLastAttemptAt.clear();
  rateLimitState.issueConsecutiveFailures.clear();
  rateLimitState.remediationsThisHour = [];
  rateLimitState.lastEscalationAt = 0;
  rateLimitState.escalationsThisHour = [];
  persistentStateLoaded = false;
  lastWeeklyProbeRunMs = 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// Persistent rate-limit state (survives gateway restarts)
// ═══════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";

const RATE_LIMIT_FILE = "sentinel-rate-limit.json";

interface SerializedRateLimitState {
  issueLastAttemptAt: Record<string, number>;
  issueConsecutiveFailures: Record<string, number>;
  remediationsThisHour: number[];
  lastEscalationAt: number;
  escalationsThisHour: number[];
}

function loadPersistentState(stateDir: string): void {
  if (persistentStateLoaded) {
    return;
  }
  persistentStateLoaded = true;

  const filePath = path.join(stateDir, RATE_LIMIT_FILE);
  try {
    if (!fs.existsSync(filePath)) {
      return;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const saved = JSON.parse(raw) as SerializedRateLimitState;

    // Hydrate Maps
    if (saved.issueLastAttemptAt && typeof saved.issueLastAttemptAt === "object") {
      for (const [k, v] of Object.entries(saved.issueLastAttemptAt)) {
        if (typeof v === "number") {
          rateLimitState.issueLastAttemptAt.set(k, v);
        }
      }
    }
    if (saved.issueConsecutiveFailures && typeof saved.issueConsecutiveFailures === "object") {
      for (const [k, v] of Object.entries(saved.issueConsecutiveFailures)) {
        if (typeof v === "number") {
          rateLimitState.issueConsecutiveFailures.set(k, v);
        }
      }
    }
    if (Array.isArray(saved.remediationsThisHour)) {
      rateLimitState.remediationsThisHour = saved.remediationsThisHour.filter(
        (t) => typeof t === "number",
      );
    }
    if (typeof saved.lastEscalationAt === "number") {
      rateLimitState.lastEscalationAt = saved.lastEscalationAt;
    }
    if (Array.isArray(saved.escalationsThisHour)) {
      rateLimitState.escalationsThisHour = saved.escalationsThisHour.filter(
        (t) => typeof t === "number",
      );
    }
    log.info?.("loaded persistent rate-limit state from disk");
  } catch (err) {
    log.warn?.(`failed to load persistent rate-limit state: ${String(err)}`);
  }
}

function savePersistentState(stateDir: string): void {
  const filePath = path.join(stateDir, RATE_LIMIT_FILE);
  try {
    const serialized: SerializedRateLimitState = {
      issueLastAttemptAt: Object.fromEntries(rateLimitState.issueLastAttemptAt),
      issueConsecutiveFailures: Object.fromEntries(rateLimitState.issueConsecutiveFailures),
      remediationsThisHour: rateLimitState.remediationsThisHour,
      lastEscalationAt: rateLimitState.lastEscalationAt,
      escalationsThisHour: rateLimitState.escalationsThisHour,
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(serialized), "utf8");
  } catch (err) {
    log.warn?.(`failed to save persistent rate-limit state: ${String(err)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard Surface
// ═══════════════════════════════════════════════════════════════════════════

let lastReport: SentinelReport | null = null;

/** Get the most recent sentinel report. */
export function getLastSentinelReport(): SentinelReport | null {
  return lastReport;
}

// ═══════════════════════════════════════════════════════════════════════════
// Classification
// ═══════════════════════════════════════════════════════════════════════════

function classifySystemCheck(check: CheckResult): ClassifiedIssue | null {
  if (check.status === "pass" || check.status === "skip") {
    return null;
  }

  const key = `system:${check.name}`;

  if (check.name === "gateway.port") {
    return {
      key,
      classification: "needs-agent",
      summary: `Gateway port unreachable: ${check.detail}`,
      suggestedAction: "Check if the gateway process is running. Try restarting the gateway.",
      source: check,
    };
  }

  if (check.name === "logs.error_rate") {
    if (check.status === "fail") {
      return {
        key,
        classification: "needs-agent",
        summary: `High error rate: ${check.detail}`,
        suggestedAction: "Review recent error logs and identify the root cause.",
        source: check,
      };
    }
    // Warning — approaching threshold
    return {
      key,
      classification: "warning",
      summary: `Error rate increasing: ${check.detail}`,
      source: check,
    };
  }

  if (check.name === "disk.log_directory") {
    if (check.status === "fail") {
      return {
        key,
        classification: "needs-agent",
        summary: `Disk space critical: ${check.detail}`,
        suggestedAction: "Disk space is critically low. Manual intervention may be needed.",
        source: check,
      };
    }
    // Warn → auto-fixable (disk cleanup playbook can handle it)
    return {
      key,
      classification: "auto-fixable",
      summary: `Disk space issue: ${check.detail}`,
      suggestedAction: "Consider rotating or cleaning up old log files.",
      source: check,
    };
  }

  if (check.name === "process.pid_file") {
    return {
      key,
      classification: "needs-agent",
      summary: `Process issue: ${check.detail}`,
      suggestedAction: "Check if the main process is running. May need a restart.",
      source: check,
    };
  }

  // Sidecar services (SearXNG, Scrapling) — warnings by default since agents
  // have fallback providers. Only escalate after consecutive failures.
  if (check.name === "sidecar.searxng" || check.name === "sidecar.scrapling") {
    const serviceName = check.name === "sidecar.searxng" ? "SearXNG" : "Scrapling";
    const consecutiveFailures = rateLimitState.issueConsecutiveFailures.get(key) ?? 0;
    if (consecutiveFailures >= 3) {
      return {
        key,
        classification: "needs-agent",
        summary: `${serviceName} sidecar persistently unreachable (${consecutiveFailures + 1} consecutive failures): ${check.detail}`,
        suggestedAction: `Notify the operator: the ${serviceName} Docker container may need restarting. Suggest running \`docker compose restart ${check.name.replace("sidecar.", "")}\` on the host.`,
        source: check,
      };
    }
    return {
      key,
      classification: "warning",
      summary: `${serviceName} sidecar unhealthy: ${check.detail}`,
      source: check,
    };
  }

  // Sandbox browser containers — auto-fixable (can be restarted), but
  // escalate to agent after consecutive failures.
  if (check.name.startsWith("sandbox.browser.")) {
    const containerName = check.name.slice("sandbox.browser.".length);
    const consecutiveFailures = rateLimitState.issueConsecutiveFailures.get(key) ?? 0;
    if (consecutiveFailures >= 3) {
      return {
        key,
        classification: "needs-agent",
        summary: `Browser container ${containerName} persistently unhealthy (${consecutiveFailures + 1} consecutive failures): ${check.detail}`,
        suggestedAction: `The browser container "${containerName}" has failed multiple restart attempts. Check if Docker daemon is healthy, the browser image exists, or the container needs to be recreated. Try \`docker rm -f ${containerName}\` and let the gateway recreate it.`,
        source: check,
      };
    }
    return {
      key,
      classification: "auto-fixable",
      summary: `Browser container ${containerName} unhealthy: ${check.detail}`,
      suggestedAction: `Restart the browser container: docker restart ${containerName}`,
      source: check,
    };
  }

  // Cron scheduler health probes
  if (check.name === "cron.scheduler_liveness") {
    return {
      key,
      classification: "needs-agent",
      summary: `Cron scheduler issue: ${check.detail}`,
      suggestedAction:
        "The cron scheduler may be dead. Check if the gateway process is running and cron is enabled. Try restarting the gateway.",
      source: check,
    };
  }

  if (check.name === "cron.consecutive_errors") {
    return {
      key,
      classification: check.status === "fail" ? "needs-agent" : "warning",
      summary: check.detail,
      suggestedAction:
        "Review the failing cron jobs. Check their delivery targets, payload configuration, and recent error logs.",
      source: check,
    };
  }

  if (check.name === "cron.auto_disabled") {
    return {
      key,
      classification: "needs-agent",
      summary: check.detail,
      suggestedAction:
        "Re-enable the auto-disabled cron jobs after fixing the underlying issue (schedule errors or repeated failures).",
      source: check,
    };
  }

  if (check.name === "cron.stale_delivery") {
    return {
      key,
      classification: "warning",
      summary: check.detail,
      suggestedAction:
        "Set explicit delivery.channel and delivery.to on these jobs to prevent messages going to the wrong channel.",
      source: check,
    };
  }

  // Disk hygiene checks
  if (check.name === "disk.session_bloat" || check.name === "disk.hygiene") {
    return {
      key,
      classification: "auto-fixable",
      summary: check.detail,
      suggestedAction:
        "Run disk cleanup to remove old session files, browser cache, and truncate gateway logs.",
      source: check,
    };
  }

  // Unknown check type — classify based on actual status
  return {
    key,
    classification: check.status === "warn" ? "warning" : "needs-agent",
    summary: `Health check ${check.status === "warn" ? "warning" : "failed"}: ${check.name} — ${check.detail}`,
    source: check,
  };
}

function classifyChannelIssue(
  channelId: string,
  summary: ChannelHealthSummary,
  maxConsecutiveFailures: number,
): ClassifiedIssue[] {
  const issues: ClassifiedIssue[] = [];
  const accounts = summary.accounts ?? {};

  for (const [accountId, accountSummary] of Object.entries(accounts)) {
    if (!accountSummary) {
      continue;
    }

    const probe =
      accountSummary.probe && typeof accountSummary.probe === "object"
        ? (accountSummary.probe as { ok?: boolean; error?: string })
        : null;

    // If probe explicitly failed, the channel has a problem
    if (probe && probe.ok === false) {
      const key = `channel:${channelId}:${accountId}`;
      const consecutiveFailures = rateLimitState.issueConsecutiveFailures.get(key) ?? 0;

      const source: ChannelIssueSource = {
        kind: "channel",
        channelId,
        accountId,
        reason: probe.error ?? "probe failed",
        lastError: probe.error,
        channelSummary: summary,
      };

      issues.push({
        key,
        classification:
          consecutiveFailures >= maxConsecutiveFailures ? "needs-agent" : "auto-fixable",
        summary: `Channel ${channelId} (${accountId}): ${probe.error ?? "probe failed"}`,
        suggestedAction: `Try restarting the ${channelId} channel. Check the bot token and network connectivity.`,
        source,
      });
    }

    // Channel configured but not linked (e.g. WhatsApp needs re-auth)
    if (
      accountSummary.configured === true &&
      typeof accountSummary.linked === "boolean" &&
      !accountSummary.linked
    ) {
      const key = `channel:${channelId}:${accountId}:unlinked`;
      const source: ChannelIssueSource = {
        kind: "channel",
        channelId,
        accountId,
        reason: "channel not linked",
        channelSummary: summary,
      };

      issues.push({
        key,
        classification: "needs-agent",
        summary: `Channel ${channelId} (${accountId}): configured but not linked — may need re-authentication`,
        suggestedAction: `The ${channelId} channel needs to be re-linked. This typically requires user intervention (e.g. QR scan for WhatsApp).`,
        source,
      });
    }
  }

  return issues;
}

export function classifyHealthIssues(
  healthSnapshot: HealthSummary,
  systemReport: HealthCheckReport,
  config?: SentinelConfig,
): ClassifiedIssue[] {
  const resolved = resolveConfig(config);
  const issues: ClassifiedIssue[] = [];

  // System-level checks
  for (const check of systemReport.checks) {
    const classified = classifySystemCheck(check);
    if (classified) {
      issues.push(classified);
    }
  }

  // Channel-level checks
  for (const [channelId, channelSummary] of Object.entries(healthSnapshot.channels ?? {})) {
    if (!channelSummary) {
      continue;
    }
    const channelIssues = classifyChannelIssue(
      channelId,
      channelSummary,
      resolved.maxConsecutiveFailures,
    );
    issues.push(...channelIssues);
  }

  return issues;
}

// ═══════════════════════════════════════════════════════════════════════════
// Rate Limiting
// ═══════════════════════════════════════════════════════════════════════════

function pruneHourlyEntries(entries: number[], nowMs: number): number[] {
  return entries.filter((t) => nowMs - t < ONE_HOUR_MS);
}

function isIssueCoolingDown(key: string, nowMs: number, cooldownMs: number): boolean {
  const lastAttempt = rateLimitState.issueLastAttemptAt.get(key);
  return lastAttempt !== undefined && nowMs - lastAttempt < cooldownMs;
}

function isRemediationRateLimited(nowMs: number, maxPerHour: number): boolean {
  rateLimitState.remediationsThisHour = pruneHourlyEntries(
    rateLimitState.remediationsThisHour,
    nowMs,
  );
  return rateLimitState.remediationsThisHour.length >= maxPerHour;
}

function isEscalationRateLimited(nowMs: number, maxPerHour: number, cooldownMs: number): boolean {
  rateLimitState.escalationsThisHour = pruneHourlyEntries(
    rateLimitState.escalationsThisHour,
    nowMs,
  );
  if (rateLimitState.escalationsThisHour.length >= maxPerHour) {
    return true;
  }
  return nowMs - rateLimitState.lastEscalationAt < cooldownMs;
}

function recordRemediation(key: string, success: boolean, nowMs: number): void {
  rateLimitState.issueLastAttemptAt.set(key, nowMs);
  rateLimitState.remediationsThisHour.push(nowMs);
  if (success) {
    rateLimitState.issueConsecutiveFailures.delete(key);
  } else {
    const current = rateLimitState.issueConsecutiveFailures.get(key) ?? 0;
    rateLimitState.issueConsecutiveFailures.set(key, current + 1);
  }
}

function recordEscalation(nowMs: number): void {
  rateLimitState.lastEscalationAt = nowMs;
  rateLimitState.escalationsThisHour.push(nowMs);
}

// ═══════════════════════════════════════════════════════════════════════════
// Report Composition
// ═══════════════════════════════════════════════════════════════════════════

function composeSentinelEventText(
  unresolved: ClassifiedIssue[],
  failedRemediations: RemediationAttempt[],
  trendContext: string | null,
): string {
  const lines: string[] = [];
  lines.push("[HEALTH SENTINEL] Issues detected that need your attention:");
  lines.push("");

  for (let i = 0; i < unresolved.length; i++) {
    const issue = unresolved[i];
    const num = i + 1;
    const failedAttempt = failedRemediations.find((r) => r.issueKey === issue.key);

    lines.push(`${num}. ${issue.summary}`);
    if (failedAttempt) {
      lines.push(`   Auto-fix attempted: ${failedAttempt.playbook} (${failedAttempt.status})`);
      if (failedAttempt.error) {
        lines.push(`   Error: ${failedAttempt.error}`);
      }
    }
    if (issue.suggestedAction) {
      lines.push(`   Suggested action: ${issue.suggestedAction}`);
    }
    lines.push("");
  }

  if (trendContext) {
    lines.push("Trend analysis:");
    lines.push(trendContext);
    lines.push("");
  }

  // Add cron_heal self-healing guidance when cron or disk issues are detected
  const hasCronIssues = unresolved.some(
    (i) => i.key?.startsWith("cron.") || i.key?.startsWith("cron:"),
  );
  const hasDiskIssues = unresolved.some(
    (i) => i.key?.startsWith("disk.") || i.key?.startsWith("disk:"),
  );

  if (hasCronIssues || hasDiskIssues) {
    lines.push("## Self-Healing Actions Available");
    lines.push("Use the `cron_heal` tool to diagnose and fix these issues:");
    if (hasCronIssues) {
      lines.push("- `cron_heal diagnose` — assess overall cron health and identify root causes");
      lines.push(
        "- `cron_heal re-enable <jobId>` — re-enable disabled or failing jobs (with automatic snapshot and rollback)",
      );
      lines.push("- `cron_heal adjust-schedule <jobId>` — fix scheduling issues");
    }
    if (hasDiskIssues) {
      lines.push(
        "- `cron_heal cleanup-disk` — reclaim disk space from old sessions, browser cache, and logs",
      );
    }
    lines.push(
      "All actions are journaled and auto-rolled back if the fix doesn't hold within the watchdog window.",
    );
    lines.push("");
  }

  // Add auto_heal guidance when error-rate or tool-related issues are detected
  const hasErrorRateIssues = unresolved.some((i) => i.key?.startsWith("system:logs.error_rate"));
  const hasToolIssues = unresolved.some(
    (i) => i.summary?.toLowerCase().includes("tool") || i.key?.includes("tool"),
  );

  if (hasErrorRateIssues || hasToolIssues) {
    lines.push("## Auto-Heal Actions Available");
    lines.push("Use the `auto_heal` tool to diagnose and fix code-level errors:");
    lines.push(
      "- `auto_heal diagnose` — check error journal for pending errors, classify by severity",
    );
    lines.push(
      "- `auto_heal attempt-fix` — backup the file, apply a fix, run tests, and report the result",
    );
    lines.push("- `auto_heal rollback` — restore a file from its backup if a fix fails");
    lines.push("- `auto_heal status` — view overall error journal and repair statistics");
    lines.push(
      "The auto-heal tool enforces strict scope constraints (leaf nodes only), mandatory backups,",
    );
    lines.push("and a 3-strike limit per error. All repairs are logged to BACKGROUND_FIXES.md.");
    lines.push("");
  }

  const hasAnySelfHeal = hasCronIssues || hasDiskIssues || hasErrorRateIssues || hasToolIssues;
  lines.push(
    hasAnySelfHeal
      ? "Investigate and fix using `cron_heal` / `auto_heal` when applicable. If you cannot resolve them after 3 attempts, escalate to the user with fix-first options."
      : "Please investigate and fix these issues. If you cannot resolve them, escalate to the user.",
  );

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Orchestrator
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run the health sentinel check cycle.
 *
 * 1. Gather health data (channel probes + system checks + doctor probes)
 * 2. Classify issues
 * 3. Attempt Tier 1 fixes (playbooks) for auto-fixable issues
 * 4. Verify fixes
 * 5. Escalate unresolved issues to the agent via system event
 * 6. Persist history and rate-limit state
 */
export async function runSentinelCheck(deps: SentinelDeps): Promise<SentinelReport> {
  const nowMs = (deps.nowMs ?? Date.now)();
  const timestamp = new Date(nowMs).toISOString();
  const cfg = resolveConfig(deps.config);

  log.info?.("starting sentinel check");

  // Load persistent rate-limit state on first run
  if (deps.stateDir) {
    loadPersistentState(deps.stateDir);
  }

  // 1. Gather health data
  let healthSnapshot: HealthSummary;
  let systemReport: HealthCheckReport;
  try {
    [healthSnapshot, systemReport] = await Promise.all([
      deps.getHealthSnapshot(),
      deps.runHealthCheck({
        errorWindowHours: 1,
        errorThreshold: cfg.errorRateThreshold,
      }),
    ]);
  } catch (err) {
    log.warn?.(`failed to gather health data: ${String(err)}`);
    return {
      timestamp,
      healthy: false,
      issues: [],
      remediations: [],
      suppressedByRateLimit: 0,
      escalatedToAgent: false,
    };
  }

  // 1b. Append doctor-derived probes to system report
  if (deps.doctorProbes) {
    if (deps.doctorProbes.checkStateDirExists) {
      try {
        systemReport.checks.push(deps.doctorProbes.checkStateDirExists());
      } catch (err) {
        log.warn?.(`doctor probe (state dir) failed: ${String(err)}`);
      }
    }
    if (deps.doctorProbes.checkEphemeralPaths) {
      try {
        const ephemeralChecks = deps.doctorProbes.checkEphemeralPaths();
        systemReport.checks.push(...ephemeralChecks);
      } catch (err) {
        log.warn?.(`doctor probe (ephemeral paths) failed: ${String(err)}`);
      }
    }
    if (deps.doctorProbes.checkSidecarHealth) {
      try {
        const sidecarChecks = await deps.doctorProbes.checkSidecarHealth();
        systemReport.checks.push(...sidecarChecks);
      } catch (err) {
        log.warn?.(`doctor probe (sidecar health) failed: ${String(err)}`);
      }
    }
    if (deps.doctorProbes.checkBrowserHealth) {
      try {
        const browserChecks = await deps.doctorProbes.checkBrowserHealth();
        systemReport.checks.push(...browserChecks);
      } catch (err) {
        log.warn?.(`doctor probe (browser health) failed: ${String(err)}`);
      }
    }
    if (deps.doctorProbes.checkCronHealth) {
      try {
        const cronChecks = deps.doctorProbes.checkCronHealth();
        systemReport.checks.push(...cronChecks);
      } catch (err) {
        log.warn?.(`doctor probe (cron health) failed: ${String(err)}`);
      }
    }
    if (deps.doctorProbes.checkDiskHygiene) {
      try {
        const diskChecks = deps.doctorProbes.checkDiskHygiene();
        systemReport.checks.push(...diskChecks);
      } catch (err) {
        log.warn?.(`doctor probe (disk hygiene) failed: ${String(err)}`);
      }
    }
  }

  // 1c. Append weekly drift probes (once per week)
  if (deps.weeklyProbes && nowMs - lastWeeklyProbeRunMs >= ONE_WEEK_MS) {
    lastWeeklyProbeRunMs = nowMs;
    log.info?.("running weekly drift checks");

    if (deps.weeklyProbes.checkBackupFreshness) {
      try {
        systemReport.checks.push(deps.weeklyProbes.checkBackupFreshness());
      } catch (err) {
        log.warn?.(`weekly probe (backup freshness) failed: ${String(err)}`);
      }
    }
    if (deps.weeklyProbes.checkFilePermissions) {
      try {
        const permChecks = deps.weeklyProbes.checkFilePermissions();
        systemReport.checks.push(...permChecks);
      } catch (err) {
        log.warn?.(`weekly probe (file permissions) failed: ${String(err)}`);
      }
    }
  }

  // 2. Classify issues
  const issues = classifyHealthIssues(healthSnapshot, systemReport, deps.config);

  if (issues.length === 0) {
    log.info?.("all checks passed");
    const report: SentinelReport = {
      timestamp,
      healthy: true,
      issues: [],
      remediations: [],
      suppressedByRateLimit: 0,
      escalatedToAgent: false,
    };
    lastReport = report;
    if (deps.stateDir) {
      appendSentinelReport(report, deps.stateDir);
      savePersistentState(deps.stateDir);
      // Write inbox summary even for healthy runs
      writeInboxSummary(report, null, deps.stateDir);
      // Run TTL cleanup on each cycle (cheap — just stat + unlink)
      runCleanup(deps.stateDir, cfg.incidentRetentionDays, cfg.historyRetentionDays);
    }
    return report;
  }

  log.info?.(`${issues.length} issue(s) detected`);

  // 3. Tier 1 — attempt auto-fixes for auto-fixable issues
  const remediations: RemediationAttempt[] = [];
  let suppressedByRateLimit = 0;
  const unresolved: ClassifiedIssue[] = [];

  // Build playbooks from remediation context (if provided)
  const noopContext = {
    restartChannel: async () => {},
    probeChannelHealth: async () => false,
    rotateEventLogs: () => ({ rotated: [], deleted: [] }),
    checkDiskSpaceMB: () => 0,
  };
  const playbooks = buildPlaybooks(deps.remediationContext ?? noopContext);

  for (const issue of issues) {
    if (issue.classification === "auto-fixable") {
      // Rate-limit checks
      if (isIssueCoolingDown(issue.key, nowMs, cfg.issueCooldownMs)) {
        suppressedByRateLimit++;
        // Still unresolved, but don't retry yet
        unresolved.push(issue);
        continue;
      }
      if (isRemediationRateLimited(nowMs, cfg.maxRemediationsPerHour)) {
        suppressedByRateLimit++;
        unresolved.push(issue);
        continue;
      }

      const playbook = findPlaybook(issue, playbooks);
      if (!playbook) {
        unresolved.push(issue);
        continue;
      }

      // Attempt remediation
      const attempt = await playbook.remediate(issue);
      remediations.push(attempt);

      if (attempt.status === "success") {
        // Verify the fix
        const verified = await playbook.verify(issue);
        attempt.verified = verified;
        recordRemediation(issue.key, verified, nowMs);

        if (!verified) {
          log.warn?.(`remediation succeeded but verification failed: ${issue.key}`);
          unresolved.push(issue);
        } else {
          log.info?.(`remediation verified: ${issue.key}`);
        }
      } else {
        recordRemediation(issue.key, false, nowMs);
        unresolved.push(issue);
      }
    } else if (issue.classification === "needs-agent" || issue.classification === "warning") {
      unresolved.push(issue);
    }
  }

  // 4. Tier 2 — escalate unresolved issues to the agent
  const agentEscalationIssues = unresolved.filter((i) => i.classification !== "warning");
  let escalatedToAgent = false;

  if (agentEscalationIssues.length > 0) {
    if (isEscalationRateLimited(nowMs, cfg.maxEscalationsPerHour, cfg.escalationCooldownMs)) {
      log.info?.("escalation rate-limited, skipping agent notification");
    } else {
      // Get trend context for richer escalation messages
      let trendContext: string | null = null;
      if (deps.stateDir) {
        try {
          const history = getRecentReports(deps.stateDir);
          if (history.length >= 2) {
            const trends = detectTrends(history);
            trendContext = formatTrendContext(trends);
          }
        } catch (err) {
          log.warn?.(`trend analysis failed: ${String(err)}`);
        }
      }

      const eventText = composeSentinelEventText(agentEscalationIssues, remediations, trendContext);
      const sessionKey = deps.resolveMainSessionKey();

      try {
        deps.enqueueSystemEvent(eventText, {
          sessionKey,
          contextKey: "health-sentinel",
        });
        deps.requestHeartbeatNow({ reason: "health-sentinel" });
        recordEscalation(nowMs);
        escalatedToAgent = true;
        log.info?.(`escalated ${agentEscalationIssues.length} issue(s) to agent`);
      } catch (err) {
        log.warn?.(`failed to escalate to agent: ${String(err)}`);
      }
    }
  }

  // Log warnings (but don't escalate them)
  const warnings = unresolved.filter((i) => i.classification === "warning");
  for (const w of warnings) {
    log.info?.(`warning: ${w.summary}`);
  }

  const healthy =
    issues.every((i) => i.classification === "healthy" || i.classification === "warning") &&
    agentEscalationIssues.length === 0;

  const report: SentinelReport = {
    timestamp,
    healthy,
    issues,
    remediations,
    suppressedByRateLimit,
    escalatedToAgent,
  };

  // 5. Persist + post-processing
  lastReport = report;
  if (deps.stateDir) {
    appendSentinelReport(report, deps.stateDir);
    savePersistentState(deps.stateDir);

    // Compute trends for inbox summary
    let trendResult: TrendAnalysis | null = null;
    try {
      const history = getRecentReports(deps.stateDir);
      if (history.length >= 2) {
        trendResult = detectTrends(history);
      }
    } catch {
      // non-critical
    }

    // Write incident files on escalation
    if (escalatedToAgent) {
      writeIncidentFiles(report, deps.stateDir);
    }

    // Write inbox summary after every run
    writeInboxSummary(report, trendResult, deps.stateDir);

    // Run TTL cleanup
    runCleanup(deps.stateDir, cfg.incidentRetentionDays, cfg.historyRetentionDays);
  }

  return report;
}
