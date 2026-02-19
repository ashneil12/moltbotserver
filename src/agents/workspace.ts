import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { isCronSessionKey, isSubagentSessionKey } from "../routing/session-key.js";
import { resolveUserPath } from "../utils.js";
import { resolveWorkspaceTemplateDir } from "./workspace-templates.js";

export function resolveDefaultAgentWorkspaceDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const home = resolveRequiredHomeDir(env, homedir);
  const profile = env.OPENCLAW_PROFILE?.trim();
  if (profile && profile.toLowerCase() !== "default") {
    return path.join(home, ".openclaw", `workspace-${profile}`);
  }
  return path.join(home, ".openclaw", "workspace");
}

export const DEFAULT_AGENT_WORKSPACE_DIR = resolveDefaultAgentWorkspaceDir();
export const DEFAULT_AGENTS_FILENAME = "AGENTS.md";
export const DEFAULT_SOUL_FILENAME = "SOUL.md";
export const DEFAULT_TOOLS_FILENAME = "TOOLS.md";
export const DEFAULT_IDENTITY_FILENAME = "IDENTITY.md";
export const DEFAULT_USER_FILENAME = "USER.md";
export const DEFAULT_HEARTBEAT_FILENAME = "HEARTBEAT.md";
export const DEFAULT_BOOTSTRAP_FILENAME = "BOOTSTRAP.md";
export const DEFAULT_MEMORY_FILENAME = "MEMORY.md";
export const DEFAULT_MEMORY_ALT_FILENAME = "memory.md";
<<<<<<< HEAD
=======
export const DEFAULT_WRITELIKEAHUMAN_FILENAME = "writelikeahuman.md";

/** Filenames that are only loaded when human mode is enabled. */
export const HUMAN_MODE_FILENAMES: ReadonlySet<string> = new Set([
  DEFAULT_WRITELIKEAHUMAN_FILENAME,
]);

/** Markers used to identify the Human Mode section in SOUL.md for programmatic removal. */
const HUMAN_MODE_SOUL_START = "<!-- HUMAN_MODE_START -->";
const HUMAN_MODE_SOUL_END = "<!-- HUMAN_MODE_END -->";

/** Markers for Honcho conditional content in workspace docs. */
const HONCHO_DISABLED_START = "<!-- HONCHO_DISABLED_START -->";
const HONCHO_DISABLED_END = "<!-- HONCHO_DISABLED_END -->";
const HONCHO_ENABLED_START = "<!-- HONCHO_ENABLED_START -->";
const HONCHO_ENABLED_END = "<!-- HONCHO_ENABLED_END -->";

/**
 * Resolves whether human mode is enabled from the environment.
 * Returns `true` unless `OPENCLAW_HUMAN_MODE_ENABLED` is explicitly set to a falsy value
 * ("false", "0", "no", "off"). Unset or unrecognized values default to enabled.
 */
export function resolveHumanModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.OPENCLAW_HUMAN_MODE_ENABLED;
  if (raw == null || raw.trim() === "") {
    return true;
  } // default on
  const parsed = parseBooleanValue(raw);
  // Explicitly false → disabled. Everything else (true, undefined/unrecognized) → enabled.
  return parsed !== false;
}

/**
 * Resolves whether Honcho memory is active from the environment.
 * Returns `true` when `HONCHO_API_KEY` is set (non-empty).
 */
export function resolveHonchoEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const key = env.HONCHO_API_KEY;
  return key != null && key.trim() !== "";
}

>>>>>>> 862786945 (feat: deep honcho integration, SOUL.md overhaul, memory flush, compaction events, and config enforcement updates)
const WORKSPACE_STATE_DIRNAME = ".openclaw";
const WORKSPACE_STATE_FILENAME = "workspace-state.json";
const WORKSPACE_STATE_VERSION = 1;

const workspaceTemplateCache = new Map<string, Promise<string>>();
let gitAvailabilityPromise: Promise<boolean> | null = null;

// File content cache with mtime invalidation to avoid redundant reads
const workspaceFileCache = new Map<string, { content: string; mtimeMs: number }>();

/**
 * Read file with caching based on mtime. Returns cached content if file
 * hasn't changed, otherwise reads from disk and updates cache.
 */
async function readFileWithCache(filePath: string): Promise<string> {
  try {
    const stats = await fs.stat(filePath);
    const mtimeMs = stats.mtimeMs;
    const cached = workspaceFileCache.get(filePath);

    // Return cached content if mtime matches
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.content;
    }

    // Read from disk and update cache
    const content = await fs.readFile(filePath, "utf-8");
    workspaceFileCache.set(filePath, { content, mtimeMs });
    return content;
  } catch (error) {
    // Remove from cache if file doesn't exist or is unreadable
    workspaceFileCache.delete(filePath);
    throw error;
  }
}

const workspaceTemplateCache = new Map<string, Promise<string>>();
let gitAvailabilityPromise: Promise<boolean> | null = null;

function stripFrontMatter(content: string): string {
  if (!content.startsWith("---")) {
    return content;
  }
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) {
    return content;
  }
  const start = endIndex + "\n---".length;
  let trimmed = content.slice(start);
  trimmed = trimmed.replace(/^\s+/, "");
  return trimmed;
}

async function loadTemplate(name: string): Promise<string> {
  const cached = workspaceTemplateCache.get(name);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    const templateDir = await resolveWorkspaceTemplateDir();
    const templatePath = path.join(templateDir, name);
    try {
      const content = await fs.readFile(templatePath, "utf-8");
      return stripFrontMatter(content);
    } catch {
      throw new Error(
        `Missing workspace template: ${name} (${templatePath}). Ensure docs/reference/templates are packaged.`,
      );
    }
  })();

  workspaceTemplateCache.set(name, pending);
  try {
    return await pending;
  } catch (error) {
    workspaceTemplateCache.delete(name);
    throw error;
  }
}

export type WorkspaceBootstrapFileName =
  | typeof DEFAULT_AGENTS_FILENAME
  | typeof DEFAULT_SOUL_FILENAME
  | typeof DEFAULT_TOOLS_FILENAME
  | typeof DEFAULT_IDENTITY_FILENAME
  | typeof DEFAULT_USER_FILENAME
  | typeof DEFAULT_HEARTBEAT_FILENAME
  | typeof DEFAULT_BOOTSTRAP_FILENAME
  | typeof DEFAULT_MEMORY_FILENAME
<<<<<<< HEAD
  | typeof DEFAULT_MEMORY_ALT_FILENAME;
=======
  | typeof DEFAULT_MEMORY_ALT_FILENAME
  | typeof DEFAULT_WRITELIKEAHUMAN_FILENAME;
>>>>>>> 862786945 (feat: deep honcho integration, SOUL.md overhaul, memory flush, compaction events, and config enforcement updates)

export type WorkspaceBootstrapFile = {
  name: WorkspaceBootstrapFileName;
  path: string;
  content?: string;
  missing: boolean;
};

<<<<<<< HEAD
type WorkspaceOnboardingState = {
  version: typeof WORKSPACE_STATE_VERSION;
  bootstrapSeededAt?: string;
  onboardingCompletedAt?: string;
};

=======
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
/** Set of recognized bootstrap filenames for runtime validation */
const VALID_BOOTSTRAP_NAMES: ReadonlySet<string> = new Set([
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_MEMORY_ALT_FILENAME,
]);

<<<<<<< HEAD
async function writeFileIfMissing(filePath: string, content: string): Promise<boolean> {
=======
async function writeFileIfMissing(filePath: string, content: string) {
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  try {
    await fs.writeFile(filePath, content, {
      encoding: "utf-8",
      flag: "wx",
    });
    return true;
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code !== "EEXIST") {
      throw err;
    }
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveWorkspaceStatePath(dir: string): string {
  return path.join(dir, WORKSPACE_STATE_DIRNAME, WORKSPACE_STATE_FILENAME);
}

function parseWorkspaceOnboardingState(raw: string): WorkspaceOnboardingState | null {
  try {
    const parsed = JSON.parse(raw) as {
      bootstrapSeededAt?: unknown;
      onboardingCompletedAt?: unknown;
    };
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return {
      version: WORKSPACE_STATE_VERSION,
      bootstrapSeededAt:
        typeof parsed.bootstrapSeededAt === "string" ? parsed.bootstrapSeededAt : undefined,
      onboardingCompletedAt:
        typeof parsed.onboardingCompletedAt === "string" ? parsed.onboardingCompletedAt : undefined,
    };
  } catch {
    return null;
  }
}

async function readWorkspaceOnboardingState(statePath: string): Promise<WorkspaceOnboardingState> {
  try {
    const raw = await fs.readFile(statePath, "utf-8");
    return (
      parseWorkspaceOnboardingState(raw) ?? {
        version: WORKSPACE_STATE_VERSION,
      }
    );
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code !== "ENOENT") {
      throw err;
    }
    return {
      version: WORKSPACE_STATE_VERSION,
    };
  }
}

async function readWorkspaceOnboardingStateForDir(dir: string): Promise<WorkspaceOnboardingState> {
  const statePath = resolveWorkspaceStatePath(resolveUserPath(dir));
  return await readWorkspaceOnboardingState(statePath);
}

export async function isWorkspaceOnboardingCompleted(dir: string): Promise<boolean> {
  const state = await readWorkspaceOnboardingStateForDir(dir);
  return (
    typeof state.onboardingCompletedAt === "string" && state.onboardingCompletedAt.trim().length > 0
  );
}

async function writeWorkspaceOnboardingState(
  statePath: string,
  state: WorkspaceOnboardingState,
): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const payload = `${JSON.stringify(state, null, 2)}\n`;
  const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    await fs.writeFile(tmpPath, payload, { encoding: "utf-8" });
    await fs.rename(tmpPath, statePath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

<<<<<<< HEAD
=======
/** Silently delete a file if it exists. */
async function deleteIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
    log.info(`human-mode: deleted ${path.basename(filePath)}`);
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code !== "ENOENT") {
      log.warn(`human-mode: failed to delete ${path.basename(filePath)}: ${String(err)}`);
    }
  }
}

/**
 * Remove the Human Mode section from SOUL.md by stripping everything between
 * the `<!-- HUMAN_MODE_START -->` and `<!-- HUMAN_MODE_END -->` markers (inclusive).
 * If markers aren't found, the file is left unchanged.
 */
async function removeHumanModeSectionFromSoul(soulPath: string): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(soulPath, "utf-8");
  } catch {
    return; // File doesn't exist yet — nothing to clean
  }
  const startIdx = content.indexOf(HUMAN_MODE_SOUL_START);
  const endIdx = content.indexOf(HUMAN_MODE_SOUL_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return; // Markers not found or malformed — leave unchanged
  }
  const before = content.slice(0, startIdx);
  const after = content.slice(endIdx + HUMAN_MODE_SOUL_END.length);
  // Clean up: collapse any resulting double-blank-lines into one
  const cleaned = (before + after).replace(/\n{3,}/g, "\n\n");
  await fs.writeFile(soulPath, cleaned, "utf-8");
  log.info("human-mode: removed Human Mode section from SOUL.md");
}

/**
 * Strip conditional Honcho markers from a workspace doc.
 * When `honchoEnabled` is true: remove HONCHO_DISABLED blocks entirely,
 * keep content of HONCHO_ENABLED blocks (strip markers only).
 * When false: remove HONCHO_ENABLED blocks entirely,
 * keep content of HONCHO_DISABLED blocks (strip markers only).
 */
async function stripHonchoConditionals(filePath: string, honchoEnabled: boolean): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return; // File doesn't exist — nothing to clean
  }

  // Determine which markers to strip (remove block entirely) and which to unwrap (keep content)
  const stripStart = honchoEnabled ? HONCHO_DISABLED_START : HONCHO_ENABLED_START;
  const stripEnd = honchoEnabled ? HONCHO_DISABLED_END : HONCHO_ENABLED_END;
  const unwrapStart = honchoEnabled ? HONCHO_ENABLED_START : HONCHO_DISABLED_START;
  const unwrapEnd = honchoEnabled ? HONCHO_ENABLED_END : HONCHO_DISABLED_END;

  let result = content;

  // Remove blocks that should be stripped entirely (including their content)
  while (true) {
    const startIdx = result.indexOf(stripStart);
    const endIdx = result.indexOf(stripEnd);
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) break;
    const before = result.slice(0, startIdx);
    const after = result.slice(endIdx + stripEnd.length);
    result = before + after;
  }

  // Unwrap blocks that should be kept (remove markers, keep content)
  result = result.replaceAll(unwrapStart, "").replaceAll(unwrapEnd, "");

  // Clean up: collapse any resulting triple+ blank lines into double
  result = result.replace(/\n{3,}/g, "\n\n");

  if (result !== content) {
    await fs.writeFile(filePath, result, "utf-8");
    const basename = filePath.split("/").pop() ?? filePath;
    log.info(`honcho: processed conditional markers in ${basename} (honcho=${honchoEnabled ? "on" : "off"})`);
  }
}

>>>>>>> 862786945 (feat: deep honcho integration, SOUL.md overhaul, memory flush, compaction events, and config enforcement updates)
async function hasGitRepo(dir: string): Promise<boolean> {
  try {
    await fs.stat(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

async function isGitAvailable(): Promise<boolean> {
  if (gitAvailabilityPromise) {
    return gitAvailabilityPromise;
  }

  gitAvailabilityPromise = (async () => {
    try {
      const result = await runCommandWithTimeout(["git", "--version"], { timeoutMs: 2_000 });
      return result.code === 0;
    } catch {
      return false;
    }
  })();

  return gitAvailabilityPromise;
}

async function ensureGitRepo(dir: string, isBrandNewWorkspace: boolean) {
  if (!isBrandNewWorkspace) {
    return;
  }
  if (await hasGitRepo(dir)) {
    return;
  }
  if (!(await isGitAvailable())) {
    return;
  }
  try {
    await runCommandWithTimeout(["git", "init"], { cwd: dir, timeoutMs: 10_000 });
  } catch {
    // Ignore git init failures; workspace creation should still succeed.
  }
}

export async function ensureAgentWorkspace(params?: {
  dir?: string;
  ensureBootstrapFiles?: boolean;
}): Promise<{
  dir: string;
  agentsPath?: string;
  soulPath?: string;
  toolsPath?: string;
  identityPath?: string;
  userPath?: string;
  bootstrapPath?: string;
}> {
  const rawDir = params?.dir?.trim() ? params.dir.trim() : DEFAULT_AGENT_WORKSPACE_DIR;
  const dir = resolveUserPath(rawDir);
  await fs.mkdir(dir, { recursive: true });

  if (!params?.ensureBootstrapFiles) {
    return { dir };
  }

  const agentsPath = path.join(dir, DEFAULT_AGENTS_FILENAME);
  const soulPath = path.join(dir, DEFAULT_SOUL_FILENAME);
  const toolsPath = path.join(dir, DEFAULT_TOOLS_FILENAME);
  const identityPath = path.join(dir, DEFAULT_IDENTITY_FILENAME);
  const userPath = path.join(dir, DEFAULT_USER_FILENAME);
  // HEARTBEAT.md is intentionally NOT created from template.
  // Per docs: "If the file is missing, the heartbeat still runs and the model decides what to do."
  // Creating it from template (which is effectively empty) would cause heartbeat to be skipped.
  const bootstrapPath = path.join(dir, DEFAULT_BOOTSTRAP_FILENAME);
<<<<<<< HEAD
=======
  const writelikeahumanPath = path.join(dir, DEFAULT_WRITELIKEAHUMAN_FILENAME);
>>>>>>> 862786945 (feat: deep honcho integration, SOUL.md overhaul, memory flush, compaction events, and config enforcement updates)
  const statePath = resolveWorkspaceStatePath(dir);

  const isBrandNewWorkspace = await (async () => {
    const paths = [agentsPath, soulPath, toolsPath, identityPath, userPath];
    const existing = await Promise.all(
      paths.map(async (p) => {
        try {
          await fs.access(p);
          return true;
        } catch {
          return false;
        }
      }),
    );
    return existing.every((v) => !v);
  })();

  const agentsTemplate = await loadTemplate(DEFAULT_AGENTS_FILENAME);
  const soulTemplate = await loadTemplate(DEFAULT_SOUL_FILENAME);
  const toolsTemplate = await loadTemplate(DEFAULT_TOOLS_FILENAME);
  const identityTemplate = await loadTemplate(DEFAULT_IDENTITY_FILENAME);
  const userTemplate = await loadTemplate(DEFAULT_USER_FILENAME);
<<<<<<< HEAD
  const heartbeatTemplate = await loadTemplate(DEFAULT_HEARTBEAT_FILENAME);
=======
  const bootstrapTemplate = await loadTemplate(DEFAULT_BOOTSTRAP_FILENAME);

>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  await writeFileIfMissing(agentsPath, agentsTemplate);
  await writeFileIfMissing(soulPath, soulTemplate);
  await writeFileIfMissing(toolsPath, toolsTemplate);
  await writeFileIfMissing(identityPath, identityTemplate);
  await writeFileIfMissing(userPath, userTemplate);
<<<<<<< HEAD
=======
  await writeFileIfMissing(heartbeatPath, heartbeatTemplate);

  // Human mode files: conditionally create or destroy based on env var
  const humanModeOn = resolveHumanModeEnabled();

  // Only load human-mode templates when needed to avoid wasted disk I/O
  if (humanModeOn) {
    // Template is optional – skip silently if not packaged
    try {
      const writelikeahumanTemplate = await loadTemplate(DEFAULT_WRITELIKEAHUMAN_FILENAME);
      await writeFileIfMissing(writelikeahumanPath, writelikeahumanTemplate);
    } catch {
      /* template not packaged */
    }
    // Clean up legacy howtobehuman.md if it still exists
    await deleteIfExists(path.join(dir, "howtobehuman.md"));
  } else {
    // Delete guide file when human mode is disabled
    await deleteIfExists(writelikeahumanPath);
    await deleteIfExists(path.join(dir, "howtobehuman.md")); // legacy cleanup
    // Remove the Human Mode section from SOUL.md
    await removeHumanModeSectionFromSoul(soulPath);
  }
>>>>>>> 862786945 (feat: deep honcho integration, SOUL.md overhaul, memory flush, compaction events, and config enforcement updates)

  // Honcho memory: strip conditional markers based on HONCHO_API_KEY
  const honchoEnabled = resolveHonchoEnabled();
  await stripHonchoConditionals(soulPath, honchoEnabled);
  await stripHonchoConditionals(agentsPath, honchoEnabled);

  let state = await readWorkspaceOnboardingState(statePath);
  let stateDirty = false;
  const markState = (next: Partial<WorkspaceOnboardingState>) => {
    state = { ...state, ...next };
    stateDirty = true;
  };
  const nowIso = () => new Date().toISOString();

  let bootstrapExists = await fileExists(bootstrapPath);
  if (!state.bootstrapSeededAt && bootstrapExists) {
    markState({ bootstrapSeededAt: nowIso() });
  }

<<<<<<< HEAD
  if (!state.onboardingCompletedAt && state.bootstrapSeededAt && !bootstrapExists) {
    markState({ onboardingCompletedAt: nowIso() });
  }

  if (!state.bootstrapSeededAt && !state.onboardingCompletedAt && !bootstrapExists) {
    // Legacy migration path: if USER/IDENTITY diverged from templates, treat onboarding as complete
    // and avoid recreating BOOTSTRAP for already-onboarded workspaces.
    const [identityContent, userContent] = await Promise.all([
      fs.readFile(identityPath, "utf-8"),
      fs.readFile(userPath, "utf-8"),
    ]);
    const legacyOnboardingCompleted =
      identityContent !== identityTemplate || userContent !== userTemplate;
    if (legacyOnboardingCompleted) {
      markState({ onboardingCompletedAt: nowIso() });
    } else {
      const bootstrapTemplate = await loadTemplate(DEFAULT_BOOTSTRAP_FILENAME);
      const wroteBootstrap = await writeFileIfMissing(bootstrapPath, bootstrapTemplate);
      if (!wroteBootstrap) {
        bootstrapExists = await fileExists(bootstrapPath);
      } else {
        bootstrapExists = true;
      }
      if (bootstrapExists && !state.bootstrapSeededAt) {
        markState({ bootstrapSeededAt: nowIso() });
      }
    }
  }

  if (stateDirty) {
    await writeWorkspaceOnboardingState(statePath, state);
=======

  if (isBrandNewWorkspace) {
    await writeFileIfMissing(bootstrapPath, bootstrapTemplate);
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  }
  await ensureGitRepo(dir, isBrandNewWorkspace);

  return {
    dir,
    agentsPath,
    soulPath,
    toolsPath,
    identityPath,
    userPath,
    bootstrapPath,
  };
}

async function resolveMemoryBootstrapEntries(
  resolvedDir: string,
): Promise<Array<{ name: WorkspaceBootstrapFileName; filePath: string }>> {
  const candidates: WorkspaceBootstrapFileName[] = [
    DEFAULT_MEMORY_FILENAME,
    DEFAULT_MEMORY_ALT_FILENAME,
  ];
  const entries: Array<{ name: WorkspaceBootstrapFileName; filePath: string }> = [];
  for (const name of candidates) {
    const filePath = path.join(resolvedDir, name);
    try {
      await fs.access(filePath);
      entries.push({ name, filePath });
    } catch {
      // optional
    }
  }
  if (entries.length <= 1) {
    return entries;
  }

  const seen = new Set<string>();
  const deduped: Array<{ name: WorkspaceBootstrapFileName; filePath: string }> = [];
  for (const entry of entries) {
    let key = entry.filePath;
    try {
      key = await fs.realpath(entry.filePath);
    } catch {}
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

export async function loadWorkspaceBootstrapFiles(dir: string): Promise<WorkspaceBootstrapFile[]> {
  const resolvedDir = resolveUserPath(dir);

  const entries: Array<{
    name: WorkspaceBootstrapFileName;
    filePath: string;
  }> = [
    {
      name: DEFAULT_AGENTS_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_AGENTS_FILENAME),
    },
    {
      name: DEFAULT_SOUL_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_SOUL_FILENAME),
    },
    {
      name: DEFAULT_TOOLS_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_TOOLS_FILENAME),
    },
    {
      name: DEFAULT_IDENTITY_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_IDENTITY_FILENAME),
    },
    {
      name: DEFAULT_USER_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_USER_FILENAME),
    },
    {
      name: DEFAULT_HEARTBEAT_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_HEARTBEAT_FILENAME),
    },
    {
<<<<<<< HEAD
      name: DEFAULT_BOOTSTRAP_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_BOOTSTRAP_FILENAME),
=======
      name: DEFAULT_WRITELIKEAHUMAN_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_WRITELIKEAHUMAN_FILENAME),
>>>>>>> 862786945 (feat: deep honcho integration, SOUL.md overhaul, memory flush, compaction events, and config enforcement updates)
    },
  ];

  // NOTE: MEMORY.md / memory.md are NOT loaded into context.
  // They can grow very large and should be accessed via memory_search (QMD),
  // not injected into the system prompt on every message.

  const result: WorkspaceBootstrapFile[] = [];
  for (const entry of entries) {
    try {
      const content = await readFileWithCache(entry.filePath);
      result.push({
        name: entry.name,
        path: entry.filePath,
        content,
        missing: false,
      });
    } catch {
      result.push({ name: entry.name, path: entry.filePath, missing: true });
    }
  }
  return result;
}

const MINIMAL_BOOTSTRAP_ALLOWLIST = new Set([
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
]);

export function filterBootstrapFilesForSession(
  files: WorkspaceBootstrapFile[],
  sessionKey?: string,
): WorkspaceBootstrapFile[] {
  if (!sessionKey || (!isSubagentSessionKey(sessionKey) && !isCronSessionKey(sessionKey))) {
    return files;
  }
  return files.filter((file) => MINIMAL_BOOTSTRAP_ALLOWLIST.has(file.name));
}

export async function loadExtraBootstrapFiles(
  dir: string,
  extraPatterns: string[],
): Promise<WorkspaceBootstrapFile[]> {
  if (!extraPatterns.length) {
    return [];
  }
  const resolvedDir = resolveUserPath(dir);
  let realResolvedDir = resolvedDir;
  try {
    realResolvedDir = await fs.realpath(resolvedDir);
  } catch {
    // Keep lexical root if realpath fails.
  }

  // Resolve glob patterns into concrete file paths
  const resolvedPaths = new Set<string>();
  for (const pattern of extraPatterns) {
    if (pattern.includes("*") || pattern.includes("?") || pattern.includes("{")) {
      try {
        const matches = fs.glob(pattern, { cwd: resolvedDir });
        for await (const m of matches) {
          resolvedPaths.add(m);
        }
      } catch {
        // glob not available or pattern error — fall back to literal
        resolvedPaths.add(pattern);
      }
    } else {
      resolvedPaths.add(pattern);
    }
  }

  const result: WorkspaceBootstrapFile[] = [];
  for (const relPath of resolvedPaths) {
    const filePath = path.resolve(resolvedDir, relPath);
    // Guard against path traversal — resolved path must stay within workspace
    if (!filePath.startsWith(resolvedDir + path.sep) && filePath !== resolvedDir) {
      continue;
    }
    try {
      // Resolve symlinks and verify the real path is still within workspace
      const realFilePath = await fs.realpath(filePath);
      if (
        !realFilePath.startsWith(realResolvedDir + path.sep) &&
        realFilePath !== realResolvedDir
      ) {
        continue;
      }
      // Only load files whose basename is a recognized bootstrap filename
      const baseName = path.basename(relPath);
      if (!VALID_BOOTSTRAP_NAMES.has(baseName)) {
        continue;
      }
      const content = await readFileWithCache(realFilePath);
      result.push({
        name: baseName as WorkspaceBootstrapFileName,
        path: filePath,
        content,
        missing: false,
      });
    } catch {
      // Silently skip missing extra files
    }
  }
  return result;
}

export async function loadExtraBootstrapFiles(
  dir: string,
  extraPatterns: string[],
): Promise<WorkspaceBootstrapFile[]> {
  if (!extraPatterns.length) {
    return [];
  }
  const resolvedDir = resolveUserPath(dir);
  let realResolvedDir = resolvedDir;
  try {
    realResolvedDir = await fs.realpath(resolvedDir);
  } catch {
    // Keep lexical root if realpath fails.
  }

  // Resolve glob patterns into concrete file paths
  const resolvedPaths = new Set<string>();
  for (const pattern of extraPatterns) {
    if (pattern.includes("*") || pattern.includes("?") || pattern.includes("{")) {
      try {
        const matches = fs.glob(pattern, { cwd: resolvedDir });
        for await (const m of matches) {
          resolvedPaths.add(m);
        }
      } catch {
        // glob not available or pattern error — fall back to literal
        resolvedPaths.add(pattern);
      }
    } else {
      resolvedPaths.add(pattern);
    }
  }

  const result: WorkspaceBootstrapFile[] = [];
  for (const relPath of resolvedPaths) {
    const filePath = path.resolve(resolvedDir, relPath);
    // Guard against path traversal — resolved path must stay within workspace
    if (!filePath.startsWith(resolvedDir + path.sep) && filePath !== resolvedDir) {
      continue;
    }
    try {
      // Resolve symlinks and verify the real path is still within workspace
      const realFilePath = await fs.realpath(filePath);
      if (
        !realFilePath.startsWith(realResolvedDir + path.sep) &&
        realFilePath !== realResolvedDir
      ) {
        continue;
      }
      // Only load files whose basename is a recognized bootstrap filename
      const baseName = path.basename(relPath);
      if (!VALID_BOOTSTRAP_NAMES.has(baseName)) {
        continue;
      }
      const content = await fs.readFile(realFilePath, "utf-8");
      result.push({
        name: baseName as WorkspaceBootstrapFileName,
        path: filePath,
        content,
        missing: false,
      });
    } catch {
      // Silently skip missing extra files
    }
  }
  return result;
}
