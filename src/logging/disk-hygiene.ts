/**
 * Disk hygiene — scanner and cleaner for OpenClaw disk bloat.
 *
 * Addresses the community-reported issue where OpenClaw instances
 * accumulate GBs of stale data:
 * - Old cron session .jsonl files
 * - Browser profile cache
 * - Gateway error logs
 * - Old inbound media
 *
 * Designed to be called by:
 * 1. The health sentinel playbook (automatic, when disk threshold exceeded)
 * 2. A gateway RPC method (manual, from the dashboard)
 */

import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "./subsystem.js";

const log = createSubsystemLogger("disk-hygiene");

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface DiskScanResult {
  /** Total size of all scanned areas in bytes. */
  totalBytes: number;
  /** Breakdown by area. */
  areas: DiskArea[];
}

export interface DiskArea {
  name: string;
  path: string;
  sizeBytes: number;
  fileCount: number;
}

export interface DiskCleanupResult {
  /** Total bytes freed. */
  freedBytes: number;
  /** Number of files deleted. */
  filesDeleted: number;
  /** Number of files truncated. */
  filesTruncated: number;
  /** Per-area results. */
  actions: DiskCleanupAction[];
  /** Errors encountered (non-fatal). */
  errors: string[];
}

export interface DiskCleanupAction {
  area: string;
  action: "deleted" | "truncated";
  path: string;
  freedBytes: number;
}

export interface DiskHygieneConfig {
  /** Delete session .jsonl files older than this (ms). Default: 30 days. */
  sessionMaxAgeMs?: number;
  /** Delete inbound media older than this (ms). Default: 14 days. */
  mediaMaxAgeMs?: number;
  /** Truncate gateway error log, keeping this many lines. Default: 1000. */
  gatewayLogKeepLines?: number;
  /** Skip main session file during cleanup. Default: true. */
  preserveMainSession?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Defaults
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60_000; // 30 days
const DEFAULT_MEDIA_MAX_AGE_MS = 14 * 24 * 60 * 60_000; // 14 days
const DEFAULT_GATEWAY_LOG_KEEP_LINES = 1000;

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function dirSizeSync(dirPath: string): { sizeBytes: number; fileCount: number } {
  let sizeBytes = 0;
  let fileCount = 0;

  try {
    if (!fs.existsSync(dirPath)) {
      return { sizeBytes: 0, fileCount: 0 };
    }
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isFile()) {
          const stat = fs.statSync(fullPath);
          sizeBytes += stat.size;
          fileCount++;
        } else if (entry.isDirectory()) {
          const sub = dirSizeSync(fullPath);
          sizeBytes += sub.sizeBytes;
          fileCount += sub.fileCount;
        }
      } catch {
        // skip inaccessible files
      }
    }
  } catch {
    // directory doesn't exist or not readable
  }

  return { sizeBytes, fileCount };
}

function findOldFiles(
  dirPath: string,
  maxAgeMs: number,
  nowMs: number,
  extensions?: string[],
): Array<{ path: string; sizeBytes: number; mtimeMs: number }> {
  const results: Array<{ path: string; sizeBytes: number; mtimeMs: number }> = [];

  try {
    if (!fs.existsSync(dirPath)) {
      return results;
    }
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isFile()) {
          if (extensions && !extensions.some((ext) => entry.name.endsWith(ext))) {
            continue;
          }
          const stat = fs.statSync(fullPath);
          if (nowMs - stat.mtimeMs > maxAgeMs) {
            results.push({ path: fullPath, sizeBytes: stat.size, mtimeMs: stat.mtimeMs });
          }
        } else if (entry.isDirectory()) {
          results.push(...findOldFiles(fullPath, maxAgeMs, nowMs, extensions));
        }
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scanner
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Scan the OpenClaw home directory for disk usage breakdown.
 */
export function scanDiskUsage(openclawDir: string): DiskScanResult {
  const areas: DiskArea[] = [];

  // 1. Session files across all agents
  const agentsDir = path.join(openclawDir, "agents");
  if (fs.existsSync(agentsDir)) {
    try {
      const agents = fs.readdirSync(agentsDir, { withFileTypes: true });
      for (const agent of agents) {
        if (!agent.isDirectory()) {
          continue;
        }
        const sessionsDir = path.join(agentsDir, agent.name, "sessions");
        const { sizeBytes, fileCount } = dirSizeSync(sessionsDir);
        if (fileCount > 0) {
          areas.push({
            name: `sessions/${agent.name}`,
            path: sessionsDir,
            sizeBytes,
            fileCount,
          });
        }
      }
    } catch {
      // skip
    }
  }

  // 2. Browser cache
  const browserDir = path.join(openclawDir, "browser");
  if (fs.existsSync(browserDir)) {
    const { sizeBytes, fileCount } = dirSizeSync(browserDir);
    if (fileCount > 0) {
      areas.push({ name: "browser_cache", path: browserDir, sizeBytes, fileCount });
    }
  }

  // 3. Gateway error log
  const errLog = path.join(openclawDir, "gateway.err.log");
  if (fs.existsSync(errLog)) {
    try {
      const stat = fs.statSync(errLog);
      areas.push({ name: "gateway_error_log", path: errLog, sizeBytes: stat.size, fileCount: 1 });
    } catch {
      // skip
    }
  }

  // 4. Inbound media
  if (fs.existsSync(agentsDir)) {
    try {
      const agents = fs.readdirSync(agentsDir, { withFileTypes: true });
      for (const agent of agents) {
        if (!agent.isDirectory()) {
          continue;
        }
        const inboundDir = path.join(agentsDir, agent.name, "inbound");
        const { sizeBytes, fileCount } = dirSizeSync(inboundDir);
        if (fileCount > 0) {
          areas.push({
            name: `inbound/${agent.name}`,
            path: inboundDir,
            sizeBytes,
            fileCount,
          });
        }
      }
    } catch {
      // skip
    }
  }

  const totalBytes = areas.reduce((sum, a) => sum + a.sizeBytes, 0);
  return { totalBytes, areas };
}

// ═══════════════════════════════════════════════════════════════════════════
// Cleaner
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run disk cleanup on the OpenClaw home directory.
 *
 * Actions:
 * 1. Delete session .jsonl files older than sessionMaxAgeMs (except main session)
 * 2. Truncate gateway.err.log to last N lines
 * 3. Delete browser cache (only Cache directories, not profile data)
 * 4. Delete inbound media older than mediaMaxAgeMs
 */
export function runDiskCleanup(
  openclawDir: string,
  config?: DiskHygieneConfig,
  nowMs?: number,
): DiskCleanupResult {
  const now = nowMs ?? Date.now();
  const sessionMaxAgeMs = config?.sessionMaxAgeMs ?? DEFAULT_SESSION_MAX_AGE_MS;
  const mediaMaxAgeMs = config?.mediaMaxAgeMs ?? DEFAULT_MEDIA_MAX_AGE_MS;
  const keepLines = config?.gatewayLogKeepLines ?? DEFAULT_GATEWAY_LOG_KEEP_LINES;
  const preserveMain = config?.preserveMainSession !== false;

  const result: DiskCleanupResult = {
    freedBytes: 0,
    filesDeleted: 0,
    filesTruncated: 0,
    actions: [],
    errors: [],
  };

  // 1. Clean old session files
  const agentsDir = path.join(openclawDir, "agents");
  if (fs.existsSync(agentsDir)) {
    try {
      const agents = fs.readdirSync(agentsDir, { withFileTypes: true });
      for (const agent of agents) {
        if (!agent.isDirectory()) {
          continue;
        }
        const sessionsDir = path.join(agentsDir, agent.name, "sessions");
        const oldFiles = findOldFiles(sessionsDir, sessionMaxAgeMs, now, [".jsonl"]);
        for (const file of oldFiles) {
          // Skip main session file if configured
          if (preserveMain && path.basename(file.path) === "main.jsonl") {
            continue;
          }
          // Skip sessions.json (metadata, not a session transcript)
          if (path.basename(file.path) === "sessions.json") {
            continue;
          }

          try {
            fs.unlinkSync(file.path);
            result.freedBytes += file.sizeBytes;
            result.filesDeleted++;
            result.actions.push({
              area: `sessions/${agent.name}`,
              action: "deleted",
              path: file.path,
              freedBytes: file.sizeBytes,
            });
          } catch (err) {
            result.errors.push(`Failed to delete ${file.path}: ${String(err)}`);
          }
        }
      }
    } catch (err) {
      result.errors.push(`Session cleanup error: ${String(err)}`);
    }
  }

  // 2. Truncate gateway error log
  const errLog = path.join(openclawDir, "gateway.err.log");
  if (fs.existsSync(errLog)) {
    try {
      const stat = fs.statSync(errLog);
      if (stat.size > 0) {
        const content = fs.readFileSync(errLog, "utf-8");
        const lines = content.split("\n");
        if (lines.length > keepLines) {
          const kept = lines.slice(-keepLines).join("\n");
          const freedBytes = stat.size - Buffer.byteLength(kept, "utf-8");
          fs.writeFileSync(errLog, kept, "utf-8");
          if (freedBytes > 0) {
            result.freedBytes += freedBytes;
            result.filesTruncated++;
            result.actions.push({
              area: "gateway_error_log",
              action: "truncated",
              path: errLog,
              freedBytes,
            });
          }
        }
      }
    } catch (err) {
      result.errors.push(`Gateway log truncation error: ${String(err)}`);
    }
  }

  // 3. Clean browser cache directories (not profile data)
  const browserDir = path.join(openclawDir, "browser");
  if (fs.existsSync(browserDir)) {
    try {
      // Only delete "Cache", "Code Cache", "GPUCache" subdirectories
      const cacheSubdirs = new Set(["Cache", "Code Cache", "GPUCache", "cache"]);
      const browserEntries = fs.readdirSync(browserDir, { withFileTypes: true });
      for (const entry of browserEntries) {
        if (!entry.isDirectory()) {
          continue;
        }
        // Profiles are typically directories like "Default", "Profile 1", etc.
        const profileDir = path.join(browserDir, entry.name);
        try {
          const profileEntries = fs.readdirSync(profileDir, { withFileTypes: true });
          for (const profileEntry of profileEntries) {
            if (!profileEntry.isDirectory()) {
              continue;
            }
            if (!cacheSubdirs.has(profileEntry.name)) {
              continue;
            }
            const cacheDir = path.join(profileDir, profileEntry.name);
            const { sizeBytes } = dirSizeSync(cacheDir);
            try {
              fs.rmSync(cacheDir, { recursive: true, force: true });
              result.freedBytes += sizeBytes;
              result.filesDeleted++;
              result.actions.push({
                area: "browser_cache",
                action: "deleted",
                path: cacheDir,
                freedBytes: sizeBytes,
              });
            } catch (err) {
              result.errors.push(`Browser cache cleanup error: ${String(err)}`);
            }
          }
        } catch {
          // skip inaccessible profile dir
        }
      }
    } catch (err) {
      result.errors.push(`Browser cache cleanup error: ${String(err)}`);
    }
  }

  // 4. Clean old inbound media
  if (fs.existsSync(agentsDir)) {
    try {
      const agents = fs.readdirSync(agentsDir, { withFileTypes: true });
      for (const agent of agents) {
        if (!agent.isDirectory()) {
          continue;
        }
        const inboundDir = path.join(agentsDir, agent.name, "inbound");
        const oldFiles = findOldFiles(inboundDir, mediaMaxAgeMs, now);
        for (const file of oldFiles) {
          try {
            fs.unlinkSync(file.path);
            result.freedBytes += file.sizeBytes;
            result.filesDeleted++;
            result.actions.push({
              area: `inbound/${agent.name}`,
              action: "deleted",
              path: file.path,
              freedBytes: file.sizeBytes,
            });
          } catch (err) {
            result.errors.push(`Failed to delete ${file.path}: ${String(err)}`);
          }
        }
      }
    } catch (err) {
      result.errors.push(`Inbound media cleanup error: ${String(err)}`);
    }
  }

  log.info(
    `disk cleanup complete: freed ${Math.round(result.freedBytes / 1024 / 1024)}MB, deleted ${result.filesDeleted} files, truncated ${result.filesTruncated} files`,
  );

  return result;
}
