/**
 * Shared helper that combines content scanning with event logging.
 *
 * Used by web-fetch, browser-tool, and cron run pipeline to avoid
 * duplicating the scan → log → warn pattern in every integration point.
 */

import { logWarn } from "../logger.js";
import { scanContentSync, type ScanResult } from "./content-scanner.js";
import type { ExternalContentSource } from "./external-content.js";

// ---------------------------------------------------------------------------
// Eager singleton event logger — starts import at module load time so the
// logger is ready before the first scan (modules load well before first HTTP
// request). Previous lazy approach dropped the first security event.
// ---------------------------------------------------------------------------

let _cachedLogger: import("../logging/event-log.js").EventLogger | null = null;
let _loggerInitPromise: Promise<void> | null = null;

function initSharedEventLogger(): void {
  if (_cachedLogger || _loggerInitPromise) {
    return;
  }
  _loggerInitPromise = import("../logging/event-log.js")
    .then(({ createEventLogger }) => {
      _cachedLogger = createEventLogger({});
    })
    .catch(() => {
      // Allow retry on next call
      _loggerInitPromise = null;
    });
}

// Kick off import eagerly at module load time
initSharedEventLogger();

function getSharedEventLogger(): import("../logging/event-log.js").EventLogger | null {
  if (!_cachedLogger) {
    initSharedEventLogger();
  }
  return _cachedLogger;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScanAndLogOptions {
  /** Content source type (used in scan metadata and event logging) */
  source: ExternalContentSource;
  /** Sender identifier for the scan (optional) */
  sender?: string;
  /** Event name for the event log entry */
  eventName?: string;
  /** Extra data to include in the event log entry */
  extraData?: Record<string, unknown>;
  /**
   * When true, suppress the generic `[security] Content QUARANTINED` logWarn.
   * The caller is responsible for logging the quarantine event itself.
   * Useful for first-party files (e.g. SOUL.md) that legitimately contain
   * patterns matching scanner rules.
   */
  suppressQuarantineLog?: boolean;
}

export type ScanAndLogResult = Omit<ScanResult, "frontierResult">;

/**
 * Scan content for threats and log findings to the event logger.
 *
 * - Runs synchronous deterministic scan (no async / no frontier model).
 * - Logs quarantine warnings to the application logger.
 * - Logs structured events when findings are detected.
 * - Never throws — all errors are caught and suppressed.
 *
 * Returns the scan result, or null if scanning itself failed.
 */
export function scanAndLog(content: string, options: ScanAndLogOptions): ScanAndLogResult | null {
  try {
    const result = scanContentSync(content, {
      source: options.source,
      sender: options.sender,
    });

    if (result.quarantined && !options.suppressQuarantineLog) {
      logWarn(
        `[security] Content QUARANTINED (source=${options.source}, ` +
          `riskScore=${result.riskScore}, ` +
          `findings=${result.findings.map((f) => f.pattern).join(", ")})`,
      );
    }

    // Only log an event if there were actual findings (avoid noise)
    if (result.findings.length > 0) {
      try {
        const logger = getSharedEventLogger();
        if (!logger) {
          // Logger not yet initialized (first call, dynamic import pending)
          return result;
        }
        logger.log({
          event: options.eventName ?? `security.${options.source}_scan`,
          level: result.quarantined ? "warn" : "info",
          data: {
            riskScore: result.riskScore,
            safe: result.safe,
            quarantined: result.quarantined,
            findingsCount: result.findings.length,
            confidence: result.confidence,
            ...options.extraData,
          },
          subsystem: "security",
        });
      } catch {
        // Event logging must never block operations
      }
    }

    return result;
  } catch {
    // Security scanning must never block the caller
    return null;
  }
}

/** Reset the cached logger (for testing). */
export function resetScanAndLogForTest(): void {
  _cachedLogger = null;
}
