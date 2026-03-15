/**
 * Session context freshness validation.
 *
 * Detects stale workspace/skill paths in long-lived sessions (especially LCM).
 * When staleness is detected, callers silently force a skill snapshot refresh
 * and system prompt rebuild — the user sees no interruption.
 */

import fs from "node:fs";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("session-freshness");

export type FreshnessResult = {
  fresh: boolean;
  staleReasons: string[];
};

/**
 * Validate that critical session context paths still exist on disk.
 * Call this on session resume (before building the system prompt) to
 * detect paths that have gone stale since the session was created.
 */
export function validateSessionPathFreshness(params: {
  workspaceDir?: string;
  /** Workspace dir recorded in the session's system prompt report */
  reportedWorkspaceDir?: string;
}): FreshnessResult {
  const staleReasons: string[] = [];

  // Check 1: Workspace directory must exist.
  if (params.workspaceDir) {
    try {
      const stat = fs.statSync(params.workspaceDir);
      if (!stat.isDirectory()) {
        staleReasons.push(`Workspace path exists but is not a directory: ${params.workspaceDir}`);
      }
    } catch {
      staleReasons.push(`Workspace directory no longer exists: ${params.workspaceDir}`);
    }
  }

  // Check 2: If the system prompt was built with a different workspace dir,
  // the session context is stale (workspace may have been reconfigured).
  if (
    params.reportedWorkspaceDir &&
    params.workspaceDir &&
    params.reportedWorkspaceDir !== params.workspaceDir
  ) {
    staleReasons.push(
      `Workspace dir mismatch: session recorded ${params.reportedWorkspaceDir}, ` +
        `current is ${params.workspaceDir}`,
    );
  }

  if (staleReasons.length > 0) {
    log.warn("session context staleness detected", {
      reasons: staleReasons,
      workspaceDir: params.workspaceDir,
    });
  }

  return {
    fresh: staleReasons.length === 0,
    staleReasons,
  };
}
