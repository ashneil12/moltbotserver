/**
 * Deterministic diary archive & memory pruning.
 *
 * Two complementary mechanisms keep agent memory files manageable:
 *
 * 1. **Full archive** (default every 14 days): moves `memory/diary.md`,
 *    `memory/identity-scratchpad.md`, and `memory/self-review.md` to
 *    `memory/archive/YYYY-MM/` and resets them to clean templates.  The
 *    new `diary.md` is seeded with a raw excerpt (last ~30 lines) from
 *    the old diary plus a marker pointing to the full archive.
 *
 * 2. **Size-triggered pruning** (checked every tick): if any memory file
 *    exceeds {@link MAX_MEMORY_FILE_BYTES} (30 KB), the oldest entries
 *    are moved to an overflow archive, keeping only the most recent
 *    {@link MAX_ENTRIES_TO_KEEP} entries in the hot file.  This prevents
 *    files from growing large enough to cause LLM edit failures.
 *
 * Lifecycle: started alongside the CronService in `server-cron.ts`.
 */

import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { listAgentIds, resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { resolveWorkspaceTemplateDir } from "../agents/workspace-templates.js";
import type { OpenClawConfig } from "../config/config.js";
import { atomicWriteFile } from "../infra/atomic-file.js";
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
const SELF_REVIEW_RELATIVE_PATH = "memory/self-review.md";
const ARCHIVE_STATE_FILENAME = ".diary-archive-state.json";

/** Signal file written by the archiver to coordinate with the diary-post-archive cron. */
export const CONTINUITY_PENDING_FILENAME = ".diary-continuity-pending";

/** Downloads older than this are pruned from the agent workspace downloads/ folder. */
const DOWNLOADS_PRUNE_AFTER_MS = 10 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// WORKING.md pruning constants
// ---------------------------------------------------------------------------

/**
 * Open loops older than this are considered stale and removed from WORKING.md.
 * 7 days matches the existing instruction in the WORKING.md template.
 */
export const WORKING_STALE_LOOP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Daily dated memory log files (memory/YYYY-MM-DD.md) older than this are
 * deleted.  Important content should already be distilled into MEMORY.md /
 * self-review.md long before this threshold is reached.
 */
export const DAILY_MEMORY_LOG_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

/** Regex that matches a dated daily memory log filename. */
const DAILY_LOG_FILENAME_RE = /^\d{4}-\d{2}-\d{2}\.md$/;

// ---------------------------------------------------------------------------
// Size-triggered pruning constants
// ---------------------------------------------------------------------------

/** Prune a memory file once it exceeds this size.  30 KB keeps files
 *  comfortably within LLM edit-tool reliability bounds. */
export const MAX_MEMORY_FILE_BYTES = 30 * 1024;

/** How many most-recent entries to retain in the hot file after pruning. */
export const MAX_ENTRIES_TO_KEEP = 15;

// ---------------------------------------------------------------------------
// Download pruning
// ---------------------------------------------------------------------------

/**
 * Delete files in `<workspaceDir>/downloads/` that have not been modified
 * for longer than `maxAgeMs`. Subdirectories are left intact.
 */
async function pruneOldDownloads(
  workspaceDir: string,
  maxAgeMs: number = DOWNLOADS_PRUNE_AFTER_MS,
): Promise<void> {
  const downloadsDir = path.join(workspaceDir, "downloads");
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(downloadsDir, { withFileTypes: true });
  } catch {
    // Downloads folder doesn't exist yet — nothing to prune
    return;
  }
  const cutoffMs = Date.now() - maxAgeMs;
  let pruned = 0;
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const filePath = path.join(downloadsDir, entry.name);
    try {
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs < cutoffMs) {
        await fs.unlink(filePath);
        pruned += 1;
      }
    } catch {
      // Best-effort; skip files we can't stat or delete
    }
  }
  if (pruned > 0) {
    log.info(`diary-archive: pruned ${pruned} old download(s) from ${downloadsDir}`);
  }
}

// ---------------------------------------------------------------------------
// Entry parsing for size-triggered pruning
// ---------------------------------------------------------------------------

/**
 * Describes how entries are delimited in a particular memory file.
 * - `h3Date`: entries start with `### YYYY-MM-DD` (diary, scratchpad)
 * - `bracketDate`: entries start with `[YYYY-MM-DD` (self-review)
 */
export type EntryFormat = "h3Date" | "bracketDate";

const ENTRY_FORMAT_MAP: Record<string, EntryFormat> = {
  [DIARY_RELATIVE_PATH]: "h3Date",
  [SCRATCHPAD_RELATIVE_PATH]: "h3Date",
  [SELF_REVIEW_RELATIVE_PATH]: "bracketDate",
};

/** Regex that matches the start of a new entry for each format. */
const ENTRY_START_REGEX: Record<EntryFormat, RegExp> = {
  h3Date: /^### \d{4}-\d{2}-\d{2}/,
  bracketDate: /^\[\d{4}-\d{2}-\d{2}/,
};

/**
 * Split file content into a header (template / preamble before the first
 * entry) and an ordered list of entry strings.  Each entry includes its
 * delimiter line and all subsequent lines until the next entry or EOF.
 */
export function extractEntries(
  content: string,
  format: EntryFormat,
): { header: string; entries: string[] } {
  const lines = content.split("\n");
  const regex = ENTRY_START_REGEX[format];

  let firstEntryIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      firstEntryIdx = i;
      break;
    }
  }

  if (firstEntryIdx === -1) {
    // No entries found — entire content is header
    return { header: content, entries: [] };
  }

  const header = lines.slice(0, firstEntryIdx).join("\n");

  // Split remaining lines into entries
  const entries: string[] = [];
  let currentEntry: string[] = [];

  for (let i = firstEntryIdx; i < lines.length; i++) {
    if (regex.test(lines[i]) && currentEntry.length > 0) {
      entries.push(currentEntry.join("\n"));
      currentEntry = [];
    }
    currentEntry.push(lines[i]);
  }
  if (currentEntry.length > 0) {
    entries.push(currentEntry.join("\n"));
  }

  return { header, entries };
}

// ---------------------------------------------------------------------------
// Size-triggered pruning
// ---------------------------------------------------------------------------

export type PruneResult = {
  /** Relative path of the file that was checked. */
  file: string;
  /** Whether pruning actually occurred. */
  pruned: boolean;
  /** Number of entries moved to the overflow archive. */
  entriesMoved: number;
  /** Overflow archive path (if written). */
  overflowPath?: string;
};

/**
 * Check a single memory file.  If it exceeds {@link MAX_MEMORY_FILE_BYTES},
 * keep only the last {@link MAX_ENTRIES_TO_KEEP} entries and archive the
 * rest to `memory/archive/YYYY-MM/{type}-overflow-{date}.md`.
 */
export async function pruneMemoryFileIfNeeded(
  workspaceDir: string,
  relativePath: string,
  maxBytes: number = MAX_MEMORY_FILE_BYTES,
  maxEntries: number = MAX_ENTRIES_TO_KEEP,
): Promise<PruneResult> {
  const filePath = path.join(workspaceDir, relativePath);
  const result: PruneResult = { file: relativePath, pruned: false, entriesMoved: 0 };

  // 1. Check file size
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return result; // File doesn't exist
  }
  if (stat.size <= maxBytes) {
    return result; // Under threshold
  }

  // 2. Read and parse entries
  const format = ENTRY_FORMAT_MAP[relativePath];
  if (!format) {
    log.warn(`memory-prune: unknown entry format for ${relativePath}, skipping`);
    return result;
  }

  const content = await fs.readFile(filePath, "utf-8");
  const { header, entries } = extractEntries(content, format);

  if (entries.length <= maxEntries) {
    // Not enough entries to prune — file is big but not entry-dense.
    // This can happen if entries are very long.  We still log it.
    log.info(
      `memory-prune: ${relativePath} is ${Math.round(stat.size / 1024)}KB ` +
        `but only has ${entries.length} entries (threshold: ${maxEntries}), skipping`,
    );
    return result;
  }

  // 3. Split into cold (to archive) and hot (to keep)
  const coldEntries = entries.slice(0, entries.length - maxEntries);
  const hotEntries = entries.slice(entries.length - maxEntries);

  // 4. Write cold entries to overflow archive
  const now = new Date();
  const archiveSubdir = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}`;
  const dateSuffix = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")}`;
  const archiveDir = path.join(workspaceDir, "memory", "archive", archiveSubdir);
  await fs.mkdir(archiveDir, { recursive: true });

  // Derive basename: memory/diary.md → diary, memory/self-review.md → self-review
  const baseName = path.basename(relativePath, ".md");
  const overflowName = `${baseName}-overflow-${dateSuffix}.md`;
  const overflowPath = path.join(archiveDir, overflowName);

  // If an overflow file already exists today, append to it
  let existingOverflow = "";
  try {
    existingOverflow = await fs.readFile(overflowPath, "utf-8");
    if (!existingOverflow.endsWith("\n")) {
      existingOverflow += "\n";
    }
  } catch {
    // No existing overflow — start fresh
  }

  const overflowContent = existingOverflow + coldEntries.join("\n") + "\n";
  await atomicWriteFile(overflowPath, overflowContent);

  // 5. Rewrite hot file: header + retained entries
  const hotContent = header + (header.endsWith("\n") ? "" : "\n") + hotEntries.join("\n") + "\n";
  await atomicWriteFile(filePath, hotContent);

  result.pruned = true;
  result.entriesMoved = coldEntries.length;
  result.overflowPath = overflowPath;

  log.info(
    `memory-prune: pruned ${relativePath} — moved ${coldEntries.length} entries to ` +
      `${path.relative(workspaceDir, overflowPath)}, kept ${hotEntries.length}`,
  );

  return result;
}

/**
 * Run the size-triggered pruner on all three memory files for a workspace.
 * This is cheap to call repeatedly — it no-ops when files are small.
 */
export async function runMemoryPruneForWorkspace(workspaceDir: string): Promise<PruneResult[]> {
  const results: PruneResult[] = [];
  for (const relPath of [
    DIARY_RELATIVE_PATH,
    SCRATCHPAD_RELATIVE_PATH,
    SELF_REVIEW_RELATIVE_PATH,
  ]) {
    try {
      results.push(await pruneMemoryFileIfNeeded(workspaceDir, relPath));
    } catch (err) {
      log.warn(`memory-prune: failed to prune ${relPath} in ${workspaceDir}: ${String(err)}`);
      results.push({ file: relPath, pruned: false, entriesMoved: 0 });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Deterministic MISS → CRITICAL promotion (Fix 1)
// ---------------------------------------------------------------------------

const IDENTITY_RELATIVE_PATH = "IDENTITY.md";

/** Minimum number of MISS occurrences with the same FIX before auto-promotion. */
export const MISS_PROMOTION_THRESHOLD = 3;

export type MissPromotionResult = {
  /** Number of new CRITICAL rules added to IDENTITY.md. */
  promoted: number;
  /** The FIX texts that were promoted. */
  promotedFixes: string[];
};

/**
 * Extract MISS entries with their FIX text from self-review.md content.
 * Returns a map of normalized FIX text → occurrence count.
 */
export function countMissPatterns(selfReviewContent: string): Map<string, number> {
  const counts = new Map<string, number>();
  // Match lines like: MISS: ... FIX: <concrete fix text>
  // or: MISS: ... — FIX: <concrete fix text>
  const missFixRegex = /MISS:.*?(?:—\s*)?FIX:\s*(.+)/g;
  let match: RegExpExecArray | null;

  while ((match = missFixRegex.exec(selfReviewContent)) !== null) {
    // Normalize: trim, lowercase, collapse whitespace
    const fix = match[1].trim().toLowerCase().replace(/\s+/g, " ");
    if (fix.length > 10) {
      // Skip trivially short FIX texts
      counts.set(fix, (counts.get(fix) ?? 0) + 1);
    }
  }

  return counts;
}

/**
 * Extract existing CRITICAL rules from IDENTITY.md content.
 * Returns them as normalized lowercase strings for dedup comparison.
 * Strips evidence counter tags `[XH/YM]` if present.
 */
export function extractExistingCriticalRules(identityContent: string): Set<string> {
  const rules = new Set<string>();
  // Match both plain "CRITICAL:" and markdown "**CRITICAL:**" variants,
  // with optional evidence counters like [5H/2M]
  const criticalRegex = /\*{0,2}CRITICAL(?:\s*\[\d+H\/\d+M\])?:?\*{0,2}\s*(.+)/g;
  let match: RegExpExecArray | null;

  while ((match = criticalRegex.exec(identityContent)) !== null) {
    // Strip any remaining markdown bold markers from the captured text
    const cleaned = match[1].replace(/\*{2}/g, "").trim().toLowerCase().replace(/\s+/g, " ");
    if (cleaned.length > 0) {
      rules.add(cleaned);
    }
  }

  return rules;
}

// ---------------------------------------------------------------------------
// Evidence counters on CRITICAL rules  (ACE-inspired)
// ---------------------------------------------------------------------------

/** Parsed evidence counters from a CRITICAL rule. */
export type EvidenceCounters = {
  hits: number;
  misses: number;
};

/** A CRITICAL rule that has been flagged as problematic (misses ≥ hits). */
export type ProblematicRule = {
  text: string;
  hits: number;
  misses: number;
};

/**
 * Parse evidence counters from a CRITICAL rule line.
 * Matches `[XH/YM]` where X and Y are non-negative integers.
 * Returns `null` for rules without counters (backward compat).
 */
export function parseEvidenceCounters(ruleLine: string): EvidenceCounters | null {
  const match = ruleLine.match(/\[(\d+)H\/(\d+)M\]/);
  if (!match) {
    return null;
  }
  return { hits: parseInt(match[1], 10), misses: parseInt(match[2], 10) };
}

/**
 * Crude prefix stemmer: keeps the first 4 characters of a word.
 * Handles common inflections (verify/verified, call/calling, check/checked).
 */
function stemWord(word: string): string {
  return word.length > 4 ? word.slice(0, 4) : word;
}

/** Build a set of stemmed significant words from text. */
function buildStemSet(text: string): Set<string> {
  return new Set(
    text
      .split(" ")
      .filter((w) => w.length > 2)
      .map(stemWord),
  );
}

/**
 * Deterministically correlate HIT/MISS entries from self-review.md with
 * existing CRITICAL rules in IDENTITY.md.
 *
 * For each HIT or MISS entry that mentions content overlapping with a
 * CRITICAL rule (50%+ stem overlap), records a hit or miss signal for
 * that rule.  Uses a crude 4-char prefix stemmer to handle common
 * inflections (verify/verified, call/calling, check/checked).
 *
 * Returns a map of normalized rule text → { hits, misses } deltas.
 */
export function correlateHitMissWithRules(
  selfReviewContent: string,
  existingRules: Set<string>,
): Map<string, EvidenceCounters> {
  const deltas = new Map<string, EvidenceCounters>();
  if (existingRules.size === 0) {
    return deltas;
  }

  // Build stemmed word sets for each existing rule once
  const ruleStemSets = new Map<string, Set<string>>();
  for (const rule of existingRules) {
    ruleStemSets.set(rule, buildStemSet(rule));
  }

  // Scan for HIT and MISS entries
  const hitMissRegex = /(HIT|MISS):\s*(.+?)(?:\s*(?:—|\.)?\s*(?:FIX|KEEP|BECAUSE|NOTE):.*)?$/gm;
  let match: RegExpExecArray | null;

  while ((match = hitMissRegex.exec(selfReviewContent)) !== null) {
    const type = match[1] as "HIT" | "MISS";
    const description = match[2].trim().toLowerCase().replace(/\s+/g, " ");
    const descStems = buildStemSet(description);
    if (descStems.size === 0) {
      continue;
    }

    // Find best-matching CRITICAL rule
    let bestRule: string | undefined;
    let bestOverlap = 0;

    for (const [rule, ruleStems] of ruleStemSets) {
      if (ruleStems.size === 0) {
        continue;
      }
      let overlap = 0;
      for (const stem of descStems) {
        if (ruleStems.has(stem)) {
          overlap++;
        }
      }
      const score = overlap / Math.min(descStems.size, ruleStems.size);
      if (score >= 0.5 && overlap > bestOverlap) {
        bestOverlap = overlap;
        bestRule = rule;
      }
    }

    if (bestRule) {
      const existing = deltas.get(bestRule) ?? { hits: 0, misses: 0 };
      if (type === "HIT") {
        existing.hits += 1;
      } else {
        existing.misses += 1;
      }
      deltas.set(bestRule, existing);
    }
  }

  return deltas;
}

/**
 * Update evidence counters on CRITICAL rules in IDENTITY.md content.
 * Increments hit/miss counters based on the provided deltas.
 *
 * Rules without existing `[XH/YM]` counters are left unchanged
 * (backward compat — only rules promoted with counters get them).
 *
 * Returns the updated content, or the original if nothing changed.
 */
export function updateEvidenceCounters(
  identityContent: string,
  deltas: Map<string, EvidenceCounters>,
): string {
  if (deltas.size === 0) {
    return identityContent;
  }

  // Match CRITICAL lines with evidence counters
  return identityContent.replace(
    /(\*{0,2}CRITICAL)\s*\[(\d+)H\/(\d+)M\](:\*{0,2})\s*(.+)/g,
    (fullMatch, prefix, hStr, mStr, colonSuffix, ruleText) => {
      const normalized = ruleText.replace(/\*{2}/g, "").trim().toLowerCase().replace(/\s+/g, " ");
      const delta = deltas.get(normalized);
      if (!delta) {
        return fullMatch;
      }
      const newH = parseInt(hStr as string, 10) + delta.hits;
      const newM = parseInt(mStr as string, 10) + delta.misses;
      return `${prefix} [${newH}H/${newM}M]${colonSuffix} ${ruleText}`;
    },
  );
}

/**
 * Find CRITICAL rules where misses ≥ hits after a minimum observation
 * threshold (3+ total observations).  These rules are candidates for
 * demotion or rewording by the deep-review cron.
 */
export function flagProblematicRules(
  identityContent: string,
  minObservations: number = 3,
): ProblematicRule[] {
  const problematic: ProblematicRule[] = [];
  // Match CRITICAL lines with evidence counters and capture the rule text
  const regex = /\*{0,2}CRITICAL\s*\[(\d+)H\/(\d+)M\]:?\*{0,2}\s*(.+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(identityContent)) !== null) {
    const hits = parseInt(match[1], 10);
    const misses = parseInt(match[2], 10);
    const totalObs = hits + misses;
    if (totalObs >= minObservations && misses >= hits) {
      const text = match[3].replace(/\*{2}/g, "").trim();
      problematic.push({ text, hits, misses });
    }
  }

  return problematic;
}

/**
 * Deterministically scan self-review.md for MISS patterns that have hit
 * the promotion threshold.  For each qualifying pattern, append a
 * `CRITICAL:` rule to IDENTITY.md if not already present.
 *
 * This is the machine-enforced backstop: even if the LLM fails to
 * self-promote during its cron sessions, this function will do it.
 */
export async function promoteMissPatterns(
  workspaceDir: string,
  threshold: number = MISS_PROMOTION_THRESHOLD,
): Promise<MissPromotionResult> {
  const result: MissPromotionResult = { promoted: 0, promotedFixes: [] };

  const selfReviewPath = path.join(workspaceDir, SELF_REVIEW_RELATIVE_PATH);
  const identityPath = path.join(workspaceDir, IDENTITY_RELATIVE_PATH);

  // Read self-review
  let selfReviewContent: string;
  try {
    selfReviewContent = await fs.readFile(selfReviewPath, "utf-8");
  } catch {
    return result; // No self-review file
  }

  // Read identity
  let identityContent: string;
  try {
    identityContent = await fs.readFile(identityPath, "utf-8");
  } catch {
    return result; // No identity file
  }

  // Count MISS patterns
  const missCounts = countMissPatterns(selfReviewContent);
  const existingRules = extractExistingCriticalRules(identityContent);

  // Find patterns that qualify for promotion
  const toPromote: string[] = [];
  for (const [fix, count] of missCounts) {
    if (count >= threshold && !existingRules.has(fix)) {
      // Check if any existing rule is substantially similar (contains the key parts)
      const alreadyCovered = [...existingRules].some((existing) => {
        // Simple overlap check: if 60%+ of words match, consider it covered
        const fixWords = new Set(fix.split(" ").filter((w) => w.length > 3));
        const existingWords = new Set(existing.split(" ").filter((w) => w.length > 3));
        if (fixWords.size === 0) {
          return false;
        }
        let overlap = 0;
        for (const word of fixWords) {
          if (existingWords.has(word)) {
            overlap++;
          }
        }
        return overlap / fixWords.size > 0.6;
      });

      if (!alreadyCovered) {
        // Capitalize first letter for the CRITICAL rule
        const capitalizedFix = fix.charAt(0).toUpperCase() + fix.slice(1);
        toPromote.push(capitalizedFix);
      }
    }
  }

  if (toPromote.length === 0) {
    return result;
  }

  // Append CRITICAL rules to IDENTITY.md
  // Find or create the "## CRITICAL Rules" section
  const criticalSectionHeader = "## CRITICAL Rules";
  let newIdentityContent: string;

  if (
    identityContent.includes(criticalSectionHeader) ||
    identityContent.includes("## Critical Rules")
  ) {
    // Append after the existing section header
    const insertPoint = identityContent.includes(criticalSectionHeader)
      ? criticalSectionHeader
      : "## Critical Rules";
    const idx = identityContent.indexOf(insertPoint);
    const afterHeader = idx + insertPoint.length;
    // Find the end of the line
    const lineEnd = identityContent.indexOf("\n", afterHeader);
    const insertIdx = lineEnd === -1 ? identityContent.length : lineEnd;

    const newRules = toPromote.map((fix) => `\n- **CRITICAL [0H/0M]:** ${fix}`).join("");

    newIdentityContent =
      identityContent.slice(0, insertIdx) + newRules + identityContent.slice(insertIdx);
  } else {
    // Create new CRITICAL Rules section before the first ## section or at end
    const newSection =
      `\n\n${criticalSectionHeader}\n` +
      toPromote.map((fix) => `\n- **CRITICAL [0H/0M]:** ${fix}`).join("") +
      "\n";

    // Try to insert before "## How You Work" or "## Personal Preferences" or append
    const insertBefore = identityContent.indexOf("## How You Work");
    if (insertBefore !== -1) {
      newIdentityContent =
        identityContent.slice(0, insertBefore) +
        newSection +
        "\n" +
        identityContent.slice(insertBefore);
    } else {
      newIdentityContent = identityContent + newSection;
    }
  }

  // Atomic write
  await atomicWriteFile(identityPath, newIdentityContent);

  result.promoted = toPromote.length;
  result.promotedFixes = toPromote;

  log.info(
    `miss-promotion: promoted ${toPromote.length} MISS pattern(s) to CRITICAL in ` +
      `${path.basename(workspaceDir)}/IDENTITY.md: ${toPromote.join("; ")}`,
  );

  return result;
}

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
  await atomicWriteFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
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
    if (relativePath.includes("self-review")) {
      return "# Self-Review Log\n\n> Read on boot. Log mistakes (MISS) and successes (HIT).\n> If same MISS appears 3x, promote to CRITICAL rule.\n";
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
  selfReviewArchived: boolean;
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
  const selfReviewPath = path.join(workspaceDir, SELF_REVIEW_RELATIVE_PATH);

  const result: DiaryArchiveResult = {
    workspaceDir,
    diaryArchived: false,
    scratchpadArchived: false,
    selfReviewArchived: false,
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

  // Archive self-review.md
  try {
    const selfReviewContent = await fs.readFile(selfReviewPath, "utf-8");
    const selfReviewTemplate = await loadTemplateContent("memory/self-review.md");
    const selfReviewHasContent =
      selfReviewContent.trim().length > 0 && selfReviewContent.trim() !== selfReviewTemplate.trim();

    if (selfReviewHasContent) {
      const archiveSelfReviewName = `self-review-${dateSuffix}.md`;
      const archiveSelfReviewPath = path.join(archiveDir, archiveSelfReviewName);

      try {
        await fs.access(archiveSelfReviewPath);
        log.info(
          `diary-archive: self-review archive already exists at ${archiveSelfReviewPath}, skipping`,
        );
      } catch {
        await fs.writeFile(archiveSelfReviewPath, selfReviewContent, "utf-8");
        result.selfReviewArchived = true;
        log.info(`diary-archive: archived self-review → ${archiveSelfReviewPath}`);
      }
    }
  } catch {
    // Self-review missing is fine — not an error
  }

  // Reset self-review to template
  if (result.selfReviewArchived) {
    const selfReviewTemplate = await loadTemplateContent("memory/self-review.md");
    await fs.writeFile(selfReviewPath, selfReviewTemplate, "utf-8");
    log.info(`diary-archive: reset self-review to template`);
  }

  // Update state
  await writeArchiveState(workspaceDir, { lastArchiveAtMs: Date.now() });

  // Signal the diary-post-archive cron that a fresh archive is ready for
  // continuity enrichment.  This solves the scheduling race condition: the
  // deterministic archiver and the LLM cron job are independently timed, so
  // the cron may fire before the archiver runs (or vice versa).  The cron
  // prompt checks for this file and responds HEARTBEAT_OK if absent.
  if (result.diaryArchived) {
    const pendingPath = path.join(workspaceDir, "memory", CONTINUITY_PENDING_FILENAME);
    const pendingData = {
      archivedAtMs: Date.now(),
      archiveRef,
    };
    await atomicWriteFile(pendingPath, `${JSON.stringify(pendingData, null, 2)}\n`);
    log.info(`diary-archive: wrote continuity-pending signal → ${pendingPath}`);
  }

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
// WORKING.md pruning
// ---------------------------------------------------------------------------

export type WorkingMdPruneResult = {
  /** Whether any stale open loops were removed. */
  staleLoopsRemoved: number;
  /** Whether any completed task lines were archived to the day log. */
  completedTasksArchived: number;
};

/**
 * Prune WORKING.md by:
 * 1. Removing open-loop checklist items (`- [ ] ...`) that carry an "added
 *    DATE" annotation older than `staleAgeMs` (default 7 days).
 * 2. Moving completed checklist items (`- [x] ...`) to today's dated memory
 *    log so WORKING.md stays focused on active state only.
 *
 * Both operations are best-effort and atomic (write-then-rename).
 * Skipped if WORKING.md doesn't exist or contains only template placeholders.
 */
export async function pruneWorkingMd(
  workspaceDir: string,
  nowMs: number = Date.now(),
  staleAgeMs: number = WORKING_STALE_LOOP_MAX_AGE_MS,
): Promise<WorkingMdPruneResult> {
  const result: WorkingMdPruneResult = { staleLoopsRemoved: 0, completedTasksArchived: 0 };
  const workingPath = path.join(workspaceDir, "WORKING.md");

  let content: string;
  try {
    content = await fs.readFile(workingPath, "utf-8");
  } catch {
    return result; // File doesn't exist yet
  }

  // Skip pure template files (contain placeholder brackets)
  if (content.includes("[What you") || content.includes("[Example:")) {
    return result;
  }

  const cutoffMs = nowMs - staleAgeMs;

  // Matches open-loop items with a date annotation in one of these forms:
  //   "- [ ] Check deploy — added 2026-03-01"   (em-dash)
  //   "- [ ] Check deploy - added 2026-03-01"    (space + hyphen + space)
  //   "- [ ] Check deploy (added 2026-03-01)"    (parenthetical)
  // The bare-hyphen variant requires surrounding spaces to avoid matching
  // hyphenated words inside the task description (e.g. "fix broken-deploy").
  const staleLoopRe = /^\s*- \[ \] .+?(?:—|\s-\s|\()\s*added\s+(\d{4}-\d{2}-\d{2})/i;

  const lines = content.split("\n");
  const keptLines: string[] = [];
  const completedLines: string[] = [];
  let staleRemoved = 0;

  for (const line of lines) {
    // Detect completed checklist items
    if (/^\s*- \[x\]/i.test(line)) {
      completedLines.push(line.trim());
      result.completedTasksArchived++;
      continue; // archive it, don't keep in WORKING.md
    }

    // Detect stale open loops
    const staleMatch = staleLoopRe.exec(line);
    if (staleMatch) {
      const dateStr = staleMatch[1];
      if (dateStr) {
        const entryMs = Date.parse(dateStr);
        if (Number.isFinite(entryMs) && entryMs < cutoffMs) {
          staleRemoved++;
          continue; // drop the line
        }
      }
    }

    keptLines.push(line);
  }

  result.staleLoopsRemoved = staleRemoved;
  const changed = staleRemoved > 0 || completedLines.length > 0;
  if (!changed) {
    return result;
  }

  // Archive completed tasks to today's daily memory log
  if (completedLines.length > 0) {
    const dateStr = new Date(nowMs).toISOString().slice(0, 10);
    const dailyLogPath = path.join(workspaceDir, "memory", `${dateStr}.md`);
    const header = `\n### Completed tasks archived from WORKING.md\n`;
    // Lines already contain the full `- [x] ...` text; write them as-is.
    const body = completedLines.join("\n") + "\n";
    try {
      await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
      await fs.appendFile(dailyLogPath, header + body, "utf-8");
      log.info(
        `working-prune: archived ${completedLines.length} completed task(s) to ${dateStr}.md`,
      );
    } catch (err) {
      log.warn(`working-prune: failed to append to daily log: ${String(err)}`);
    }
  }

  // Rewrite WORKING.md (atomic)
  const newContent = keptLines.join("\n");
  const tmpPath = `${workingPath}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    await fs.writeFile(tmpPath, newContent, "utf-8");
    await fs.rename(tmpPath, workingPath);
    if (staleRemoved > 0) {
      log.info(`working-prune: removed ${staleRemoved} stale open loop(s) from WORKING.md`);
    }
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    log.warn(`working-prune: failed to rewrite WORKING.md: ${String(err)}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Daily memory log cleanup
// ---------------------------------------------------------------------------

/**
 * Delete dated daily memory log files (`memory/YYYY-MM-DD.md`) that are older
 * than `maxAgeMs` (default 60 days).  Important content from these files should
 * already be distilled into MEMORY.md / self-review.md long before this runs.
 *
 * The `memory/archive/` subtree and non-date-named files are never touched.
 */
export async function pruneOldDailyMemoryLogs(
  workspaceDir: string,
  maxAgeMs: number = DAILY_MEMORY_LOG_MAX_AGE_MS,
  nowMs: number = Date.now(),
): Promise<number> {
  const memoryDir = path.join(workspaceDir, "memory");
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(memoryDir, { withFileTypes: true });
  } catch {
    return 0; // memory/ doesn't exist yet
  }

  const cutoffMs = nowMs - maxAgeMs;
  let deleted = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !DAILY_LOG_FILENAME_RE.test(entry.name)) {
      continue; // skip directories (archive/) and non-dated files
    }
    const filePath = path.join(memoryDir, entry.name);
    try {
      // Parse the date from the filename itself — cheaper than statting for mtime
      const dateMs = Date.parse(entry.name.slice(0, 10));
      if (Number.isFinite(dateMs) && dateMs < cutoffMs) {
        await fs.unlink(filePath);
        deleted++;
      }
    } catch {
      // Best-effort; skip files we can't parse or delete
    }
  }

  if (deleted > 0) {
    log.info(
      `daily-log-prune: deleted ${deleted} daily memory log(s) older than 60 days from ${memoryDir}`,
    );
  }

  return deleted;
}

// ---------------------------------------------------------------------------
// Multi-agent sweep
// ---------------------------------------------------------------------------

/**
 * Run diary archive for all agent workspaces that are due, and run
 * the size-triggered memory pruner on **every** workspace regardless
 * of whether a full archive is due.
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

    // ── Size-triggered pruning (every tick, cheap no-op when small) ──
    await runMemoryPruneForWorkspace(workspaceDir).catch((err) =>
      log.warn(`memory-prune: sweep failed for ${workspaceDir}: ${String(err)}`),
    );

    // ── WORKING.md pruning: evict stale loops + archive completed tasks ──
    await pruneWorkingMd(workspaceDir).catch((err) =>
      log.warn(`working-prune: sweep failed for ${workspaceDir}: ${String(err)}`),
    );

    // ── Daily memory log cleanup: delete logs older than 60 days ──
    await pruneOldDailyMemoryLogs(workspaceDir).catch((err) =>
      log.warn(`daily-log-prune: sweep failed for ${workspaceDir}: ${String(err)}`),
    );

    // ── Deterministic MISS → CRITICAL promotion (every tick, cheap scan) ──
    await promoteMissPatterns(workspaceDir).catch((err) =>
      log.warn(`miss-promotion: sweep failed for ${workspaceDir}: ${String(err)}`),
    );

    // ── Full archive (time-gated) ──
    const state = await readArchiveState(workspaceDir);
    if (state.lastArchiveAtMs && nowMs - state.lastArchiveAtMs < intervalMs) {
      // Not due for full archive — still do download pruning
      await pruneOldDownloads(workspaceDir).catch((err) =>
        log.warn(`diary-archive: download prune failed for ${workspaceDir}: ${String(err)}`),
      );
      continue;
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
        selfReviewArchived: false,
        error: String(err),
      });
    }

    // Always prune old downloads regardless of whether a diary archive ran.
    await pruneOldDownloads(workspaceDir).catch((err) =>
      log.warn(`diary-archive: download prune failed for ${workspaceDir}: ${String(err)}`),
    );
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
