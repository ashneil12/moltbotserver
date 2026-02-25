import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractSummary, readKnowledgeIndex, rebuildKnowledgeIndex } from "./knowledge-index.js";

async function makeTempDir(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", prefix));
}

describe("extractSummary", () => {
  it("extracts first 3 non-heading, non-empty lines", () => {
    const content = [
      "# API Gotchas",
      "",
      "The X API returns 429 when rate limiting.",
      "Always include retry-after header parsing.",
      "Default timeout is 30 seconds.",
      "Additional line ignored.",
    ].join("\n");
    expect(extractSummary(content)).toBe(
      "The X API returns 429 when rate limiting.\nAlways include retry-after header parsing.\nDefault timeout is 30 seconds.",
    );
  });

  it("skips headings, front matter, and blockquotes", () => {
    const content = [
      "---",
      "title: test",
      "---",
      "# Heading",
      "> Template instructions",
      "## Subheading",
      "Actual content here.",
    ].join("\n");
    expect(extractSummary(content)).toBe("title: test\nActual content here.");
  });

  it("returns empty string for empty content", () => {
    expect(extractSummary("")).toBe("");
  });

  it("returns empty string for heading-only content", () => {
    expect(extractSummary("# Title\n## Subtitle\n")).toBe("");
  });

  it("respects custom maxLines", () => {
    const content = "Line 1\nLine 2\nLine 3\nLine 4";
    expect(extractSummary(content, 1)).toBe("Line 1");
    expect(extractSummary(content, 2)).toBe("Line 1\nLine 2");
  });
});

describe("rebuildKnowledgeIndex", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("generates correct index from multiple topic files", async () => {
    tempDir = await makeTempDir("kb-test-");
    const knowledgeDir = path.join(tempDir, "memory", "knowledge");
    await fs.mkdir(knowledgeDir, { recursive: true });

    await fs.writeFile(
      path.join(knowledgeDir, "api-gotchas.md"),
      "# API Gotchas\n\nThe X API returns 429 on rate limit.\nUse exponential backoff.",
      "utf-8",
    );
    await fs.writeFile(
      path.join(knowledgeDir, "user-preferences.md"),
      "# User Preferences\n\nUser prefers dark mode.\nConcise replies preferred.",
      "utf-8",
    );

    await rebuildKnowledgeIndex(tempDir);

    const index = await fs.readFile(path.join(knowledgeDir, "_index.md"), "utf-8");
    expect(index).toContain("# Knowledge Base Index");
    expect(index).toContain("## api-gotchas");
    expect(index).toContain("The X API returns 429 on rate limit.");
    expect(index).toContain("## user-preferences");
    expect(index).toContain("User prefers dark mode.");
  });

  it("sorts topics alphabetically", async () => {
    tempDir = await makeTempDir("kb-test-");
    const knowledgeDir = path.join(tempDir, "memory", "knowledge");
    await fs.mkdir(knowledgeDir, { recursive: true });

    await fs.writeFile(path.join(knowledgeDir, "zebra.md"), "Zebra info", "utf-8");
    await fs.writeFile(path.join(knowledgeDir, "alpha.md"), "Alpha info", "utf-8");

    await rebuildKnowledgeIndex(tempDir);

    const index = await fs.readFile(path.join(knowledgeDir, "_index.md"), "utf-8");
    const alphaPos = index.indexOf("## alpha");
    const zebraPos = index.indexOf("## zebra");
    expect(alphaPos).toBeLessThan(zebraPos);
  });

  it("skips _index.md itself", async () => {
    tempDir = await makeTempDir("kb-test-");
    const knowledgeDir = path.join(tempDir, "memory", "knowledge");
    await fs.mkdir(knowledgeDir, { recursive: true });

    await fs.writeFile(path.join(knowledgeDir, "_index.md"), "old index", "utf-8");
    await fs.writeFile(path.join(knowledgeDir, "topic.md"), "Topic content", "utf-8");

    await rebuildKnowledgeIndex(tempDir);

    const index = await fs.readFile(path.join(knowledgeDir, "_index.md"), "utf-8");
    expect(index).not.toContain("## _index");
    expect(index).toContain("## topic");
  });

  it("produces minimal index for empty directory", async () => {
    tempDir = await makeTempDir("kb-test-");
    const knowledgeDir = path.join(tempDir, "memory", "knowledge");
    await fs.mkdir(knowledgeDir, { recursive: true });

    await rebuildKnowledgeIndex(tempDir);

    const index = await fs.readFile(path.join(knowledgeDir, "_index.md"), "utf-8");
    expect(index).toContain("No topics yet");
  });

  it("handles files with no extractable content", async () => {
    tempDir = await makeTempDir("kb-test-");
    const knowledgeDir = path.join(tempDir, "memory", "knowledge");
    await fs.mkdir(knowledgeDir, { recursive: true });

    await fs.writeFile(path.join(knowledgeDir, "empty-topic.md"), "# Just a heading\n\n", "utf-8");

    await rebuildKnowledgeIndex(tempDir);

    const index = await fs.readFile(path.join(knowledgeDir, "_index.md"), "utf-8");
    expect(index).toContain("## empty-topic");
    expect(index).toContain("_(empty)_");
  });

  it("does nothing when knowledge directory does not exist", async () => {
    tempDir = await makeTempDir("kb-test-");
    // Don't create the knowledge directory
    await rebuildKnowledgeIndex(tempDir);
    // Should not throw, and no files created
    const dirExists = await fs
      .access(path.join(tempDir, "memory", "knowledge"))
      .then(() => true)
      .catch(() => false);
    expect(dirExists).toBe(false);
  });
});

describe("readKnowledgeIndex", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns index content when file exists", async () => {
    tempDir = await makeTempDir("kb-test-");
    const knowledgeDir = path.join(tempDir, "memory", "knowledge");
    await fs.mkdir(knowledgeDir, { recursive: true });
    await fs.writeFile(path.join(knowledgeDir, "_index.md"), "test index content", "utf-8");

    const result = await readKnowledgeIndex(tempDir);
    expect(result).toBe("test index content");
  });

  it("returns null when directory does not exist", async () => {
    tempDir = await makeTempDir("kb-test-");
    const result = await readKnowledgeIndex(tempDir);
    expect(result).toBeNull();
  });
});
