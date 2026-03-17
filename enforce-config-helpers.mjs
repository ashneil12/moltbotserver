// =============================================================================
// enforce-config-helpers.mjs — Shared utilities for enforce-config modules
//
// Extracted from enforce-config.mjs to improve testability and reduce the
// monolith file size. All functions are pure or have clear side-effects
// (file I/O), making them easy to unit test.
// =============================================================================

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Read and parse a JSON config file. Returns empty object if file is missing/empty. */
export function readConfig(path) {
  try {
    const raw = readFileSync(path, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    if (err?.code !== "ENOENT") {
      console.warn(`[enforce-config] ⚠ Failed to read ${path}: ${err.message}`);
    }
    return {};
  }
}

/** Write config back to disk with pretty-printing. */
export function writeConfig(path, config) {
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
}

/** Ensure a nested path exists in an object, returning the leaf. */
export function ensure(obj, ...keys) {
  let current = obj;
  for (const key of keys) {
    current[key] = current[key] || {};
    current = current[key];
  }
  return current;
}

/** Generate a 12-char alphanumeric ID for cron jobs. */
export function makeId() {
  return Array.from({ length: 12 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
}

/** Read an env var, returning defaultValue if unset/empty. */
export function env(name, defaultValue = "") {
  return process.env[name]?.trim() || defaultValue;
}

/**
 * Determine whether reflection cron jobs should be enabled.
 * Accepts 'enabled'/'disabled' (new) and 'high'/'normal'/'low' (legacy compat).
 */
export function resolveReflectionIntervals(freq) {
  return {
    reflectionEnabled: freq !== "disabled",
  };
}

/** Check if a string is truthy ("true" or "1"). */
export function isTruthy(value) {
  return value === "true" || value === "1";
}

// ── Config Safety ───────────────────────────────────────────────────────────

/**
 * Detect and repair common config corruption patterns:
 * - Non-JSON content prepended to the file (e.g. leaked stdout from shell commands)
 * - Empty or missing file → restore from .bak
 *
 * Returns true if the file was repaired, false if no repair needed.
 */
export function repairConfig(configPath) {
  if (!existsSync(configPath)) {
    // File missing — try restore from backup
    const bakPath = configPath + ".bak";
    if (existsSync(bakPath)) {
      try {
        const bakRaw = readFileSync(bakPath, "utf8").trim();
        JSON.parse(bakRaw); // validate the backup is valid JSON
        copyFileSync(bakPath, configPath);
        console.log(`[enforce-config] 🔧 Config missing — restored from ${bakPath}`);
        return true;
      } catch {
        console.warn(
          `[enforce-config] ⚠ Config missing and backup is also invalid — starting fresh`,
        );
      }
    }
    return false;
  }

  const raw = readFileSync(configPath, "utf8");

  // Try parsing as-is first
  try {
    JSON.parse(raw);
    return false; // Valid JSON, no repair needed
  } catch {
    // Fall through to repair attempts
  }

  // Attempt 1: Strip non-JSON prefix lines (e.g. shell output leaked before JSON)
  const lines = raw.split("\n");
  const firstBraceIdx = lines.findIndex((l) => l.trimStart().startsWith("{"));
  if (firstBraceIdx > 0) {
    const stripped = lines.slice(firstBraceIdx).join("\n");
    try {
      JSON.parse(stripped);
      const garbage = lines
        .slice(0, firstBraceIdx)
        .map((l) => l.trim())
        .filter(Boolean);
      writeFileSync(configPath, stripped);
      console.log(
        `[enforce-config] 🔧 Repaired config: stripped ${firstBraceIdx} corrupted line(s) ` +
          `before JSON: ${JSON.stringify(garbage)}`,
      );
      return true;
    } catch {
      // Stripped content still invalid — fall through
    }
  }

  // Attempt 2: Restore from backup
  const bakPath = configPath + ".bak";
  if (existsSync(bakPath)) {
    try {
      const bakRaw = readFileSync(bakPath, "utf8").trim();
      JSON.parse(bakRaw);
      copyFileSync(bakPath, configPath);
      console.log(`[enforce-config] 🔧 Config corrupted beyond repair — restored from ${bakPath}`);
      return true;
    } catch {
      console.error(
        `[enforce-config] ❌ Config AND backup are both corrupted — manual intervention needed`,
      );
    }
  } else {
    console.error(
      `[enforce-config] ❌ Config corrupted and no backup exists — manual intervention needed`,
    );
  }

  return false;
}

/**
 * Back up openclaw.json to openclaw.json.bak before enforcement runs.
 * Only backs up if the current file is valid JSON (avoids propagating corruption).
 * Rotates: .bak → .bak.1 → .bak.2 (keeps up to 3 backups).
 */
export function backupConfig(configPath) {
  if (!existsSync(configPath)) {
    return;
  }
  try {
    const raw = readFileSync(configPath, "utf8").trim();
    JSON.parse(raw); // Only back up valid JSON
  } catch {
    console.warn(`[enforce-config] ⚠ Skipping backup — config is not valid JSON`);
    return;
  }

  const bak = configPath + ".bak";
  const bak1 = configPath + ".bak.1";
  const bak2 = configPath + ".bak.2";

  // Rotate: .bak.1 → .bak.2, .bak → .bak.1
  try {
    if (existsSync(bak1)) {
      copyFileSync(bak1, bak2);
    }
    if (existsSync(bak)) {
      copyFileSync(bak, bak1);
    }
    copyFileSync(configPath, bak);
    console.log(`[enforce-config] 📋 Config backed up to ${bak}`);
  } catch (err) {
    console.warn(`[enforce-config] ⚠ Backup failed: ${err.message}`);
  }
}
