import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectWarnings,
  formatWarningsAsMarkdown,
  persistWarnings,
  type AdvisoryWarning,
} from "./advisory-warnings.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "advisory-warnings-test-"));
  await fs.promises.mkdir(path.join(tmpDir, "memory"), { recursive: true });
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// detectWarnings — deploy/build failures
// ---------------------------------------------------------------------------

describe("detectWarnings — deploy/build", () => {
  it("detects deploy failed", () => {
    const warnings = detectWarnings("The deploy failed with timeout", "diary.md");
    expect(warnings).toContainEqual(
      expect.objectContaining({
        level: "critical",
        message: expect.stringContaining("deploy failed"),
      }),
    );
  });

  it("detects build error", () => {
    const warnings = detectWarnings("build error in production step", "diary.md");
    expect(warnings).toContainEqual(expect.objectContaining({ level: "critical" }));
  });

  it("detects non-zero exit code", () => {
    const warnings = detectWarnings("Process ended with exit code 1", "diary.md");
    expect(warnings.some((w) => w.message.includes("exit"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectWarnings — dangerous commands
// ---------------------------------------------------------------------------

describe("detectWarnings — dangerous commands", () => {
  it("detects rm -rf on non-tmp paths", () => {
    const warnings = detectWarnings("rm -rf /var/data/production", "diary.md");
    expect(warnings).toContainEqual(
      expect.objectContaining({ level: "critical", message: expect.stringContaining("rm") }),
    );
  });

  it("skips rm -rf /tmp (safe)", () => {
    const warnings = detectWarnings("rm -rf /tmp/build-cache", "diary.md");
    const rmWarnings = warnings.filter((w) => w.message.includes("rm"));
    expect(rmWarnings.length).toBe(0);
  });

  it("detects DROP TABLE", () => {
    const warnings = detectWarnings("DROP TABLE users", "diary.md");
    expect(warnings).toContainEqual(
      expect.objectContaining({ level: "critical", message: expect.stringContaining("DROP") }),
    );
  });

  it("detects force push", () => {
    const warnings = detectWarnings("git push --force origin main", "diary.md");
    expect(warnings).toContainEqual(
      expect.objectContaining({ level: "warning", message: expect.stringContaining("push") }),
    );
  });
});

// ---------------------------------------------------------------------------
// detectWarnings — connection failures
// ---------------------------------------------------------------------------

describe("detectWarnings — connection", () => {
  it("detects ECONNREFUSED", () => {
    const warnings = detectWarnings("Error: ECONNREFUSED 127.0.0.1:5432", "diary.md");
    expect(warnings).toContainEqual(
      expect.objectContaining({
        level: "critical",
        message: expect.stringContaining("ECONNREFUSED"),
      }),
    );
  });

  it("detects connection refused", () => {
    const warnings = detectWarnings("connection refused by server", "diary.md");
    expect(warnings.some((w) => w.level === "critical")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectWarnings — auth/permission
// ---------------------------------------------------------------------------

describe("detectWarnings — auth", () => {
  it("detects 401 unauthorized", () => {
    const warnings = detectWarnings("API returned 401 unauthorized", "diary.md");
    const authWarnings = warnings.filter(
      (w) => w.message.toLowerCase().includes("auth") || w.message.toLowerCase().includes("401"),
    );
    expect(authWarnings.length).toBeGreaterThan(0);
  });

  it("detects permission denied", () => {
    const warnings = detectWarnings("permission denied on file", "diary.md");
    expect(warnings.some((w) => w.level === "warning")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectWarnings — missing env vars
// ---------------------------------------------------------------------------

describe("detectWarnings — missing config", () => {
  it("detects missing env var", () => {
    const warnings = detectWarnings("DATABASE_URL is not set", "diary.md");
    expect(warnings.some((w) => w.message.includes("DATABASE_URL"))).toBe(true);
  });

  it("detects missing config key", () => {
    const warnings = detectWarnings("missing env var: API_KEY", "diary.md");
    expect(warnings.some((w) => w.message.includes("API_KEY"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectWarnings — crashes
// ---------------------------------------------------------------------------

describe("detectWarnings — crashes", () => {
  it("detects OOM", () => {
    const warnings = detectWarnings("OOM killed by kernel", "diary.md");
    expect(warnings).toContainEqual(
      expect.objectContaining({ level: "critical", message: expect.stringContaining("OOM") }),
    );
  });

  it("detects SIGKILL", () => {
    const warnings = detectWarnings("Process received SIGKILL", "diary.md");
    expect(warnings).toContainEqual(expect.objectContaining({ level: "critical" }));
  });
});

// ---------------------------------------------------------------------------
// detectWarnings — no false positives
// ---------------------------------------------------------------------------

describe("detectWarnings — no false positives", () => {
  it("returns empty for normal content", () => {
    const warnings = detectWarnings(
      "Successfully completed the task. Everything looks good.",
      "diary.md",
    );
    expect(warnings.length).toBe(0);
  });

  it("deduplicates identical matches", () => {
    const warnings = detectWarnings("deploy failed. then deploy failed again.", "diary.md");
    expect(warnings.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// formatWarningsAsMarkdown
// ---------------------------------------------------------------------------

describe("formatWarningsAsMarkdown", () => {
  it("returns empty for no warnings", () => {
    expect(formatWarningsAsMarkdown([])).toBe("");
  });

  it("sorts by severity (critical first)", () => {
    const warnings: AdvisoryWarning[] = [
      { level: "info", message: "Rate limited", source: "diary.md", date: "2026-03-15" },
      { level: "critical", message: "OOM crash", source: "diary.md", date: "2026-03-15" },
      { level: "warning", message: "401 error", source: "diary.md", date: "2026-03-15" },
    ];
    const md = formatWarningsAsMarkdown(warnings);
    const critIdx = md.indexOf("OOM crash");
    const warnIdx = md.indexOf("401 error");
    const infoIdx = md.indexOf("Rate limited");
    expect(critIdx).toBeLessThan(warnIdx);
    expect(warnIdx).toBeLessThan(infoIdx);
  });

  it("includes severity icons", () => {
    const warnings: AdvisoryWarning[] = [
      { level: "critical", message: "test", source: "s", date: "2026-03-15" },
    ];
    const md = formatWarningsAsMarkdown(warnings);
    expect(md).toContain("🔴");
  });
});

// ---------------------------------------------------------------------------
// persistWarnings
// ---------------------------------------------------------------------------

describe("persistWarnings", () => {
  it("creates new file when none exists", () => {
    const warnings: AdvisoryWarning[] = [
      { level: "critical", message: "deploy failed", source: "diary.md", date: "2026-03-15" },
    ];
    const result = persistWarnings(tmpDir, warnings);
    expect(result.written).toBe(1);

    const content = fs.readFileSync(path.join(tmpDir, "memory", "advisory-warnings.md"), "utf-8");
    expect(content).toContain("# Active Warnings");
    expect(content).toContain("deploy failed");
  });

  it("deduplicates against existing file", () => {
    const initial: AdvisoryWarning[] = [
      { level: "critical", message: "deploy failed", source: "diary.md", date: "2026-03-15" },
    ];
    persistWarnings(tmpDir, initial);

    const again: AdvisoryWarning[] = [
      { level: "critical", message: "deploy failed", source: "diary.md", date: "2026-03-15" },
      { level: "warning", message: "new warning", source: "diary.md", date: "2026-03-15" },
    ];
    const result = persistWarnings(tmpDir, again);
    expect(result.written).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("dry-run does not write file", () => {
    const warnings: AdvisoryWarning[] = [
      { level: "critical", message: "test", source: "diary.md", date: "2026-03-15" },
    ];
    const result = persistWarnings(tmpDir, warnings, { dryRun: true });
    expect(result.written).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, "memory", "advisory-warnings.md"))).toBe(false);
  });
});
