/**
 * Transcript security sweep — deterministic timer that periodically
 * re-scans transcript files across all agent workspaces and redacts
 * any secrets that slipped through the initial write-time filter.
 *
 * Architecture mirrors `diary-archive.ts`: a setInterval tick checks
 * a per-workspace `.sweep-state.json` to decide if a sweep is due,
 * then reads/rewrites any transcript files that contain unredacted secrets.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { listAgentIds, resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import type { OpenClawConfig } from "../config/config.js";
import { atomicWriteFile } from "../infra/atomic-file.js";
import { redactSensitiveText } from "../logging/redact.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("cron/transcript-sweep");

/** Default sweep interval: 6 hours in ms. */
export const DEFAULT_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Timer tick interval — check every 60 seconds whether a sweep is due. */
const TIMER_TICK_MS = 60_000;

const SWEEP_STATE_FILENAME = ".sweep-state.json";
const TRANSCRIPTS_DIR = "transcripts";

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

type SweepState = {
  lastSweepAtMs?: number;
};

async function readSweepState(transcriptsDir: string): Promise<SweepState> {
  const statePath = path.join(transcriptsDir, SWEEP_STATE_FILENAME);
  try {
    const raw = await fs.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      lastSweepAtMs: typeof parsed.lastSweepAtMs === "number" ? parsed.lastSweepAtMs : undefined,
    };
  } catch {
    return {};
  }
}

async function writeSweepState(transcriptsDir: string, state: SweepState): Promise<void> {
  const statePath = path.join(transcriptsDir, SWEEP_STATE_FILENAME);
  await atomicWriteFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Core sweep logic
// ---------------------------------------------------------------------------

export type TranscriptSweepResult = {
  workspaceDir: string;
  filesScanned: number;
  filesRedacted: number;
  error?: string;
};

/**
 * Sweep a single workspace's transcripts directory.
 * Reads each `.md` file, re-runs `redactSensitiveText()`, and writes back
 * only if the content changed (secrets were found and masked).
 */
export async function sweepTranscriptsForWorkspace(
  workspaceDir: string,
): Promise<TranscriptSweepResult> {
  const transcriptsDir = path.join(workspaceDir, TRANSCRIPTS_DIR);
  let filesScanned = 0;
  let filesRedacted = 0;

  try {
    await fs.access(transcriptsDir);
  } catch {
    // No transcripts directory — nothing to sweep
    return { workspaceDir, filesScanned: 0, filesRedacted: 0 };
  }

  const entries = await fs.readdir(transcriptsDir);
  const mdFiles = entries.filter((f) => f.endsWith(".md"));

  for (const filename of mdFiles) {
    const filePath = path.join(transcriptsDir, filename);
    try {
      const original = await fs.readFile(filePath, "utf-8");
      filesScanned++;

      const redacted = redactSensitiveText(original);
      if (redacted !== original) {
        await atomicWriteFile(filePath, redacted);
        filesRedacted++;
      }
    } catch (err) {
      log.warn(
        `transcript-sweep: failed to process ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Update state
  await writeSweepState(transcriptsDir, { lastSweepAtMs: Date.now() });

  return { workspaceDir, filesScanned, filesRedacted };
}

// ---------------------------------------------------------------------------
// Multi-agent sweep
// ---------------------------------------------------------------------------

/**
 * Run transcript sweep for all agent workspaces that are due.
 */
export async function runTranscriptSweep(
  cfg: OpenClawConfig,
  intervalMs: number = DEFAULT_SWEEP_INTERVAL_MS,
): Promise<TranscriptSweepResult[]> {
  const agentIds = listAgentIds(cfg);
  const results: TranscriptSweepResult[] = [];
  const nowMs = Date.now();

  for (const agentId of agentIds) {
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const transcriptsDir = path.join(workspaceDir, TRANSCRIPTS_DIR);

    try {
      await fs.access(transcriptsDir);
    } catch {
      continue; // No transcripts directory, skip
    }

    // Check if sweep is due
    const state = await readSweepState(transcriptsDir);
    if (state.lastSweepAtMs && nowMs - state.lastSweepAtMs < intervalMs) {
      continue; // Not due yet
    }

    try {
      const result = await sweepTranscriptsForWorkspace(workspaceDir);
      results.push(result);
    } catch (err) {
      log.warn(`transcript-sweep: failed for workspace ${workspaceDir}: ${String(err)}`);
      results.push({
        workspaceDir,
        filesScanned: 0,
        filesRedacted: 0,
        error: String(err),
      });
    }
  }

  if (results.length > 0) {
    const totalScanned = results.reduce((sum, r) => sum + r.filesScanned, 0);
    const totalRedacted = results.reduce((sum, r) => sum + r.filesRedacted, 0);
    log.info(
      `transcript-sweep: sweep complete — ${totalScanned} file(s) scanned, ${totalRedacted} redacted across ${results.length} workspace(s)`,
    );
  }

  return results;
}

// ---------------------------------------------------------------------------
// Timer lifecycle
// ---------------------------------------------------------------------------

let activeTimer: ReturnType<typeof setInterval> | null = null;

type TranscriptSweepTimerDeps = {
  cfg: OpenClawConfig;
  intervalMs?: number;
};

/**
 * Start the transcript sweep timer. Checks every 60s whether any workspace is due.
 * Safe to call multiple times — stops any existing timer first.
 */
export function startTranscriptSweepTimer(deps: TranscriptSweepTimerDeps): void {
  stopTranscriptSweepTimer();

  const intervalMs = deps.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;

  const tick = () => {
    void runTranscriptSweep(deps.cfg, intervalMs).catch((err) => {
      log.warn(`transcript-sweep: sweep failed unexpectedly: ${String(err)}`);
    });
  };

  activeTimer = setInterval(tick, TIMER_TICK_MS);

  // Unref so the timer doesn't prevent process exit
  if (activeTimer && typeof activeTimer === "object" && "unref" in activeTimer) {
    activeTimer.unref();
  }

  const intervalHours = Math.round(intervalMs / (60 * 60 * 1000));
  log.info(`transcript-sweep: timer started — sweep interval is ${intervalHours} hour(s)`);

  // Run an immediate check on startup
  tick();
}

/**
 * Stop the transcript sweep timer.
 */
export function stopTranscriptSweepTimer(): void {
  if (activeTimer !== null) {
    clearInterval(activeTimer);
    activeTimer = null;
  }
}
