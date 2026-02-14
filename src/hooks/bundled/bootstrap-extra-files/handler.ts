import {
  filterBootstrapFilesForSession,
  loadExtraBootstrapFiles,
} from "../../../agents/workspace.js";
<<<<<<< HEAD
import { createSubsystemLogger } from "../../../logging/subsystem.js";
=======
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
import { resolveHookConfig } from "../../config.js";
import { isAgentBootstrapEvent, type HookHandler } from "../../hooks.js";

const HOOK_KEY = "bootstrap-extra-files";
<<<<<<< HEAD
const log = createSubsystemLogger("bootstrap-extra-files");
=======
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
}

function resolveExtraBootstrapPatterns(hookConfig: Record<string, unknown>): string[] {
  const fromPaths = normalizeStringArray(hookConfig.paths);
  if (fromPaths.length > 0) {
    return fromPaths;
  }
  const fromPatterns = normalizeStringArray(hookConfig.patterns);
  if (fromPatterns.length > 0) {
    return fromPatterns;
  }
  return normalizeStringArray(hookConfig.files);
}

const bootstrapExtraFilesHook: HookHandler = async (event) => {
  if (!isAgentBootstrapEvent(event)) {
    return;
  }

  const context = event.context;
  const hookConfig = resolveHookConfig(context.cfg, HOOK_KEY);
  if (!hookConfig || hookConfig.enabled === false) {
    return;
  }

  const patterns = resolveExtraBootstrapPatterns(hookConfig as Record<string, unknown>);
  if (patterns.length === 0) {
    return;
  }

  try {
    const extras = await loadExtraBootstrapFiles(context.workspaceDir, patterns);
    if (extras.length === 0) {
      return;
    }
    context.bootstrapFiles = filterBootstrapFilesForSession(
      [...context.bootstrapFiles, ...extras],
      context.sessionKey,
    );
  } catch (err) {
<<<<<<< HEAD
    log.warn(`failed: ${String(err)}`);
=======
    console.warn(`[bootstrap-extra-files] failed: ${String(err)}`);
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  }
};

export default bootstrapExtraFilesHook;
