/**
 * Global session memory flush callback.
 *
 * Bridges the gap between the session init path (auto-reply/reply/session.ts)
 * and the cron infrastructure (cron/pre-reset-flush.ts). The session init path
 * detects /new and /reset triggers but doesn't have access to the cron deps
 * needed to run an isolated agent turn. This module provides a global callback
 * that server-cron.ts registers at startup and session.ts invokes fire-and-forget.
 *
 * Uses the same Symbol.for global singleton pattern as hook-runner-global.ts.
 */

import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("session-flush");

export type SessionFlushRequest = {
  /** The session key to flush (the OLD key, before reset). */
  sessionKey: string;
  /** The agent ID owning the session. */
  agentId: string;
  /** Reason for the flush (for logging). */
  reason: "reset-trigger" | "idle" | "daily";
};

export type SessionFlushCallback = (request: SessionFlushRequest) => Promise<void>;

const globalStateKey = Symbol.for("openclaw.session-flush-callback");

type GlobalFlushState = {
  callback: SessionFlushCallback | null;
};

function getGlobalState(): GlobalFlushState {
  const globalStore = globalThis as typeof globalThis & {
    [globalStateKey]?: GlobalFlushState;
  };
  return (globalStore[globalStateKey] ??= { callback: null });
}

/**
 * Register the global session flush callback.
 * Called once during gateway startup from server-cron.ts.
 */
export function registerSessionFlushCallback(cb: SessionFlushCallback): void {
  getGlobalState().callback = cb;
  log.info("session flush callback registered");
}

/**
 * Unregister the global session flush callback.
 * Called during gateway shutdown or for testing.
 */
export function unregisterSessionFlushCallback(): void {
  getGlobalState().callback = null;
}

/**
 * Request a fire-and-forget memory flush for a session.
 * Returns immediately — the flush runs asynchronously in the background.
 *
 * Safe to call even if no callback is registered (silently no-ops).
 * Safe to call multiple times — deduplication is handled by the
 * preResetFlushAt guard in the flush implementation.
 */
export function requestSessionFlush(request: SessionFlushRequest): void {
  const cb = getGlobalState().callback;
  if (!cb) {
    log.debug("session flush requested but no callback registered", {
      sessionKey: request.sessionKey,
      reason: request.reason,
    });
    return;
  }

  log.info("session flush requested", {
    sessionKey: request.sessionKey,
    agentId: request.agentId,
    reason: request.reason,
  });

  // Fire-and-forget — don't block the caller
  void cb(request).catch((err) => {
    log.warn("session flush failed", {
      sessionKey: request.sessionKey,
      agentId: request.agentId,
      err: String(err),
    });
  });
}
