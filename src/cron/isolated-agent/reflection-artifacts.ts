import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import { loadSessionStore, resolveStorePath } from "../../config/sessions.js";
import { isCronSessionKey } from "../../routing/session-key.js";
import {
  correlateHitMissWithRules,
  countMissPatterns,
  extractEntries,
  extractExistingCriticalRules,
  flagProblematicRules,
  promoteMissPatterns,
  updateEvidenceCounters,
  type ProblematicRule,
} from "../diary-archive.js";

const REFLECTION_JOB_SUFFIXES = ["consciousness", "self-review", "deep-review"] as const;

const REFLECTION_WATCHED_FILES = [
  "WORKING.md",
  "IDENTITY.md",
  "MEMORY.md",
  "memory/diary.md",
  "memory/identity-scratchpad.md",
  "memory/open-loops.md",
  "memory/self-review.md",
] as const;

const SELF_REVIEW_RELATIVE_PATH = "memory/self-review.md";
const IDENTITY_RELATIVE_PATH = "IDENTITY.md";
const SCRATCHPAD_RELATIVE_PATH = "memory/identity-scratchpad.md";
const REFLECTION_STATE_RELATIVE_PATH = "memory/.reflection-state.json";
export const REFLECTION_INBOX_RELATIVE_PATH = "memory/reflection-inbox.md";
const REFLECTION_CHANGE_LOG_RELATIVE_PATH = "memory/reflection-change-log.jsonl";

/** Maximum number of entries to keep in the reflection change log. */
const CHANGE_LOG_MAX_ENTRIES = 200;

export const CONSCIOUSNESS_IDENTITY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const CONSCIOUSNESS_MAX_IDENTITY_CHANGED_LINES = 16;

const META_SELF_REVIEW_PATTERNS = [
  "approaching promotion threshold",
  "pattern confirmed:",
  "pattern check:",
  "pattern insight:",
  "pattern breakthrough:",
] as const;

type ReflectionState = {
  lastIdentityWriteAtMs?: number;
  lastIdentityWriteByJobId?: string;
};

type ReflectionSessionActivity = {
  countSinceLastRun: number;
  latestUpdatedAtMs?: number;
};

export type ReflectionInboxSummary = {
  changedFiles: string[];
  promotionsDue: string[];
  watchFixes: string[];
  sessionActivity: ReflectionSessionActivity;
  state: ReflectionState;
  problematicRules: ProblematicRule[];
};

export type ReflectionFileSnapshot = {
  identity?: string;
  scratchpad?: string;
  selfReview?: string;
};

function normalizeJobId(jobId: string | undefined): string {
  return jobId?.trim().toLowerCase() ?? "";
}

export function isReflectionJobId(jobId: string | undefined): boolean {
  const normalized = normalizeJobId(jobId);
  return REFLECTION_JOB_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`-${suffix}`),
  );
}

export function isConsciousnessJobId(jobId: string | undefined): boolean {
  const normalized = normalizeJobId(jobId);
  return normalized === "consciousness" || normalized.endsWith("-consciousness");
}

export function isSelfReviewJobId(jobId: string | undefined): boolean {
  const normalized = normalizeJobId(jobId);
  return normalized === "self-review" || normalized.endsWith("-self-review");
}

export function isDeepReviewJobId(jobId: string | undefined): boolean {
  const normalized = normalizeJobId(jobId);
  return normalized === "deep-review" || normalized.endsWith("-deep-review");
}

function formatUtcTimestamp(ms: number | undefined): string | undefined {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    return undefined;
  }
  return new Date(ms).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function normalizeWhitespace(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function hashContent(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function readTextFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function writeTextFileIfChanged(filePath: string, next: string): Promise<boolean> {
  const existing = await readTextFileIfExists(filePath);
  if (existing === next) {
    return false;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    await fs.writeFile(tmpPath, next, "utf-8");
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => {});
    throw error;
  }
  return true;
}

async function writeOptionalFile(filePath: string, content: string | undefined): Promise<void> {
  if (content === undefined) {
    await fs.unlink(filePath).catch(() => {});
    return;
  }
  await writeTextFileIfChanged(filePath, content);
}

async function readReflectionState(workspaceDir: string): Promise<ReflectionState> {
  const statePath = path.join(workspaceDir, REFLECTION_STATE_RELATIVE_PATH);
  const raw = await readTextFileIfExists(statePath);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      lastIdentityWriteAtMs:
        typeof parsed.lastIdentityWriteAtMs === "number" ? parsed.lastIdentityWriteAtMs : undefined,
      lastIdentityWriteByJobId:
        typeof parsed.lastIdentityWriteByJobId === "string"
          ? parsed.lastIdentityWriteByJobId
          : undefined,
    };
  } catch {
    return {};
  }
}

async function writeReflectionState(workspaceDir: string, state: ReflectionState): Promise<void> {
  const statePath = path.join(workspaceDir, REFLECTION_STATE_RELATIVE_PATH);
  await writeTextFileIfChanged(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function collectChangedFilesSince(params: {
  workspaceDir: string;
  lastRunAtMs: number;
}): Promise<string[]> {
  const changed: string[] = [];
  for (const relativePath of REFLECTION_WATCHED_FILES) {
    const absolutePath = path.join(params.workspaceDir, relativePath);
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.mtimeMs > params.lastRunAtMs) {
        changed.push(relativePath);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }
  return changed;
}

function collectSessionActivitySince(params: {
  cfg: OpenClawConfig;
  agentId: string;
  lastRunAtMs: number;
}): ReflectionSessionActivity {
  try {
    const storePath = resolveStorePath(params.cfg.session?.store, { agentId: params.agentId });
    const store = loadSessionStore(storePath, { skipCache: true });
    let countSinceLastRun = 0;
    let latestUpdatedAtMs: number | undefined;
    for (const [sessionKey, entry] of Object.entries(store)) {
      if (isCronSessionKey(sessionKey)) {
        continue;
      }
      if (typeof entry?.updatedAt !== "number" || !Number.isFinite(entry.updatedAt)) {
        continue;
      }
      if (entry.updatedAt > params.lastRunAtMs) {
        countSinceLastRun += 1;
      }
      if (latestUpdatedAtMs === undefined || entry.updatedAt > latestUpdatedAtMs) {
        latestUpdatedAtMs = entry.updatedAt;
      }
    }
    return { countSinceLastRun, latestUpdatedAtMs };
  } catch {
    return { countSinceLastRun: 1 };
  }
}

function summarizeMissPatterns(selfReviewContent: string | undefined): {
  promotionsDue: string[];
  watchFixes: string[];
} {
  if (!selfReviewContent) {
    return { promotionsDue: [], watchFixes: [] };
  }
  const counts = [...countMissPatterns(selfReviewContent).entries()].toSorted((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0]);
  });
  const formatFix = (fix: string, count: number) => `${fix} (${count}x)`;
  return {
    promotionsDue: counts
      .filter(([, count]) => count >= 3)
      .map(([fix, count]) => formatFix(fix, count)),
    watchFixes: counts
      .filter(([, count]) => count === 2)
      .map(([fix, count]) => formatFix(fix, count)),
  };
}

function buildReflectionInboxMarkdown(summary: ReflectionInboxSummary): string {
  const lines = [
    "# Reflection Inbox",
    "",
    "> Deterministic summary for reflection cron jobs. Read this first.",
    "",
    "---",
    "",
    "## Activity Since Last Reflection",
  ];

  if (summary.sessionActivity.countSinceLastRun > 0) {
    lines.push(
      `- Non-cron session activity: ${summary.sessionActivity.countSinceLastRun} updated session(s).`,
    );
  } else {
    lines.push("- Non-cron session activity: none.");
  }

  const latestActivity = formatUtcTimestamp(summary.sessionActivity.latestUpdatedAtMs);
  if (latestActivity) {
    lines.push(`- Latest non-cron session update: ${latestActivity}.`);
  }

  if (summary.changedFiles.length > 0) {
    lines.push(`- Changed reflection files: ${summary.changedFiles.join(", ")}.`);
  } else {
    lines.push("- Changed reflection files: none.");
  }

  lines.push("", "## Self-Review Watchlist");
  if (summary.promotionsDue.length > 0) {
    lines.push("- Promotion required:");
    for (const entry of summary.promotionsDue) {
      lines.push(`  - ${entry}`);
    }
  } else {
    lines.push("- Promotion required: none.");
  }

  if (summary.watchFixes.length > 0) {
    lines.push("- Watch for promotion:");
    for (const entry of summary.watchFixes) {
      lines.push(`  - ${entry}`);
    }
  } else {
    lines.push("- Watch for promotion: none.");
  }

  lines.push("", "## Identity Budget");
  lines.push("- Self-review: `IDENTITY.md` is read-only except CRITICAL promotions.");
  lines.push(
    "- Consciousness: default to diary/open-loops/working changes. Prefer `memory/identity-scratchpad.md` when evidence is still forming.",
  );
  lines.push("- Deep review: primary owner of broad identity cleanup and consolidation.");
  const lastIdentityWrite = formatUtcTimestamp(summary.state.lastIdentityWriteAtMs);
  if (lastIdentityWrite && summary.state.lastIdentityWriteByJobId) {
    lines.push(
      `- Last recorded direct identity write: ${lastIdentityWrite} by ${summary.state.lastIdentityWriteByJobId}.`,
    );
  }

  if (summary.problematicRules.length > 0) {
    lines.push("", "## Problematic Rules");
    lines.push(
      "> CRITICAL rules where misses \u2265 hits after 3+ observations. Consider demotion or rewording.",
    );
    for (const rule of summary.problematicRules) {
      lines.push(`- [${rule.hits}H/${rule.misses}M] ${rule.text}`);
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function updateReflectionInbox(params: {
  cfg: OpenClawConfig;
  agentId: string;
  workspaceDir: string;
  lastRunAtMs: number;
}): Promise<ReflectionInboxSummary> {
  const [state, changedFiles, selfReviewContent, identityContent] = await Promise.all([
    readReflectionState(params.workspaceDir),
    collectChangedFilesSince({
      workspaceDir: params.workspaceDir,
      lastRunAtMs: params.lastRunAtMs,
    }),
    readTextFileIfExists(path.join(params.workspaceDir, SELF_REVIEW_RELATIVE_PATH)),
    readTextFileIfExists(path.join(params.workspaceDir, IDENTITY_RELATIVE_PATH)),
  ]);
  const sessionActivity = collectSessionActivitySince({
    cfg: params.cfg,
    agentId: params.agentId,
    lastRunAtMs: params.lastRunAtMs,
  });
  const { promotionsDue, watchFixes } = summarizeMissPatterns(selfReviewContent);
  const problematicRules = identityContent ? flagProblematicRules(identityContent) : [];
  const summary: ReflectionInboxSummary = {
    changedFiles,
    promotionsDue,
    watchFixes,
    sessionActivity,
    state,
    problematicRules,
  };
  const inboxPath = path.join(params.workspaceDir, REFLECTION_INBOX_RELATIVE_PATH);
  await writeTextFileIfChanged(inboxPath, buildReflectionInboxMarkdown(summary));
  return summary;
}

export async function captureReflectionFileSnapshot(params: {
  jobId: string;
  workspaceDir: string;
}): Promise<ReflectionFileSnapshot | null> {
  if (!isReflectionJobId(params.jobId)) {
    return null;
  }
  const [identity, scratchpad, selfReview] = await Promise.all([
    readTextFileIfExists(path.join(params.workspaceDir, IDENTITY_RELATIVE_PATH)),
    readTextFileIfExists(path.join(params.workspaceDir, SCRATCHPAD_RELATIVE_PATH)),
    readTextFileIfExists(path.join(params.workspaceDir, SELF_REVIEW_RELATIVE_PATH)),
  ]);
  return { identity, scratchpad, selfReview };
}

function countChangedLines(before: string, after: string): number {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  let changed = 0;
  const total = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < total; index += 1) {
    if ((beforeLines[index] ?? "") !== (afterLines[index] ?? "")) {
      changed += 1;
    }
  }
  return changed;
}

function normalizeSelfReviewBody(entry: string): string {
  const [, ...rest] = entry.split("\n");
  return normalizeWhitespace(rest.join(" "));
}

function resolveMetaSelfReviewKey(entry: string): string | undefined {
  const body = normalizeSelfReviewBody(entry);
  if (META_SELF_REVIEW_PATTERNS.some((pattern) => body.includes(pattern))) {
    return body;
  }
  return undefined;
}

export async function dedupeSelfReviewFile(workspaceDir: string): Promise<{
  removedEntries: number;
  rewritten: boolean;
}> {
  const filePath = path.join(workspaceDir, SELF_REVIEW_RELATIVE_PATH);
  const current = await readTextFileIfExists(filePath);
  if (!current) {
    return { removedEntries: 0, rewritten: false };
  }
  const { header, entries } = extractEntries(current, "bracketDate");
  if (entries.length === 0) {
    return { removedEntries: 0, rewritten: false };
  }

  const dedupedNewestFirst: string[] = [];
  const seenExact = new Set<string>();
  const seenMeta = new Set<string>();
  let removedEntries = 0;

  for (const entry of entries.toReversed()) {
    const metaKey = resolveMetaSelfReviewKey(entry);
    if (metaKey) {
      if (seenMeta.has(metaKey)) {
        removedEntries += 1;
        continue;
      }
      seenMeta.add(metaKey);
      dedupedNewestFirst.push(entry.trimEnd());
      continue;
    }
    const exactKey = hashContent(normalizeWhitespace(entry));
    if (seenExact.has(exactKey)) {
      removedEntries += 1;
      continue;
    }
    seenExact.add(exactKey);
    dedupedNewestFirst.push(entry.trimEnd());
  }

  if (removedEntries === 0) {
    return { removedEntries: 0, rewritten: false };
  }

  const dedupedEntries = dedupedNewestFirst.toReversed();
  const next = `${header}${header.endsWith("\n") ? "" : "\n"}${dedupedEntries.join("\n\n")}\n`;
  const rewritten = await writeTextFileIfChanged(filePath, next);
  return { removedEntries, rewritten };
}

export async function applyReflectionRunPostflight(params: {
  jobId: string;
  workspaceDir: string;
  before: ReflectionFileSnapshot | null;
  nowMs?: number;
}): Promise<void> {
  if (!params.before || !isReflectionJobId(params.jobId)) {
    return;
  }

  const nowMs = params.nowMs ?? Date.now();
  const identityPath = path.join(params.workspaceDir, IDENTITY_RELATIVE_PATH);
  const scratchpadPath = path.join(params.workspaceDir, SCRATCHPAD_RELATIVE_PATH);
  let state = await readReflectionState(params.workspaceDir);

  const after = await captureReflectionFileSnapshot({
    jobId: params.jobId,
    workspaceDir: params.workspaceDir,
  });
  if (!after) {
    return;
  }

  const identityChanged = after.identity !== params.before.identity;
  const scratchpadChanged = after.scratchpad !== params.before.scratchpad;
  let reverted = false;
  let promotionCount = 0;

  if (isSelfReviewJobId(params.jobId)) {
    if (identityChanged) {
      await writeOptionalFile(identityPath, params.before.identity);
      reverted = true;
    }
    if (scratchpadChanged) {
      await writeOptionalFile(scratchpadPath, params.before.scratchpad);
    }
    const promotions = await promoteMissPatterns(params.workspaceDir);
    promotionCount = promotions.promoted;
    if (promotions.promoted > 0) {
      state = {
        ...state,
        lastIdentityWriteAtMs: nowMs,
        lastIdentityWriteByJobId: normalizeJobId(params.jobId),
      };
    }
  } else if (isConsciousnessJobId(params.jobId)) {
    let allowIdentityWrite = false;
    if (identityChanged) {
      const changedLines = countChangedLines(params.before.identity ?? "", after.identity ?? "");
      const cooldownActive =
        typeof state.lastIdentityWriteAtMs === "number" &&
        nowMs - state.lastIdentityWriteAtMs < CONSCIOUSNESS_IDENTITY_COOLDOWN_MS;
      if (
        !scratchpadChanged ||
        cooldownActive ||
        changedLines > CONSCIOUSNESS_MAX_IDENTITY_CHANGED_LINES
      ) {
        await writeOptionalFile(identityPath, params.before.identity);
        await writeOptionalFile(scratchpadPath, params.before.scratchpad);
        reverted = true;
      } else {
        allowIdentityWrite = true;
      }
    } else if (scratchpadChanged) {
      await writeOptionalFile(scratchpadPath, params.before.scratchpad);
    }

    const promotions = await promoteMissPatterns(params.workspaceDir);
    promotionCount = promotions.promoted;
    if (allowIdentityWrite || promotions.promoted > 0) {
      state = {
        ...state,
        lastIdentityWriteAtMs: nowMs,
        lastIdentityWriteByJobId: normalizeJobId(params.jobId),
      };
    }
  } else if (isDeepReviewJobId(params.jobId)) {
    if (!identityChanged && scratchpadChanged) {
      await writeOptionalFile(scratchpadPath, params.before.scratchpad);
    }
    if (identityChanged) {
      state = {
        ...state,
        lastIdentityWriteAtMs: nowMs,
        lastIdentityWriteByJobId: normalizeJobId(params.jobId),
      };
    }
  }

  // --- Evidence counter update (deterministic, no LLM calls) ---
  // Read the current self-review and identity files, correlate HIT/MISS
  // entries with existing CRITICAL rules, and update the counters.
  try {
    const [currentSelfReview, currentIdentity] = await Promise.all([
      readTextFileIfExists(path.join(params.workspaceDir, SELF_REVIEW_RELATIVE_PATH)),
      readTextFileIfExists(identityPath),
    ]);
    if (currentSelfReview && currentIdentity) {
      const existingRules = extractExistingCriticalRules(currentIdentity);
      const deltas = correlateHitMissWithRules(currentSelfReview, existingRules);
      if (deltas.size > 0) {
        const updatedIdentity = updateEvidenceCounters(currentIdentity, deltas);
        if (updatedIdentity !== currentIdentity) {
          await writeTextFileIfChanged(identityPath, updatedIdentity);
        }
      }
    }
  } catch {
    // Best-effort — evidence counter failures should never fail the postflight
  }

  // --- Structured change-log (Feature 2) ---
  const linesChanged = identityChanged
    ? countChangedLines(params.before.identity ?? "", after.identity ?? "")
    : 0;
  if (identityChanged || promotionCount > 0) {
    await appendReflectionChangeLog(params.workspaceDir, {
      ts: new Date(nowMs).toISOString(),
      jobId: normalizeJobId(params.jobId),
      file: "IDENTITY.md",
      linesChanged,
      reverted,
      promotions: promotionCount,
    });
  }

  await dedupeSelfReviewFile(params.workspaceDir);
  await writeReflectionState(params.workspaceDir, state);
}

// ---------------------------------------------------------------------------
// Structured reflection change-log (ACE-inspired)
// ---------------------------------------------------------------------------

/** A single entry in the reflection change log. */
export type ReflectionChangeLogEntry = {
  ts: string;
  jobId: string;
  file: string;
  linesChanged: number;
  reverted: boolean;
  promotions: number;
};

/**
 * Append a structured change-log entry to `memory/reflection-change-log.jsonl`.
 * Each entry is one JSON object per line.  Best-effort — failures are
 * silently ignored to never break the postflight.
 */
export async function appendReflectionChangeLog(
  workspaceDir: string,
  entry: ReflectionChangeLogEntry,
): Promise<void> {
  const logPath = path.join(workspaceDir, REFLECTION_CHANGE_LOG_RELATIVE_PATH);
  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf-8");
    await pruneReflectionChangeLog(logPath);
  } catch {
    // Best-effort — never fail the postflight
  }
}

/**
 * Keep only the last {@link CHANGE_LOG_MAX_ENTRIES} entries in the change log.
 * Avoids unbounded growth of the JSONL file.
 */
export async function pruneReflectionChangeLog(
  logPath: string,
  maxEntries: number = CHANGE_LOG_MAX_ENTRIES,
): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(logPath, "utf-8");
  } catch {
    return;
  }
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length <= maxEntries) {
    return;
  }
  const trimmed = lines.slice(lines.length - maxEntries);
  await writeTextFileIfChanged(logPath, `${trimmed.join("\n")}\n`);
}
