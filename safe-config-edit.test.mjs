/**
 * safe-config-edit.test.mjs — Black-box tests for the safe config editor CLI.
 *
 * Tests the CLI by invoking it as a subprocess, verifying exit codes and file
 * mutations. Each test gets an isolated temp directory with a fresh config.
 *
 * This is a custom MoltBot addition — upstream has no equivalent.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "safe-config-edit.mjs");

let tmpDir;
let configPath;

/** Helper: create a fresh config file with the given data. */
function writeTestConfig(data) {
  writeFileSync(configPath, JSON.stringify(data, null, 2) + "\n");
}

/** Helper: read the current config from disk. */
function readTestConfig() {
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

/** Run safe-config-edit.mjs with arguments. Returns stdout. */
function run(...args) {
  return execFileSync("node", [SCRIPT, ...args, "--config", configPath], {
    encoding: "utf-8",
    timeout: 10_000,
  });
}

/** Run but expect failure — returns { status, stderr }. */
function runExpectFail(...args) {
  try {
    execFileSync("node", [SCRIPT, ...args, "--config", configPath], {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    throw new Error("Expected command to fail but it succeeded");
  } catch (err) {
    return { status: err.status, stderr: err.stderr || "" };
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "safe-config-test-"));
  configPath = join(tmpDir, "openclaw.json");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── GET command ─────────────────────────────────────────────────────────────

describe("get command", () => {
  it("reads a top-level key", () => {
    writeTestConfig({ model: "gpt-4" });
    const output = run("get", "model");
    expect(output.trim()).toBe('"gpt-4"');
  });

  it("reads a nested key", () => {
    writeTestConfig({ channels: { telegram: { enabled: true } } });
    const output = run("get", "channels.telegram.enabled");
    expect(output.trim()).toBe("true");
  });

  it("reads an object value as pretty JSON", () => {
    writeTestConfig({ agents: { list: [{ id: "main" }] } });
    const output = run("get", "agents");
    expect(JSON.parse(output)).toEqual({ list: [{ id: "main" }] });
  });

  it("fails on missing path", () => {
    writeTestConfig({ key: "value" });
    const { status } = runExpectFail("get", "nonexistent.path");
    expect(status).toBe(1);
  });
});

// ── SET command ─────────────────────────────────────────────────────────────

describe("set command", () => {
  it("creates a new key", () => {
    writeTestConfig({});
    run("set", "newKey", '"hello"');
    expect(readTestConfig().newKey).toBe("hello");
  });

  it("overwrites an existing key", () => {
    writeTestConfig({ key: "old" });
    run("set", "key", '"new"');
    expect(readTestConfig().key).toBe("new");
  });

  it("creates intermediate objects", () => {
    writeTestConfig({});
    run("set", "a.b.c", "42");
    expect(readTestConfig().a.b.c).toBe(42);
  });

  it("sets an array value", () => {
    writeTestConfig({});
    run("set", "tags", '["a", "b"]');
    expect(readTestConfig().tags).toEqual(["a", "b"]);
  });

  it("sets a boolean value", () => {
    writeTestConfig({});
    run("set", "enabled", "true");
    expect(readTestConfig().enabled).toBe(true);
  });

  it("creates a backup on write", () => {
    writeTestConfig({ original: true });
    run("set", "added", '"val"');
    expect(existsSync(configPath + ".bak")).toBe(true);
    const bak = JSON.parse(readFileSync(configPath + ".bak", "utf-8"));
    expect(bak.original).toBe(true);
    expect(bak.added).toBeUndefined();
  });

  it("no-ops when value is already set", () => {
    writeTestConfig({ key: "same" });
    const output = run("set", "key", '"same"');
    expect(output).toContain("No changes");
  });

  it("dry-run does not write", () => {
    writeTestConfig({ key: "original" });
    run("set", "key", '"changed"', "--dry-run");
    expect(readTestConfig().key).toBe("original");
  });
});

// ── REMOVE command ──────────────────────────────────────────────────────────

describe("remove command", () => {
  it("removes key with --force", () => {
    writeTestConfig({ keep: true, remove: "me" });
    run("remove", "remove", "--force");
    const config = readTestConfig();
    expect(config.keep).toBe(true);
    expect(config.remove).toBeUndefined();
  });

  it("refuses removal without --force", () => {
    writeTestConfig({ key: "value" });
    const { status } = runExpectFail("remove", "key");
    expect(status).toBe(1);
    // Config unchanged
    expect(readTestConfig().key).toBe("value");
  });

  it("fails on nonexistent key", () => {
    writeTestConfig({ key: "value" });
    const { status } = runExpectFail("remove", "nonexistent", "--force");
    expect(status).toBe(1);
  });
});

// ── VALIDATE command ────────────────────────────────────────────────────────

describe("validate command", () => {
  it("validates clean config", () => {
    writeTestConfig({ channels: {}, agents: { list: [] } });
    const output = run("validate");
    expect(output).toContain("valid");
  });

  it("detects pairedUsers structural issue", () => {
    writeTestConfig({
      channels: {
        telegram: {
          accounts: {
            bot1: { botToken: "123:xxx", pairedUsers: ["12345"] },
          },
        },
      },
    });
    const output = run("validate");
    expect(output).toContain("pairedUsers");
  });

  it("detects missing botToken in telegram account", () => {
    writeTestConfig({
      channels: {
        telegram: {
          accounts: {
            bot1: {},
          },
        },
      },
    });
    const output = run("validate");
    expect(output).toContain("botToken");
  });

  it("fails on non-JSON config", () => {
    writeFileSync(configPath, "not json");
    const { status } = runExpectFail("validate");
    expect(status).toBe(1);
  });
});

// ── DIFF command ────────────────────────────────────────────────────────────

describe("diff command", () => {
  it("shows no differences for identical config and backup", () => {
    writeTestConfig({ same: true });
    writeFileSync(configPath + ".bak", JSON.stringify({ same: true }));
    const output = run("diff");
    expect(output).toContain("No differences");
  });

  it("shows changes between config and backup", () => {
    writeTestConfig({ key: "new" });
    writeFileSync(configPath + ".bak", JSON.stringify({ key: "old" }));
    const output = run("diff");
    expect(output).toContain("change");
    expect(output).toContain("key");
  });

  it("fails when no backup exists", () => {
    writeTestConfig({ key: "value" });
    const { status } = runExpectFail("diff");
    expect(status).toBe(1);
  });
});

// ── Backup rotation ────────────────────────────────────────────────────────

describe("backup rotation", () => {
  it("rotates .bak → .bak.1 on second write", () => {
    writeTestConfig({ v: 1 });
    run("set", "v", "2");
    run("set", "v", "3");

    expect(readTestConfig().v).toBe(3);
    expect(JSON.parse(readFileSync(configPath + ".bak", "utf-8")).v).toBe(2);
    expect(JSON.parse(readFileSync(configPath + ".bak.1", "utf-8")).v).toBe(1);
  });
});
