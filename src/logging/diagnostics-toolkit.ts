/**
 * Diagnostic toolkit: health checks, cron debugging, and model diagnostics.
 *
 * Provides programmatic access (not CLI) so agents and cron jobs can call these
 * directly. All functions return structured data, never side-effect on stdout.
 *
 * Usage:
 * ```ts
 * const health = await runHealthCheck({ logsDir: "data/logs", gatewayPort: 5151 });
 * if (!health.healthy) {
 *   // inspect health.checks for failures
 * }
 * ```
 */

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  createEventLogger,
  getRecentErrors,
  type EventLogger,
  type StoredEventEntry,
} from "./event-log.js";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type CheckStatus = "pass" | "fail" | "warn" | "skip";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  /** Milliseconds taken for this check */
  durationMs?: number;
}

export interface HealthCheckReport {
  /** ISO timestamp of the health check */
  timestamp: string;
  /** Overall health */
  healthy: boolean;
  /** Individual check results */
  checks: CheckResult[];
  /** Summary counts */
  summary: { pass: number; fail: number; warn: number; skip: number };
}

export interface HealthCheckOptions {
  /** Directory containing event logs */
  logsDir?: string;
  /** Gateway port to probe */
  gatewayPort?: number;
  /** Gateway host, default: 127.0.0.1 */
  gatewayHost?: string;
  /** TCP probe timeout ms, default: 3000 */
  probeTimeoutMs?: number;
  /** Hours to look back for error rate check, default: 1 */
  errorWindowHours?: number;
  /** Error count threshold for failure, default: 50 */
  errorThreshold?: number;
  /** PID file path (optional, skipped if not provided) */
  pidFile?: string;
  /** Pre-built event logger (optional, constructed from logsDir if not provided) */
  eventLogger?: EventLogger;
}

// ── Cron debugger types ───────────────────────────────────────────────────

export interface CronHistoryEntry {
  timestamp: string;
  jobId: string;
  status: string;
  error?: string;
  durationMs?: number;
}

export interface CronHistoryFilter {
  jobId?: string;
  status?: string;
  since?: Date;
  until?: Date;
  limit?: number;
}

export interface PersistentFailure {
  jobId: string;
  failureCount: number;
  windowHours: number;
  recentErrors: string[];
}

export interface StaleJob {
  jobId: string;
  startedAt: string;
  ageMs: number;
}

// ── Model diagnostics types ──────────────────────────────────────────────

export interface ModelStatus {
  /** Active model name */
  activeModel: string | null;
  /** Context usage percentage (0-100) if available */
  contextUsage: number | null;
  /** Fallback chain list */
  fallbackChain: string[];
  /** Provider connection status */
  providerStatus: string;
}

export interface CanaryTestResult {
  /** Whether the canary test succeeded */
  success: boolean;
  /** Reported provider/model in the response */
  respondedModel: string | null;
  /** Whether it matches expected model */
  matchesExpected: boolean;
  /** Error if the test failed */
  error?: string;
  /** Duration of the test in ms */
  durationMs: number;
}

export interface UsageDashboardEntry {
  model: string;
  callCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  errorCount: number;
  estimatedCost: number | null;
}

export interface UsageDashboard {
  since: string;
  until: string;
  entries: UsageDashboardEntry[];
  totalCalls: number;
  totalErrors: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Health Check
// ═══════════════════════════════════════════════════════════════════════════

function checkPidFile(pidFile: string): CheckResult {
  const start = Date.now();
  try {
    if (!fs.existsSync(pidFile)) {
      return {
        name: "process.pid_file",
        status: "skip",
        detail: `PID file not found: ${pidFile}`,
        durationMs: Date.now() - start,
      };
    }
    const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
    if (isNaN(pid)) {
      return {
        name: "process.pid_file",
        status: "fail",
        detail: "PID file contains invalid value",
        durationMs: Date.now() - start,
      };
    }
    try {
      process.kill(pid, 0); // signal 0 = existence check
      return {
        name: "process.pid_file",
        status: "pass",
        detail: `Process ${pid} is running`,
        durationMs: Date.now() - start,
      };
    } catch {
      return {
        name: "process.pid_file",
        status: "fail",
        detail: `Process ${pid} is not running`,
        durationMs: Date.now() - start,
      };
    }
  } catch (err) {
    return {
      name: "process.pid_file",
      status: "fail",
      detail: `Error reading PID file: ${String(err)}`,
      durationMs: Date.now() - start,
    };
  }
}

function checkPort(host: string, port: number, timeoutMs: number): Promise<CheckResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    const finish = (result: CheckResult) => {
      if (resolved) {
        return;
      }
      resolved = true;
      socket.destroy();
      resolve({ ...result, durationMs: Date.now() - start });
    };

    socket.setTimeout(timeoutMs);
    socket.on("connect", () => {
      finish({
        name: "gateway.port",
        status: "pass",
        detail: `Port ${port} is reachable on ${host}`,
      });
    });
    socket.on("error", (err) => {
      finish({
        name: "gateway.port",
        status: "fail",
        detail: `Port ${port} unreachable: ${err.message}`,
      });
    });
    socket.on("timeout", () => {
      finish({
        name: "gateway.port",
        status: "fail",
        detail: `Port ${port} timed out after ${timeoutMs}ms`,
      });
    });
    socket.connect(port, host);
  });
}

function checkRecentErrors(
  logger: EventLogger,
  windowHours: number,
  threshold: number,
): CheckResult {
  const start = Date.now();
  try {
    const errors = getRecentErrors(logger, windowHours);
    const count = errors.length;
    if (count >= threshold) {
      return {
        name: "logs.error_rate",
        status: "fail",
        detail: `${count} errors in the last ${windowHours}h (threshold: ${threshold})`,
        durationMs: Date.now() - start,
      };
    }
    if (count > threshold / 2) {
      return {
        name: "logs.error_rate",
        status: "warn",
        detail: `${count} errors in the last ${windowHours}h (approaching threshold: ${threshold})`,
        durationMs: Date.now() - start,
      };
    }
    return {
      name: "logs.error_rate",
      status: "pass",
      detail: `${count} errors in the last ${windowHours}h`,
      durationMs: Date.now() - start,
    };
  } catch {
    return {
      name: "logs.error_rate",
      status: "skip",
      detail: "Could not read event logs",
      durationMs: Date.now() - start,
    };
  }
}

function checkDiskSpace(dir: string): CheckResult {
  const start = Date.now();
  try {
    if (!fs.existsSync(dir)) {
      return {
        name: "disk.log_directory",
        status: "skip",
        detail: `Log directory does not exist: ${dir}`,
        durationMs: Date.now() - start,
      };
    }
    let totalBytes = 0;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      try {
        const stat = fs.statSync(path.join(dir, file));
        if (stat.isFile()) {
          totalBytes += stat.size;
        }
      } catch {
        // skip
      }
    }
    const totalMB = Math.round(totalBytes / 1024 / 1024);
    if (totalMB > 500) {
      return {
        name: "disk.log_directory",
        status: "warn",
        detail: `Log directory is ${totalMB}MB — consider rotation`,
        durationMs: Date.now() - start,
      };
    }
    return {
      name: "disk.log_directory",
      status: "pass",
      detail: `Log directory is ${totalMB}MB (${files.length} files)`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "disk.log_directory",
      status: "fail",
      detail: `Error checking disk: ${String(err)}`,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Run a comprehensive system health check.
 */
export async function runHealthCheck(
  options?: HealthCheckOptions,
): Promise<HealthCheckReport> {
  const logsDir = options?.logsDir ?? "data/logs";
  const port = options?.gatewayPort;
  const host = options?.gatewayHost ?? "127.0.0.1";
  const probeTimeoutMs = options?.probeTimeoutMs ?? 3000;
  const errorWindowHours = options?.errorWindowHours ?? 1;
  const errorThreshold = options?.errorThreshold ?? 50;
  const eventLogger = options?.eventLogger ?? createEventLogger({ baseDir: logsDir });

  const checks: CheckResult[] = [];

  // 1. PID file check (if configured)
  if (options?.pidFile) {
    checks.push(checkPidFile(options.pidFile));
  }

  // 2. Port reachability (if configured)
  if (port) {
    checks.push(await checkPort(host, port, probeTimeoutMs));
  }

  // 3. Recent error rate
  checks.push(checkRecentErrors(eventLogger, errorWindowHours, errorThreshold));

  // 4. Disk space
  checks.push(checkDiskSpace(logsDir));

  const summary = {
    pass: checks.filter((c) => c.status === "pass").length,
    fail: checks.filter((c) => c.status === "fail").length,
    warn: checks.filter((c) => c.status === "warn").length,
    skip: checks.filter((c) => c.status === "skip").length,
  };

  return {
    timestamp: new Date().toISOString(),
    healthy: summary.fail === 0,
    checks,
    summary,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Cron Debugger
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Query cron job history from the event log.
 * Reads "cron.*" events and returns structured history.
 */
export function queryCronHistory(
  logger: EventLogger,
  filters?: CronHistoryFilter,
): CronHistoryEntry[] {
  const eventEntries = logger.query({
    event: "cron.",
    since: filters?.since,
    until: filters?.until,
    limit: filters?.limit ?? 100,
  });

  return eventEntries
    .filter((e) => {
      if (filters?.jobId && e.data.jobId !== filters.jobId) {
        return false;
      }
      if (filters?.status && e.data.status !== filters.status) {
        return false;
      }
      return true;
    })
    .map((e) => ({
      timestamp: e.timestamp,
      jobId: String(e.data.jobId ?? "unknown"),
      status: String(e.data.status ?? e.level),
      error: e.data.error ? String(e.data.error) : undefined,
      durationMs: typeof e.data.durationMs === "number" ? e.data.durationMs : undefined,
    }));
}

/**
 * Detect jobs that have failed persistently (3+ times) within a time window.
 */
export function detectPersistentFailures(
  logger: EventLogger,
  windowHours: number = 6,
  minFailures: number = 3,
): PersistentFailure[] {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const entries = logger.query({ event: "cron.", level: "error", since });

  const byJob = new Map<string, StoredEventEntry[]>();
  for (const entry of entries) {
    const jobId = String(entry.data.jobId ?? "unknown");
    const arr = byJob.get(jobId) ?? [];
    arr.push(entry);
    byJob.set(jobId, arr);
  }

  const results: PersistentFailure[] = [];
  for (const [jobId, failures] of byJob) {
    if (failures.length >= minFailures) {
      results.push({
        jobId,
        failureCount: failures.length,
        windowHours,
        recentErrors: failures
          .slice(-3)
          .map((e) => String(e.data.error ?? e.data.message ?? "unknown")),
      });
    }
  }

  return results;
}

/**
 * Find and mark jobs stuck in "running" state for longer than maxAgeMs.
 */
export function detectStaleJobs(
  logger: EventLogger,
  maxAgeMs: number = 2 * 60 * 60 * 1000,
): StaleJob[] {
  const entries = logger.query({ event: "cron.", limit: 5000 });

  // Track last seen state per job
  const lastState = new Map<string, { state: string; timestamp: string }>();
  for (const entry of entries) {
    const jobId = String(entry.data.jobId ?? "");
    if (!jobId) {
      continue;
    }
    const state = String(entry.data.status ?? entry.data.state ?? "");
    if (state) {
      lastState.set(jobId, { state, timestamp: entry.timestamp });
    }
  }

  const now = Date.now();
  const stale: StaleJob[] = [];
  for (const [jobId, { state, timestamp }] of lastState) {
    if (state === "running" || state === "processing") {
      const ageMs = now - new Date(timestamp).getTime();
      if (ageMs > maxAgeMs) {
        stale.push({
          jobId,
          startedAt: timestamp,
          ageMs,
        });
      }
    }
  }

  return stale;
}

// ═══════════════════════════════════════════════════════════════════════════
// Model / Provider Diagnostics
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get model status from the event log.
 * Reads "llm.call" events to determine active model.
 */
export function getModelStatus(logger: EventLogger): ModelStatus {
  const recent = logger.query({ event: "llm.", limit: 20 });

  const modelCounts = new Map<string, number>();
  for (const entry of recent) {
    const model = String(entry.data.model ?? "");
    if (model) {
      modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
    }
  }

  // Most used model is the "active" one
  let activeModel: string | null = null;
  let maxCount = 0;
  for (const [model, count] of modelCounts) {
    if (count > maxCount) {
      maxCount = count;
      activeModel = model;
    }
  }

  const contextUsage =
    recent.length > 0 && typeof recent[recent.length - 1].data.contextUsage === "number"
      ? (recent[recent.length - 1].data.contextUsage as number)
      : null;

  const fallbackChain = [...modelCounts.keys()].filter((m) => m !== activeModel);

  return {
    activeModel,
    contextUsage,
    fallbackChain,
    providerStatus: recent.length > 0 ? "connected" : "unknown",
  };
}

/**
 * Get usage dashboard from the event log.
 */
export function getUsageDashboard(
  logger: EventLogger,
  since?: Date,
): UsageDashboard {
  const sinceDate = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const entries = logger.query({ event: "llm.", since: sinceDate });

  const byModel = new Map<string, UsageDashboardEntry>();
  let totalCalls = 0;
  let totalErrors = 0;

  for (const entry of entries) {
    const model = String(entry.data.model ?? "unknown");
    const existing = byModel.get(model) ?? {
      model,
      callCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      errorCount: 0,
      estimatedCost: null,
    };

    existing.callCount += 1;
    totalCalls += 1;

    if (typeof entry.data.inputTokens === "number") {
      existing.totalInputTokens += entry.data.inputTokens;
    }
    if (typeof entry.data.outputTokens === "number") {
      existing.totalOutputTokens += entry.data.outputTokens;
    }
    if (entry.level === "error") {
      existing.errorCount += 1;
      totalErrors += 1;
    }

    byModel.set(model, existing);
  }

  return {
    since: sinceDate.toISOString(),
    until: new Date().toISOString(),
    entries: [...byModel.values()],
    totalCalls,
    totalErrors,
  };
}
