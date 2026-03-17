/**
 * Workspace doc converter functional tests.
 *
 * Tests the shell script `scripts/workspace-doc-converter.sh` by shelling out
 * with `--once` and asserting on the converted output files.
 *
 * Only tests self-contained converters (TXT, CSV) that need no external deps
 * (pdftotext, pandoc). Each test gets an isolated temp workspace directory.
 *
 * This is a custom MoltBot addition — upstream has no equivalent.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  utimesSync,
} from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Path to the converter script (relative to repo root)
const SCRIPT = join(__dirname, "..", "..", "scripts", "workspace-doc-converter.sh");

let workDir: string;

/** Run the converter once against `workDir`. */
function runConverter(extraArgs: string[] = []): string {
  return execFileSync("bash", [SCRIPT, "--once", ...extraArgs], {
    env: {
      ...process.env,
      OPENCLAW_WORKSPACE_DIR: workDir,
      // Suppress log to a temp location (avoids polluting real workspace)
      CONVERTER_LOG: join(workDir, "converter-log", "converter.log"),
    },
    timeout: 15_000,
    encoding: "utf-8",
  });
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "doc-converter-test-"));
  mkdirSync(join(workDir, "converter-log"), { recursive: true });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

// ── TXT Conversion ──────────────────────────────────────────────────────────

describe("TXT conversion", () => {
  it("converts .txt to .md with AUTO-CONVERTED header", () => {
    const txtPath = join(workDir, "notes.txt");
    writeFileSync(txtPath, "Hello world\nSecond line\n");

    runConverter();

    const mdPath = join(workDir, "notes.md");
    expect(existsSync(mdPath)).toBe(true);

    const content = readFileSync(mdPath, "utf-8");
    expect(content).toContain("AUTO-CONVERTED");
    expect(content).toContain("plain text");
    expect(content).toContain("Hello world");
    expect(content).toContain("Second line");
  });

  it("converts .txt in a nested subdirectory", () => {
    const subDir = join(workDir, "docs", "internal");
    mkdirSync(subDir, { recursive: true });
    const txtPath = join(subDir, "readme.txt");
    writeFileSync(txtPath, "Nested content");

    runConverter();

    const mdPath = join(subDir, "readme.md");
    expect(existsSync(mdPath)).toBe(true);
    expect(readFileSync(mdPath, "utf-8")).toContain("Nested content");
  });
});

// ── CSV Conversion ──────────────────────────────────────────────────────────

describe("CSV conversion", () => {
  it("converts .csv to a markdown table", () => {
    const csvPath = join(workDir, "data.csv");
    writeFileSync(csvPath, "Name,Age,City\nAlice,30,NYC\nBob,25,LA\n");

    runConverter();

    const mdPath = join(workDir, "data.md");
    expect(existsSync(mdPath)).toBe(true);

    const content = readFileSync(mdPath, "utf-8");
    expect(content).toContain("AUTO-CONVERTED");
    expect(content).toContain("CSV");
    // Header row
    expect(content).toContain("| Name |");
    expect(content).toContain("| Age |");
    // Separator
    expect(content).toContain("| --- |");
    // Data rows
    expect(content).toContain("| Alice |");
    expect(content).toContain("| Bob |");
  });

  it("handles single-column CSV", () => {
    const csvPath = join(workDir, "single.csv");
    writeFileSync(csvPath, "Item\napple\nbanana\n");

    runConverter();

    const mdPath = join(workDir, "single.md");
    expect(existsSync(mdPath)).toBe(true);

    const content = readFileSync(mdPath, "utf-8");
    expect(content).toContain("| Item |");
    expect(content).toContain("| apple |");
    expect(content).toContain("| banana |");
  });
});

// ── Idempotency ─────────────────────────────────────────────────────────────

describe("idempotency", () => {
  it("skips conversion when .md is already up to date", () => {
    const txtPath = join(workDir, "stable.txt");
    writeFileSync(txtPath, "Original content");

    // First run — converts
    runConverter();
    const mdPath = join(workDir, "stable.md");
    expect(existsSync(mdPath)).toBe(true);

    const firstContent = readFileSync(mdPath, "utf-8");

    // Make the .md file older by setting its mtime to the past
    // (the converter checks source -nt output)
    // Actually, since we just created both, the .md is newer. Just re-run.
    const _output = runConverter();

    // Second run should not re-convert (content unchanged)
    const secondContent = readFileSync(mdPath, "utf-8");
    expect(secondContent).toBe(firstContent);
  });

  it("re-converts when source is newer than output", () => {
    const txtPath = join(workDir, "changing.txt");
    writeFileSync(txtPath, "Version 1");

    runConverter();
    const mdPath = join(workDir, "changing.md");
    const firstContent = readFileSync(mdPath, "utf-8");
    expect(firstContent).toContain("Version 1");

    // Make the .md older than the source by backdating it
    const past = new Date(Date.now() - 60_000);
    utimesSync(mdPath, past, past);

    // Update the source
    writeFileSync(txtPath, "Version 2");

    runConverter();
    const secondContent = readFileSync(mdPath, "utf-8");
    expect(secondContent).toContain("Version 2");
    expect(secondContent).not.toContain("Version 1");
  });
});

// ── User File Protection ────────────────────────────────────────────────────

describe("user file protection", () => {
  it("does NOT overwrite a user-created .md file", () => {
    const txtPath = join(workDir, "project.txt");
    writeFileSync(txtPath, "Source text");

    // Create a user-authored .md alongside it (no AUTO-CONVERTED header)
    const mdPath = join(workDir, "project.md");
    writeFileSync(mdPath, "# My Hand-Written Notes\n\nDo not touch this.\n");

    runConverter();

    // The user file should be untouched
    const content = readFileSync(mdPath, "utf-8");
    expect(content).toBe("# My Hand-Written Notes\n\nDo not touch this.\n");
    expect(content).not.toContain("AUTO-CONVERTED");
  });
});

// ── --force Flag ────────────────────────────────────────────────────────────

describe("--force flag", () => {
  it("re-converts even when .md is up to date", () => {
    const txtPath = join(workDir, "forced.txt");
    writeFileSync(txtPath, "Force test content");

    runConverter();
    const mdPath = join(workDir, "forced.md");
    expect(existsSync(mdPath)).toBe(true);

    // Get the first conversion timestamp from the header
    const firstContent = readFileSync(mdPath, "utf-8");
    const firstMatch = firstContent.match(/Converted: (\S+)/);
    expect(firstMatch).not.toBeNull();

    // Wait a tiny bit so the timestamp differs
    const start = Date.now();
    while (Date.now() - start < 1100) {
      /* spin */
    }

    // Force re-conversion
    runConverter(["--force"]);
    const secondContent = readFileSync(mdPath, "utf-8");
    const secondMatch = secondContent.match(/Converted: (\S+)/);
    expect(secondMatch).not.toBeNull();

    // Timestamps should differ (forced re-conversion happened)
    expect(secondMatch![1]).not.toBe(firstMatch![1]);
  });
});

// ── Directory Exclusions ────────────────────────────────────────────────────

describe("directory exclusions", () => {
  it("ignores files in hidden directories", () => {
    const hiddenDir = join(workDir, ".git");
    mkdirSync(hiddenDir, { recursive: true });
    writeFileSync(join(hiddenDir, "config.txt"), "git config");

    runConverter();

    expect(existsSync(join(hiddenDir, "config.md"))).toBe(false);
  });

  it("ignores files in node_modules", () => {
    const nmDir = join(workDir, "node_modules", "some-pkg");
    mkdirSync(nmDir, { recursive: true });
    writeFileSync(join(nmDir, "README.txt"), "Package readme");

    runConverter();

    expect(existsSync(join(nmDir, "README.md"))).toBe(false);
  });

  it("ignores files in converter-log directory", () => {
    writeFileSync(join(workDir, "converter-log", "old.txt"), "old log data");

    runConverter();

    expect(existsSync(join(workDir, "converter-log", "old.md"))).toBe(false);
  });
});

// ── Log File ────────────────────────────────────────────────────────────────

describe("log file", () => {
  it("creates converter.log with entries", () => {
    writeFileSync(join(workDir, "logtest.txt"), "Log test");

    runConverter();

    const logPath = join(workDir, "converter-log", "converter.log");
    expect(existsSync(logPath)).toBe(true);

    const log = readFileSync(logPath, "utf-8");
    expect(log).toContain("workspace-doc-converter starting");
    expect(log).toContain("OK");
    expect(log).toContain("logtest.txt");
  });
});

// ── Empty Workspace ─────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles empty workspace without crashing", () => {
    // workDir exists but has no convertible files (just converter-log/)
    expect(() => runConverter()).not.toThrow();
  });
});
