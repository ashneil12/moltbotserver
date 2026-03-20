/**
 * Health Sentinel — shared types.
 *
 * Defines the contracts between the sentinel orchestrator, playbooks,
 * and the diagnostic heartbeat integration.
 */

import type { ChannelHealthSummary, HealthSummary } from "../commands/health.js";
import type { CheckResult, HealthCheckReport } from "./diagnostics-toolkit.js";
import type { RemediationContext } from "./health-sentinel-playbooks.js";

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

export interface SentinelConfig {
  /** Max auto-fix remediations per hour. Default: 5 */
  maxRemediationsPerHour?: number;
  /** Per-issue cooldown before re-attempting remediation (ms). Default: 900000 (15 min) */
  issueCooldownMs?: number;
  /** Minimum delay between escalation events to the agent (ms). Default: 1800000 (30 min) */
  escalationCooldownMs?: number;
  /** Maximum escalation events per hour. Default: 3 */
  maxEscalationsPerHour?: number;
  /** Consecutive failures before escalating instead of retrying. Default: 3 */
  maxConsecutiveFailures?: number;
  /** Log directory size (MB) at which disk cleanup is attempted. Default: 500 */
  diskWarnThresholdMB?: number;
  /** Error count threshold for failure within the error window. Default: 50 */
  errorRateThreshold?: number;
  /** Days to keep incident files and inbox summaries. Default: 7 */
  incidentRetentionDays?: number;
  /** Days to keep history JSONL entries. Default: 14 */
  historyRetentionDays?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Classification
// ═══════════════════════════════════════════════════════════════════════════

export type SentinelClassification = "healthy" | "auto-fixable" | "needs-agent" | "warning";

export interface ClassifiedIssue {
  /** Unique key for rate-limiting (e.g. "channel:telegram:default") */
  key: string;
  classification: SentinelClassification;
  /** Human-readable summary of the issue */
  summary: string;
  /** Suggested action for the agent (when escalated) */
  suggestedAction?: string;
  /** Source data from the health check */
  source: CheckResult | ChannelIssueSource;
}

export interface ChannelIssueSource {
  kind: "channel";
  channelId: string;
  accountId: string;
  reason: string;
  lastError?: string;
  channelSummary?: ChannelHealthSummary;
}

// ═══════════════════════════════════════════════════════════════════════════
// Remediation
// ═══════════════════════════════════════════════════════════════════════════

export type RemediationStatus = "success" | "failed" | "skipped";

export interface RemediationAttempt {
  issueKey: string;
  playbook: string;
  status: RemediationStatus;
  error?: string;
  /** Whether verification confirmed the fix */
  verified?: boolean;
  durationMs: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sentinel Report
// ═══════════════════════════════════════════════════════════════════════════

export interface SentinelReport {
  timestamp: string;
  healthy: boolean;
  issues: ClassifiedIssue[];
  remediations: RemediationAttempt[];
  /** Number of issues suppressed by rate limiting */
  suppressedByRateLimit: number;
  /** Whether a system event was sent to the agent */
  escalatedToAgent: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Rate Limiting State
// ═══════════════════════════════════════════════════════════════════════════

export interface RateLimitState {
  /** Per-issue: last attempt timestamp */
  issueLastAttemptAt: Map<string, number>;
  /** Per-issue: consecutive failure count */
  issueConsecutiveFailures: Map<string, number>;
  /** Global: remediation timestamps this hour */
  remediationsThisHour: number[];
  /** Global: last escalation timestamp */
  lastEscalationAt: number;
  /** Global: escalation count this hour */
  escalationsThisHour: number[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Playbook
// ═══════════════════════════════════════════════════════════════════════════

export interface RemediationPlaybook {
  /** Unique playbook identifier */
  id: string;
  /** Whether this playbook can handle the given issue */
  matches: (issue: ClassifiedIssue) => boolean;
  /** Attempt to fix the issue. Must not throw. */
  remediate: (issue: ClassifiedIssue) => Promise<RemediationAttempt>;
  /** Re-check whether the issue is resolved. */
  verify: (issue: ClassifiedIssue) => Promise<boolean>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sentinel Dependencies (for testability)
// ═══════════════════════════════════════════════════════════════════════════

export interface SentinelDeps {
  /** Run the full health snapshot (channels + system checks) */
  getHealthSnapshot: () => Promise<HealthSummary>;
  /** Run the system health check (error rate, disk, port) */
  runHealthCheck: (opts?: {
    errorWindowHours?: number;
    errorThreshold?: number;
  }) => Promise<HealthCheckReport>;
  /** Enqueue a system event for the agent */
  enqueueSystemEvent: (
    text: string,
    options: { sessionKey?: string; contextKey?: string },
  ) => boolean | void;
  /** Wake the heartbeat immediately */
  requestHeartbeatNow: (opts?: { reason?: string }) => void;
  /** Resolve the main session key */
  resolveMainSessionKey: () => string;
  /** Remediation context for playbooks (channel restart, probe, etc.) */
  remediationContext?: RemediationContext;
  /** Current time (overridable for tests) */
  nowMs?: () => number;
  /** State directory for persistent sentinel data (history, rate-limit state) */
  stateDir?: string;
  /** Configurable thresholds (from openclaw.json → diagnostics.sentinel) */
  config?: SentinelConfig;
  /** Lightweight doctor-derived probes (ephemeral path, state dir existence) */
  doctorProbes?: DoctorProbes;
  /** Weekly drift probes (backup freshness, file permissions) — gated to run ~1x/week */
  weeklyProbes?: WeeklyProbes;
}

export interface DoctorProbes {
  /** Check if critical paths are on ephemeral storage */
  checkEphemeralPaths?: () => CheckResult[];
  /** Check if the state directory exists */
  checkStateDirExists?: () => CheckResult;
  /** Check Docker sidecar services (SearXNG, Scrapling) — async because it uses fetch */
  checkSidecarHealth?: () => Promise<CheckResult[]>;
  /** Check sandbox browser containers (Docker state + CDP probe) — async */
  checkBrowserHealth?: () => Promise<CheckResult[]>;
  /** Check cron scheduler health (liveness, consecutive errors, auto-disabled, stale delivery) */
  checkCronHealth?: () => CheckResult[];
  /** Check disk hygiene (session files, browser cache, gateway logs) */
  checkDiskHygiene?: () => CheckResult[];
}

export interface WeeklyProbes {
  /** Check if config backup is fresh (not stale) */
  checkBackupFreshness?: () => CheckResult;
  /** Check file permissions (e.g. root-owned residue in state dir) */
  checkFilePermissions?: () => CheckResult[];
}
