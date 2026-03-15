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
// Playbook Registry
// ═══════════════════════════════════════════════════════════════════════════

/** Build the full playbook registry with injected context. */
export function buildPlaybooks(ctx: RemediationContext): RemediationPlaybook[] {
  return [createChannelRestartPlaybook(ctx), createDiskCleanupPlaybook(ctx)];
}

/** Find the first playbook that matches the given issue. */
export function findPlaybook(
  issue: ClassifiedIssue,
  playbooks: RemediationPlaybook[],
): RemediationPlaybook | null {
  return playbooks.find((p) => p.matches(issue)) ?? null;
}
