/**
 * Download workspace registry tests.
 *
 * Tests the per-agent download routing system:
 *   1. setDownloadWorkspaceForCdp / getDownloadWorkspaceForCdp — registry CRUD
 *   2. sanitizeDownloadFilename — path traversal protection, control char stripping, overflow
 *   3. sanitizeAutoDownloadFilename — timestamped collision avoidance
 *
 * These are custom additions that route browser downloads to per-agent workspaces.
 * Without them, all downloads go to a single location regardless of which agent triggered them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDownloadWorkspaceForCdp,
  sanitizeAutoDownloadFilename,
  sanitizeDownloadFilename,
  setDownloadWorkspaceForCdp,
} from "./download-workspace-registry.js";

// ── Registry Tests ──────────────────────────────────────────────────────────

describe("download workspace registry", () => {
  afterEach(() => {
    // Clean up any registered entries between tests
    setDownloadWorkspaceForCdp("http://browser-dan:9222", null);
    setDownloadWorkspaceForCdp("http://browser-jael:9222", null);
    setDownloadWorkspaceForCdp("http://browser-nehemiah:9222", null);
    setDownloadWorkspaceForCdp("http://127.0.0.1:9222", null);
  });

  it("registers and retrieves a workspace for a CDP URL", () => {
    setDownloadWorkspaceForCdp("http://browser-dan:9222", "/home/node/data/workspace-dan");
    expect(getDownloadWorkspaceForCdp("http://browser-dan:9222")).toBe(
      "/home/node/data/workspace-dan",
    );
  });

  it("returns null for unregistered CDP URLs", () => {
    expect(getDownloadWorkspaceForCdp("http://browser-unknown:9222")).toBeNull();
  });

  it("clears registration when workspace is null", () => {
    setDownloadWorkspaceForCdp("http://browser-dan:9222", "/home/node/data/workspace-dan");
    setDownloadWorkspaceForCdp("http://browser-dan:9222", null);
    expect(getDownloadWorkspaceForCdp("http://browser-dan:9222")).toBeNull();
  });

  it("isolates registrations per agent", () => {
    setDownloadWorkspaceForCdp("http://browser-dan:9222", "/home/node/data/workspace-dan");
    setDownloadWorkspaceForCdp("http://browser-jael:9222", "/home/node/data/workspace-jael");

    expect(getDownloadWorkspaceForCdp("http://browser-dan:9222")).toBe(
      "/home/node/data/workspace-dan",
    );
    expect(getDownloadWorkspaceForCdp("http://browser-jael:9222")).toBe(
      "/home/node/data/workspace-jael",
    );
  });

  it("overwrites existing registration", () => {
    setDownloadWorkspaceForCdp("http://browser-dan:9222", "/old/path");
    setDownloadWorkspaceForCdp("http://browser-dan:9222", "/new/path");
    expect(getDownloadWorkspaceForCdp("http://browser-dan:9222")).toBe("/new/path");
  });

  it("normalizes trailing slashes in CDP URLs", () => {
    setDownloadWorkspaceForCdp("http://browser-dan:9222/", "/home/node/data/workspace-dan");
    expect(getDownloadWorkspaceForCdp("http://browser-dan:9222")).toBe(
      "/home/node/data/workspace-dan",
    );
  });

  it("normalizes case in CDP URLs", () => {
    setDownloadWorkspaceForCdp("HTTP://Browser-Dan:9222", "/home/node/data/workspace-dan");
    expect(getDownloadWorkspaceForCdp("http://browser-dan:9222")).toBe(
      "/home/node/data/workspace-dan",
    );
  });

  it("normalizes whitespace in CDP URLs", () => {
    setDownloadWorkspaceForCdp("  http://browser-dan:9222  ", "/home/node/data/workspace-dan");
    expect(getDownloadWorkspaceForCdp("http://browser-dan:9222")).toBe(
      "/home/node/data/workspace-dan",
    );
  });

  it("handles the main browser at 127.0.0.1", () => {
    setDownloadWorkspaceForCdp("http://127.0.0.1:9222", "/home/node/workspace");
    expect(getDownloadWorkspaceForCdp("http://127.0.0.1:9222")).toBe("/home/node/workspace");
  });
});

// ── Filename Sanitization Tests ─────────────────────────────────────────────

describe("sanitizeDownloadFilename", () => {
  it("returns a normal filename unchanged", () => {
    expect(sanitizeDownloadFilename("report.pdf")).toBe("report.pdf");
  });

  it("returns fallback for empty string", () => {
    expect(sanitizeDownloadFilename("")).toBe("download.bin");
  });

  it("returns fallback for whitespace-only", () => {
    expect(sanitizeDownloadFilename("   ")).toBe("download.bin");
  });

  it("returns fallback for single dot", () => {
    expect(sanitizeDownloadFilename(".")).toBe("download.bin");
  });

  it("returns fallback for double dot", () => {
    expect(sanitizeDownloadFilename("..")).toBe("download.bin");
  });

  it("strips posix path traversal", () => {
    expect(sanitizeDownloadFilename("../../../etc/passwd")).toBe("passwd");
  });

  it("strips windows path traversal", () => {
    expect(sanitizeDownloadFilename("..\\..\\Windows\\system32\\config")).toBe("config");
  });

  it("strips absolute posix paths", () => {
    expect(sanitizeDownloadFilename("/etc/shadow")).toBe("shadow");
  });

  it("strips windows absolute paths", () => {
    expect(sanitizeDownloadFilename("C:\\Users\\admin\\secrets.txt")).toBe("secrets.txt");
  });

  it("strips C0 control characters", () => {
    expect(sanitizeDownloadFilename("file\x00name\x01.txt")).toBe("filename.txt");
  });

  it("strips DEL character", () => {
    expect(sanitizeDownloadFilename("file\x7fname.txt")).toBe("filename.txt");
  });

  it("clamps filename length to 200 characters", () => {
    const longName = "a".repeat(300) + ".pdf";
    const result = sanitizeDownloadFilename(longName);
    expect(result.length).toBe(200);
  });

  it("preserves unicode in filenames", () => {
    expect(sanitizeDownloadFilename("日本語ファイル.pdf")).toBe("日本語ファイル.pdf");
  });

  it("preserves spaces in filenames", () => {
    expect(sanitizeDownloadFilename("my report (final).pdf")).toBe("my report (final).pdf");
  });

  it("handles null coercion", () => {
    // @ts-expect-error — testing runtime safety
    expect(sanitizeDownloadFilename(null)).toBe("download.bin");
  });

  it("handles undefined coercion", () => {
    // @ts-expect-error — testing runtime safety
    expect(sanitizeDownloadFilename(undefined)).toBe("download.bin");
  });
});

// ── Auto-Download Filename Tests ────────────────────────────────────────────

describe("sanitizeAutoDownloadFilename", () => {
  it("appends a timestamp before the extension", () => {
    const before = Date.now();
    const result = sanitizeAutoDownloadFilename("report.pdf");
    const after = Date.now();

    // Should match pattern: report-<timestamp>.pdf
    const match = result.match(/^report-(\d+)\.pdf$/);
    expect(match).not.toBeNull();
    const ts = Number(match![1]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("appends timestamp to files without extension", () => {
    const result = sanitizeAutoDownloadFilename("README");
    expect(result).toMatch(/^README-\d+$/);
  });

  it("handles dotfiles", () => {
    const result = sanitizeAutoDownloadFilename(".gitignore");
    // path.extname(".gitignore") === "" on some platforms, so stem = ".gitignore"
    expect(result).toMatch(/gitignore/);
    expect(result).toMatch(/\d+/);
  });

  it("sanitizes before timestamping", () => {
    const result = sanitizeAutoDownloadFilename("../../../etc/passwd");
    expect(result).toMatch(/^passwd-\d+$/);
    expect(result).not.toContain("..");
  });

  it("falls back to download.bin for empty input", () => {
    const result = sanitizeAutoDownloadFilename("");
    expect(result).toMatch(/^download-\d+\.bin$/);
  });

  it("produces unique names on sequential calls", () => {
    // Mock Date.now to ensure different timestamps
    let counter = 1000000000000;
    vi.spyOn(Date, "now").mockImplementation(() => counter++);

    const name1 = sanitizeAutoDownloadFilename("file.txt");
    const name2 = sanitizeAutoDownloadFilename("file.txt");

    expect(name1).not.toBe(name2);

    vi.restoreAllMocks();
  });
});
