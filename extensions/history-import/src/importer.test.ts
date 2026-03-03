import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeConversations } from "../src/importer.js";
import type { NormalizedConversation } from "../src/types.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "history-import-test-"));
}

function makeConvo(
  title: string,
  source: "chatgpt" | "claude" = "chatgpt",
  createdAt = 1700000000,
): NormalizedConversation {
  return {
    id: `conv-${Math.random().toString(36).slice(2, 8)}`,
    title,
    messages: [
      { role: "user", content: "Hello there!", timestamp: createdAt },
      { role: "assistant", content: "Hi! How can I help?", timestamp: createdAt + 60 },
    ],
    source,
    createdAt,
  };
}

describe("importer", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes conversations as markdown files", () => {
    const convos = [makeConvo("My First Chat"), makeConvo("Second Chat")];

    const result = writeConversations(convos, tmpDir);
    expect(result.importedConversations).toBe(2);
    expect(result.filesWritten).toHaveLength(2);

    // Verify files exist
    for (const filePath of result.filesWritten) {
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });

  it("creates the correct directory structure", () => {
    const convos = [makeConvo("Test", "chatgpt")];
    writeConversations(convos, tmpDir);

    const targetDir = path.join(tmpDir, "memory", "imported", "chatgpt");
    expect(fs.existsSync(targetDir)).toBe(true);
  });

  it("writes valid markdown with metadata", () => {
    const convos = [makeConvo("Markdown Test", "chatgpt", 1700000000)];
    const result = writeConversations(convos, tmpDir);

    const content = fs.readFileSync(result.filesWritten[0]!, "utf-8");
    expect(content).toContain("# Markdown Test");
    expect(content).toContain("**Source:** chatgpt");
    expect(content).toContain("**Messages:** 2");
    expect(content).toContain("**User:**");
    expect(content).toContain("Hello there!");
    expect(content).toContain("**Assistant:**");
    expect(content).toContain("Hi! How can I help?");
  });

  it("respects maxConversations limit", () => {
    const convos = Array.from({ length: 10 }, (_, i) => makeConvo(`Chat ${i}`));
    const result = writeConversations(convos, tmpDir, { maxConversations: 3 });

    expect(result.importedConversations).toBe(3);
    expect(result.filesWritten).toHaveLength(3);
    expect(result.skipped).toBe(7);
  });

  it("is idempotent (skips existing files)", () => {
    const convos = [makeConvo("Idempotent Test")];

    const result1 = writeConversations(convos, tmpDir);
    expect(result1.importedConversations).toBe(1);

    const result2 = writeConversations(convos, tmpDir);
    expect(result2.importedConversations).toBe(0);
    expect(result2.skipped).toBeGreaterThan(0);
  });

  it("handles dry-run without writing files", () => {
    const convos = [makeConvo("Dry Run")];
    const result = writeConversations(convos, tmpDir, { dryRun: true });

    expect(result.importedConversations).toBe(1);
    expect(result.filesWritten).toHaveLength(0);

    // Nothing should be on disk
    const targetDir = path.join(tmpDir, "memory", "imported", "chatgpt");
    expect(fs.existsSync(targetDir)).toBe(false);
  });

  it("handles conversations with duplicate titles", () => {
    const convos = [
      makeConvo("Same Title", "chatgpt", 1700000000),
      makeConvo("Same Title", "chatgpt", 1700000000),
    ];

    const result = writeConversations(convos, tmpDir);
    expect(result.importedConversations).toBe(2);
    expect(result.filesWritten).toHaveLength(2);

    // Files should have different names
    const names = result.filesWritten.map((f) => path.basename(f));
    expect(new Set(names).size).toBe(2);
  });

  it("separates by source", () => {
    const chatgpt = makeConvo("ChatGPT Chat", "chatgpt");
    const claude = makeConvo("Claude Chat", "claude");

    writeConversations([chatgpt], tmpDir);
    writeConversations([claude], tmpDir);

    expect(fs.existsSync(path.join(tmpDir, "memory", "imported", "chatgpt"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "memory", "imported", "claude"))).toBe(true);
  });

  it("returns correct totals", () => {
    const convos = Array.from({ length: 5 }, (_, i) => makeConvo(`Chat ${i}`));
    const result = writeConversations(convos, tmpDir);

    expect(result.totalConversations).toBe(5);
    expect(result.importedConversations).toBe(5);
    expect(result.totalMessages).toBe(10); // 2 messages each
    expect(result.errors).toHaveLength(0);
  });
});
