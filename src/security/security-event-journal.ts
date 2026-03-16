/**
 * Security Event Journal — lightweight append-only log for security events.
 *
 * Logs security-relevant events (secret redactions, injection detections,
 * quarantines) to the structured event log for observability. Never blocks
 * the caller — all errors are swallowed.
 *
 * This is the "observe" half of the AgentGuard philosophy:
 * observe and redact, never restrict.
 */

import { logWarn } from "../logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SecurityEventType =
  | "secret_redacted"
  | "content_quarantined"
  | "injection_detected"
  | "audit_finding";

export interface SecurityEvent {
  /** What kind of security event */
  type: SecurityEventType;
  /** Which secret/injection patterns were detected */
  patterns?: string[];
  /** Where the event originated (e.g. "normalize-reply", "web-fetch") */
  source?: string;
  /** Additional context */
  detail?: string;
  /** Extra structured data */
  extra?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Eager singleton (mirrors scan-and-log.ts pattern)
// ---------------------------------------------------------------------------

let _cachedLogger: import("../logging/event-log.js").EventLogger | null = null;
let _loggerInitPromise: Promise<void> | null = null;

function initSecurityEventLogger(): void {
  if (_cachedLogger || _loggerInitPromise) {
    return;
  }
  _loggerInitPromise = import("../logging/event-log.js")
    .then(({ createEventLogger }) => {
      _cachedLogger = createEventLogger({});
    })
    .catch(() => {
      _loggerInitPromise = null;
    });
}

// Kick off import eagerly at module load time
initSecurityEventLogger();

function getSecurityEventLogger(): import("../logging/event-log.js").EventLogger | null {
  if (!_cachedLogger) {
    initSecurityEventLogger();
  }
  return _cachedLogger;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Log a security event to the structured event journal.
 *
 * Fire-and-forget — never throws, never blocks the caller.
 * Events go to `security.<type>.jsonl` and the unified `all.jsonl`.
 */
export function logSecurityEvent(event: SecurityEvent): void {
  try {
    // Warn-level log for immediate visibility in console
    if (event.type === "secret_redacted") {
      logWarn(
        `[agentguard] Secret redacted in output (patterns=${event.patterns?.join(", ") ?? "unknown"}, source=${event.source ?? "unknown"})`,
      );
    }

    const logger = getSecurityEventLogger();
    if (!logger) {
      return;
    }

    logger.log({
      event: `security.${event.type}`,
      level: event.type === "secret_redacted" ? "warn" : "info",
      data: {
        patterns: event.patterns ?? [],
        source: event.source ?? "unknown",
        detail: event.detail,
        ...event.extra,
      },
      subsystem: "agentguard",
    });
  } catch {
    // Security logging must never block operations
  }
}

/**
 * Query recent security events from the journal.
 *
 * Returns empty array if the logger isn't available yet.
 */
export function querySecurityEvents(options?: {
  type?: SecurityEventType;
  since?: Date;
  limit?: number;
}): Array<import("../logging/event-log.js").StoredEventEntry> {
  try {
    const logger = getSecurityEventLogger();
    if (!logger) {
      return [];
    }
    return logger.query({
      event: options?.type ? `security.${options.type}` : "security.",
      since: options?.since,
      limit: options?.limit ?? 100,
    });
  } catch {
    return [];
  }
}

/** Reset the cached logger (for testing). */
export function resetSecurityEventJournalForTest(): void {
  _cachedLogger = null;
  _loggerInitPromise = null;
}
