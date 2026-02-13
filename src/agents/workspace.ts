import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { isSubagentSessionKey } from "../routing/session-key.js";
import { resolveUserPath } from "../utils.js";
import { parseBooleanValue } from "../utils/boolean.js";
import { resolveWorkspaceTemplateDir } from "./workspace-templates.js";

const log = createSubsystemLogger("workspace");

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
export const DEFAULT_HOWTOBEHUMAN_FILENAME = "howtobehuman.md";
export const DEFAULT_WRITELIKEAHUMAN_FILENAME = "writelikeahuman.md";

/** Filenames that are only loaded when human mode is enabled. */
export const HUMAN_MODE_FILENAMES: ReadonlySet<string> = new Set([
  DEFAULT_HOWTOBEHUMAN_FILENAME,
  DEFAULT_WRITELIKEAHUMAN_FILENAME,
]);

/** Markers used to identify the Human Mode section in SOUL.md for programmatic removal. */
const HUMAN_MODE_SOUL_START = "<!-- HUMAN_MODE_START -->";
const HUMAN_MODE_SOUL_END = "<!-- HUMAN_MODE_END -->";

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
  | typeof DEFAULT_HOWTOBEHUMAN_FILENAME
  | typeof DEFAULT_WRITELIKEAHUMAN_FILENAME;

export type WorkspaceBootstrapFile = {
  name: WorkspaceBootstrapFileName;
  path: string;
  content?: string;
  missing: boolean;
};

async function writeFileIfMissing(filePath: string, content: string) {
  try {
    await fs.writeFile(filePath, content, {
      encoding: "utf-8",
      flag: "wx",
    });
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code !== "EEXIST") {
      throw err;
    }
  }
}

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

async function hasGitRepo(dir: string): Promise<boolean> {
  try {
    await fs.stat(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

async function isGitAvailable(): Promise<boolean> {
  try {
    const result = await runCommandWithTimeout(["git", "--version"], { timeoutMs: 2_000 });
    return result.code === 0;
  } catch {
    return false;
  }
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
  heartbeatPath?: string;
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
  const howtobehumanPath = path.join(dir, DEFAULT_HOWTOBEHUMAN_FILENAME);
  const writelikeahumanPath = path.join(dir, DEFAULT_WRITELIKEAHUMAN_FILENAME);

  const isBrandNewWorkspace = await (async () => {
    const paths = [agentsPath, soulPath, toolsPath, identityPath, userPath, heartbeatPath];
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
  const heartbeatTemplate = await loadTemplate(DEFAULT_HEARTBEAT_FILENAME);
  const bootstrapTemplate = await loadTemplate(DEFAULT_BOOTSTRAP_FILENAME);

  await writeFileIfMissing(agentsPath, agentsTemplate);
  await writeFileIfMissing(soulPath, soulTemplate);
  await writeFileIfMissing(toolsPath, toolsTemplate);
  await writeFileIfMissing(identityPath, identityTemplate);
  await writeFileIfMissing(userPath, userTemplate);
  await writeFileIfMissing(heartbeatPath, heartbeatTemplate);

  // Human mode files: conditionally create or destroy based on env var
  const humanModeOn = resolveHumanModeEnabled();

  // Only load human-mode templates when needed to avoid wasted disk I/O
  if (humanModeOn) {
    const howtobehumanTemplate = await loadTemplate(DEFAULT_HOWTOBEHUMAN_FILENAME);
    const writelikeahumanTemplate = await loadTemplate(DEFAULT_WRITELIKEAHUMAN_FILENAME);
    await writeFileIfMissing(howtobehumanPath, howtobehumanTemplate);
    await writeFileIfMissing(writelikeahumanPath, writelikeahumanTemplate);
  } else {
    // Delete guide files when human mode is disabled
    await deleteIfExists(howtobehumanPath);
    await deleteIfExists(writelikeahumanPath);
    // Remove the Human Mode section from SOUL.md
    await removeHumanModeSectionFromSoul(soulPath);
  }

  if (isBrandNewWorkspace) {
    await writeFileIfMissing(bootstrapPath, bootstrapTemplate);
  }
  await ensureGitRepo(dir, isBrandNewWorkspace);

  return {
    dir,
    agentsPath,
    soulPath,
    toolsPath,
    identityPath,
    userPath,
    heartbeatPath,
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
      name: DEFAULT_BOOTSTRAP_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_BOOTSTRAP_FILENAME),
    },
    {
      name: DEFAULT_HOWTOBEHUMAN_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_HOWTOBEHUMAN_FILENAME),
    },
    {
      name: DEFAULT_WRITELIKEAHUMAN_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_WRITELIKEAHUMAN_FILENAME),
    },
  ];

  entries.push(...(await resolveMemoryBootstrapEntries(resolvedDir)));

  const result: WorkspaceBootstrapFile[] = [];
  for (const entry of entries) {
    try {
      const content = await fs.readFile(entry.filePath, "utf-8");
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

const SUBAGENT_BOOTSTRAP_ALLOWLIST = new Set([DEFAULT_AGENTS_FILENAME, DEFAULT_TOOLS_FILENAME]);

export function filterBootstrapFilesForSession(
  files: WorkspaceBootstrapFile[],
  sessionKey?: string,
): WorkspaceBootstrapFile[] {
  if (!sessionKey || !isSubagentSessionKey(sessionKey)) {
    return files;
  }
  return files.filter((file) => SUBAGENT_BOOTSTRAP_ALLOWLIST.has(file.name));
}
