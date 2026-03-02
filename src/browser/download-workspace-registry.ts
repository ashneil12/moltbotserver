/**
 * Maps a CDP URL (normalised) to the agent workspace directory that should
 * receive automatic browser downloads for that profile.
 *
 * Set by the browser server context when a profile is initialised.
 * Read by the Playwright session layer when a download event fires.
 */
const registry = new Map<string, string>();

/** Register (or clear) the agent workspace dir for a given CDP URL. */
export function setDownloadWorkspaceForCdp(cdpUrl: string, workspaceDir: string | null): void {
  const norm = cdpUrl.trim().replace(/\/$/, "").toLowerCase();
  if (workspaceDir) {
    registry.set(norm, workspaceDir);
  } else {
    registry.delete(norm);
  }
}

/** Retrieve the registered agent workspace dir for a CDP URL, or null. */
export function getDownloadWorkspaceForCdp(cdpUrl: string): string | null {
  const norm = cdpUrl.trim().replace(/\/$/, "").toLowerCase();
  return registry.get(norm) ?? null;
}
