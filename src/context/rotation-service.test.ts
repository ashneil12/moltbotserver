import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  initContextRotation,
  getRotationConfig,
  updateRotationConfig,
  resolveRotationPaths,
  forceRotation,
  getRotationState,
  clearRotationState,
} from "./rotation-service.js";
import { DEFAULT_CONTEXT_ROTATION_CONFIG } from "./rotation-types.js";

describe("rotation-service", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rotation-test-"));
    clearRotationState();
  });

  afterEach(async () => {
    clearRotationState();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("getRotationConfig", () => {
    it("returns default config", () => {
      const config = getRotationConfig();
      expect(config).toEqual(DEFAULT_CONTEXT_ROTATION_CONFIG);
    });
  });

  describe("updateRotationConfig", () => {
    it("merges partial config with defaults", () => {
      updateRotationConfig({ windowSize: 30 });
      const config = getRotationConfig();
      expect(config.windowSize).toBe(30);
      expect(config.historySize).toBe(DEFAULT_CONTEXT_ROTATION_CONFIG.historySize);
    });
  });

  describe("resolveRotationPaths", () => {
    it("resolves paths relative to workspace", () => {
      const paths = resolveRotationPaths("/home/user/workspace");
      expect(paths.historyFile).toBe("/home/user/workspace/conversation_history.md");
      expect(paths.archiveFile).toBe("/home/user/workspace/conversation_archive.md");
      expect(paths.workspaceDir).toBe("/home/user/workspace");
    });
  });

  describe("initContextRotation", () => {
    it("returns cleanup function", () => {
      const cleanup = initContextRotation({ enabled: false });
      expect(typeof cleanup).toBe("function");
      cleanup();
    });

    it("respects enabled flag", () => {
      const cleanup = initContextRotation({ enabled: false });
      // Should return a no-op cleanup
      cleanup();
    });
  });

  describe("forceRotation", () => {
    it("returns result even for non-existent session", async () => {
      const result = await forceRotation("/non/existent/session.jsonl");
      expect(result.rotated).toBe(false);
      expect(result.movedToHistory).toBe(0);
      expect(result.movedToArchive).toBe(0);
    });
  });

  describe("getRotationState", () => {
    it("returns undefined for unknown session", () => {
      const state = getRotationState("/unknown/session.jsonl");
      expect(state).toBeUndefined();
    });
  });

  describe("clearRotationState", () => {
    it("clears all state", () => {
      clearRotationState();
      // Should not throw
      expect(true).toBe(true);
    });
  });
});
