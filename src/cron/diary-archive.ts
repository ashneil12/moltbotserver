/**
 * Deterministic diary archive — moves `memory/diary.md` and
 * `memory/identity-scratchpad.md` to `memory/archive/YYYY-MM/` and
 * resets them to clean templates.  The new `diary.md` is seeded with a
 * raw excerpt (last ~30 lines) from the old diary plus a marker
 * pointing to the full archive, giving the agent some continuity even
 * before the LLM `diary-post-archive` enrichment job runs.
 *
 * Lifecycle: started alongside the CronService in `server-cron.ts`.
 * Fires on a configurable interval (default 14 days).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { listAgentIds, resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { resolveWorkspaceTemplateDir } from "../agents/workspace-templates.js";
import type { OpenClawConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("diary-archive");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default archive interval: 14 days in ms. */
export const DEFAULT_DIARY_ARCHIVE_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;

/** Timer tick interval — check every 60 seconds whether an archive is due. */
const TIMER_TICK_MS = 60_000;

/** Number of tail lines to include as an excerpt in the new diary. */
const EXCERPT_TAIL_LINES = 30;

const DIARY_RELATIVE_PATH = "memory/diary.md";
const SCRATCHPAD_RELATIVE_PATH = "memory/identity-scratchpad.md";
const ARCHIVE_STATE_FILENAME = ".diary-archive-state.json";

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

type DiaryArchiveState = {
  lastArchiveAtMs?: number;
};

async function readArchiveState(workspaceDir: string): Promise<DiaryArchiveState> {
  const statePath = path.join(workspaceDir, "memory", ARCHIVE_STATE_FILENAME);
  try {
    const raw = await fs.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      lastArchiveAtMs:
        typeof parsed.lastArchiveAtMs === "number" ? parsed.lastArchiveAtMs : undefined,
    };
  } catch {
    return {};
  }
}

async function writeArchiveState(workspaceDir: string, state: DiaryArchiveState): Promise<void> {
  const dir = path.join(workspaceDir, "memory");
  await fs.mkdir(dir, { recursive: true });
  const statePath = path.join(dir, ARCHIVE_STATE_FILENAME);
  const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    await fs.writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
    await fs.rename(tmpPath, statePath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Template loading
// ---------------------------------------------------------------------------

async function loadTemplateContent(relativePath: string): Promise<string> {
  const templateDir = await resolveWorkspaceTemplateDir();
  const templatePath = path.join(templateDir, relativePath);
  try {
    return await fs.readFile(templatePath, "utf-8");
  } catch {
    // Good-enough fallback if template isn't packaged
    if (relativePath.includes("diary")) {
      return "# Diary\n\n> Your reflective journal. Updated by the diary cron job.\n";
    }
    return "# Identity Scratchpad\n\n> Document reasoning behind identity changes here.\n> Archived every 2 weeks alongside the diary.\n";
  }
}

// ---------------------------------------------------------------------------
// Core archive logic
// ---------------------------------------------------------------------------

export type DiaryArchiveResult = {
  workspaceDir: string;
  diaryArchived: boolean;
  scratchpadArchived: boolean;
  archivePath?: string;
  error?: string;
};

/**
 * Archive diary.md and identity-scratchpad.md for a single workspace.
 * Returns details about what was archived.
 */
export async function runDiaryArchiveForWorkspace(
  workspaceDir: string,
): Promise<DiaryArchiveResult> {
  const now = new Date();
  const yyyy = now.getFullYear().toString();
  const mm = (now.getMonth() + 1).toString().padStart(2, "0");
  const dd = now.getDate().toString().padStart(2, "0");
  const archiveSubdir = `${yyyy}-${mm}`;
  const dateSuffix = `${yyyy}-${mm}-${dd}`;

  const archiveDir = path.join(workspaceDir, "memory", "archive", archiveSubdir);
  const diaryPath = path.join(workspaceDir, DIARY_RELATIVE_PATH);
  const scratchpadPath = path.join(workspaceDir, SCRATCHPAD_RELATIVE_PATH);

  const result: DiaryArchiveResult = {
    workspaceDir,
    diaryArchived: false,
    scratchpadArchived: false,
  };

  // Read existing diary content before archiving
  let oldDiaryContent = "";
  try {
    oldDiaryContent = await fs.readFile(diaryPath, "utf-8");
  } catch {
    // Diary doesn't exist — nothing to archive
  }

  // Check if diary has any real content beyond the template header
  const diaryTemplate = await loadTemplateContent("memory/diary.md");
  const hasContent =
    oldDiaryContent.trim().length > 0 && oldDiaryContent.trim() !== diaryTemplate.trim();

  if (!hasContent) {
    log.info(`diary-archive: ${workspaceDir} — diary is empty/template, skipping archive`);
    return result;
  }

  // Create archive directory
  await fs.mkdir(archiveDir, { recursive: true });
  result.archivePath = archiveDir;

  // Archive diary
  try {
    const archiveDiaryName = `diary-${dateSuffix}.md`;
    const archiveDiaryPath = path.join(archiveDir, archiveDiaryName);

    // Avoid overwriting an existing archive from the same day
    try {
      await fs.access(archiveDiaryPath);
      log.info(`diary-archive: archive already exists at ${archiveDiaryPath}, skipping diary`);
    } catch {
      await fs.writeFile(archiveDiaryPath, oldDiaryContent, "utf-8");
      result.diaryArchived = true;
      log.info(`diary-archive: archived diary → ${archiveDiaryPath}`);
    }
  } catch (err) {
    log.warn(`diary-archive: failed to archive diary: ${String(err)}`);
    result.error = `diary archive failed: ${String(err)}`;
    return result;
  }

  // Archive identity-scratchpad
  try {
    const scratchpadContent = await fs.readFile(scratchpadPath, "utf-8");
    const scratchpadTemplate = await loadTemplateContent("memory/identity-scratchpad.md");
    const scratchpadHasContent =
      scratchpadContent.trim().length > 0 && scratchpadContent.trim() !== scratchpadTemplate.trim();

    if (scratchpadHasContent) {
      const archiveScratchpadName = `scratchpad-${dateSuffix}.md`;
      const archiveScratchpadPath = path.join(archiveDir, archiveScratchpadName);

      try {
        await fs.access(archiveScratchpadPath);
        log.info(
          `diary-archive: scratchpad archive already exists at ${archiveScratchpadPath}, skipping`,
        );
      } catch {
        await fs.writeFile(archiveScratchpadPath, scratchpadContent, "utf-8");
        result.scratchpadArchived = true;
        log.info(`diary-archive: archived scratchpad → ${archiveScratchpadPath}`);
      }
    }
  } catch {
    // Scratchpad missing is fine — not an error
  }

  // Build the new diary with excerpt from old one
  const archiveRef = `memory/archive/${archiveSubdir}/diary-${dateSuffix}.md`;
  const excerpt = extractTailExcerpt(oldDiaryContent, EXCERPT_TAIL_LINES);
  const newDiaryContent = buildNewDiary(diaryTemplate, archiveRef, excerpt);

  // Reset diary to new template + excerpt
  await fs.writeFile(diaryPath, newDiaryContent, "utf-8");
  log.info(`diary-archive: reset diary with continuity excerpt`);

  // Reset identity-scratchpad to template
  if (result.scratchpadArchived) {
    const scratchpadTemplate = await loadTemplateContent("memory/identity-scratchpad.md");
    await fs.writeFile(scratchpadPath, scratchpadTemplate, "utf-8");
    log.info(`diary-archive: reset identity-scratchpad to template`);
  }

  // Update state
  await writeArchiveState(workspaceDir, { lastArchiveAtMs: Date.now() });

  return result;
}

// ---------------------------------------------------------------------------
// Excerpt & template helpers
// ---------------------------------------------------------------------------

/**
 * Extract the last N non-empty lines from content for use as a continuity excerpt.
 */
export function extractTailExcerpt(content: string, lineCount: number): string {
  const lines = content.split("\n");
  // Take from the tail, skipping trailing blanks
  let endIdx = lines.length;
  while (endIdx > 0 && lines[endIdx - 1].trim() === "") {
    endIdx--;
  }
  const startIdx = Math.max(0, endIdx - lineCount);
  return lines.slice(startIdx, endIdx).join("\n");
}

/**
 * Build a fresh diary.md with a reference to the archived diary and an excerpt.
 */
export function buildNewDiary(template: string, archiveRef: string, excerpt: string): string {
  const sections = [
    template.trimEnd(),
    "",
    "## Previous Period",
    `<!-- PREVIOUS_ARCHIVE: ${archiveRef} -->`,
    `> Archived to: \`${archiveRef}\``,
    "> A continuity summary will be written by the diary-post-archive job.",
    ">",
    "> **Excerpt (last entries):**",
  ];

  // Blockquote the excerpt lines
  if (excerpt.trim()) {
    for (const line of excerpt.split("\n")) {
      sections.push(`> ${line}`);
    }
  } else {
    sections.push("> _(no entries)_");
  }

  sections.push(""); // trailing newline
  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Multi-agent sweep
// ---------------------------------------------------------------------------

/**
 * Run diary archive for all agent workspaces that are due.
 */
export async function runDiaryArchiveSweep(
  cfg: OpenClawConfig,
  intervalMs: number = DEFAULT_DIARY_ARCHIVE_INTERVAL_MS,
): Promise<DiaryArchiveResult[]> {
  const agentIds = listAgentIds(cfg);
  const results: DiaryArchiveResult[] = [];
  const nowMs = Date.now();

  for (const agentId of agentIds) {
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    try {
      // Check if workspace exists
      await fs.access(workspaceDir);
    } catch {
      continue; // Workspace doesn't exist, skip
    }

    // Check if archive is due
    const state = await readArchiveState(workspaceDir);
    if (state.lastArchiveAtMs && nowMs - state.lastArchiveAtMs < intervalMs) {
      continue; // Not due yet
    }

    try {
      const result = await runDiaryArchiveForWorkspace(workspaceDir);
      results.push(result);
    } catch (err) {
      log.warn(`diary-archive: failed for workspace ${workspaceDir}: ${String(err)}`);
      results.push({
        workspaceDir,
        diaryArchived: false,
        scratchpadArchived: false,
        error: String(err),
      });
    }
  }

  if (results.length > 0) {
    const archived = results.filter((r) => r.diaryArchived).length;
    log.info(`diary-archive: sweep complete — ${archived}/${results.length} workspace(s) archived`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Timer lifecycle
// ---------------------------------------------------------------------------

let activeTimer: ReturnType<typeof setInterval> | null = null;

export type DiaryArchiveTimerDeps = {
  cfg: OpenClawConfig;
  intervalMs?: number;
};

/**
 * Start the diary archive timer. Checks every 60s whether any workspace is due.
 * Safe to call multiple times — stops any existing timer first.
 */
export function startDiaryArchiveTimer(deps: DiaryArchiveTimerDeps): void {
  stopDiaryArchiveTimer();

  const intervalMs = deps.intervalMs ?? DEFAULT_DIARY_ARCHIVE_INTERVAL_MS;

  const tick = () => {
    void runDiaryArchiveSweep(deps.cfg, intervalMs).catch((err) => {
      log.warn(`diary-archive: sweep failed unexpectedly: ${String(err)}`);
    });
  };

  activeTimer = setInterval(tick, TIMER_TICK_MS);

  // Unref so the timer doesn't prevent process exit
  if (activeTimer && typeof activeTimer === "object" && "unref" in activeTimer) {
    activeTimer.unref();
  }

  const intervalDays = Math.round(intervalMs / (24 * 60 * 60 * 1000));
  log.info(`diary-archive: timer started — archive interval is ${intervalDays} day(s)`);

  // Run an immediate check on startup
  tick();
}

/**
 * Stop the diary archive timer.
 */
export function stopDiaryArchiveTimer(): void {
  if (activeTimer !== null) {
    clearInterval(activeTimer);
    activeTimer = null;
  }
}
