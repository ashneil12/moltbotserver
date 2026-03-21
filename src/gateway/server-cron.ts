import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import type { CliDeps } from "../cli/deps.js";
import { createOutboundSendDeps } from "../cli/outbound-send-deps.js";
import { loadConfig } from "../config/config.js";
import {
  canonicalizeMainSessionAlias,
  resolveAgentIdFromSessionKey,
  resolveAgentMainSessionKey,
} from "../config/sessions.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import { resolveFailureDestination, sendFailureNotificationAnnounce } from "../cron/delivery.js";
import { startDiaryArchiveTimer, stopDiaryArchiveTimer } from "../cron/diary-archive.js";
import { runCronIsolatedAgentTurn } from "../cron/isolated-agent.js";
import { resolveDeliveryTarget } from "../cron/isolated-agent/delivery-target.js";
import { startPreIdleFlushTimer, stopPreIdleFlushTimer } from "../cron/pre-idle-flush.js";
import { startPreResetFlushTimer, stopPreResetFlushTimer } from "../cron/pre-reset-flush.js";
import {
  appendCronRunLog,
  resolveCronRunLogPath,
  resolveCronRunLogPruneOptions,
} from "../cron/run-log.js";
import { CronService } from "../cron/service.js";
import {
  registerSessionFlushCallback,
  unregisterSessionFlushCallback,
} from "../cron/session-flush-global.js";
import { resolveCronStorePath } from "../cron/store.js";
import { startTranscriptSweepTimer, stopTranscriptSweepTimer } from "../cron/transcript-sweep.js";
import { normalizeHttpWebhookUrl } from "../cron/webhook-url.js";
import { formatErrorMessage } from "../infra/errors.js";
import { runHeartbeatOnce } from "../infra/heartbeat-runner.js";
import { requestHeartbeatNow } from "../infra/heartbeat-wake.js";
import { fetchWithSsrFGuard } from "../infra/net/fetch-guard.js";
import { SsrFBlockedError } from "../infra/net/ssrf.js";
import { deliverOutboundPayloads } from "../infra/outbound/deliver.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import { getChildLogger } from "../logging.js";
import { normalizeAgentId, toAgentStoreSessionKey } from "../routing/session-key.js";
import { defaultRuntime } from "../runtime.js";
// Security audit scheduler disabled — see line 355
// import { startSecurityAuditScheduler } from "../security/scheduler.js";

export type GatewayCronState = {
  cron: CronService;
  storePath: string;
  cronEnabled: boolean;
  stopPreResetFlush: () => void;
  stopPreIdleFlush: () => void;
  stopSessionFlushCallback: () => void;
  stopDiaryArchive: () => void;
  stopTranscriptSweep: () => void;
};

const CRON_WEBHOOK_TIMEOUT_MS = 10_000;

function trimToOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function redactWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "<invalid-webhook-url>";
  }
}

type CronWebhookTarget = {
  url: string;
  source: "delivery" | "legacy";
};

function resolveCronWebhookTarget(params: {
  delivery?: { mode?: string; to?: string };
  legacyNotify?: boolean;
  legacyWebhook?: string;
}): CronWebhookTarget | null {
  const mode = params.delivery?.mode?.trim().toLowerCase();
  if (mode === "webhook") {
    const url = normalizeHttpWebhookUrl(params.delivery?.to);
    return url ? { url, source: "delivery" } : null;
  }

  if (params.legacyNotify) {
    const legacyUrl = normalizeHttpWebhookUrl(params.legacyWebhook);
    if (legacyUrl) {
      return { url: legacyUrl, source: "legacy" };
    }
  }

  return null;
}

function buildCronWebhookHeaders(webhookToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (webhookToken) {
    headers.Authorization = `Bearer ${webhookToken}`;
  }
  return headers;
}

async function postCronWebhook(params: {
  webhookUrl: string;
  webhookToken?: string;
  payload: unknown;
  logContext: Record<string, unknown>;
  blockedLog: string;
  failedLog: string;
  logger: ReturnType<typeof getChildLogger>;
}): Promise<void> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, CRON_WEBHOOK_TIMEOUT_MS);

  try {
    const result = await fetchWithSsrFGuard({
      url: params.webhookUrl,
      init: {
        method: "POST",
        headers: buildCronWebhookHeaders(params.webhookToken),
        body: JSON.stringify(params.payload),
        signal: abortController.signal,
      },
    });
    await result.release();
  } catch (err) {
    if (err instanceof SsrFBlockedError) {
      params.logger.warn(
        {
          ...params.logContext,
          reason: formatErrorMessage(err),
          webhookUrl: redactWebhookUrl(params.webhookUrl),
        },
        params.blockedLog,
      );
    } else {
      params.logger.warn(
        {
          ...params.logContext,
          err: formatErrorMessage(err),
          webhookUrl: redactWebhookUrl(params.webhookUrl),
        },
        params.failedLog,
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

export function buildGatewayCronService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): GatewayCronState {
  const cronLogger = getChildLogger({ module: "cron" });
  const storePath = resolveCronStorePath(params.cfg.cron?.store);
  const cronEnabled = process.env.OPENCLAW_SKIP_CRON !== "1" && params.cfg.cron?.enabled !== false;

  const resolveCronAgent = (requested?: string | null) => {
    const runtimeConfig = loadConfig();
    const normalized =
      typeof requested === "string" && requested.trim() ? normalizeAgentId(requested) : undefined;
    const hasAgent =
      normalized !== undefined &&
      Array.isArray(runtimeConfig.agents?.list) &&
      runtimeConfig.agents.list.some(
        (entry) =>
          entry && typeof entry.id === "string" && normalizeAgentId(entry.id) === normalized,
      );
    const agentId = hasAgent ? normalized : resolveDefaultAgentId(runtimeConfig);
    return { agentId, cfg: runtimeConfig };
  };

  const resolveCronSessionKey = (params: {
    runtimeConfig: ReturnType<typeof loadConfig>;
    agentId: string;
    requestedSessionKey?: string | null;
  }) => {
    const requested = params.requestedSessionKey?.trim();
    if (!requested) {
      return resolveAgentMainSessionKey({
        cfg: params.runtimeConfig,
        agentId: params.agentId,
      });
    }
    const candidate = toAgentStoreSessionKey({
      agentId: params.agentId,
      requestKey: requested,
      mainKey: params.runtimeConfig.session?.mainKey,
    });
    const canonical = canonicalizeMainSessionAlias({
      cfg: params.runtimeConfig,
      agentId: params.agentId,
      sessionKey: candidate,
    });
    if (canonical !== "global") {
      const sessionAgentId = resolveAgentIdFromSessionKey(canonical);
      if (normalizeAgentId(sessionAgentId) !== normalizeAgentId(params.agentId)) {
        return resolveAgentMainSessionKey({
          cfg: params.runtimeConfig,
          agentId: params.agentId,
        });
      }
    }
    return canonical;
  };

  const resolveCronWakeTarget = (opts?: { agentId?: string; sessionKey?: string | null }) => {
    const runtimeConfig = loadConfig();
    const requestedAgentId = opts?.agentId ? resolveCronAgent(opts.agentId).agentId : undefined;
    const derivedAgentId =
      requestedAgentId ??
      (opts?.sessionKey
        ? normalizeAgentId(resolveAgentIdFromSessionKey(opts.sessionKey))
        : undefined);
    const agentId = derivedAgentId || undefined;
    const sessionKey =
      opts?.sessionKey && agentId
        ? resolveCronSessionKey({
            runtimeConfig,
            agentId,
            requestedSessionKey: opts.sessionKey,
          })
        : undefined;
    return { runtimeConfig, agentId, sessionKey };
  };

  const defaultAgentId = resolveDefaultAgentId(params.cfg);
  const runLogPrune = resolveCronRunLogPruneOptions(params.cfg.cron?.runLog);
  const resolveSessionStorePath = (agentId?: string) =>
    resolveStorePath(params.cfg.session?.store, {
      agentId: agentId ?? defaultAgentId,
    });
  const sessionStorePath = resolveSessionStorePath(defaultAgentId);
  const warnedLegacyWebhookJobs = new Set<string>();

  const cron = new CronService({
    storePath,
    cronEnabled,
    cronConfig: params.cfg.cron,
    defaultAgentId,
    resolveSessionStorePath,
    sessionStorePath,
    enqueueSystemEvent: (text, opts) => {
      const { agentId, cfg: runtimeConfig } = resolveCronAgent(opts?.agentId);
      const sessionKey = resolveCronSessionKey({
        runtimeConfig,
        agentId,
        requestedSessionKey: opts?.sessionKey,
      });
      enqueueSystemEvent(text, { sessionKey, contextKey: opts?.contextKey });
    },
    requestHeartbeatNow: (opts) => {
      const { agentId, sessionKey } = resolveCronWakeTarget(opts);
      requestHeartbeatNow({
        reason: opts?.reason,
        agentId,
        sessionKey,
      });
    },
    runHeartbeatOnce: async (opts) => {
      const { runtimeConfig, agentId, sessionKey } = resolveCronWakeTarget(opts);
      // Merge cron-supplied heartbeat overrides (e.g. target: "last") with the
      // fully resolved agent heartbeat config so cron-triggered heartbeats
      // respect agent-specific overrides (agents.list[].heartbeat) before
      // falling back to agents.defaults.heartbeat.
      const agentEntry =
        Array.isArray(runtimeConfig.agents?.list) &&
        runtimeConfig.agents.list.find(
          (entry) =>
            entry && typeof entry.id === "string" && normalizeAgentId(entry.id) === agentId,
        );
      const agentHeartbeat =
        agentEntry && typeof agentEntry === "object" ? agentEntry.heartbeat : undefined;
      const baseHeartbeat = {
        ...runtimeConfig.agents?.defaults?.heartbeat,
        ...agentHeartbeat,
      };
      const heartbeatOverride = opts?.heartbeat
        ? { ...baseHeartbeat, ...opts.heartbeat }
        : undefined;
      return await runHeartbeatOnce({
        cfg: runtimeConfig,
        reason: opts?.reason,
        agentId,
        sessionKey,
        heartbeat: heartbeatOverride,
        deps: { ...params.deps, runtime: defaultRuntime },
      });
    },
    runIsolatedAgentJob: async ({ job, message, abortSignal }) => {
      const { agentId, cfg: runtimeConfig } = resolveCronAgent(job.agentId);
      let sessionKey = `cron:${job.id}`;
      if (job.sessionTarget.startsWith("session:")) {
        const customSessionId = job.sessionTarget.slice(8).trim();
        if (customSessionId) {
          sessionKey = customSessionId;
        }
      }
      return await runCronIsolatedAgentTurn({
        cfg: runtimeConfig,
        deps: params.deps,
        job,
        message,
        abortSignal,
        agentId,
        sessionKey,
        lane: "cron",
      });
    },
    sendCronFailureAlert: async ({ job, text, channel, to, mode, accountId }) => {
      const { agentId, cfg: runtimeConfig } = resolveCronAgent(job.agentId);
      const webhookToken = trimToOptionalString(params.cfg.cron?.webhookToken);

      // Webhook mode requires a URL - fail closed if missing
      if (mode === "webhook" && !to) {
        cronLogger.warn(
          { jobId: job.id },
          "cron: failure alert webhook mode requires URL, skipping",
        );
        return;
      }

      if (mode === "webhook" && to) {
        const webhookUrl = normalizeHttpWebhookUrl(to);
        if (webhookUrl) {
          await postCronWebhook({
            webhookUrl,
            webhookToken,
            payload: {
              jobId: job.id,
              jobName: job.name,
              message: text,
            },
            logContext: { jobId: job.id },
            blockedLog: "cron: failure alert webhook blocked by SSRF guard",
            failedLog: "cron: failure alert webhook failed",
            logger: cronLogger,
          });
        } else {
          cronLogger.warn(
            {
              jobId: job.id,
              webhookUrl: redactWebhookUrl(to),
            },
            "cron: failure alert webhook URL is invalid, skipping",
          );
        }
        return;
      }

      const target = await resolveDeliveryTarget(runtimeConfig, agentId, {
        channel,
        to,
        accountId,
      });
      if (!target.ok) {
        throw target.error;
      }
      await deliverOutboundPayloads({
        cfg: runtimeConfig,
        channel: target.channel,
        to: target.to,
        accountId: target.accountId,
        threadId: target.threadId,
        payloads: [{ text }],
        deps: createOutboundSendDeps(params.deps),
      });
    },
    log: getChildLogger({ module: "cron", storePath }),
    onEvent: (evt) => {
      params.broadcast("cron", evt, { dropIfSlow: true });
      if (evt.action === "finished") {
        const webhookToken = trimToOptionalString(params.cfg.cron?.webhookToken);
        const legacyWebhook = trimToOptionalString(params.cfg.cron?.webhook);
        const job = cron.getJob(evt.jobId);
        const legacyNotify = (job as { notify?: unknown } | undefined)?.notify === true;
        const webhookTarget = resolveCronWebhookTarget({
          delivery:
            job?.delivery && typeof job.delivery.mode === "string"
              ? { mode: job.delivery.mode, to: job.delivery.to }
              : undefined,
          legacyNotify,
          legacyWebhook,
        });

        if (!webhookTarget && job?.delivery?.mode === "webhook") {
          cronLogger.warn(
            {
              jobId: evt.jobId,
              deliveryTo: job.delivery.to,
            },
            "cron: skipped webhook delivery, delivery.to must be a valid http(s) URL",
          );
        }

        if (webhookTarget?.source === "legacy" && !warnedLegacyWebhookJobs.has(evt.jobId)) {
          warnedLegacyWebhookJobs.add(evt.jobId);
          cronLogger.warn(
            {
              jobId: evt.jobId,
              legacyWebhook: redactWebhookUrl(webhookTarget.url),
            },
            "cron: deprecated notify+cron.webhook fallback in use, migrate to delivery.mode=webhook with delivery.to",
          );
        }

        if (webhookTarget && evt.summary) {
          void (async () => {
            await postCronWebhook({
              webhookUrl: webhookTarget.url,
              webhookToken,
              payload: evt,
              logContext: { jobId: evt.jobId },
              blockedLog: "cron: webhook delivery blocked by SSRF guard",
              failedLog: "cron: webhook delivery failed",
              logger: cronLogger,
            });
          })();
        }

        if (evt.status === "error" && job) {
          const failureDest = resolveFailureDestination(job, params.cfg.cron?.failureDestination);
          if (failureDest) {
            const isBestEffort =
              job.delivery?.bestEffort === true ||
              (job.payload.kind === "agentTurn" && job.payload.bestEffortDeliver === true);

            if (!isBestEffort) {
              const failureMessage = `Cron job "${job.name}" failed: ${evt.error ?? "unknown error"}`;
              const failurePayload = {
                jobId: job.id,
                jobName: job.name,
                message: failureMessage,
                status: evt.status,
                error: evt.error,
                runAtMs: evt.runAtMs,
                durationMs: evt.durationMs,
                nextRunAtMs: evt.nextRunAtMs,
              };

              if (failureDest.mode === "webhook" && failureDest.to) {
                const webhookUrl = normalizeHttpWebhookUrl(failureDest.to);
                if (webhookUrl) {
                  void (async () => {
                    await postCronWebhook({
                      webhookUrl,
                      webhookToken,
                      payload: failurePayload,
                      logContext: { jobId: evt.jobId },
                      blockedLog: "cron: failure destination webhook blocked by SSRF guard",
                      failedLog: "cron: failure destination webhook failed",
                      logger: cronLogger,
                    });
                  })();
                } else {
                  cronLogger.warn(
                    {
                      jobId: evt.jobId,
                      webhookUrl: redactWebhookUrl(failureDest.to),
                    },
                    "cron: failure destination webhook URL is invalid, skipping",
                  );
                }
              } else if (failureDest.mode === "announce") {
                const { agentId, cfg: runtimeConfig } = resolveCronAgent(job.agentId);
                void sendFailureNotificationAnnounce(
                  params.deps,
                  runtimeConfig,
                  agentId,
                  job.id,
                  {
                    channel: failureDest.channel,
                    to: failureDest.to,
                    accountId: failureDest.accountId,
                  },
                  `[Cron Failure] ${failureMessage}`,
                );
              }
            }
          }
        }

        const logPath = resolveCronRunLogPath({
          storePath,
          jobId: evt.jobId,
        });
        void appendCronRunLog(
          logPath,
          {
            ts: Date.now(),
            jobId: evt.jobId,
            action: "finished",
            status: evt.status,
            error: evt.error,
            summary: evt.summary,
            delivered: evt.delivered,
            deliveryStatus: evt.deliveryStatus,
            deliveryError: evt.deliveryError,
            sessionId: evt.sessionId,
            sessionKey: evt.sessionKey,
            runAtMs: evt.runAtMs,
            durationMs: evt.durationMs,
            nextRunAtMs: evt.nextRunAtMs,
            model: evt.model,
            provider: evt.provider,
            usage: evt.usage,
          },
          runLogPrune,
        ).catch((err) => {
          cronLogger.warn({ err: String(err), logPath }, "cron: run log append failed");
        });
      }
    },
  });

  // Start auxiliary timers alongside the CronService.
  const resetAtHour = params.cfg.session?.reset?.atHour;
  startPreResetFlushTimer({
    cfg: params.cfg,
    resolveSessionStorePath,
    resetAtHour: typeof resetAtHour === "number" ? resetAtHour : undefined,
    runIsolatedAgentJob: async ({ job, message }) => {
      const { agentId, cfg: runtimeConfig } = resolveCronAgent(job.agentId);
      return await runCronIsolatedAgentTurn({
        cfg: runtimeConfig,
        deps: params.deps,
        job,
        message,
        abortSignal: undefined,
        agentId,
        sessionKey: `cron:${job.id}`,
        lane: "cron",
      });
    },
    log: cronLogger,
  });

  startPreIdleFlushTimer({
    cfg: params.cfg,
    resolveSessionStorePath,
    runIsolatedAgentJob: async ({ job, message }) => {
      const { agentId, cfg: runtimeConfig } = resolveCronAgent(job.agentId);
      return await runCronIsolatedAgentTurn({
        cfg: runtimeConfig,
        deps: params.deps,
        job,
        message,
        abortSignal: undefined,
        agentId,
        sessionKey: `cron:${job.id}`,
        lane: "cron",
      });
    },
    log: cronLogger,
  });

  startDiaryArchiveTimer({ cfg: params.cfg });
  startTranscriptSweepTimer({ cfg: params.cfg });

  // Register the global session flush callback so session.ts can trigger
  // fire-and-forget memory flush turns on /new and /reset.
  registerSessionFlushCallback(async (request) => {
    const { agentId: resolvedAgentId, cfg: runtimeConfig } = resolveCronAgent(request.agentId);
    const now = Date.now();
    const syntheticJob = {
      id: `__session-flush:${request.sessionKey}`,
      agentId: resolvedAgentId,
      name: "Session reset memory flush",
      description: `Memory flush before session reset (${request.reason})`,
      enabled: true,
      deleteAfterRun: true,
      createdAtMs: now,
      updatedAtMs: now,
      sessionKey: request.sessionKey,
      schedule: { kind: "at" as const, at: new Date(now).toISOString() },
      sessionTarget: "main" as const,
      wakeMode: "now" as const,
      payload: {
        kind: "agentTurn" as const,
        message: [
          "Session reset memory flush.",
          `The user triggered a session reset (${request.reason}) — store any durable memories now.`,
          "",
          "## 1. Daily memory log",
          "Write to memory/YYYY-MM-DD.md; create memory/ if needed.",
          "IMPORTANT: If the file already exists, APPEND new content only — do not overwrite existing entries.",
          "Include a ### Seemingly Insignificant / Minor Notes section for small details, asides,",
          "offhand mentions, or anything that didn't feel important at the time.",
          "These often turn out to matter later. Better to write it down than lose it.",
          "",
          `If nothing to store, reply with ${SILENT_REPLY_TOKEN}.`,
        ].join("\n"),
        deliver: false,
      },
      state: {},
    };
    await runCronIsolatedAgentTurn({
      cfg: runtimeConfig,
      deps: params.deps,
      job: syntheticJob,
      message: syntheticJob.payload.message,
      abortSignal: undefined,
      agentId: resolvedAgentId,
      sessionKey: `cron:${syntheticJob.id}`,
      lane: "cron",
    });
  });
  // Security audit scheduler disabled — produces false positives on SaaS/Docker deployments
  // startSecurityAuditScheduler({ cfg: params.cfg, deps: params.deps });

  return {
    cron,
    storePath,
    cronEnabled,
    stopPreResetFlush: stopPreResetFlushTimer,
    stopPreIdleFlush: stopPreIdleFlushTimer,
    stopSessionFlushCallback: unregisterSessionFlushCallback,
    stopDiaryArchive: stopDiaryArchiveTimer,
    stopTranscriptSweep: stopTranscriptSweepTimer,
  };
}
