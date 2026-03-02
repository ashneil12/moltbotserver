import { listAgentIds, resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveBrowserConfig } from "./config.js";
import { ensureBrowserControlAuth } from "./control-auth.js";
import { setDownloadWorkspaceForCdp } from "./download-workspace-registry.js";
import { type BrowserServerState, createBrowserRouteContext } from "./server-context.js";
import { ensureExtensionRelayForProfiles, stopKnownBrowserProfiles } from "./server-lifecycle.js";

let state: BrowserServerState | null = null;
const log = createSubsystemLogger("browser");
const logService = log.child("service");

export function getBrowserControlState(): BrowserServerState | null {
  return state;
}

export function createBrowserControlContext() {
  return createBrowserRouteContext({
    getState: () => state,
    refreshConfigFromDisk: true,
  });
}

export async function startBrowserControlServiceFromConfig(): Promise<BrowserServerState | null> {
  if (state) {
    return state;
  }

  const cfg = loadConfig();
  const resolved = resolveBrowserConfig(cfg.browser, cfg);
  if (!resolved.enabled) {
    return null;
  }
  try {
    const ensured = await ensureBrowserControlAuth({ cfg });
    if (ensured.generatedToken) {
      logService.info("No browser auth configured; generated gateway.auth.token automatically.");
    }
  } catch (err) {
    logService.warn(`failed to auto-configure browser auth: ${String(err)}`);
  }

  state = {
    server: null,
    port: resolved.controlPort,
    resolved,
    profiles: new Map(),
  };

  await ensureExtensionRelayForProfiles({
    resolved,
    onWarn: (message) => logService.warn(message),
  });

  // Register per-profile workspace paths so auto-downloads land in the right agent workspace.
  const agentIds = listAgentIds(cfg);
  for (const [profileName, profileCfg] of Object.entries(resolved.profiles)) {
    const cdpUrl = profileCfg.cdpUrl;
    if (!cdpUrl) {
      continue;
    }
    // A profile name conventionally matches an agent ID. Try exact match first,
    // then fall back to the default agent workspace.
    const matchedAgentId = agentIds.find((id) => id === profileName);
    const agentId = matchedAgentId ?? profileName;
    try {
      const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
      setDownloadWorkspaceForCdp(cdpUrl, workspaceDir);
      logService.info(`browser downloads: ${profileName} → ${workspaceDir}/downloads`);
    } catch (err) {
      logService.warn(
        `browser downloads: could not resolve workspace for ${profileName}: ${String(err)}`,
      );
    }
  }

  logService.info(
    `Browser control service ready (profiles=${Object.keys(resolved.profiles).length})`,
  );
  return state;
}

export async function stopBrowserControlService(): Promise<void> {
  const current = state;
  if (!current) {
    return;
  }

  await stopKnownBrowserProfiles({
    getState: () => state,
    onWarn: (message) => logService.warn(message),
  });

  // Clear workspace registry for all profiles.
  if (current) {
    for (const profileCfg of Object.values(current.resolved.profiles)) {
      if (profileCfg.cdpUrl) {
        setDownloadWorkspaceForCdp(profileCfg.cdpUrl, null);
      }
    }
  }

  state = null;

  // Optional: Playwright is not always available (e.g. embedded gateway builds).
  try {
    const mod = await import("./pw-ai.js");
    await mod.closePlaywrightBrowserConnection();
  } catch {
    // ignore
  }
}
