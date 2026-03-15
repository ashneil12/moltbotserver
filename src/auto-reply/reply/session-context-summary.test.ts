import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractSessionContextFromTranscript,
  MAX_SESSION_CONTEXT_CHARS,
  SESSION_CONTEXT_FILENAME,
  updateSessionContextFile,
  persistSessionContextOnReset,
} from "./session-context-summary.js";

let tmpDir: string;
let workspaceDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "session-ctx-test-"));
  workspaceDir = tmpDir;
  await fs.promises.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

function writeTranscript(lines: object[]): string {
  const filePath = path.join(tmpDir, "test-session.jsonl");
  const content = lines.map((l) => JSON.stringify(l)).join("\n");
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

describe("extractSessionContextFromTranscript", () => {
  it("returns undefined for non-existent file", () => {
    expect(extractSessionContextFromTranscript("/nonexistent/path.jsonl")).toBeUndefined();
  });

  it("returns undefined for empty transcript", () => {
    const filePath = writeTranscript([]);
    expect(extractSessionContextFromTranscript(filePath)).toBeUndefined();
  });

  it("returns undefined for transcript with no user messages", () => {
    const filePath = writeTranscript([
      { type: "session", timestamp: "2026-03-01T10:00:00.000Z" },
      {
        type: "message",
        timestamp: "2026-03-01T10:01:00.000Z",
        message: { role: "assistant", content: "Hello!" },
      },
    ]);
    expect(extractSessionContextFromTranscript(filePath)).toBeUndefined();
  });

  it("extracts user messages from transcript", () => {
    const filePath = writeTranscript([
      { type: "session", timestamp: "2026-03-01T10:00:00.000Z", id: "test-session" },
      {
        type: "message",
        timestamp: "2026-03-01T10:01:00.000Z",
        message: { role: "user", content: "Fix the cron job for Ezra" },
      },
      {
        type: "message",
        timestamp: "2026-03-01T10:02:00.000Z",
        message: { role: "assistant", content: "I'll look into that now." },
      },
      {
        type: "message",
        timestamp: "2026-03-01T10:05:00.000Z",
        message: { role: "user", content: "Also check the memory flush" },
      },
    ]);

    const result = extractSessionContextFromTranscript(filePath);
    expect(result).toBeDefined();
    expect(result).toContain("Session ended");
    expect(result).toContain("2 user messages");
    expect(result).toContain("Fix the cron job for Ezra");
    expect(result).toContain("Also check the memory flush");
  });

  it("extracts tool usage", () => {
    const filePath = writeTranscript([
      { type: "session", timestamp: "2026-03-01T10:00:00.000Z" },
      {
        type: "message",
        timestamp: "2026-03-01T10:01:00.000Z",
        message: { role: "user", content: "Run the tests" },
      },
      {
        type: "message",
        timestamp: "2026-03-01T10:02:00.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Running tests now" },
            { type: "toolCall", name: "exec", arguments: { command: "npm test" } },
          ],
        },
      },
    ]);

    const result = extractSessionContextFromTranscript(filePath);
    expect(result).toBeDefined();
    expect(result).toContain("Tools used: exec");
  });

  it("handles content blocks format", () => {
    const filePath = writeTranscript([
      { type: "session", timestamp: "2026-03-01T10:00:00.000Z" },
      {
        type: "message",
        timestamp: "2026-03-01T10:01:00.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Hello from content blocks" }],
        },
      },
    ]);

    const result = extractSessionContextFromTranscript(filePath);
    expect(result).toBeDefined();
    expect(result).toContain("Hello from content blocks");
  });
});

describe("updateSessionContextFile", () => {
  it("creates new file when none exists", () => {
    updateSessionContextFile(workspaceDir, "## Session ended 2026-03-01\nTest summary");
    const filePath = path.join(workspaceDir, "memory", SESSION_CONTEXT_FILENAME);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("# Recent Session Context");
    expect(content).toContain("Test summary");
  });

  it("prepends new summary to existing file", () => {
    const filePath = path.join(workspaceDir, "memory", SESSION_CONTEXT_FILENAME);
    fs.writeFileSync(filePath, "## Old session\nOld content", "utf-8");
    updateSessionContextFile(workspaceDir, "## New session\nNew content");
    const content = fs.readFileSync(filePath, "utf-8");
    // New content should appear before old content
    const newIdx = content.indexOf("New content");
    const oldIdx = content.indexOf("Old content");
    expect(newIdx).toBeLessThan(oldIdx);
  });

  it("truncates at MAX_SESSION_CONTEXT_CHARS", () => {
    // Write a large existing file
    const bigContent = "## Old session\n" + "x".repeat(MAX_SESSION_CONTEXT_CHARS + 1000);
    const filePath = path.join(workspaceDir, "memory", SESSION_CONTEXT_FILENAME);
    fs.writeFileSync(filePath, bigContent, "utf-8");
    updateSessionContextFile(workspaceDir, "## New session\nNew summary");
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content.length).toBeLessThanOrEqual(MAX_SESSION_CONTEXT_CHARS + 100); // small buffer for trailing newline
  });
});

describe("persistSessionContextOnReset", () => {
  it("extracts and persists session context", () => {
    const transcriptPath = writeTranscript([
      { type: "session", timestamp: "2026-03-01T10:00:00.000Z" },
      {
        type: "message",
        timestamp: "2026-03-01T10:01:00.000Z",
        message: { role: "user", content: "Deploy the new build" },
      },
    ]);

    persistSessionContextOnReset({ transcriptPath, workspaceDir });

    const filePath = path.join(workspaceDir, "memory", SESSION_CONTEXT_FILENAME);
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("Deploy the new build");
  });

  it("silently skips unreadable transcript", () => {
    expect(() =>
      persistSessionContextOnReset({
        transcriptPath: "/nonexistent/path.jsonl",
        workspaceDir,
      }),
    ).not.toThrow();
    const filePath = path.join(workspaceDir, "memory", SESSION_CONTEXT_FILENAME);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("does not persist context for cron-only sessions", () => {
    const cronPrompt = [
      "Pre-reset memory flush.",
      "The daily session reset will happen in ~20 minutes — store any durable memories now.",
      "## 1. Daily memory log",
      "Write to memory/YYYY-MM-DD.md; create memory/ if needed.",
    ].join("\n");

    const transcriptPath = writeTranscript([
      { type: "session", timestamp: "2026-03-01T03:40:00.000Z" },
      {
        type: "message",
        timestamp: "2026-03-01T03:40:01.000Z",
        message: { role: "user", content: cronPrompt },
      },
      {
        type: "message",
        timestamp: "2026-03-01T03:40:30.000Z",
        message: { role: "assistant", content: "Saving daily memory log now." },
      },
    ]);

    persistSessionContextOnReset({ transcriptPath, workspaceDir });

    const filePath = path.join(workspaceDir, "memory", SESSION_CONTEXT_FILENAME);
    expect(fs.existsSync(filePath)).toBe(false);
  });
});
