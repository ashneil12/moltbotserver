/**
 * enforce-config-helpers.test.mjs — Tests for extracted config helpers.
 *
 * Tests the shared utilities now living in enforce-config-helpers.mjs:
 * readConfig, writeConfig, ensure, makeId, env, isTruthy,
 * repairConfig, backupConfig, resolveReflectionIntervals.
 *
 * This is a custom MoltBot addition — upstream has no equivalent.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readConfig,
  writeConfig,
  ensure,
  makeId,
  env,
  isTruthy,
  repairConfig,
  backupConfig,
  resolveReflectionIntervals,
} from "./enforce-config-helpers.mjs";

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "enforce-helpers-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  // Clean up any env vars set during tests
  delete process.env.__TEST_ENV_VAR;
});

// ── readConfig ──────────────────────────────────────────────────────────────

describe("readConfig", () => {
  it("parses valid JSON file", () => {
    const p = join(tmpDir, "valid.json");
    writeFileSync(p, '{"key": "value"}');
    expect(readConfig(p)).toEqual({ key: "value" });
  });

  it("returns {} for missing file", () => {
    expect(readConfig(join(tmpDir, "nonexistent.json"))).toEqual({});
  });

  it("returns {} for empty file", () => {
    const p = join(tmpDir, "empty.json");
    writeFileSync(p, "");
    expect(readConfig(p)).toEqual({});
  });

  it("returns {} for corrupt (non-JSON) file", () => {
    const p = join(tmpDir, "corrupt.json");
    writeFileSync(p, "this is not json");
    expect(readConfig(p)).toEqual({});
  });
});

// ── writeConfig ─────────────────────────────────────────────────────────────

describe("writeConfig", () => {
  it("writes pretty-printed JSON with trailing newline", () => {
    const p = join(tmpDir, "out.json");
    writeConfig(p, { hello: "world", nested: { value: 42 } });
    const raw = readFileSync(p, "utf-8");
    expect(raw).toBe(JSON.stringify({ hello: "world", nested: { value: 42 } }, null, 2) + "\n");
  });
});

// ── ensure ──────────────────────────────────────────────────────────────────

describe("ensure", () => {
  it("creates nested objects from scratch", () => {
    const obj = {};
    const leaf = ensure(obj, "a", "b", "c");
    expect(obj.a.b.c).toEqual({});
    expect(leaf).toBe(obj.a.b.c);
  });

  it("preserves existing intermediate objects", () => {
    const obj = { a: { existing: true } };
    ensure(obj, "a", "b");
    expect(obj.a.existing).toBe(true);
    expect(obj.a.b).toEqual({});
  });

  it("returns existing leaf if already present", () => {
    const obj = { a: { b: { value: 42 } } };
    const leaf = ensure(obj, "a", "b");
    expect(leaf).toBe(obj.a.b);
    expect(leaf.value).toBe(42);
  });
});

// ── makeId ──────────────────────────────────────────────────────────────────

describe("makeId", () => {
  it("generates a 12-character alphanumeric string", () => {
    const id = makeId();
    expect(id).toHaveLength(12);
    expect(id).toMatch(/^[a-z0-9]{12}$/);
  });

  it("generates unique IDs", () => {
    const ids = Array.from({ length: 100 }, () => makeId());
    const unique = new Set(ids);
    expect(unique.size).toBeGreaterThan(90); // Statistically should be 100, but allow for tiny collision chance
  });
});

// ── env ─────────────────────────────────────────────────────────────────────

describe("env", () => {
  it("reads an existing env var", () => {
    process.env.__TEST_ENV_VAR = "hello";
    expect(env("__TEST_ENV_VAR")).toBe("hello");
  });

  it("returns default for missing env var", () => {
    expect(env("__DEFINITELY_NOT_SET_12345", "fallback")).toBe("fallback");
  });

  it("returns default for empty env var", () => {
    process.env.__TEST_ENV_VAR = "";
    expect(env("__TEST_ENV_VAR", "fallback")).toBe("fallback");
  });

  it("trims whitespace from env var", () => {
    process.env.__TEST_ENV_VAR = "  trimmed  ";
    expect(env("__TEST_ENV_VAR")).toBe("trimmed");
  });

  it("returns empty string as default when no default provided", () => {
    expect(env("__DEFINITELY_NOT_SET_12345")).toBe("");
  });
});

// ── isTruthy ────────────────────────────────────────────────────────────────

describe("isTruthy", () => {
  it('returns true for "true"', () => {
    expect(isTruthy("true")).toBe(true);
  });

  it('returns true for "1"', () => {
    expect(isTruthy("1")).toBe(true);
  });

  it('returns false for "false"', () => {
    expect(isTruthy("false")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isTruthy("")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isTruthy(undefined)).toBe(false);
  });
});

// ── resolveReflectionIntervals ──────────────────────────────────────────────

describe("resolveReflectionIntervals", () => {
  it("enables reflection for 'normal'", () => {
    expect(resolveReflectionIntervals("normal")).toEqual({ reflectionEnabled: true });
  });

  it("enables reflection for 'high'", () => {
    expect(resolveReflectionIntervals("high")).toEqual({ reflectionEnabled: true });
  });

  it("disables reflection for 'disabled'", () => {
    expect(resolveReflectionIntervals("disabled")).toEqual({ reflectionEnabled: false });
  });

  it("enables reflection for 'enabled'", () => {
    expect(resolveReflectionIntervals("enabled")).toEqual({ reflectionEnabled: true });
  });
});

// ── repairConfig ────────────────────────────────────────────────────────────

describe("repairConfig", () => {
  it("returns false for valid JSON (no repair needed)", () => {
    const p = join(tmpDir, "valid.json");
    writeFileSync(p, '{"key": "value"}');
    expect(repairConfig(p)).toBe(false);
  });

  it("returns false for missing file with no backup", () => {
    expect(repairConfig(join(tmpDir, "nonexistent.json"))).toBe(false);
  });

  it("restores from .bak when file is missing", () => {
    const p = join(tmpDir, "missing.json");
    writeFileSync(p + ".bak", '{"restored": true}');
    expect(repairConfig(p)).toBe(true);
    expect(JSON.parse(readFileSync(p, "utf-8"))).toEqual({ restored: true });
  });

  it("strips non-JSON prefix lines", () => {
    const p = join(tmpDir, "prefixed.json");
    writeFileSync(p, 'some garbage output\nmore garbage\n{"fixed": true}\n');
    expect(repairConfig(p)).toBe(true);
    expect(JSON.parse(readFileSync(p, "utf-8"))).toEqual({ fixed: true });
  });

  it("restores from backup when file is corrupt beyond repair", () => {
    const p = join(tmpDir, "corrupt.json");
    writeFileSync(p, "total garbage with no JSON anywhere");
    writeFileSync(p + ".bak", '{"from_backup": true}');
    expect(repairConfig(p)).toBe(true);
    expect(JSON.parse(readFileSync(p, "utf-8"))).toEqual({ from_backup: true });
  });

  it("returns false when both file and backup are corrupt", () => {
    const p = join(tmpDir, "both-bad.json");
    writeFileSync(p, "garbage");
    writeFileSync(p + ".bak", "also garbage");
    expect(repairConfig(p)).toBe(false);
  });
});

// ── backupConfig ────────────────────────────────────────────────────────────

describe("backupConfig", () => {
  it("creates .bak from valid config", () => {
    const p = join(tmpDir, "config.json");
    writeFileSync(p, '{"data": 1}');
    backupConfig(p);
    expect(existsSync(p + ".bak")).toBe(true);
    expect(readFileSync(p + ".bak", "utf-8")).toBe('{"data": 1}');
  });

  it("rotates backups: .bak → .bak.1 → .bak.2", () => {
    const p = join(tmpDir, "config.json");

    // Create initial config and backup
    writeFileSync(p, '{"v": 1}');
    backupConfig(p);
    expect(readFileSync(p + ".bak", "utf-8")).toBe('{"v": 1}');

    // Second backup — .bak rotates to .bak.1
    writeFileSync(p, '{"v": 2}');
    backupConfig(p);
    expect(readFileSync(p + ".bak", "utf-8")).toBe('{"v": 2}');
    expect(readFileSync(p + ".bak.1", "utf-8")).toBe('{"v": 1}');

    // Third backup — .bak.1 rotates to .bak.2
    writeFileSync(p, '{"v": 3}');
    backupConfig(p);
    expect(readFileSync(p + ".bak", "utf-8")).toBe('{"v": 3}');
    expect(readFileSync(p + ".bak.1", "utf-8")).toBe('{"v": 2}');
    expect(readFileSync(p + ".bak.2", "utf-8")).toBe('{"v": 1}');
  });

  it("skips backup for invalid JSON config", () => {
    const p = join(tmpDir, "bad.json");
    writeFileSync(p, "not json");
    backupConfig(p);
    expect(existsSync(p + ".bak")).toBe(false);
  });

  it("does nothing for missing file", () => {
    backupConfig(join(tmpDir, "nonexistent.json"));
    // Should not throw
  });
});
