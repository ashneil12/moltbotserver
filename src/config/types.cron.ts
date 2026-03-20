import type { SecretInput } from "./types.secrets.js";

/** Error types that can trigger retries for one-shot jobs. */
export type CronRetryOn = "rate_limit" | "overloaded" | "network" | "timeout" | "server_error";

export type CronRetryConfig = {
  /** Max retries for transient errors before permanent disable (default: 3). */
  maxAttempts?: number;
  /** Backoff delays in ms for each retry attempt (default: [30000, 60000, 300000]). */
  backoffMs?: number[];
  /** Error types to retry; omit to retry all transient types. */
  retryOn?: CronRetryOn[];
};

export type CronFailureAlertConfig = {
  enabled?: boolean;
  after?: number;
  cooldownMs?: number;
  mode?: "announce" | "webhook";
  accountId?: string;
};

export type CronFailureDestinationConfig = {
  channel?: string;
  to?: string;
  accountId?: string;
  mode?: "announce" | "webhook";
};

export type CronConfig = {
  enabled?: boolean;
  store?: string;
  maxConcurrentRuns?: number;
  /** Override default retry policy for one-shot jobs on transient errors. */
  retry?: CronRetryConfig;
  /**
   * Deprecated legacy fallback webhook URL used only for stored jobs with notify=true.
   * Prefer per-job delivery.mode="webhook" with delivery.to.
   */
  webhook?: string;
  /** Bearer token for cron webhook POST delivery. */
  webhookToken?: SecretInput;
  /**
   * How long to retain completed cron run sessions before automatic pruning.
   * Accepts a duration string (e.g. "24h", "7d", "1h30m") or `false` to disable pruning.
   * Default: "24h".
   */
  sessionRetention?: string | false;
  /**
   * Run-log pruning controls for `cron/runs/<jobId>.jsonl`.
   * Defaults: `maxBytes=2_000_000`, `keepLines=2000`.
   */
  runLog?: {
    maxBytes?: number | string;
    keepLines?: number;
  };
  failureAlert?: CronFailureAlertConfig;
  /** Default destination for failure notifications across all cron jobs. */
  failureDestination?: CronFailureDestinationConfig;
  /**
   * Maximum age (in days) for cron session .jsonl files on disk.
   * Files older than this in agents/&lt;id&gt;/sessions/ are deleted during reaper sweeps.
   * Set to false to disable file-age pruning.
   * Default: 30.
   */
  sessionFileRetentionDays?: number | false;
  /**
   * Remediation journal retention in days. Entries older than this are pruned.
   * Default: 14.
   */
  remediationRetentionDays?: number;
  /**
   * Watchdog window in minutes. If a remediated job re-fails within this
   * window, the fix is auto-rolled back. Default: 30.
   */
  remediationWatchdogMinutes?: number;
  /**
   * Max agent remediation attempts per issue before escalating to human.
   * Default: 2.
   */
  remediationMaxAttempts?: number;
  /**
   * Whether to auto-seed system cron jobs (e.g. health check) on startup.
   * Default: true. Set to false in test environments.
   */
  seedSystemJobs?: boolean;
};
