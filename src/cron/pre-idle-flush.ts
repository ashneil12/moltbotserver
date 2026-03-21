/**
 * Pre-idle-reset memory flush — runs a memory flush agent turn on all active
 * human sessions that are approaching their idle timeout so the agent can
 * persist durable memories before the context is discarded.
 *
 * This mirrors the daily pre-reset flush (pre-reset-flush.ts) but operates on
 * a periodic sweep interval (default: every 10 minutes) instead of once daily.
 *
 * Only human-interactive sessions (direct, group, thread) are eligible.
 * System sessions (cron, hooks, heartbeat, synthetic flush) are skipped.
 */

import { listAgentIds } from "../agents/agent-scope.js";
import type { OpenClawConfig } from "../config/config.js";
import {
  loadSessionStore,
  updateSessionStoreEntry,
  type SessionEntry,
} from "../config/sessions.js";
import {
  resolveSessionResetPolicy,
  resolveSessionResetType,
  resolveChannelResetConfig,
  isThreadSessionKey,
} from "../config/sessions/reset.js";
import { buildFlushPrompt } from "./flush-prompt.js";
import type { RunCronAgentTurnResult } from "./isolated-agent.js";
import { MAX_FLUSH_PER_SWEEP, MIN_FLUSH_TOKENS } from "./pre-reset-flush.js";
import type { CronJob } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default sweep interval in milliseconds (10 minutes). */
export const DEFAULT_IDLE_SWEEP_INTERVAL_MS = 10 * 60_000;

/**
 * Fraction of idleMinutes that must have elapsed before a session becomes
 * eligible for the pre-idle flush. E.g. 0.8 means the flush fires after
 * 80% of the idle window has passed (48 min of a 60-min idle timeout).
 */
export const IDLE_FLUSH_THRESHOLD = 0.8;

const PRE_IDLE_FLUSH_PROMPT = buildFlushPrompt(
  "Pre-idle-reset memory flush.\n" +
    "This session is about to expire due to inactivity — store any durable memories now.",
);

// ---------------------------------------------------------------------------
// Session key patterns that indicate non-human sessions
// ---------------------------------------------------------------------------

const SYSTEM_SESSION_MARKERS = [
  ":cron:",
  ":run:",
  ":hook:",
  "heartbeat",
  "__pre-reset-flush:",
  "__pre-idle-flush:",
] as const;

const HUMAN_CHAT_TYPES = new Set(["direct", "group", "channel"]);

// ---------------------------------------------------------------------------
// Human session gate
// ---------------------------------------------------------------------------

/**
 * Determine whether a session key + entry represents a human-interactive
 * session. Only human sessions should be eligible for pre-idle flushing.
 *
 * Rejects all system/automated session keys (cron, hooks, heartbeat,
 * synthetic flush sessions) and sessions that were never interacted with
 * by a human (no chatType set).
 */
export function isHumanSession(sessionKey: string, entry: SessionEntry): boolean {
  const normalized = sessionKey.toLowerCase();

  // Reject any session key containing system markers
  for (const marker of SYSTEM_SESSION_MARKERS) {
    if (normalized.includes(marker)) {
      return false;
    }
  }

  // Must have a chatType indicating human origin, or be a thread session
  // (threads use session key markers like :thread:/:topic:, not chatType)
  const chatType = entry.chatType;
  const isThread = isThreadSessionKey(sessionKey);
  if (!isThread && (!chatType || !HUMAN_CHAT_TYPES.has(chatType))) {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Idle flush eligibility
// ---------------------------------------------------------------------------

/**
 * Determine whether a human session is approaching its idle timeout and
 * should receive a pre-idle flush.
 *
 * A session is eligible when:
 * 1. It is a human session (passes isHumanSession)
 * 2. It has meaningful context (totalTokens ≥ MIN_FLUSH_TOKENS)
 * 3. It is configured with idle reset mode (has idleMinutes)
 * 4. It has been idle for ≥ IDLE_FLUSH_THRESHOLD of its idleMinutes
 * 5. It hasn't already been flushed since last activity
 */
export function isEligibleForPreIdleFlush(params: {
  sessionKey: string;
  entry: SessionEntry;
  nowMs: number;
  idleMinutes: number | undefined;
}): boolean {
  const { sessionKey, entry, nowMs, idleMinutes } = params;

  // Gate: must be a human session
  if (!isHumanSession(sessionKey, entry)) {
    return false;
  }

  // Must have meaningful context
  const totalTokens = entry.totalTokens;
  if (typeof totalTokens !== "number" || totalTokens < MIN_FLUSH_TOKENS) {
    return false;
  }

  // Must have an idle timeout configured
  if (typeof idleMinutes !== "number" || idleMinutes <= 0) {
    return false;
  }

  // Must have been idle long enough (approaching the timeout)
  const idleMs = nowMs - entry.updatedAt;
  const thresholdMs = idleMinutes * 60_000 * IDLE_FLUSH_THRESHOLD;
  if (idleMs < thresholdMs) {
    return false;
  }

  // Must not have already expired (already past the idle timeout)
  const expiryMs = idleMinutes * 60_000;
  if (idleMs >= expiryMs) {
    return false;
  }

  // Skip if already flushed since last activity
  const lastFlush = entry.preResetFlushAt;
  if (typeof lastFlush === "number" && lastFlush >= entry.updatedAt) {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Sweep logic
// ---------------------------------------------------------------------------

export type PreIdleFlushResult = {
  flushed: number;
  skipped: number;
  errors: number;
  scanned: number;
};

export type PreIdleFlushDeps = {
  cfg: OpenClawConfig;
  resolveSessionStorePath: (agentId: string) => string;
  runIsolatedAgentJob: (params: {
    job: CronJob;
    message: string;
  }) => Promise<RunCronAgentTurnResult>;
  log: {
    info: (obj: Record<string, unknown>, msg: string) => void;
    warn: (obj: Record<string, unknown>, msg: string) => void;
  };
};

/**
 * Sweep all agent session stores and run pre-idle memory flush turns
 * on human sessions approaching their idle timeout.
 */
export async function runPreIdleFlushSweep(deps: PreIdleFlushDeps): Promise<PreIdleFlushResult> {
  const nowMs = Date.now();
  const agentIds = listAgentIds(deps.cfg);
  const sessionCfg = deps.cfg.session;
  const eligible: Array<{
    agentId: string;
    key: string;
    entry: SessionEntry;
    storePath: string;
    idleMinutes: number;
  }> = [];
  let scanned = 0;

  for (const agentId of agentIds) {
    const storePath = deps.resolveSessionStorePath(agentId);
    let store: Record<string, SessionEntry>;
    try {
      store = loadSessionStore(storePath, { skipCache: true });
    } catch {
      // Store doesn't exist yet for this agent — skip
      continue;
    }

    for (const [key, entry] of Object.entries(store)) {
      if (!entry) {
        continue;
      }
      scanned++;

      // Resolve the session's reset policy to get its idle timeout
      const isThread = isThreadSessionKey(key);
      const resetType = resolveSessionResetType({
        sessionKey: key,
        isGroup: entry.chatType === "group",
        isThread,
      });
      const channelReset = resolveChannelResetConfig({
        sessionCfg,
        channel: entry.lastChannel ?? entry.channel,
      });
      const policy = resolveSessionResetPolicy({
        sessionCfg,
        resetType,
        resetOverride: channelReset,
      });

      if (
        isEligibleForPreIdleFlush({
          sessionKey: key,
          entry,
          nowMs,
          idleMinutes: policy.idleMinutes,
        })
      ) {
        eligible.push({
          agentId,
          key,
          entry,
          storePath,
          idleMinutes: policy.idleMinutes!,
        });
      }
    }
  }

  if (eligible.length === 0) {
    deps.log.info({ agents: agentIds.length, scanned }, "pre-idle-flush: no eligible sessions");
    return { flushed: 0, skipped: 0, errors: 0, scanned };
  }

  // Sort by closest to expiry first (most urgent flush first)
  eligible.sort((a, b) => {
    const aRemaining = a.entry.updatedAt + a.idleMinutes * 60_000 - nowMs;
    const bRemaining = b.entry.updatedAt + b.idleMinutes * 60_000 - nowMs;
    return aRemaining - bRemaining;
  });

  // Cap to prevent runaway usage
  const toFlush = eligible.slice(0, MAX_FLUSH_PER_SWEEP);
  const skipped = eligible.length - toFlush.length;

  deps.log.info(
    {
      eligible: eligible.length,
      flushing: toFlush.length,
      skipped,
      agents: agentIds.length,
      scanned,
    },
    `pre-idle-flush: starting sweep for ${toFlush.length} session(s) across ${agentIds.length} agent(s)`,
  );

  let flushed = 0;
  let errors = 0;

  for (const { agentId, key, entry, storePath, idleMinutes: idleMins } of toFlush) {
    try {
      const syntheticJob = buildPreIdleFlushJob(key, agentId);
      await deps.runIsolatedAgentJob({
        job: syntheticJob,
        message: PRE_IDLE_FLUSH_PROMPT,
      });

      // Mark session as flushed
      try {
        await updateSessionStoreEntry({
          storePath,
          sessionKey: key,
          update: async () => ({ preResetFlushAt: Date.now() }),
        });
      } catch {
        // Best-effort metadata update
      }

      flushed++;
      deps.log.info(
        { agentId, sessionKey: key, tokens: entry.totalTokens, idleMinutes: idleMins },
        `pre-idle-flush: flushed session ${key} (agent: ${agentId})`,
      );
    } catch (err) {
      errors++;
      deps.log.warn(
        { agentId, sessionKey: key, err: String(err) },
        `pre-idle-flush: failed to flush session ${key} (agent: ${agentId})`,
      );
    }
  }

  deps.log.info(
    { flushed, skipped, errors, agents: agentIds.length, scanned },
    `pre-idle-flush: sweep complete — flushed=${flushed} skipped=${skipped} errors=${errors}`,
  );

  return { flushed, skipped, errors, scanned };
}

// ---------------------------------------------------------------------------
// Synthetic job builder
// ---------------------------------------------------------------------------

function buildPreIdleFlushJob(sessionKey: string, agentId: string): CronJob {
  const now = Date.now();
  return {
    id: `__pre-idle-flush:${sessionKey}`,
    agentId,
    name: "Pre-idle memory flush",
    description: "Automated pre-idle memory flush before session idle expiry",
    enabled: true,
    deleteAfterRun: true,
    createdAtMs: now,
    updatedAtMs: now,
    sessionKey,
    schedule: { kind: "at", at: new Date(now).toISOString() },
    sessionTarget: "main",
    wakeMode: "now",
    payload: {
      kind: "agentTurn",
      message: PRE_IDLE_FLUSH_PROMPT,
      deliver: false,
    },
    state: {},
  };
}

// ---------------------------------------------------------------------------
// Timer lifecycle
// ---------------------------------------------------------------------------

let activeInterval: ReturnType<typeof setInterval> | null = null;

export type PreIdleFlushTimerDeps = PreIdleFlushDeps & {
  /** Sweep interval in milliseconds (default: 10 minutes). */
  sweepIntervalMs?: number;
};

/**
 * Start the pre-idle flush sweep timer. Runs periodically at the configured
 * interval (default: every 10 minutes) to check for sessions approaching
 * their idle timeout.
 *
 * Safe to call multiple times — stops any existing timer first.
 */
export function startPreIdleFlushTimer(deps: PreIdleFlushTimerDeps): void {
  stopPreIdleFlushTimer();

  const intervalMs = deps.sweepIntervalMs ?? DEFAULT_IDLE_SWEEP_INTERVAL_MS;

  activeInterval = setInterval(() => {
    deps.log.info({}, "pre-idle-flush: sweep timer firing");
    void runPreIdleFlushSweep(deps).catch((err) => {
      deps.log.warn({ err: String(err) }, "pre-idle-flush: sweep failed unexpectedly");
    });
  }, intervalMs);

  // Unref so the timer doesn't prevent process exit
  if (activeInterval && typeof activeInterval === "object" && "unref" in activeInterval) {
    activeInterval.unref();
  }

  const intervalMinutes = Math.round(intervalMs / 60_000);
  deps.log.info(
    { intervalMs, intervalMinutes },
    `pre-idle-flush: timer started — sweeping every ${intervalMinutes} minute(s)`,
  );
}

/**
 * Stop the pre-idle flush timer.
 */
export function stopPreIdleFlushTimer(): void {
  if (activeInterval !== null) {
    clearInterval(activeInterval);
    activeInterval = null;
  }
}
