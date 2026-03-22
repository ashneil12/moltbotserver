/**
 * Quarantine Alert — operator channel notification for high-severity quarantines.
 *
 * Sends an alert to the operator's configured channel (Telegram/Discord/etc.)
 * when a workspace file is quarantined with a high risk score (≥ 85 by default).
 *
 * Rate-limited to 1 alert per file per hour to prevent alert fatigue.
 */

import { createSubsystemLogger } from "../logging/subsystem.js";
import type { Finding } from "./content-scanner.js";

const alertLog = createSubsystemLogger("quarantine-alert");

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

const DEFAULT_ALERT_THRESHOLD = 85;
const RATE_LIMIT_MS = 60 * 60 * 1000; // 1 hour

/** Tracks last alert time per file path. */
const lastAlertTime = new Map<string, number>();

function isRateLimited(filePath: string): boolean {
  const last = lastAlertTime.get(filePath);
  if (last === undefined) {
    return false;
  }
  return Date.now() - last < RATE_LIMIT_MS;
}

function recordAlert(filePath: string): void {
  lastAlertTime.set(filePath, Date.now());
}

// ---------------------------------------------------------------------------
// Alert formatting
// ---------------------------------------------------------------------------

function formatAlertMessage(fileName: string, riskScore: number, findings: Finding[]): string {
  const categories = [...new Set(findings.map((f) => f.category))]
    .map((c) => c.replace(/_/g, " "))
    .join(", ");

  const severities = findings
    .filter((f) => f.severity === "critical" || f.severity === "high")
    .map((f) => `• ${f.description} (${f.severity})`)
    .slice(0, 5)
    .join("\n");

  return [
    `🛡️ **Security Quarantine Alert**`,
    ``,
    `File: \`${fileName}\``,
    `Risk Score: **${riskScore}/100**`,
    `Detected patterns: ${categories}`,
    ``,
    severities ? `Top findings:\n${severities}` : "",
    ``,
    `The file has been quarantined and wrapped in untrusted-content markers.`,
    `Review the file in the agent workspace to decide if it should be removed or allowed.`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface QuarantineAlertParams {
  /** File name (basename) that was quarantined */
  fileName: string;
  /** Full file path */
  filePath: string;
  /** Risk score from the scanner (0–100) */
  riskScore: number;
  /** Findings from the scanner */
  findings: Finding[];
  /** Function to enqueue system event — injected to avoid circular deps */
  enqueueSystemEvent: (text: string, options: { sessionKey: string }) => boolean;
  /** Session key to target for the operator alert */
  sessionKey: string;
  /** Override the risk score threshold for alerting (default: 85) */
  alertThreshold?: number;
}

/**
 * Send an operator-level alert for a high-severity quarantine.
 *
 * Only fires if riskScore ≥ threshold (default 85) and not rate-limited.
 * Returns true if an alert was sent.
 */
export function alertOperatorQuarantine(params: QuarantineAlertParams): boolean {
  const {
    fileName,
    filePath,
    riskScore,
    findings,
    enqueueSystemEvent,
    sessionKey,
    alertThreshold = DEFAULT_ALERT_THRESHOLD,
  } = params;

  // Below threshold — no operator alert needed
  if (riskScore < alertThreshold) {
    return false;
  }

  // Rate limited — skip
  if (isRateLimited(filePath)) {
    alertLog.debug(`Suppressed duplicate quarantine alert for ${fileName} (rate limited)`);
    return false;
  }

  const message = formatAlertMessage(fileName, riskScore, findings);
  const enqueued = enqueueSystemEvent(message, { sessionKey });

  if (enqueued) {
    recordAlert(filePath);
    alertLog.info(`Quarantine alert sent for ${fileName} (riskScore=${riskScore})`);
  }

  return enqueued;
}

/**
 * Get the current alert rate limit cache size (for diagnostics).
 */
export function getAlertCacheSize(): number {
  return lastAlertTime.size;
}

/** Reset rate limit cache (for testing). */
export function resetQuarantineAlertForTest(): void {
  lastAlertTime.clear();
}
