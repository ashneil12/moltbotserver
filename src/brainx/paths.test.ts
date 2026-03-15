import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findRecentTranscripts,
  parseCliArgs,
  readTranscriptText,
  resolveAgentSessionsDir,
  resolveAgentWorkspaceDir,
  resolveStateDir,
} from "./paths.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brainx-paths-test-"));
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe("resolveStateDir", () => {
  it("returns ~/.openclaw by default", () => {
    const dir = resolveStateDir();
    expect(dir).toContain(".openclaw");
  });
});

describe("resolveAgentSessionsDir", () => {
  it("returns agents/{id}/sessions path", () => {
    const dir = resolveAgentSessionsDir("coder");
    expect(dir).toContain(path.join("agents", "coder", "sessions"));
  });
});

describe("resolveAgentWorkspaceDir", () => {
  it("returns 'workspace' for main agent", () => {
    const dir = resolveAgentWorkspaceDir("main");
    expect(dir).toMatch(/workspace$/);
    expect(dir).not.toContain("workspace-");
  });

  it("returns 'workspace-{id}' for non-main agents", () => {
    const dir = resolveAgentWorkspaceDir("jael");
    expect(dir).toContain("workspace-jael");
  });
});

// ---------------------------------------------------------------------------
// Transcript parsing
// ---------------------------------------------------------------------------

describe("readTranscriptText", () => {
  it("reads JSONL transcript and extracts message text", () => {
    const transcriptPath = path.join(tmpDir, "session.jsonl");
    const lines = [
      JSON.stringify({ type: "message", message: { role: "user", content: "Hello" } }),
      JSON.stringify({
        type: "message",
        message: { role: "assistant", content: "Hi there!" },
      }),
      JSON.stringify({ type: "system", data: "ignored" }),
    ];
    fs.writeFileSync(transcriptPath, lines.join("\n") + "\n");

    const text = readTranscriptText(transcriptPath);
    expect(text).toContain("Hello");
    expect(text).toContain("Hi there!");
    expect(text).not.toContain("ignored");
  });

  it("handles array content blocks", () => {
    const transcriptPath = path.join(tmpDir, "session.jsonl");
    const entry = {
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "First block" },
          { type: "text", text: "Second block" },
          { type: "image", url: "ignored" },
        ],
      },
    };
    fs.writeFileSync(transcriptPath, JSON.stringify(entry) + "\n");

    const text = readTranscriptText(transcriptPath);
    expect(text).toContain("First block");
    expect(text).toContain("Second block");
    expect(text).not.toContain("ignored");
  });

  it("returns empty string for missing file", () => {
    expect(readTranscriptText("/nonexistent/path.jsonl")).toBe("");
  });

  it("skips malformed JSON lines gracefully", () => {
    const transcriptPath = path.join(tmpDir, "session.jsonl");
    const lines = [
      "not json",
      JSON.stringify({ type: "message", message: { role: "user", content: "Valid" } }),
      "{broken json",
    ];
    fs.writeFileSync(transcriptPath, lines.join("\n") + "\n");

    const text = readTranscriptText(transcriptPath);
    expect(text).toContain("Valid");
  });
});

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

describe("findRecentTranscripts", () => {
  it("finds .jsonl files within age limit", () => {
    const sessionsDir = path.join(tmpDir, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, "recent.jsonl"), "data\n");
    fs.writeFileSync(path.join(sessionsDir, "readme.md"), "ignored\n");

    const results = findRecentTranscripts(sessionsDir, 24);
    expect(results.length).toBe(1);
    expect(results[0]).toContain("recent.jsonl");
  });

  it("returns empty for nonexistent directory", () => {
    expect(findRecentTranscripts("/nonexistent/sessions", 24)).toEqual([]);
  });

  it("excludes old files", () => {
    const sessionsDir = path.join(tmpDir, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const filePath = path.join(sessionsDir, "old.jsonl");
    fs.writeFileSync(filePath, "data\n");
    // Set mtime to 48 hours ago
    const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
    fs.utimesSync(filePath, oldTime, oldTime);

    const results = findRecentTranscripts(sessionsDir, 24);
    expect(results.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

describe("parseCliArgs", () => {
  it("parses default args", () => {
    const args = parseCliArgs([]);
    expect(args).toEqual({
      dryRun: false,
      verbose: false,
      hours: 24,
      agentFilter: undefined,
    });
  });

  it("parses all flags", () => {
    const args = parseCliArgs(["--dry-run", "--verbose", "--hours", "12", "--agent", "coder"]);
    expect(args.dryRun).toBe(true);
    expect(args.verbose).toBe(true);
    expect(args.hours).toBe(12);
    expect(args.agentFilter).toBe("coder");
  });

  it("defaults hours to 24 for invalid input", () => {
    const args = parseCliArgs(["--hours", "banana"]);
    expect(args.hours).toBe(24);
  });
});
