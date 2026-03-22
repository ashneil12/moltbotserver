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
import { LazyEventLogger } from "./lazy-event-logger.js";

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
// Shared singleton (eager import at module load time)
// ---------------------------------------------------------------------------

const securityLogger = new LazyEventLogger();

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

    const logger = securityLogger.get();
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
    const logger = securityLogger.get();
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
  securityLogger.resetForTest();
}
