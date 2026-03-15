import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateSessionPathFreshness } from "./session-freshness.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-freshness-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("validateSessionPathFreshness", () => {
  it("returns fresh when workspace exists", () => {
    const result = validateSessionPathFreshness({ workspaceDir: tmpDir });
    expect(result.fresh).toBe(true);
    expect(result.staleReasons).toHaveLength(0);
  });

  it("returns stale when workspace directory is missing", () => {
    const missingDir = path.join(tmpDir, "nonexistent");
    const result = validateSessionPathFreshness({ workspaceDir: missingDir });
    expect(result.fresh).toBe(false);
    expect(result.staleReasons[0]).toContain("no longer exists");
  });

  it("returns stale when workspace path is a file, not a directory", () => {
    const filePath = path.join(tmpDir, "not-a-dir.txt");
    fs.writeFileSync(filePath, "oops", "utf-8");

    const result = validateSessionPathFreshness({ workspaceDir: filePath });
    expect(result.fresh).toBe(false);
    expect(result.staleReasons[0]).toContain("not a directory");
  });

  it("returns stale when reported workspace differs from current", () => {
    const result = validateSessionPathFreshness({
      workspaceDir: tmpDir,
      reportedWorkspaceDir: "/some/other/path",
    });
    expect(result.fresh).toBe(false);
    expect(result.staleReasons[0]).toContain("mismatch");
  });

  it("returns fresh when reported workspace matches current", () => {
    const result = validateSessionPathFreshness({
      workspaceDir: tmpDir,
      reportedWorkspaceDir: tmpDir,
    });
    expect(result.fresh).toBe(true);
  });

  it("returns fresh when no params are provided", () => {
    const result = validateSessionPathFreshness({});
    expect(result.fresh).toBe(true);
    expect(result.staleReasons).toHaveLength(0);
  });

  it("accumulates multiple stale reasons", () => {
    const missingDir = path.join(tmpDir, "gone");
    const result = validateSessionPathFreshness({
      workspaceDir: missingDir,
      reportedWorkspaceDir: "/different/path",
    });
    expect(result.fresh).toBe(false);
    expect(result.staleReasons.length).toBeGreaterThanOrEqual(2);
  });
});
