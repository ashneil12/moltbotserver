import { loadConfig } from "../config/config.js";
import type { OpenClawConfig } from "../config/config.js";
import { emitDiagnosticEvent } from "../infra/diagnostic-events.js";
import {
  diagnosticSessionStates,
  getDiagnosticSessionState,
  getDiagnosticSessionStateCountForTest as getDiagnosticSessionStateCountForTestImpl,
  pruneDiagnosticSessionStates,
  resetDiagnosticSessionStateForTest,
  type SessionRef,
  type SessionStateValue,
} from "./diagnostic-session-state.js";
import { createSubsystemLogger } from "./subsystem.js";

const diag = createSubsystemLogger("diagnostic");

const webhookStats = {
  received: 0,
  processed: 0,
  errors: 0,
  lastReceived: 0,
};

let lastActivityAt = 0;
const DEFAULT_STUCK_SESSION_WARN_MS = 120_000;
const MIN_STUCK_SESSION_WARN_MS = 1_000;
const MAX_STUCK_SESSION_WARN_MS = 24 * 60 * 60 * 1000;
let commandPollBackoffRuntimePromise: Promise<
  typeof import("../agents/command-poll-backoff.runtime.js")
> | null = null;

function loadCommandPollBackoffRuntime() {
  commandPollBackoffRuntimePromise ??= import("../agents/command-poll-backoff.runtime.js");
  return commandPollBackoffRuntimePromise;
}

function markActivity() {
  lastActivityAt = Date.now();
}

export function resolveStuckSessionWarnMs(config?: OpenClawConfig): number {
  const raw = config?.diagnostics?.stuckSessionWarnMs;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_STUCK_SESSION_WARN_MS;
  }
  const rounded = Math.floor(raw);
  if (rounded < MIN_STUCK_SESSION_WARN_MS || rounded > MAX_STUCK_SESSION_WARN_MS) {
    return DEFAULT_STUCK_SESSION_WARN_MS;
  }
  return rounded;
}

export function logWebhookReceived(params: {
  channel: string;
  updateType?: string;
  chatId?: number | string;
}) {
  webhookStats.received += 1;
  webhookStats.lastReceived = Date.now();
  if (diag.isEnabled("debug")) {
    diag.debug(
      `webhook received: channel=${params.channel} type=${params.updateType ?? "unknown"} chatId=${
        params.chatId ?? "unknown"
      } total=${webhookStats.received}`,
    );
  }
  emitDiagnosticEvent({
    type: "webhook.received",
    channel: params.channel,
    updateType: params.updateType,
    chatId: params.chatId,
  });
  markActivity();
}

export function logWebhookProcessed(params: {
  channel: string;
  updateType?: string;
  chatId?: number | string;
  durationMs?: number;
}) {
  webhookStats.processed += 1;
  if (diag.isEnabled("debug")) {
    diag.debug(
      `webhook processed: channel=${params.channel} type=${
        params.updateType ?? "unknown"
      } chatId=${params.chatId ?? "unknown"} duration=${params.durationMs ?? 0}ms processed=${
        webhookStats.processed
      }`,
    );
  }
  emitDiagnosticEvent({
    type: "webhook.processed",
    channel: params.channel,
    updateType: params.updateType,
    chatId: params.chatId,
    durationMs: params.durationMs,
  });
  markActivity();
}

export function logWebhookError(params: {
  channel: string;
  updateType?: string;
  chatId?: number | string;
  error: string;
}) {
  webhookStats.errors += 1;
  diag.error(
    `webhook error: channel=${params.channel} type=${params.updateType ?? "unknown"} chatId=${
      params.chatId ?? "unknown"
    } error="${params.error}" errors=${webhookStats.errors}`,
  );
  emitDiagnosticEvent({
    type: "webhook.error",
    channel: params.channel,
    updateType: params.updateType,
    chatId: params.chatId,
    error: params.error,
  });
  markActivity();
}

export function logMessageQueued(params: {
  sessionId?: string;
  sessionKey?: string;
  channel?: string;
  source: string;
}) {
  const state = getDiagnosticSessionState(params);
  state.queueDepth += 1;
  state.lastActivity = Date.now();
  if (diag.isEnabled("debug")) {
    diag.debug(
      `message queued: sessionId=${state.sessionId ?? "unknown"} sessionKey=${
        state.sessionKey ?? "unknown"
      } source=${params.source} queueDepth=${state.queueDepth} sessionState=${state.state}`,
    );
  }
  emitDiagnosticEvent({
    type: "message.queued",
    sessionId: state.sessionId,
    sessionKey: state.sessionKey,
    channel: params.channel,
    source: params.source,
    queueDepth: state.queueDepth,
  });
  markActivity();
}

export function logMessageProcessed(params: {
  channel: string;
  messageId?: number | string;
  chatId?: number | string;
  sessionId?: string;
  sessionKey?: string;
  durationMs?: number;
  outcome: "completed" | "skipped" | "error";
  reason?: string;
  error?: string;
}) {
  const wantsLog = params.outcome === "error" ? diag.isEnabled("error") : diag.isEnabled("debug");
  if (wantsLog) {
    const payload = `message processed: channel=${params.channel} chatId=${
      params.chatId ?? "unknown"
    } messageId=${params.messageId ?? "unknown"} sessionId=${
      params.sessionId ?? "unknown"
    } sessionKey=${params.sessionKey ?? "unknown"} outcome=${params.outcome} duration=${
      params.durationMs ?? 0
    }ms${params.reason ? ` reason=${params.reason}` : ""}${
      params.error ? ` error="${params.error}"` : ""
    }`;
    if (params.outcome === "error") {
      diag.error(payload);
    } else {
      diag.debug(payload);
    }
  }
  emitDiagnosticEvent({
    type: "message.processed",
    channel: params.channel,
    chatId: params.chatId,
    messageId: params.messageId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    durationMs: params.durationMs,
    outcome: params.outcome,
    reason: params.reason,
    error: params.error,
  });
  markActivity();
}

export function logSessionStateChange(
  params: SessionRef & {
    state: SessionStateValue;
    reason?: string;
  },
) {
  const state = getDiagnosticSessionState(params);
  const isProbeSession = state.sessionId?.startsWith("probe-") ?? false;
  const prevState = state.state;
  state.state = params.state;
  state.lastActivity = Date.now();
  if (params.state === "idle") {
    state.queueDepth = Math.max(0, state.queueDepth - 1);
  }
  if (!isProbeSession && diag.isEnabled("debug")) {
    diag.debug(
      `session state: sessionId=${state.sessionId ?? "unknown"} sessionKey=${
        state.sessionKey ?? "unknown"
      } prev=${prevState} new=${params.state} reason="${params.reason ?? ""}" queueDepth=${
        state.queueDepth
      }`,
    );
  }
  emitDiagnosticEvent({
    type: "session.state",
    sessionId: state.sessionId,
    sessionKey: state.sessionKey,
    prevState,
    state: params.state,
    reason: params.reason,
    queueDepth: state.queueDepth,
  });
  markActivity();
}

export function logSessionStuck(params: SessionRef & { state: SessionStateValue; ageMs: number }) {
  const state = getDiagnosticSessionState(params);
  diag.warn(
    `stuck session: sessionId=${state.sessionId ?? "unknown"} sessionKey=${
      state.sessionKey ?? "unknown"
    } state=${params.state} age=${Math.round(params.ageMs / 1000)}s queueDepth=${state.queueDepth}`,
  );
  emitDiagnosticEvent({
    type: "session.stuck",
    sessionId: state.sessionId,
    sessionKey: state.sessionKey,
    state: params.state,
    ageMs: params.ageMs,
    queueDepth: state.queueDepth,
  });
  markActivity();
}

export function logLaneEnqueue(lane: string, queueSize: number) {
  diag.debug(`lane enqueue: lane=${lane} queueSize=${queueSize}`);
  emitDiagnosticEvent({
    type: "queue.lane.enqueue",
    lane,
    queueSize,
  });
  markActivity();
}

export function logLaneDequeue(lane: string, waitMs: number, queueSize: number) {
  diag.debug(`lane dequeue: lane=${lane} waitMs=${waitMs} queueSize=${queueSize}`);
  emitDiagnosticEvent({
    type: "queue.lane.dequeue",
    lane,
    queueSize,
    waitMs,
  });
  markActivity();
}

export function logRunAttempt(params: SessionRef & { runId: string; attempt: number }) {
  diag.debug(
    `run attempt: sessionId=${params.sessionId ?? "unknown"} sessionKey=${
      params.sessionKey ?? "unknown"
    } runId=${params.runId} attempt=${params.attempt}`,
  );
  emitDiagnosticEvent({
    type: "run.attempt",
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    runId: params.runId,
    attempt: params.attempt,
  });
  markActivity();
}

export function logToolLoopAction(
  params: SessionRef & {
    toolName: string;
    level: "warning" | "critical";
    action: "warn" | "block";
    detector: "generic_repeat" | "known_poll_no_progress" | "global_circuit_breaker" | "ping_pong";
    count: number;
    message: string;
    pairedToolName?: string;
  },
) {
  const payload = `tool loop: sessionId=${params.sessionId ?? "unknown"} sessionKey=${
    params.sessionKey ?? "unknown"
  } tool=${params.toolName} level=${params.level} action=${params.action} detector=${
    params.detector
  } count=${params.count}${params.pairedToolName ? ` pairedTool=${params.pairedToolName}` : ""} message="${params.message}"`;
  if (params.level === "critical") {
    diag.error(payload);
  } else {
    diag.warn(payload);
  }
  emitDiagnosticEvent({
    type: "tool.loop",
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    toolName: params.toolName,
    level: params.level,
    action: params.action,
    detector: params.detector,
    count: params.count,
    message: params.message,
    pairedToolName: params.pairedToolName,
  });
  markActivity();
}

export function logActiveRuns() {
  const activeSessions = Array.from(diagnosticSessionStates.entries())
    .filter(([, s]) => s.state === "processing")
    .map(
      ([id, s]) =>
        `${id}(q=${s.queueDepth},age=${Math.round((Date.now() - s.lastActivity) / 1000)}s)`,
    );
  diag.debug(`active runs: count=${activeSessions.length} sessions=[${activeSessions.join(", ")}]`);
  markActivity();
}

let heartbeatInterval: NodeJS.Timeout | null = null;
let healthCheckCycleCount = 0;
let sentinelCycleCount = 0;

export function startDiagnosticHeartbeat(config?: OpenClawConfig) {
  if (heartbeatInterval) {
    return;
  }
  heartbeatInterval = setInterval(() => {
    let heartbeatConfig = config;
    if (!heartbeatConfig) {
      try {
        heartbeatConfig = loadConfig();
      } catch {
        heartbeatConfig = undefined;
      }
    }
    const stuckSessionWarnMs = resolveStuckSessionWarnMs(heartbeatConfig);
    const now = Date.now();
    pruneDiagnosticSessionStates(now, true);
    const activeCount = Array.from(diagnosticSessionStates.values()).filter(
      (s) => s.state === "processing",
    ).length;
    const waitingCount = Array.from(diagnosticSessionStates.values()).filter(
      (s) => s.state === "waiting",
    ).length;
    const totalQueued = Array.from(diagnosticSessionStates.values()).reduce(
      (sum, s) => sum + s.queueDepth,
      0,
    );
    const hasActivity =
      lastActivityAt > 0 ||
      webhookStats.received > 0 ||
      activeCount > 0 ||
      waitingCount > 0 ||
      totalQueued > 0;
    if (!hasActivity) {
      return;
    }
    if (now - lastActivityAt > 120_000 && activeCount === 0 && waitingCount === 0) {
      return;
    }

    diag.debug(
      `heartbeat: webhooks=${webhookStats.received}/${webhookStats.processed}/${webhookStats.errors} active=${activeCount} waiting=${waitingCount} queued=${totalQueued}`,
    );
    emitDiagnosticEvent({
      type: "diagnostic.heartbeat",
      webhooks: {
        received: webhookStats.received,
        processed: webhookStats.processed,
        errors: webhookStats.errors,
      },
      active: activeCount,
      waiting: waitingCount,
      queued: totalQueued,
    });

    void loadCommandPollBackoffRuntime()
      .then(({ pruneStaleCommandPolls }) => {
        for (const [, state] of diagnosticSessionStates) {
          pruneStaleCommandPolls(state);
        }
      })
      .catch((err) => {
        diag.debug(`command-poll-backoff prune failed: ${String(err)}`);
      });

    // Periodic health check: every ~5 minutes (every 10th heartbeat at 30s intervals)
    healthCheckCycleCount += 1;
    if (healthCheckCycleCount >= 10) {
      healthCheckCycleCount = 0;
      import("./diagnostics-toolkit.js")
        .then(({ runHealthCheck }) => runHealthCheck({ errorWindowHours: 1, errorThreshold: 50 }))
        .then((report) => {
          if (!report.healthy) {
            diag.warn?.(
              `[health] System health check FAILED: ${report.checks
                .filter((c) => c.status === "fail")
                .map((c) => `${c.name}: ${c.detail}`)
                .join("; ")}`,
            );
          }
          import("./event-log.js")
            .then(({ createEventLogger }) => {
              const eventLogger = createEventLogger({});
              eventLogger.log({
                event: "system.health_check",
                level: report.healthy ? "info" : "warn",
                data: {
                  healthy: report.healthy,
                  summary: report.summary,
                  failedChecks: report.checks
                    .filter((c) => c.status === "fail")
                    .map((c) => ({ name: c.name, detail: c.detail })),
                },
                subsystem: "diagnostics",
              });
            })
            .catch(() => {
              /* event logging must never block */
            });
        })
        .catch((err) => {
          diag.debug(`health check failed: ${String(err)}`);
        });
    }

    // Health Sentinel: every ~30 minutes (every 60th heartbeat at 30s intervals)
    sentinelCycleCount += 1;
    if (sentinelCycleCount >= 60) {
      sentinelCycleCount = 0;
      Promise.all([
        import("./health-sentinel.js"),
        import("../gateway/call.js"),
        import("./diagnostics-toolkit.js"),
        import("../infra/system-events.js"),
        import("../infra/heartbeat-wake.js"),
        import("../config/sessions.js"),
        import("./event-log.js"),
        import("../infra/ephemeral-path.js"),
        import("../config/paths.js"),
      ])
        .then(
          ([
            { runSentinelCheck },
            { callGateway },
            { runHealthCheck },
            { enqueueSystemEvent },
            { requestHeartbeatNow },
            { resolveMainSessionKey },
            { rotateEventLogs },
            { isEphemeralPath },
            { resolveStateDir },
          ]) => {
            const cfg = loadConfig();
            const sessionKey = resolveMainSessionKey(cfg);
            const stateDir = resolveStateDir(process.env, () => {
              try {
                return require("node:os").homedir();
              } catch {
                return "/tmp";
              }
            });

            return runSentinelCheck({
              getHealthSnapshot: async () => {
                return await callGateway<import("../commands/health.js").HealthSummary>({
                  method: "health",
                  params: { probe: true },
                  config: cfg,
                  timeoutMs: 30_000,
                });
              },
              runHealthCheck,
              enqueueSystemEvent: (text, opts) => enqueueSystemEvent(text, { sessionKey, ...opts }),
              requestHeartbeatNow,
              resolveMainSessionKey: () => sessionKey,
              stateDir,
              config:
                (cfg as Record<string, unknown>).diagnostics &&
                typeof (cfg as Record<string, unknown>).diagnostics === "object"
                  ? (((cfg as Record<string, unknown>).diagnostics as Record<string, unknown>)
                      .sentinel as import("./health-sentinel-types.js").SentinelConfig | undefined)
                  : undefined,
              remediationContext: {
                restartChannel: async (channelId: string, accountId: string) => {
                  await callGateway({
                    method: "channel-restart",
                    params: { channelId, accountId },
                    config: cfg,
                    timeoutMs: 15_000,
                  });
                },
                probeChannelHealth: async (channelId: string) => {
                  try {
                    const result = await callGateway<{ ok?: boolean }>({
                      method: "channel-health",
                      params: { channelId, probe: true },
                      config: cfg,
                      timeoutMs: 10_000,
                    });
                    return result?.ok === true;
                  } catch {
                    return false;
                  }
                },
                rotateEventLogs: (baseDir: string) => rotateEventLogs(baseDir),
                checkDiskSpaceMB: (dir: string) => {
                  const fs = require("node:fs");
                  const path = require("node:path");
                  try {
                    if (!fs.existsSync(dir)) {
                      return 0;
                    }
                    let total = 0;
                    for (const f of fs.readdirSync(dir)) {
                      try {
                        const s = fs.statSync(path.join(dir, f));
                        if (s.isFile()) {
                          total += s.size;
                        }
                      } catch {
                        /* skip */
                      }
                    }
                    return Math.round(total / 1024 / 1024);
                  } catch {
                    return 0;
                  }
                },
              },
              doctorProbes: {
                checkStateDirExists: () => {
                  const fs = require("node:fs");
                  const exists = fs.existsSync(stateDir);
                  return {
                    name: "doctor.state_dir",
                    status: exists ? ("pass" as const) : ("fail" as const),
                    detail: exists
                      ? `State directory exists: ${stateDir}`
                      : `State directory missing: ${stateDir}`,
                  };
                },
                checkEphemeralPaths: () => {
                  const checks: import("./diagnostics-toolkit.js").CheckResult[] = [];
                  const result = isEphemeralPath(stateDir);
                  if (result.ephemeral) {
                    checks.push({
                      name: "doctor.ephemeral_state",
                      status: "warn",
                      detail: `State dir is on ephemeral storage: ${result.reason}`,
                    });
                  }
                  return checks;
                },
              },
              weeklyProbes: {
                checkBackupFreshness: () => {
                  const fs = require("node:fs");
                  const configPath =
                    require("../config/paths.js").resolveConfigPath?.(process.env) ??
                    "openclaw.json";
                  const bakPath = `${configPath}.bak`;
                  try {
                    if (!fs.existsSync(bakPath)) {
                      return {
                        name: "weekly.backup_freshness",
                        status: "warn" as const,
                        detail: `No config backup found at ${bakPath}`,
                      };
                    }
                    const stat = fs.statSync(bakPath);
                    const ageMs = Date.now() - stat.mtimeMs;
                    const ageDays = Math.round(ageMs / (24 * 60 * 60_000));
                    if (ageDays > 7) {
                      return {
                        name: "weekly.backup_freshness",
                        status: "warn" as const,
                        detail: `Config backup is ${ageDays} days old (${bakPath})`,
                      };
                    }
                    return {
                      name: "weekly.backup_freshness",
                      status: "pass" as const,
                      detail: `Config backup is ${ageDays} day(s) old`,
                    };
                  } catch {
                    return {
                      name: "weekly.backup_freshness",
                      status: "warn" as const,
                      detail: "Could not check backup freshness",
                    };
                  }
                },
                checkFilePermissions: () => {
                  const fs = require("node:fs");
                  const checks: import("./diagnostics-toolkit.js").CheckResult[] = [];
                  try {
                    const stat = fs.statSync(stateDir);
                    if (stat.uid === 0 && process.getuid?.() !== 0) {
                      checks.push({
                        name: "weekly.root_owned_state",
                        status: "warn" as const,
                        detail: `State directory ${stateDir} is owned by root — possible Docker residue`,
                      });
                    }
                  } catch {
                    // skip if we can't stat
                  }
                  return checks;
                },
              },
            });
          },
        )
        .then((report) => {
          if (!report.healthy) {
            diag.warn?.(
              `[health-sentinel] ${report.issues.length} issue(s), ` +
                `${report.remediations.length} remediation(s), ` +
                `escalated=${report.escalatedToAgent}`,
            );
          }
        })
        .catch((err) => {
          diag.debug(`health sentinel check failed: ${String(err)}`);
        });
    }

    for (const [, state] of diagnosticSessionStates) {
      const ageMs = now - state.lastActivity;
      if (state.state === "processing" && ageMs > stuckSessionWarnMs) {
        logSessionStuck({
          sessionId: state.sessionId,
          sessionKey: state.sessionKey,
          state: state.state,
          ageMs,
        });
      }
    }
  }, 30_000);
  heartbeatInterval.unref?.();
}

export function stopDiagnosticHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

export function getDiagnosticSessionStateCountForTest(): number {
  return getDiagnosticSessionStateCountForTestImpl();
}

export function resetDiagnosticStateForTest(): void {
  resetDiagnosticSessionStateForTest();
  webhookStats.received = 0;
  webhookStats.processed = 0;
  webhookStats.errors = 0;
  webhookStats.lastReceived = 0;
  lastActivityAt = 0;
  healthCheckCycleCount = 0;
  sentinelCycleCount = 0;
  stopDiagnosticHeartbeat();
}

export { diag as diagnosticLogger };
