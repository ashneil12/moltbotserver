/**
 * Ephemeral path detection — identifies paths under volatile/tmpfs mounts
 * that will be wiped on restart.
 *
 * Used by `doctor-state-integrity` and `resolveStorePath` to warn when
 * critical session/state data is stored in locations that won't survive
 * a reboot.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type EphemeralPathResult = {
  ephemeral: boolean;
  reason?: string;
};

/**
 * Returns true if targetPath is under an ephemeral/volatile directory
 * that will be cleared on restart (e.g. /tmp, os.tmpdir(), tmpfs mounts).
 */
export function isEphemeralPath(targetPath: string): EphemeralPathResult {
  const resolved = path.resolve(targetPath);

  for (const root of getEphemeralRoots()) {
    if (resolved === root || resolved.startsWith(root + path.sep)) {
      return {
        ephemeral: true,
        reason: `Path is under ephemeral directory ${root}`,
      };
    }
  }

  // Linux: check /proc/self/mountinfo for tmpfs/ramfs mounts.
  if (process.platform === "linux") {
    const tmpfsResult = isUnderTmpfsMount(resolved);
    if (tmpfsResult.ephemeral) {
      return tmpfsResult;
    }
  }

  return { ephemeral: false };
}

// ──────────────────────────────────────────────────────────────────────────────
// Lazily cached ephemeral roots — resolved once per process to avoid
// rebuilding the array and calling os.tmpdir() on every invocation.
// ──────────────────────────────────────────────────────────────────────────────

let _ephemeralRoots: string[] | undefined;

function getEphemeralRoots(): readonly string[] {
  if (_ephemeralRoots) {
    return _ephemeralRoots;
  }
  const roots = new Set<string>();
  // Resolve all roots to absolute paths for reliable prefix comparison.
  for (const raw of [
    os.tmpdir(),
    "/tmp",
    "/var/tmp",
    ...(process.platform === "darwin" ? ["/private/tmp", "/private/var/tmp"] : []),
  ]) {
    roots.add(path.resolve(raw));
  }
  _ephemeralRoots = [...roots];
  return _ephemeralRoots;
}

/** Parse Linux mountinfo to detect tmpfs/ramfs mounts. */
function isUnderTmpfsMount(resolvedPath: string): EphemeralPathResult {
  try {
    const mountinfo = fs.readFileSync("/proc/self/mountinfo", "utf-8");
    for (const line of mountinfo.split("\n")) {
      const parsed = parseMountInfoLine(line);
      if (!parsed) {
        continue;
      }
      if (parsed.fsType !== "tmpfs" && parsed.fsType !== "ramfs") {
        continue;
      }
      // Skip well-known system tmpfs mounts that are always ephemeral
      // (already handled by the prefix check above).
      if (parsed.mountPoint === "/tmp" || parsed.mountPoint === "/var/tmp") {
        continue;
      }
      const mountPrefixed = parsed.mountPoint + path.sep;
      if (resolvedPath === parsed.mountPoint || resolvedPath.startsWith(mountPrefixed)) {
        return {
          ephemeral: true,
          reason: `Path is on ${parsed.fsType} mount at ${parsed.mountPoint}`,
        };
      }
    }
  } catch {
    // Can't read mountinfo — not an error, just can't verify.
  }
  return { ephemeral: false };
}

/** Minimal parser for /proc/self/mountinfo lines.
 *  Format: id parent major:minor root mountPoint opts separator - fsType source superOpts
 */
export function parseMountInfoLine(line: string): { mountPoint: string; fsType: string } | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  // Split into fields before and after the " - " separator.
  const separatorIndex = trimmed.indexOf(" - ");
  if (separatorIndex === -1) {
    return null;
  }

  const beforeSep = trimmed.slice(0, separatorIndex).split(/\s+/);
  const afterSep = trimmed.slice(separatorIndex + 3).split(/\s+/);

  // Before separator: id parent major:minor root mountPoint [opts...]
  // We need mountPoint at index 4.
  if (beforeSep.length < 5) {
    return null;
  }
  const mountPoint = beforeSep[4];

  // After separator: fsType source superOpts
  if (afterSep.length < 1) {
    return null;
  }
  const fsType = afterSep[0];

  return { mountPoint, fsType };
}
