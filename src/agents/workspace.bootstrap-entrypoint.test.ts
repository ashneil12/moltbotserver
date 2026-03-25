/**
 * Bootstrap Entrypoint Regression Tests
 *
 * Regression suite for the "BOOTSTRAP.md never created on fresh Hetzner deploy" bug.
 *
 * Root cause: docker-entrypoint.sh deploys SOUL.md, HEARTBEAT.md and creates memory/
 * before the gateway starts. The old `isBrandNewWorkspace` file-existence heuristic
 * saw these files and concluded onboarding was already complete, suppressing BOOTSTRAP.md.
 *
 * Fix: replaced `isBrandNewWorkspace` with `isFirstEnsureRun` — detection based solely
 * on workspace-state.json presence, which is ONLY written by ensureAgentWorkspace().
 *
 * These tests lock in the contract so upstream syncs cannot silently revert the fix.
 *
 * @see src/agents/workspace.ts (ensureAgentWorkspace)
 * @see OPENCLAW_CHANGELOG.md ("fix: BOOTSTRAP.md not seeded on fresh deploy")
 */

import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempWorkspace, writeWorkspaceFile } from "../test-helpers/workspace.js";
import {
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_USER_FILENAME,
  ensureAgentWorkspace,
} from "./workspace.js";

const WORKSPACE_STATE_SEGMENTS = [".openclaw", "workspace-state.json"] as const;

async function readWorkspaceState(dir: string) {
  const raw = await fs.readFile(path.join(dir, ...WORKSPACE_STATE_SEGMENTS), "utf-8");
  return JSON.parse(raw) as {
    version: number;
    bootstrapSeededAt?: string;
    setupCompletedAt?: string;
  };
}

async function expectBootstrapSeeded(dir: string) {
  await expect(
    fs.access(path.join(dir, DEFAULT_BOOTSTRAP_FILENAME)),
    "BOOTSTRAP.md should exist",
  ).resolves.toBeUndefined();
  const state = await readWorkspaceState(dir);
  expect(state.bootstrapSeededAt, "bootstrapSeededAt should be set").toMatch(
    /\d{4}-\d{2}-\d{2}T/,
  );
  expect(state.setupCompletedAt, "setupCompletedAt must be unset on first run").toBeUndefined();
}

async function expectSetupCompletedWithoutBootstrap(dir: string) {
  await expect(
    fs.access(path.join(dir, DEFAULT_BOOTSTRAP_FILENAME)),
    "BOOTSTRAP.md should NOT exist",
  ).rejects.toMatchObject({ code: "ENOENT" });
  const state = await readWorkspaceState(dir);
  expect(state.setupCompletedAt, "setupCompletedAt should be set").toMatch(/\d{4}-\d{2}-\d{2}T/);
}

// ---------------------------------------------------------------------------
// Core regression: the SaaS / Hetzner deploy scenario
// ---------------------------------------------------------------------------

describe("bootstrap ritual — SaaS/Hetzner fresh deploy regression", () => {
  it("seeds BOOTSTRAP.md when SOUL.md is pre-deployed by docker-entrypoint.sh", async () => {
    // This is the primary regression scenario.
    // docker-entrypoint.sh always copies SOUL.md for security hardening.
    // The fix: SOUL.md presence must NOT suppress BOOTSTRAP.md on first run.
    const tempDir = await makeTempWorkspace("openclaw-bootstrap-entrypoint-");
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_SOUL_FILENAME, content: "soul" });

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expectBootstrapSeeded(tempDir);
  });

  it("seeds BOOTSTRAP.md when SOUL.md + HEARTBEAT.md are pre-deployed", async () => {
    // Entrypoint deploys both SOUL.md and HEARTBEAT.md in some configurations.
    const tempDir = await makeTempWorkspace("openclaw-bootstrap-entrypoint-");
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_SOUL_FILENAME, content: "soul" });
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_HEARTBEAT_FILENAME, content: "hb" });

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expectBootstrapSeeded(tempDir);
  });

  it("seeds BOOTSTRAP.md when entrypoint pre-seeds SOUL.md + memory/ directory", async () => {
    // Full entrypoint scenario: SOUL.md + populated memory/ before first gateway start.
    const tempDir = await makeTempWorkspace("openclaw-bootstrap-entrypoint-");
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_SOUL_FILENAME, content: "soul" });
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_HEARTBEAT_FILENAME, content: "hb" });
    await fs.mkdir(path.join(tempDir, "memory"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "memory", "self-review.md"),
      "# Self Review\nTemplate content",
    );

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expectBootstrapSeeded(tempDir);
  });

  it("seeds BOOTSTRAP.md on second boot when state file was never written (crash recovery)", async () => {
    // If the gateway crashed after entrypoint but before ensureAgentWorkspace completed,
    // no state file exists. BOOTSTRAP.md must be seeded on the next boot.
    const tempDir = await makeTempWorkspace("openclaw-bootstrap-entrypoint-");
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_SOUL_FILENAME, content: "soul" });
    // Note: no workspace-state.json written

    // Simulate 2nd boot (e.g. container restart after crash)
    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expectBootstrapSeeded(tempDir);
  });
});

// ---------------------------------------------------------------------------
// isFirstEnsureRun contract: state-file is the ONLY signal
// ---------------------------------------------------------------------------

describe("bootstrap ritual — isFirstEnsureRun contract", () => {
  it("does NOT re-seed BOOTSTRAP.md when setupCompletedAt is set in state file", async () => {
    // If state file says setup is complete, BOOTSTRAP.md must never be re-created
    // even if entrypoint pre-seeded SOUL.md on this boot.
    const tempDir = await makeTempWorkspace("openclaw-bootstrap-entrypoint-");
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_SOUL_FILENAME, content: "soul" });
    await fs.mkdir(path.join(tempDir, ".openclaw"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, ...WORKSPACE_STATE_SEGMENTS),
      JSON.stringify({
        version: 1,
        setupCompletedAt: "2026-03-01T12:00:00.000Z",
        bootstrapSeededAt: "2026-03-01T10:00:00.000Z",
      }),
    );

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expect(
      fs.access(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const state = await readWorkspaceState(tempDir);
    expect(state.setupCompletedAt).toBe("2026-03-01T12:00:00.000Z");
  });

  it("detects legacy onboarded workspace via IDENTITY.md divergence (no state file)", async () => {
    // Workspace was onboarded BEFORE workspace-state.json existed.
    // Must detect this via customized IDENTITY.md/USER.md, not via file presence.
    const tempDir = await makeTempWorkspace("openclaw-bootstrap-entrypoint-");
    await writeWorkspaceFile({
      dir: tempDir,
      name: DEFAULT_IDENTITY_FILENAME,
      content: "# Custom Identity\nName: Molly\nViibe: Warm and curious",
    });
    await writeWorkspaceFile({
      dir: tempDir,
      name: DEFAULT_USER_FILENAME,
      content: "# Custom User\nName: Ash",
    });

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expectSetupCompletedWithoutBootstrap(tempDir);
  });

  it("seeds BOOTSTRAP.md even when IDENTITY.md/USER.md match templates exactly", async () => {
    // Template-identical files mean onboarding hasn't happened yet.
    // BOOTSTRAP.md must be created.
    const tempDir = await makeTempWorkspace("openclaw-bootstrap-entrypoint-");
    // ensureAgentWorkspace writes templates itself — run it on a clean dir
    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expectBootstrapSeeded(tempDir);
  });

  it("completes idempotently — second call with no user activity still has BOOTSTRAP.md", async () => {
    // Running ensureAgentWorkspace twice on first-boot (e.g. health check + startup)
    // must be idempotent.
    const tempDir = await makeTempWorkspace("openclaw-bootstrap-entrypoint-");
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_SOUL_FILENAME, content: "soul" });

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });
    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expectBootstrapSeeded(tempDir);
  });
});

// ---------------------------------------------------------------------------
// Markers: bootstrapSeededAt is written, setupCompletedAt is only set on finish
// ---------------------------------------------------------------------------

describe("bootstrap ritual — state marker correctness", () => {
  it("sets bootstrapSeededAt but NOT setupCompletedAt after first run", async () => {
    const tempDir = await makeTempWorkspace("openclaw-bootstrap-entrypoint-");

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    const state = await readWorkspaceState(tempDir);
    expect(state.bootstrapSeededAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(state.setupCompletedAt).toBeUndefined();
  });

  it("sets setupCompletedAt after BOOTSTRAP.md is deleted (ritual complete)", async () => {
    const tempDir = await makeTempWorkspace("openclaw-bootstrap-entrypoint-");

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });
    // Simulate agent completing ritual: deletes BOOTSTRAP.md
    await fs.unlink(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME));
    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    const state = await readWorkspaceState(tempDir);
    expect(state.setupCompletedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    // Must not re-create BOOTSTRAP.md after completion
    await expect(
      fs.access(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
