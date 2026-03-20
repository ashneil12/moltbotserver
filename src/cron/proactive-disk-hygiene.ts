/**
 * Proactive disk hygiene — periodic cleanup piggybacked on the cron timer.
 *
 * Unlike the health sentinel's reactive disk-hygiene playbook (triggered by
 * threshold breach), this runs on a regular schedule to prevent bloat from
 * accumulating in the first place.
 *
 * Cleans:
 * - Old session .jsonl files (>30 days)
 * - Browser cache directories
 * - Gateway error logs (truncate to last 1000 lines)
 * - Old inbound media (>14 days)
 * - Old daily memory files (>30 days) → consolidated into monthly archives
 */

import fs from "node:fs";
import path from "node:path";
import { resolveAgentsDirFromSessionStorePath } from "../config/sessions/paths.js";
import type { CronConfig } from "../config/types.cron.js";
import { runDiskCleanup, type DiskCleanupResult } from "../logging/disk-hygiene.js";
import { rotateOldMemoryFiles } from "../memory/memory-file-rotator.js";
import {
  formatStalenessSummary,
  scanMemoryForStaleness,
} from "../memory/memory-staleness-scanner.js";
import type { Logger } from "./service/state.js";

/** Default interval between proactive sweeps: 6 hours. */
const DEFAULT_PROACTIVE_INTERVAL_MS = 6 * 60 * 60_000;

/** Minimum interval to prevent accidental tight loops. */
const MIN_PROACTIVE_INTERVAL_MS = 30 * 60_000; // 30 minutes

const lastSweepAtMsByDir = new Map<string, number>();

export function resolveProactiveIntervalMs(cronConfig?: CronConfig): number {
  const raw = (cronConfig as Record<string, unknown> | undefined)?.diskHygieneIntervalMs;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.max(MIN_PROACTIVE_INTERVAL_MS, Math.floor(raw));
  }
  return DEFAULT_PROACTIVE_INTERVAL_MS;
}

/**
 * Derive the OpenClaw home directory from a session store path.
 * Session store paths follow the pattern:
 *   `<openclawHome>/agents/<agentId>/sessions/sessions.json`
 *
 * Returns `undefined` if the path doesn't follow the expected pattern.
 */
export function deriveOpenclawDirFromStorePath(storePath: string): string | undefined {
  const agentsDir = resolveAgentsDirFromSessionStorePath(storePath);
  if (!agentsDir) {
    return undefined;
  }
  // agentsDir is `<openclawHome>/agents` — parent is openclawHome
  return path.dirname(agentsDir);
}

/**
 * Discover agent workspace directories by scanning the state directory.
 * Agents typically have workspaces at `<stateDir>/workspace-<agentId>` or
 * a configured custom path. For the default agent, the workspace is often
 * the process cwd. This scanner looks for `memory/` subdirs to find
 * rotatable workspaces.
 */
function discoverAgentWorkspaceDirs(openclawDir: string): string[] {
  const workspaces: string[] = [];
  const agentsDir = path.join(openclawDir, "agents");

  try {
    if (!fs.existsSync(agentsDir)) {
      return workspaces;
    }

    const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      // Check for memory/ dir in the agent's state directory
      const agentStateMemory = path.join(agentsDir, entry.name, "memory");
      if (fs.existsSync(agentStateMemory)) {
        // The agent's "workspace" for memory purposes is the parent of memory/
        workspaces.push(path.join(agentsDir, entry.name));
      }
    }
  } catch {
    // Ignore scan errors
  }

  // Also check for workspace-* directories alongside agents dir
  try {
    const stateEntries = fs.readdirSync(openclawDir, { withFileTypes: true });
    for (const entry of stateEntries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (!entry.name.startsWith("workspace-")) {
        continue;
      }

      const workspaceMemory = path.join(openclawDir, entry.name, "memory");
      if (fs.existsSync(workspaceMemory)) {
        workspaces.push(path.join(openclawDir, entry.name));
      }
    }
  } catch {
    // Ignore scan errors
  }

  return workspaces;
}

export type ProactiveDiskHygieneResult = {
  swept: boolean;
  result?: DiskCleanupResult;
  memoryFilesRotated?: number;
  staleMemoryEntries?: number;
};

/**
 * Run proactive disk hygiene cleanup. Self-throttles to the configured
 * interval (default: 6 hours).
 *
 * Designed to be called from the cron timer's `finally` block alongside
 * the session reaper.
 */
export async function sweepProactiveDiskHygiene(params: {
  cronConfig?: CronConfig;
  /** One or more session store paths to derive the openclawDir from. */
  sessionStorePaths: string[];
  nowMs?: number;
  log: Logger;
  /** Override for testing — skips the interval throttle. */
  force?: boolean;
}): Promise<ProactiveDiskHygieneResult> {
  const now = params.nowMs ?? Date.now();
  const intervalMs = resolveProactiveIntervalMs(params.cronConfig);

  // Derive the OpenClaw home directory from any available session store path.
  let openclawDir: string | undefined;
  for (const storePath of params.sessionStorePaths) {
    openclawDir = deriveOpenclawDirFromStorePath(storePath);
    if (openclawDir) {
      break;
    }
  }

  if (!openclawDir) {
    return { swept: false };
  }

  const lastSweep = lastSweepAtMsByDir.get(openclawDir) ?? 0;
  if (!params.force && now - lastSweep < intervalMs) {
    return { swept: false };
  }

  lastSweepAtMsByDir.set(openclawDir, now);

  let diskResult: DiskCleanupResult | undefined;
  let memoryFilesRotated = 0;

  // 1. Disk cleanup (sessions, cache, logs, media)
  try {
    diskResult = runDiskCleanup(openclawDir, undefined, now);

    if (diskResult.filesDeleted > 0 || diskResult.filesTruncated > 0) {
      const freedMB = Math.round(diskResult.freedBytes / 1024 / 1024);
      params.log.info(
        {
          freedBytes: diskResult.freedBytes,
          freedMB,
          filesDeleted: diskResult.filesDeleted,
          filesTruncated: diskResult.filesTruncated,
          errors: diskResult.errors.length,
        },
        `proactive-disk-hygiene: freed ${freedMB}MB, deleted ${diskResult.filesDeleted} files, truncated ${diskResult.filesTruncated} files`,
      );
    }
  } catch (err) {
    params.log.warn({ err: String(err) }, "proactive-disk-hygiene: disk cleanup failed");
  }

  // 2. Memory file rotation (daily → monthly archives) + staleness scan
  let staleMemoryEntries = 0;
  try {
    const workspaceDirs = discoverAgentWorkspaceDirs(openclawDir);

    // 2a. Rotate old daily memory files into monthly archives
    for (const workspaceDir of workspaceDirs) {
      const rotationResult = rotateOldMemoryFiles(workspaceDir, {
        nowMs: now,
        force: params.force,
      });
      memoryFilesRotated += rotationResult.dailyFilesDeleted;
    }

    if (memoryFilesRotated > 0) {
      params.log.info(
        { memoryFilesRotated, workspaceCount: workspaceDirs.length },
        `proactive-disk-hygiene: rotated ${memoryFilesRotated} daily memory file(s) into monthly archives`,
      );
    }

    // 2b. Staleness scan — check MEMORY.md for dated entries >90 days old
    for (const workspaceDir of workspaceDirs) {
      const memoryPath = path.join(workspaceDir, "MEMORY.md");
      const result = scanMemoryForStaleness(memoryPath, { nowMs: now });
      if (result.staleCount > 0) {
        staleMemoryEntries += result.staleCount;
        const summary = formatStalenessSummary(result);
        if (summary) {
          params.log.info(
            { workspace: workspaceDir, staleCount: result.staleCount },
            `proactive-disk-hygiene: ${summary}`,
          );
        }
      }
    }
  } catch (err) {
    params.log.warn(
      { err: String(err) },
      "proactive-disk-hygiene: memory maintenance (rotation/staleness) failed",
    );
  }

  return { swept: true, result: diskResult, memoryFilesRotated, staleMemoryEntries };
}

/** Reset the throttle timer (for tests). */
export function resetProactiveDiskHygieneThrottle(): void {
  lastSweepAtMsByDir.clear();
}
