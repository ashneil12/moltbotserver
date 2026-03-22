import syncFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveMainSessionKeyFromConfig } from "../config/sessions/main-session.js";
import { atomicWriteFile } from "../infra/atomic-file.js";
import { openBoundaryFile } from "../infra/boundary-file-read.js";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { rebuildKnowledgeIndex } from "../memory/knowledge-index.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { isCronSessionKey, isSubagentSessionKey } from "../routing/session-key.js";
import { alertOperatorQuarantine } from "../security/quarantine-alert.js";
import { notifyQuarantine } from "../security/quarantine-notify.js";
import { scanAndLog } from "../security/scan-and-log.js";
import { resolveUserPath } from "../utils.js";
import { resolveWorkspaceTemplateDir } from "./workspace-templates.js";

const workspaceSecurityLog = createSubsystemLogger("workspace-security");

/**
 * Scan workspace content for prompt injection before it enters the system prompt.
 * Quarantined content gets wrapped with ACIP boundary markers so the agent treats
 * it as untrusted. Fail-open: if the scanner crashes, content passes through unchanged.
 */
function scanWorkspaceContent(content: string, fileName: string, filePath: string): string {
  const isBootstrap = VALID_BOOTSTRAP_NAMES.has(fileName);
  const scanResult = scanAndLog(content, {
    source: "workspace_context",
    sender: fileName,
    eventName: "security.workspace_context_scan",
    extraData: { file: fileName, path: filePath },
    // Bootstrap files (SOUL.md, OPERATIONS.md, etc.) legitimately contain
    // patterns that match scanner rules (e.g. "override safety", "rm -rf").
    // Suppress the generic QUARANTINED warning — we log at debug level below.
    suppressQuarantineLog: isBootstrap,
  });
  if (scanResult?.quarantined) {
    // First-party bootstrap files are authored by the OpenClaw project.
    // Log at debug level for visibility but do NOT quarantine — wrapping
    // the agent's own identity file in EXTERNAL_UNTRUSTED_CONTENT markers
    // degrades bootstrap context.
    if (isBootstrap) {
      workspaceSecurityLog.debug(
        `Bootstrap file scan (first-party, not quarantined): ${fileName} ` +
          `(riskScore=${scanResult.riskScore}, ` +
          `findings=${scanResult.findings.map((f) => f.description).join(", ")})`,
      );
      return content;
    }
    workspaceSecurityLog.warn(
      `Workspace file quarantined: ${fileName} (riskScore=${scanResult.riskScore}, ` +
        `findings=${scanResult.findings.map((f) => f.description).join(", ")})`,
    );

    // ── User notification ───────────────────────────────────────────────
    // Inject a system event so the agent proactively tells the user about
    // the quarantine. Also fire operator alert for high-severity events.
    try {
      const sessionKey = resolveMainSessionKeyFromConfig();
      // Get mtime for dedup (if file is accessible)
      let mtimeMs: number | undefined;
      try {
        const stat = syncFs.statSync(filePath);
        mtimeMs = stat.mtimeMs;
      } catch {
        // stat failure is non-fatal for notification
      }

      notifyQuarantine({
        fileName,
        filePath,
        mtimeMs,
        riskScore: scanResult.riskScore,
        findings: scanResult.findings,
        enqueueSystemEvent,
        sessionKey,
      });

      alertOperatorQuarantine({
        fileName,
        filePath,
        riskScore: scanResult.riskScore,
        findings: scanResult.findings,
        enqueueSystemEvent,
        sessionKey,
      });
    } catch {
      // Notification must never block workspace loading
    }

    return scanResult.sanitizedContent;
  }
  return content;
}

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
export const DEFAULT_DIARY_FILENAME = "diary.md";
export const DEFAULT_KNOWLEDGE_INDEX_FILENAME = "_index.md";
export const DEFAULT_OPERATIONS_FILENAME = "OPERATIONS.md";
export const DEFAULT_MEMORY_HYGIENE_FILENAME = "memory-hygiene.md";
export const DEFAULT_HUMAN_GUIDE_FILENAME = "openclaw-human-v1.md";
export const DEFAULT_HUMOR_GUIDE_FILENAME = "THE_ART_OF_BEING_FUNNY.md";
export const DEFAULT_BUSINESS_GUIDE_FILENAME = "openclaw-business-v1.md";
const DEFAULT_BUSINESS_DOCS_DIRNAME = "business";
const WORKSPACE_STATE_DIRNAME = ".openclaw";
const WORKSPACE_STATE_FILENAME = "workspace-state.json";
const WORKSPACE_STATE_VERSION = 1;

/**
 * Check if human voice mode is enabled.
 * Defaults to TRUE — human voice mode is active unless explicitly disabled
 * via OPENCLAW_HUMAN_MODE=0 or OPENCLAW_HUMAN_MODE_ENABLED=false.
 * When enabled, openclaw-human-v1.md is seeded into the workspace.
 * When disabled, references to these files are removed from SOUL.md.
 */
export function resolveHumanModeEnabled(): boolean {
  const short = process.env.OPENCLAW_HUMAN_MODE?.trim();
  if (short === "0") {
    return false;
  }
  const long = process.env.OPENCLAW_HUMAN_MODE_ENABLED?.trim();
  if (long === "false" || long === "0") {
    return false;
  }
  return true;
}

/**
 * Check if business mode is enabled.
 * Defaults to FALSE — business mode is off unless explicitly enabled
 * via OPENCLAW_BUSINESS_MODE=1 or OPENCLAW_BUSINESS_MODE_ENABLED=true.
 * When enabled, SOUL.md is overwritten with the business guide content
 * and business/ knowledge docs are seeded into the workspace.
 */
export function resolveBusinessModeEnabled(): boolean {
  const short = process.env.OPENCLAW_BUSINESS_MODE?.trim();
  if (short === "1") {
    return true;
  }
  const long = process.env.OPENCLAW_BUSINESS_MODE_ENABLED?.trim();
  if (long === "true" || long === "1") {
    return true;
  }
  return false;
}

/**
 * Generic helper to strip conditional marker blocks from a workspace file.
 *
 * When `enabled` is true: markers are removed, content between them is preserved.
 * When `enabled` is false: entire blocks (markers + content) are removed.
 *
 * @param filePath - Path to the file to process
 * @param ifMarker - Opening marker (e.g. `<!-- if-human-mode -->`)
 * @param endMarker - Closing marker (e.g. `<!-- end-human-mode -->`)
 * @param enabled - Whether the feature is active
 */
async function stripConditionalBlock(
  filePath: string,
  ifMarker: string,
  endMarker: string,
  enabled: boolean,
): Promise<void> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    if (!content.includes(ifMarker)) {
      return; // No conditional markers — nothing to do
    }

    let result = content;
    if (enabled) {
      // Keep the content, just remove the markers themselves
      result = result.replace(new RegExp(`\\s*${ifMarker}\\s*\\n?`, "g"), "\n");
      result = result.replace(new RegExp(`\\s*${endMarker}\\s*\\n?`, "g"), "\n");
    } else {
      // Remove entire blocks between markers (including markers)
      const regex = new RegExp(`\\s*${ifMarker}[\\s\\S]*?${endMarker}\\s*\\n?`, "g");
      result = result.replace(regex, "\n");
    }

    if (result !== content) {
      await fs.writeFile(filePath, result, "utf-8");
    }
  } catch {
    // Silently skip — workspace file may not exist or be readable
  }
}

/**
 * Strip `<!-- if-human-mode -->` / `<!-- end-human-mode -->` conditional blocks
 * from a workspace file based on whether human voice mode is enabled.
 */
export async function removeHumanModeSectionFromSoul(
  filePath: string,
  humanModeEnabled: boolean,
): Promise<void> {
  await stripConditionalBlock(
    filePath,
    "<!-- if-human-mode -->",
    "<!-- end-human-mode -->",
    humanModeEnabled,
  );
}

/**
 * Strip `<!-- if-business-mode -->` / `<!-- end-business-mode -->` conditional blocks
 * from a workspace file. This is a legacy safety net for workspaces whose SOUL.md
 * may still contain the old conditional markers from before business mode was
 * changed to overwrite SOUL.md entirely.
 */
async function removeBusinessModeSectionFromSoul(
  filePath: string,
  businessModeEnabled: boolean,
): Promise<void> {
  await stripConditionalBlock(
    filePath,
    "<!-- if-business-mode -->",
    "<!-- end-business-mode -->",
    businessModeEnabled,
  );
}

/**
 * Recursively copy a directory tree, using writeFileIfMissing semantics.
 * Files that already exist in the destination are NOT overwritten.
 * This preserves user modifications while seeding new template files.
 */
async function copyDirectoryRecursive(srcDir: string, dstDir: string): Promise<void> {
  await fs.mkdir(dstDir, { recursive: true });
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".DS_Store") {
      continue;
    }
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryRecursive(srcPath, dstPath);
    } else {
      try {
        const content = await fs.readFile(srcPath, "utf-8");
        await writeFileIfMissing(dstPath, stripFrontMatter(content));
      } catch {
        // Skip unreadable files
      }
    }
  }
}

const workspaceTemplateCache = new Map<string, Promise<string>>();
let gitAvailabilityPromise: Promise<boolean> | null = null;
const MAX_WORKSPACE_BOOTSTRAP_FILE_BYTES = 2 * 1024 * 1024;

// File content cache keyed by stable file identity to avoid stale reads.
const workspaceFileCache = new Map<string, { content: string; identity: string }>();

/**
 * Read workspace files via boundary-safe open and cache by inode/dev/size/mtime identity.
 */
type WorkspaceGuardedReadResult =
  | { ok: true; content: string }
  | { ok: false; reason: "path" | "validation" | "io"; error?: unknown };

function workspaceFileIdentity(stat: syncFs.Stats, canonicalPath: string): string {
  return `${canonicalPath}|${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
}

async function readWorkspaceFileWithGuards(params: {
  filePath: string;
  workspaceDir: string;
}): Promise<WorkspaceGuardedReadResult> {
  const opened = await openBoundaryFile({
    absolutePath: params.filePath,
    rootPath: params.workspaceDir,
    boundaryLabel: "workspace root",
    maxBytes: MAX_WORKSPACE_BOOTSTRAP_FILE_BYTES,
  });
  if (!opened.ok) {
    workspaceFileCache.delete(params.filePath);
    return opened;
  }

  const identity = workspaceFileIdentity(opened.stat, opened.path);
  const cached = workspaceFileCache.get(params.filePath);
  if (cached && cached.identity === identity) {
    syncFs.closeSync(opened.fd);
    return { ok: true, content: cached.content };
  }

  try {
    const content = syncFs.readFileSync(opened.fd, "utf-8");
    workspaceFileCache.set(params.filePath, { content, identity });
    return { ok: true, content };
  } catch (error) {
    workspaceFileCache.delete(params.filePath);
    return { ok: false, reason: "io", error };
  } finally {
    syncFs.closeSync(opened.fd);
  }
}

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
  | typeof DEFAULT_MEMORY_ALT_FILENAME
  | typeof DEFAULT_DIARY_FILENAME
  | typeof DEFAULT_KNOWLEDGE_INDEX_FILENAME
  | typeof DEFAULT_OPERATIONS_FILENAME
  | typeof DEFAULT_MEMORY_HYGIENE_FILENAME
  | typeof DEFAULT_HUMAN_GUIDE_FILENAME
  | typeof DEFAULT_HUMOR_GUIDE_FILENAME
  | typeof DEFAULT_BUSINESS_GUIDE_FILENAME
  | (string & {});

export type WorkspaceBootstrapFile = {
  name: WorkspaceBootstrapFileName;
  path: string;
  content?: string;
  missing: boolean;
};

export type ExtraBootstrapLoadDiagnosticCode =
  | "invalid-bootstrap-filename"
  | "missing"
  | "security"
  | "io";

export type ExtraBootstrapLoadDiagnostic = {
  path: string;
  reason: ExtraBootstrapLoadDiagnosticCode;
  detail: string;
};

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
  DEFAULT_HUMAN_GUIDE_FILENAME,
  DEFAULT_HUMOR_GUIDE_FILENAME,
  DEFAULT_BUSINESS_GUIDE_FILENAME,
  DEFAULT_OPERATIONS_FILENAME,
]);

type WorkspaceOnboardingState = {
  version: typeof WORKSPACE_STATE_VERSION;
  bootstrapSeededAt?: string;
  onboardingCompletedAt?: string;
  /** Tracks when SOUL.md has been overwritten by a mode (e.g. "business"). */
  soulOverride?: string;
};

async function writeFileIfMissing(filePath: string, content: string): Promise<boolean> {
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
      soulOverride?: unknown;
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
      soulOverride: typeof parsed.soulOverride === "string" ? parsed.soulOverride : undefined,
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
  const payload = `${JSON.stringify(state, null, 2)}\n`;
  await atomicWriteFile(statePath, payload);
}

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
  const heartbeatPath = path.join(dir, DEFAULT_HEARTBEAT_FILENAME);
  const bootstrapPath = path.join(dir, DEFAULT_BOOTSTRAP_FILENAME);
  const statePath = resolveWorkspaceStatePath(dir);

  // Detect whether ensureAgentWorkspace has ever completed before.
  // workspace-state.json is ONLY written by this function, so its absence
  // is a reliable signal — unlike template/user file checks which break when
  // docker-entrypoint.sh pre-seeds SOUL.md, IDENTITY.md, memory/ etc.
  const stateFileExists = await fileExists(statePath);
  const isFirstEnsureRun = !stateFileExists;

  const agentsTemplate = await loadTemplate(DEFAULT_AGENTS_FILENAME);
  const soulTemplate = await loadTemplate(DEFAULT_SOUL_FILENAME);
  const toolsTemplate = await loadTemplate(DEFAULT_TOOLS_FILENAME);
  const identityTemplate = await loadTemplate(DEFAULT_IDENTITY_FILENAME);
  const userTemplate = await loadTemplate(DEFAULT_USER_FILENAME);
  const heartbeatTemplate = await loadTemplate(DEFAULT_HEARTBEAT_FILENAME);

  await writeFileIfMissing(agentsPath, agentsTemplate);
  await writeFileIfMissing(soulPath, soulTemplate);
  await writeFileIfMissing(toolsPath, toolsTemplate);
  await writeFileIfMissing(identityPath, identityTemplate);
  await writeFileIfMissing(userPath, userTemplate);
  await writeFileIfMissing(heartbeatPath, heartbeatTemplate);

  // Human voice mode: strip conditional markers based on OPENCLAW_HUMAN_MODE
  const humanModeEnabled = resolveHumanModeEnabled();
  await removeHumanModeSectionFromSoul(soulPath, humanModeEnabled);

  // Business mode: strip conditional markers based on OPENCLAW_BUSINESS_MODE
  const businessModeEnabled = resolveBusinessModeEnabled();

  // Business mode: overwrite SOUL.md with business guide content when enabled.
  // When disabled after being on, restore the original SOUL.md template.
  // NOTE: We read state early and reuse it for the bootstrap logic below to
  // avoid a redundant disk read.
  let state = await readWorkspaceOnboardingState(statePath);
  let stateDirty = false;
  const markState = (next: Partial<WorkspaceOnboardingState>) => {
    state = { ...state, ...next };
    stateDirty = true;
  };
  const nowIso = () => new Date().toISOString();

  if (businessModeEnabled) {
    // Overwrite SOUL.md entirely with business template content.
    // Skip conditional stripping — the file is being replaced wholesale.
    // Guard: only overwrite on the first run (soulOverride not yet set).
    // Subsequent calls reuse the already-written file to avoid redundant
    // disk I/O and log noise on every message.
    if (state.soulOverride !== "business") {
      const businessTemplate = await loadTemplate(DEFAULT_BUSINESS_GUIDE_FILENAME);
      console.log(
        `[workspace] business mode ON → overwriting SOUL.md (${soulPath}) with business template (${businessTemplate.length} chars)`,
      );
      // Ensure writable — docker-entrypoint.sh sets chmod 444 on SOUL.md
      await fs.chmod(soulPath, 0o644).catch(() => {});
      await fs.writeFile(soulPath, businessTemplate, "utf-8");
      markState({ soulOverride: "business" });
    }
  } else {
    // Non-business mode: strip business conditional markers from SOUL.md
    await removeBusinessModeSectionFromSoul(soulPath, false);

    if (state.soulOverride === "business") {
      // Business mode was on but now off — restore original SOUL.md
      console.log(
        `[workspace] business mode OFF (was ON) → restoring original SOUL.md (${soulPath})`,
      );
      // Ensure writable — docker-entrypoint.sh sets chmod 444 on SOUL.md
      await fs.chmod(soulPath, 0o644).catch(() => {});
      await fs.writeFile(soulPath, soulTemplate, "utf-8");
      // Re-apply conditional stripping to the freshly restored template
      await removeHumanModeSectionFromSoul(soulPath, humanModeEnabled);
      await removeBusinessModeSectionFromSoul(soulPath, false);
      markState({ soulOverride: undefined });
    }
  }

  // Seed extra context files from templates
  const operationsPath = path.join(dir, DEFAULT_OPERATIONS_FILENAME);
  const memoryHygienePath = path.join(dir, DEFAULT_MEMORY_HYGIENE_FILENAME);
  const operationsTemplate = await loadTemplate(DEFAULT_OPERATIONS_FILENAME);
  const memoryHygieneTemplate = await loadTemplate(DEFAULT_MEMORY_HYGIENE_FILENAME);
  await writeFileIfMissing(operationsPath, operationsTemplate);
  await writeFileIfMissing(memoryHygienePath, memoryHygieneTemplate);

  // Seed MEMORY.md — top-level long-term memory file (accessed via memory_search/QMD, not context)
  const memoryFilePath = path.join(dir, DEFAULT_MEMORY_FILENAME);
  const memoryTemplate = await loadTemplate(DEFAULT_MEMORY_FILENAME);
  await writeFileIfMissing(memoryFilePath, memoryTemplate);

  // Human voice mode: seed openclaw-human-v1.md when enabled
  if (humanModeEnabled) {
    const humanGuidePath = path.join(dir, DEFAULT_HUMAN_GUIDE_FILENAME);
    const humanGuideTemplate = await loadTemplate(DEFAULT_HUMAN_GUIDE_FILENAME);
    await writeFileIfMissing(humanGuidePath, humanGuideTemplate);

    // Humor guide: seed THE_ART_OF_BEING_FUNNY.md when human mode is enabled
    const humorGuidePath = path.join(dir, DEFAULT_HUMOR_GUIDE_FILENAME);
    const humorGuideTemplate = await loadTemplate(DEFAULT_HUMOR_GUIDE_FILENAME);
    await writeFileIfMissing(humorGuidePath, humorGuideTemplate);

    // Cleanup: remove old split guides from existing workspaces
    for (const oldFile of ["writelikeahuman.md", "howtobehuman.md"]) {
      try {
        await fs.unlink(path.join(dir, oldFile));
      } catch {
        // File may not exist — that's fine
      }
    }
  }

  // Business mode: seed business/ knowledge docs when enabled (for memory_search).
  // NOTE: openclaw-business-v1.md is NOT seeded as a separate file — its content
  // is now written directly into SOUL.md (see business mode override above).
  if (businessModeEnabled) {
    // Seed business knowledge docs from templates/business/ into workspace/business/
    const templateDir = await resolveWorkspaceTemplateDir();
    const businessTemplateDir = path.join(templateDir, DEFAULT_BUSINESS_DOCS_DIRNAME);
    const businessWorkspaceDir = path.join(dir, DEFAULT_BUSINESS_DOCS_DIRNAME);
    try {
      await copyDirectoryRecursive(businessTemplateDir, businessWorkspaceDir);
    } catch (err) {
      // Business docs may not be available in all deployments
      console.warn(`[workspace] Could not seed business docs: ${String(err)}`);
    }
  }

  // Business mode: delete workspace business files when flagged (two-step disable)
  if (!businessModeEnabled && process.env.OPENCLAW_BUSINESS_DELETE_FILES?.trim() === "true") {
    const businessWorkspaceDir = path.join(dir, DEFAULT_BUSINESS_DOCS_DIRNAME);
    const businessGuidePath = path.join(dir, DEFAULT_BUSINESS_GUIDE_FILENAME);
    try {
      await fs.rm(businessWorkspaceDir, { recursive: true, force: true });
      // Also clean up any leftover separate business guide file from legacy workspaces
      await fs.unlink(businessGuidePath).catch(() => {});
      console.log("[workspace] Deleted business files from workspace (user requested cleanup)");
    } catch {
      // Already cleaned up or doesn't exist
    }
  }

  // Ensure .agents/skills/ exists for agent-created procedural skills
  const agentSkillsDir = path.join(dir, ".agents", "skills");
  await fs.mkdir(agentSkillsDir, { recursive: true });

  // Seed memory sub-directory templates (diary, self-review, open-loops, identity-scratchpad)
  const memoryDir = path.join(dir, "memory");
  await fs.mkdir(memoryDir, { recursive: true });
  const memoryTemplateFiles = [
    "memory/diary.md",
    "memory/self-review.md",
    "memory/open-loops.md",
    "memory/identity-scratchpad.md",
    "memory/reflection-inbox.md",
    "memory/MEMORY_GUIDELINES.md",
  ];
  for (const relPath of memoryTemplateFiles) {
    const templateContent = await loadTemplate(relPath);
    await writeFileIfMissing(path.join(dir, relPath), templateContent);
  }

  // NOTE: state, stateDirty, markState, and nowIso are defined above
  // in the business mode block and reused here for bootstrap logic.

  let bootstrapExists = await fileExists(bootstrapPath);
  if (!state.bootstrapSeededAt && bootstrapExists) {
    markState({ bootstrapSeededAt: nowIso() });
  }

  if (!state.onboardingCompletedAt && state.bootstrapSeededAt && !bootstrapExists) {
    markState({ onboardingCompletedAt: nowIso() });
  }

  if (!state.bootstrapSeededAt && !state.onboardingCompletedAt && !bootstrapExists) {
    // No state file has been written yet and BOOTSTRAP.md doesn't exist.
    // Two possibilities:
    //   1. First-ever run (fresh deploy) → seed BOOTSTRAP.md
    //   2. Legacy workspace that was onboarded before workspace-state.json existed
    //      → detect via IDENTITY.md/USER.md divergence from templates
    //
    // We purposely do NOT check for memory/, MEMORY.md, or .git/ as "user content"
    // indicators — docker-entrypoint.sh creates those before the gateway starts,
    // so they're unreliable signals of actual user activity.
    let legacyOnboardingCompleted = false;
    if (!isFirstEnsureRun) {
      // State file exists (but has no bootstrapSeededAt/onboardingCompletedAt).
      // This shouldn't normally happen, but handle it defensively.
      legacyOnboardingCompleted = false;
    } else {
      // No state file at all. Check if the user customized IDENTITY.md or USER.md
      // beyond the default templates (sign of a pre-existing onboarded workspace).
      try {
        const [identityContent, userContent] = await Promise.all([
          fs.readFile(identityPath, "utf-8"),
          fs.readFile(userPath, "utf-8"),
        ]);
        legacyOnboardingCompleted =
          identityContent !== identityTemplate || userContent !== userTemplate;
      } catch {
        // Files don't exist or can't be read → not a legacy workspace
        legacyOnboardingCompleted = false;
      }
    }
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
  }
  await ensureGitRepo(dir, isFirstEnsureRun);

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

export async function loadWorkspaceBootstrapFiles(dir: string): Promise<WorkspaceBootstrapFile[]> {
  const resolvedDir = resolveUserPath(dir);

  const entries: Array<{
    name: WorkspaceBootstrapFileName;
    filePath: string;
  }> = [
    {
      name: DEFAULT_BOOTSTRAP_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_BOOTSTRAP_FILENAME),
    },
    {
      name: DEFAULT_SOUL_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_SOUL_FILENAME),
    },
    {
      name: DEFAULT_IDENTITY_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_IDENTITY_FILENAME),
    },
    {
      name: DEFAULT_AGENTS_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_AGENTS_FILENAME),
    },
    {
      name: DEFAULT_TOOLS_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_TOOLS_FILENAME),
    },
    {
      name: DEFAULT_USER_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_USER_FILENAME),
    },
    {
      name: DEFAULT_HEARTBEAT_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_HEARTBEAT_FILENAME),
    },
  ];

  // NOTE: MEMORY.md / memory.md are NOT loaded into context.
  // They can grow very large and should be accessed via memory_search (QMD),
  // not injected into the system prompt on every message.

  // Extra context files: OPERATIONS, human guide (always optional).
  // memory-hygiene.md is seeded into the workspace but NOT
  // injected into context — its content overlaps with SOUL.md, OPERATIONS.md,
  // and hardcoded system prompt sections. It remains as a reference file.
  const extraContextFiles: Array<{ name: WorkspaceBootstrapFileName; filePath: string }> = [
    {
      name: DEFAULT_OPERATIONS_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_OPERATIONS_FILENAME),
    },
    {
      name: DEFAULT_HUMAN_GUIDE_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_HUMAN_GUIDE_FILENAME),
    },
    {
      name: DEFAULT_HUMOR_GUIDE_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_HUMOR_GUIDE_FILENAME),
    },
    // NOTE: openclaw-business-v1.md is intentionally NOT listed here.
    // When business mode is active, the business content lives inside SOUL.md.
    // Legacy workspaces that still have the separate file will have it detected
    // as a stale artifact — the system prompt handles this via hasBusinessModeFiles
    // as a fallback.
  ];
  for (const extra of extraContextFiles) {
    try {
      await fs.access(extra.filePath);
      entries.push(extra);
    } catch {
      // Optional — file may not have been seeded
    }
  }

  // Diary: tail-heavy truncation handled by bootstrap.ts (DIARY_MAX_CHARS).
  const diaryPath = path.join(resolvedDir, "memory", DEFAULT_DIARY_FILENAME);
  try {
    await fs.access(diaryPath);
    entries.push({ name: DEFAULT_DIARY_FILENAME, filePath: diaryPath });
  } catch {
    // Optional — diary may not exist yet
  }

  // Session context: rolling summary of recent sessions for continuity across resets.
  const sessionContextPath = path.join(resolvedDir, "memory", "session-context.md");
  try {
    await fs.access(sessionContextPath);
    entries.push({
      name: "session-context.md" as WorkspaceBootstrapFileName,
      filePath: sessionContextPath,
    });
  } catch {
    // Optional — session context may not exist yet
  }

  // BrainX enrichment: extracted facts and advisory warnings (written by cron scripts).
  const extractedFactsPath = path.join(resolvedDir, "memory", "extracted-facts.md");
  try {
    await fs.access(extractedFactsPath);
    entries.push({
      name: "extracted-facts.md" as WorkspaceBootstrapFileName,
      filePath: extractedFactsPath,
    });
  } catch {
    // Optional — created by brainx-extract-facts cron
  }
  const advisoryWarningsPath = path.join(resolvedDir, "memory", "advisory-warnings.md");
  try {
    await fs.access(advisoryWarningsPath);
    entries.push({
      name: "advisory-warnings.md" as WorkspaceBootstrapFileName,
      filePath: advisoryWarningsPath,
    });
  } catch {
    // Optional — created by brainx-advisory-warnings cron
  }

  // Knowledge index: rebuild before loading so the index is fresh.
  const knowledgeIndexPath = path.join(
    resolvedDir,
    "memory",
    "knowledge",
    DEFAULT_KNOWLEDGE_INDEX_FILENAME,
  );
  try {
    // preLoad: rebuild the knowledge index from topic files before reading
    await rebuildKnowledgeIndex(resolvedDir);
    await fs.access(knowledgeIndexPath);
    entries.push({ name: DEFAULT_KNOWLEDGE_INDEX_FILENAME, filePath: knowledgeIndexPath });
  } catch {
    // Optional — knowledge directory may not exist
  }

  const result: WorkspaceBootstrapFile[] = [];
  for (const entry of entries) {
    const loaded = await readWorkspaceFileWithGuards({
      filePath: entry.filePath,
      workspaceDir: resolvedDir,
    });
    if (loaded.ok) {
      result.push({
        name: entry.name,
        path: entry.filePath,
        content: scanWorkspaceContent(loaded.content, entry.name, entry.filePath),
        missing: false,
      });
    } else {
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
  const loaded = await loadExtraBootstrapFilesWithDiagnostics(dir, extraPatterns);
  return loaded.files;
}

export async function loadExtraBootstrapFilesWithDiagnostics(
  dir: string,
  extraPatterns: string[],
): Promise<{
  files: WorkspaceBootstrapFile[];
  diagnostics: ExtraBootstrapLoadDiagnostic[];
}> {
  if (!extraPatterns.length) {
    return { files: [], diagnostics: [] };
  }
  const resolvedDir = resolveUserPath(dir);

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

  const files: WorkspaceBootstrapFile[] = [];
  const diagnostics: ExtraBootstrapLoadDiagnostic[] = [];
  for (const relPath of resolvedPaths) {
    const filePath = path.resolve(resolvedDir, relPath);
    // Only load files whose basename is a recognized bootstrap filename
    const baseName = path.basename(relPath);
    if (!VALID_BOOTSTRAP_NAMES.has(baseName)) {
      diagnostics.push({
        path: filePath,
        reason: "invalid-bootstrap-filename",
        detail: `unsupported bootstrap basename: ${baseName}`,
      });
      continue;
    }
    const loaded = await readWorkspaceFileWithGuards({
      filePath,
      workspaceDir: resolvedDir,
    });
    if (loaded.ok) {
      files.push({
        name: baseName as WorkspaceBootstrapFileName,
        path: filePath,
        content: scanWorkspaceContent(loaded.content, baseName, filePath),
        missing: false,
      });
      continue;
    }

    const reason: ExtraBootstrapLoadDiagnosticCode =
      loaded.reason === "path" ? "missing" : loaded.reason === "validation" ? "security" : "io";
    diagnostics.push({
      path: filePath,
      reason,
      detail:
        loaded.error instanceof Error
          ? loaded.error.message
          : typeof loaded.error === "string"
            ? loaded.error
            : reason,
    });
  }
  return { files, diagnostics };
}
