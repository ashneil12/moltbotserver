import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWriteFile, readTextFileIfExists, writeTextFileIfChanged } from "./atomic-file.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-file-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// atomicWriteFile
// ---------------------------------------------------------------------------

describe("atomicWriteFile", () => {
  it("writes content to a new file", async () => {
    const filePath = path.join(tmpDir, "test.txt");
    await atomicWriteFile(filePath, "hello world");

    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe("hello world");
  });

  it("creates parent directories automatically", async () => {
    const filePath = path.join(tmpDir, "nested", "deep", "test.txt");
    await atomicWriteFile(filePath, "nested content");

    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe("nested content");
  });

  it("overwrites existing file atomically", async () => {
    const filePath = path.join(tmpDir, "test.txt");
    await atomicWriteFile(filePath, "first");
    await atomicWriteFile(filePath, "second");

    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe("second");
  });

  it("does not leave tmp files on success", async () => {
    const filePath = path.join(tmpDir, "test.txt");
    await atomicWriteFile(filePath, "content");

    const entries = await fs.readdir(tmpDir);
    expect(entries).toEqual(["test.txt"]);
  });
});

// ---------------------------------------------------------------------------
// readTextFileIfExists
// ---------------------------------------------------------------------------

describe("readTextFileIfExists", () => {
  it("reads existing file content", async () => {
    const filePath = path.join(tmpDir, "exists.txt");
    await fs.writeFile(filePath, "hello", "utf-8");

    const content = await readTextFileIfExists(filePath);
    expect(content).toBe("hello");
  });

  it("returns undefined for non-existent file", async () => {
    const content = await readTextFileIfExists(path.join(tmpDir, "nope.txt"));
    expect(content).toBeUndefined();
  });

  it("throws for non-ENOENT errors (e.g. permission denied on a directory)", async () => {
    // Reading a directory as a file should throw a non-ENOENT error
    const dirPath = path.join(tmpDir, "a-directory");
    await fs.mkdir(dirPath);

    await expect(readTextFileIfExists(dirPath)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// writeTextFileIfChanged
// ---------------------------------------------------------------------------

describe("writeTextFileIfChanged", () => {
  it("writes file and returns true when content is new", async () => {
    const filePath = path.join(tmpDir, "new.txt");
    const result = await writeTextFileIfChanged(filePath, "new content");

    expect(result).toBe(true);
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe("new content");
  });

  it("returns false when content is unchanged", async () => {
    const filePath = path.join(tmpDir, "same.txt");
    await fs.writeFile(filePath, "same content", "utf-8");

    const result = await writeTextFileIfChanged(filePath, "same content");
    expect(result).toBe(false);
  });

  it("overwrites and returns true when content differs", async () => {
    const filePath = path.join(tmpDir, "change.txt");
    await fs.writeFile(filePath, "old", "utf-8");

    const result = await writeTextFileIfChanged(filePath, "new");
    expect(result).toBe(true);

    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe("new");
  });
});
