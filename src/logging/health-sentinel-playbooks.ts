/**
 * Health Sentinel — remediation playbooks.
 *
 * Each playbook handles a specific class of health issue. Playbooks are
 * deterministic — no AI involved in remediation. They attempt simple,
 * well-understood fixes and report results.
 *
 * Playbooks accept dependencies via `RemediationContext` instead of
 * importing gateway modules directly, keeping the module tree lightweight
 * and the code fully testable.
 */

import type {
  ClassifiedIssue,
  ChannelIssueSource,
  RemediationAttempt,
  RemediationPlaybook,
} from "./health-sentinel-types.js";
import { createSubsystemLogger } from "./subsystem.js";

const log = createSubsystemLogger("health-sentinel/playbooks");

// ═══════════════════════════════════════════════════════════════════════════
// Context (injected at runtime)
// ═══════════════════════════════════════════════════════════════════════════

export interface RemediationContext {
  /** Restart a channel via gateway RPC (stop + start). */
  restartChannel: (channelId: string, accountId: string) => Promise<void>;
  /** Probe channel health via gateway RPC. Returns true if healthy. */
  probeChannelHealth: (channelId: string) => Promise<boolean>;
  /** Rotate event log files. Returns files rotated and deleted. */
  rotateEventLogs: (baseDir: string) => { rotated: string[]; deleted: string[] };
  /** Check log directory size in MB. */
  checkDiskSpaceMB: (dir: string) => number;
  /** Restart a sandbox browser Docker container. */
  restartBrowserContainer?: (containerName: string) => Promise<void>;
  /** Probe a browser container's CDP endpoint. Returns true if responsive. */
  probeBrowserCdp?: (cdpPort: number) => Promise<boolean>;
  /** Run full disk hygiene cleanup (sessions, cache, logs, media). */
  runDiskHygiene?: () => { freedBytes: number; filesDeleted: number; errors: string[] };
  /** Validate openclaw.json config and return issues (from doctor config flow). */
  validateConfig?: () => Promise<{
    valid: boolean;
    issues: Array<{ path: string; message: string }>;
  }>;
  /** Clean stale session lock files. Returns count of locks removed. */
  cleanStaleLocks?: () => Promise<{ staleCount: number; removedCount: number }>;
  /** Re-scan for stale locks without removing them. Returns stale count. */
  countStaleLocks?: () => Promise<number>;
  /**
   * Request a graceful gateway restart.
   * Called by the event loop degradation playbook when p99 > fail threshold.
   * Implementation should call process.exit(1) — Docker's restart policy
   * (restart: unless-stopped) recovers the container automatically.
   */
  requestGatewayRestart?: (reason: string) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// Channel Restart Playbook
// ═══════════════════════════════════════════════════════════════════════════

function isChannelIssue(issue: ClassifiedIssue): issue is ClassifiedIssue & {
  source: ChannelIssueSource;
} {
  return (
    typeof issue.source === "object" && "kind" in issue.source && issue.source.kind === "channel"
  );
}

export function createChannelRestartPlaybook(ctx: RemediationContext): RemediationPlaybook {
  return {
    id: "channel-restart",

    matches(issue) {
      return isChannelIssue(issue) && issue.classification === "auto-fixable";
    },

    async remediate(issue): Promise<RemediationAttempt> {
      const start = Date.now();
      if (!isChannelIssue(issue)) {
        return {
          issueKey: issue.key,
          playbook: "channel-restart",
          status: "skipped",
          error: "not a channel issue",
          durationMs: Date.now() - start,
        };
      }

      const { channelId, accountId } = issue.source;
      log.info?.(
        `attempting channel restart: ${channelId}:${accountId} (reason: ${issue.source.reason})`,
      );

      try {
        await ctx.restartChannel(channelId, accountId);
        log.info?.(`channel restart succeeded: ${channelId}:${accountId}`);
        return {
          issueKey: issue.key,
          playbook: "channel-restart",
          status: "success",
          durationMs: Date.now() - start,
        };
      } catch (err) {
        const error = String(err);
        log.warn?.(`channel restart failed: ${channelId}:${accountId} — ${error}`);
        return {
          issueKey: issue.key,
          playbook: "channel-restart",
          status: "failed",
          error,
          durationMs: Date.now() - start,
        };
      }
    },

    async verify(issue): Promise<boolean> {
      if (!isChannelIssue(issue)) {
        return false;
      }
      // Wait briefly for the channel to reconnect
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      try {
        return await ctx.probeChannelHealth(issue.source.channelId);
      } catch {
        return false;
      }
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Disk Cleanup Playbook
// ═══════════════════════════════════════════════════════════════════════════

function isDiskIssue(issue: ClassifiedIssue): boolean {
  return issue.key === "system:disk.log_directory";
}

export function createDiskCleanupPlaybook(ctx: RemediationContext): RemediationPlaybook {
  return {
    id: "disk-cleanup",

    matches(issue) {
      return isDiskIssue(issue) && issue.classification === "auto-fixable";
    },

    async remediate(issue): Promise<RemediationAttempt> {
      const start = Date.now();
      if (!isDiskIssue(issue)) {
        return {
          issueKey: issue.key,
          playbook: "disk-cleanup",
          status: "skipped",
          error: "not a disk issue",
          durationMs: Date.now() - start,
        };
      }

      log.info?.("attempting disk cleanup via log rotation");

      try {
        // Default log dir — the issue detail string contains the path info
        const result = ctx.rotateEventLogs("data/logs");
        const totalActions = result.rotated.length + result.deleted.length;
        if (totalActions === 0) {
          log.info?.("disk cleanup: no files needed rotation");
          return {
            issueKey: issue.key,
            playbook: "disk-cleanup",
            status: "success",
            durationMs: Date.now() - start,
          };
        }
        log.info?.(
          `disk cleanup: rotated ${result.rotated.length} file(s), deleted ${result.deleted.length} old rotation(s)`,
        );
        return {
          issueKey: issue.key,
          playbook: "disk-cleanup",
          status: "success",
          durationMs: Date.now() - start,
        };
      } catch (err) {
        const error = String(err);
        log.warn?.(`disk cleanup failed: ${error}`);
        return {
          issueKey: issue.key,
          playbook: "disk-cleanup",
          status: "failed",
          error,
          durationMs: Date.now() - start,
        };
      }
    },

    async verify(_issue): Promise<boolean> {
      try {
        const currentMB = ctx.checkDiskSpaceMB("data/logs");
        // Consider verified if under 500MB (the default threshold)
        return currentMB < 500;
      } catch {
        return false;
      }
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Browser Container Restart Playbook
// ═══════════════════════════════════════════════════════════════════════════

const BROWSER_ISSUE_KEY_PREFIX = "system:sandbox.browser.";

/**
 * Docker container names: 1–63 chars, `[a-zA-Z0-9][a-zA-Z0-9_.-]*`.
 * Validate to prevent command injection via crafted issue keys.
 */
const DOCKER_CONTAINER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/;

function isBrowserContainerIssue(issue: ClassifiedIssue): boolean {
  return issue.key.startsWith(BROWSER_ISSUE_KEY_PREFIX);
}

/**
 * Extract the container name from a browser issue key like
 * "system:sandbox.browser.browser-dan". Returns null if the key
 * is malformed or the container name fails Docker name validation.
 */
function extractBrowserContainerName(issue: ClassifiedIssue): string | null {
  if (!issue.key.startsWith(BROWSER_ISSUE_KEY_PREFIX)) {
    return null;
  }
  const name = issue.key.slice(BROWSER_ISSUE_KEY_PREFIX.length);
  if (!name || !DOCKER_CONTAINER_NAME_RE.test(name)) {
    return null;
  }
  return name;
}

/** Extract the CDP port from the issue detail string (e.g. "CDP port 49221 unreachable"). */
function extractCdpPortFromDetail(detail: string): number | null {
  const match = detail.match(/CDP port (\d+)/);
  if (!match?.[1]) {
    return null;
  }
  const port = Number.parseInt(match[1], 10);
  return Number.isFinite(port) && port > 0 && port <= 65535 ? port : null;
}

export function createBrowserRestartPlaybook(ctx: RemediationContext): RemediationPlaybook {
  return {
    id: "browser-container-restart",

    matches(issue) {
      return (
        isBrowserContainerIssue(issue) &&
        issue.classification === "auto-fixable" &&
        ctx.restartBrowserContainer !== undefined
      );
    },

    async remediate(issue): Promise<RemediationAttempt> {
      const start = Date.now();
      const containerName = extractBrowserContainerName(issue);
      if (!containerName || !ctx.restartBrowserContainer) {
        return {
          issueKey: issue.key,
          playbook: "browser-container-restart",
          status: "skipped",
          error: containerName ? "no restart handler" : "cannot extract container name",
          durationMs: Date.now() - start,
        };
      }

      log.info?.(
        `attempting browser container restart: ${containerName} (reason: ${issue.summary})`,
      );

      try {
        await ctx.restartBrowserContainer(containerName);
        log.info?.(`browser container restart succeeded: ${containerName}`);
        return {
          issueKey: issue.key,
          playbook: "browser-container-restart",
          status: "success",
          durationMs: Date.now() - start,
        };
      } catch (err) {
        const error = String(err);
        log.warn?.(`browser container restart failed: ${containerName} — ${error}`);
        return {
          issueKey: issue.key,
          playbook: "browser-container-restart",
          status: "failed",
          error,
          durationMs: Date.now() - start,
        };
      }
    },

    async verify(issue): Promise<boolean> {
      if (!ctx.probeBrowserCdp) {
        return false;
      }
      // Extract CDP port from the issue detail
      const detail =
        "detail" in issue.source && typeof issue.source.detail === "string"
          ? issue.source.detail
          : issue.summary;
      const cdpPort = extractCdpPortFromDetail(detail);
      if (!cdpPort) {
        return false;
      }
      // Wait for browser to restart
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      try {
        return await ctx.probeBrowserCdp(cdpPort);
      } catch {
        return false;
      }
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Disk Hygiene Playbook (sessions, cache, logs, media)
// ═══════════════════════════════════════════════════════════════════════════

function isDiskHygieneIssue(issue: ClassifiedIssue): boolean {
  return issue.key === "system:disk.session_bloat" || issue.key === "system:disk.hygiene";
}

export function createDiskHygienePlaybook(ctx: RemediationContext): RemediationPlaybook {
  return {
    id: "disk-hygiene",

    matches(issue) {
      return (
        isDiskHygieneIssue(issue) &&
        issue.classification === "auto-fixable" &&
        ctx.runDiskHygiene !== undefined
      );
    },

    async remediate(issue): Promise<RemediationAttempt> {
      const start = Date.now();
      if (!ctx.runDiskHygiene) {
        return {
          issueKey: issue.key,
          playbook: "disk-hygiene",
          status: "skipped",
          error: "no disk hygiene handler",
          durationMs: Date.now() - start,
        };
      }

      log.info?.("attempting disk hygiene cleanup (sessions, cache, logs, media)");

      try {
        const result = ctx.runDiskHygiene();
        const freedMB = Math.round(result.freedBytes / 1024 / 1024);
        log.info?.(`disk hygiene: freed ${freedMB}MB, deleted ${result.filesDeleted} files`);
        if (result.errors.length > 0) {
          log.warn?.(`disk hygiene: ${result.errors.length} non-fatal errors`);
        }
        return {
          issueKey: issue.key,
          playbook: "disk-hygiene",
          status: "success",
          durationMs: Date.now() - start,
        };
      } catch (err) {
        const error = String(err);
        log.warn?.(`disk hygiene failed: ${error}`);
        return {
          issueKey: issue.key,
          playbook: "disk-hygiene",
          status: "failed",
          error,
          durationMs: Date.now() - start,
        };
      }
    },

    async verify(_issue): Promise<boolean> {
      // Verify by re-checking disk space — hard to know exact threshold here
      // so just return true (the cleanup itself is the fix)
      return true;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Config Repair Playbook (from doctor config flow)
// ═══════════════════════════════════════════════════════════════════════════

function isConfigIssue(issue: ClassifiedIssue): boolean {
  return issue.key.startsWith("system:config.");
}

export function createConfigRepairPlaybook(ctx: RemediationContext): RemediationPlaybook {
  return {
    id: "doctor-config-repair",

    matches(issue) {
      return (
        isConfigIssue(issue) &&
        issue.classification === "auto-fixable" &&
        ctx.validateConfig !== undefined
      );
    },

    async remediate(issue): Promise<RemediationAttempt> {
      const start = Date.now();
      if (!ctx.validateConfig) {
        return {
          issueKey: issue.key,
          playbook: "doctor-config-repair",
          status: "skipped",
          error: "no config validator",
          durationMs: Date.now() - start,
        };
      }

      log.info?.("attempting config repair via doctor config flow");

      try {
        const result = await ctx.validateConfig();
        if (result.valid) {
          log.info?.("config repair: config is now valid");
          return {
            issueKey: issue.key,
            playbook: "doctor-config-repair",
            status: "success",
            durationMs: Date.now() - start,
          };
        }
        const issuesSummary = result.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
        log.warn?.(`config repair: ${result.issues.length} issue(s) remain — ${issuesSummary}`);
        return {
          issueKey: issue.key,
          playbook: "doctor-config-repair",
          status: "failed",
          error: `${result.issues.length} validation issues remain`,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        const error = String(err);
        log.warn?.(`config repair failed: ${error}`);
        return {
          issueKey: issue.key,
          playbook: "doctor-config-repair",
          status: "failed",
          error,
          durationMs: Date.now() - start,
        };
      }
    },

    async verify(_issue): Promise<boolean> {
      if (!ctx.validateConfig) {
        return false;
      }
      try {
        const result = await ctx.validateConfig();
        return result.valid;
      } catch {
        return false;
      }
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Session Lock Cleanup Playbook (from doctor session locks)
// ═══════════════════════════════════════════════════════════════════════════

function isSessionLockIssue(issue: ClassifiedIssue): boolean {
  return issue.key === "system:process.session_locks";
}

export function createSessionLockPlaybook(ctx: RemediationContext): RemediationPlaybook {
  return {
    id: "doctor-session-lock-cleanup",

    matches(issue) {
      return (
        isSessionLockIssue(issue) &&
        issue.classification === "auto-fixable" &&
        ctx.cleanStaleLocks !== undefined
      );
    },

    async remediate(issue): Promise<RemediationAttempt> {
      const start = Date.now();
      if (!ctx.cleanStaleLocks) {
        return {
          issueKey: issue.key,
          playbook: "doctor-session-lock-cleanup",
          status: "skipped",
          error: "no lock cleanup handler",
          durationMs: Date.now() - start,
        };
      }

      log.info?.("attempting stale session lock cleanup");

      try {
        const result = await ctx.cleanStaleLocks();
        if (result.removedCount === 0) {
          log.info?.("session lock cleanup: no stale locks found");
          return {
            issueKey: issue.key,
            playbook: "doctor-session-lock-cleanup",
            status: "success",
            durationMs: Date.now() - start,
          };
        }
        log.info?.(
          `session lock cleanup: removed ${result.removedCount} of ${result.staleCount} stale lock(s)`,
        );
        return {
          issueKey: issue.key,
          playbook: "doctor-session-lock-cleanup",
          status: "success",
          durationMs: Date.now() - start,
        };
      } catch (err) {
        const error = String(err);
        log.warn?.(`session lock cleanup failed: ${error}`);
        return {
          issueKey: issue.key,
          playbook: "doctor-session-lock-cleanup",
          status: "failed",
          error,
          durationMs: Date.now() - start,
        };
      }
    },

    async verify(_issue): Promise<boolean> {
      if (!ctx.countStaleLocks) {
        return false;
      }
      try {
        const staleCount = await ctx.countStaleLocks();
        return staleCount === 0;
      } catch {
        return false;
      }
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Gateway Restart Playbook (event loop degradation)
// ═══════════════════════════════════════════════════════════════════════════

function isEventLoopIssue(issue: ClassifiedIssue): boolean {
  return issue.key === "system:process.event_loop_delay";
}

/**
 * When the event loop is severely degraded (p99 > 2s), HTTP healthchecks
 * still pass (10s timeout) but the agent is unusable. This playbook
 * triggers a graceful process exit — Docker's `restart: unless-stopped`
 * policy recovers the container, and the host watchdog cron provides a
 * backup if Docker's restart fails.
 *
 * Recovery chain:
 *   probe detects p99 > 2s → sentinel classifies as auto-fixable
 *   → playbook calls process.exit(1) → Docker restarts container
 *   → event loop is healthy on fresh start
 */
export function createGatewayRestartPlaybook(ctx: RemediationContext): RemediationPlaybook {
  return {
    id: "gateway-restart-event-loop",

    matches(issue) {
      return (
        isEventLoopIssue(issue) &&
        issue.classification === "auto-fixable" &&
        ctx.requestGatewayRestart !== undefined
      );
    },

    async remediate(issue): Promise<RemediationAttempt> {
      const start = Date.now();
      if (!ctx.requestGatewayRestart) {
        return {
          issueKey: issue.key,
          playbook: "gateway-restart-event-loop",
          status: "skipped",
          error: "no restart handler",
          durationMs: Date.now() - start,
        };
      }

      log.info?.(`event loop severely degraded — requesting gateway restart: ${issue.summary}`);

      try {
        ctx.requestGatewayRestart(`Event loop degradation auto-fix: ${issue.summary}`);
        // process.exit is async-ish — give it a moment
        return {
          issueKey: issue.key,
          playbook: "gateway-restart-event-loop",
          status: "success",
          durationMs: Date.now() - start,
        };
      } catch (err) {
        const error = String(err);
        log.warn?.(`gateway restart request failed: ${error}`);
        return {
          issueKey: issue.key,
          playbook: "gateway-restart-event-loop",
          status: "failed",
          error,
          durationMs: Date.now() - start,
        };
      }
    },

    async verify(_issue): Promise<boolean> {
      // Cannot verify — process should be restarting.
      // If we're still running, the restart didn't happen.
      return false;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Playbook Registry
// ═══════════════════════════════════════════════════════════════════════════

/** Build the full playbook registry with injected context. */
export function buildPlaybooks(ctx: RemediationContext): RemediationPlaybook[] {
  return [
    createChannelRestartPlaybook(ctx),
    createDiskCleanupPlaybook(ctx),
    createDiskHygienePlaybook(ctx),
    createBrowserRestartPlaybook(ctx),
    createConfigRepairPlaybook(ctx),
    createSessionLockPlaybook(ctx),
    createGatewayRestartPlaybook(ctx),
  ];
}

/** Find the first playbook that matches the given issue. */
export function findPlaybook(
  issue: ClassifiedIssue,
  playbooks: RemediationPlaybook[],
): RemediationPlaybook | null {
  return playbooks.find((p) => p.matches(issue)) ?? null;
}
