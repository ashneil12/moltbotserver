/**
 * Atomic file operations — shared helpers for crash-safe writes and
 * idempotent reads.
 *
 * These patterns were duplicated across diary-archive.ts,
 * reflection-artifacts.ts, workspace.ts, and transcript-sweep.ts.
 * Consolidated here to eliminate boilerplate and ensure consistent
 * error handling.
 */

import fs from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

/**
 * Write `content` to `filePath` atomically via a temporary file + rename.
 *
 * The tmp file is written adjacent to `filePath` so the rename is guaranteed
 * to be on the same filesystem (required for POSIX atomic rename).
 *
 * Parent directories are created automatically.
 *
 * On failure the tmp file is cleaned up best-effort before re-throwing.
 */
export async function atomicWriteFile(
  filePath: string,
  content: string,
  encoding: BufferEncoding = "utf-8",
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    await fs.writeFile(tmpPath, content, { encoding });
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Read a text file, returning `undefined` if it does not exist (ENOENT).
 * All other errors are re-thrown.
 */
export async function readTextFileIfExists(filePath: string): Promise<string | undefined> {
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

// ---------------------------------------------------------------------------
// Write-if-changed
// ---------------------------------------------------------------------------

/**
 * Read the current content of `filePath`, compare with `next`, and
 * atomically overwrite only if the content has actually changed.
 *
 * Returns `true` if the file was rewritten, `false` if it was already
 * up-to-date (or didn't exist and `next` is undefined).
 */
export async function writeTextFileIfChanged(filePath: string, next: string): Promise<boolean> {
  const existing = await readTextFileIfExists(filePath);
  if (existing === next) {
    return false;
  }
  await atomicWriteFile(filePath, next);
  return true;
}
