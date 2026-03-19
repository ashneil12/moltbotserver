import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bumpSkillGeneration,
  readSkillGeneration,
  readSkillGenerationState,
} from "./skill-generation.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skill-gen-test-"));
}

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("readSkillGeneration", () => {
  let workspace: string;

  afterEach(() => {
    if (workspace) {
      cleanup(workspace);
    }
  });

  it("returns 1 when no generation file exists", () => {
    workspace = makeTempWorkspace();
    expect(readSkillGeneration(workspace)).toBe(1);
  });

  it("reads existing generation number", () => {
    workspace = makeTempWorkspace();
    const skillsDir = path.join(workspace, "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, ".generation.json"),
      JSON.stringify({ generation: 5, bumpedAt: "2026-01-01T00:00:00Z", bumpedBy: "test" }),
    );
    expect(readSkillGeneration(workspace)).toBe(5);
  });

  it("returns 1 for corrupt JSON", () => {
    workspace = makeTempWorkspace();
    const skillsDir = path.join(workspace, "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, ".generation.json"), "not json");
    expect(readSkillGeneration(workspace)).toBe(1);
  });

  it("returns 1 for negative generation", () => {
    workspace = makeTempWorkspace();
    const skillsDir = path.join(workspace, "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, ".generation.json"),
      JSON.stringify({ generation: -3, bumpedAt: "2026-01-01T00:00:00Z", bumpedBy: "test" }),
    );
    expect(readSkillGeneration(workspace)).toBe(1);
  });

  it("returns 1 for non-number generation", () => {
    workspace = makeTempWorkspace();
    const skillsDir = path.join(workspace, "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, ".generation.json"),
      JSON.stringify({ generation: "five", bumpedAt: "2026-01-01T00:00:00Z", bumpedBy: "test" }),
    );
    expect(readSkillGeneration(workspace)).toBe(1);
  });

  it("returns 1 for NaN generation", () => {
    workspace = makeTempWorkspace();
    const skillsDir = path.join(workspace, "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, ".generation.json"),
      '{"generation": NaN, "bumpedAt": "2026-01-01T00:00:00Z", "bumpedBy": "test"}',
    );
    // NaN is not valid JSON, so JSON.parse fails → falls back to 1
    expect(readSkillGeneration(workspace)).toBe(1);
  });

  it("returns 1 for Infinity generation", () => {
    workspace = makeTempWorkspace();
    const skillsDir = path.join(workspace, "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, ".generation.json"),
      '{"generation": "Infinity", "bumpedAt": "2026-01-01T00:00:00Z", "bumpedBy": "test"}',
    );
    expect(readSkillGeneration(workspace)).toBe(1);
  });

  it("returns 1 for zero generation", () => {
    workspace = makeTempWorkspace();
    const skillsDir = path.join(workspace, "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, ".generation.json"),
      JSON.stringify({ generation: 0, bumpedAt: "2026-01-01T00:00:00Z", bumpedBy: "test" }),
    );
    expect(readSkillGeneration(workspace)).toBe(1);
  });
});

describe("readSkillGenerationState", () => {
  let workspace: string;

  afterEach(() => {
    if (workspace) {
      cleanup(workspace);
    }
  });

  it("returns null when no file exists", () => {
    workspace = makeTempWorkspace();
    expect(readSkillGenerationState(workspace)).toBeNull();
  });

  it("returns full state object", () => {
    workspace = makeTempWorkspace();
    const skillsDir = path.join(workspace, "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    const state = { generation: 3, bumpedAt: "2026-03-19T12:00:00Z", bumpedBy: "skill-evolution" };
    fs.writeFileSync(path.join(skillsDir, ".generation.json"), JSON.stringify(state));
    const result = readSkillGenerationState(workspace);
    expect(result).toEqual(state);
  });
});

describe("bumpSkillGeneration", () => {
  let workspace: string;

  afterEach(() => {
    if (workspace) {
      cleanup(workspace);
    }
  });

  it("bumps from 1 to 2 on first bump", () => {
    workspace = makeTempWorkspace();
    const result = bumpSkillGeneration(workspace, "test");
    expect(result).toBe(2);
    expect(readSkillGeneration(workspace)).toBe(2);
  });

  it("increments existing generation", () => {
    workspace = makeTempWorkspace();
    const skillsDir = path.join(workspace, "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, ".generation.json"),
      JSON.stringify({ generation: 7, bumpedAt: "2026-01-01T00:00:00Z", bumpedBy: "old" }),
    );
    const result = bumpSkillGeneration(workspace, "skill-evolution");
    expect(result).toBe(8);
  });

  it("creates skills directory if missing", () => {
    workspace = makeTempWorkspace();
    bumpSkillGeneration(workspace, "test");
    expect(fs.existsSync(path.join(workspace, "skills", ".generation.json"))).toBe(true);
  });

  it("persists bumpedBy metadata", () => {
    workspace = makeTempWorkspace();
    bumpSkillGeneration(workspace, "my-agent");
    const state = readSkillGenerationState(workspace);
    expect(state?.bumpedBy).toBe("my-agent");
    expect(state?.bumpedAt).toBeTruthy();
  });

  it("floors decimal generation values on read", () => {
    workspace = makeTempWorkspace();
    const skillsDir = path.join(workspace, "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, ".generation.json"),
      JSON.stringify({ generation: 3.7, bumpedAt: "2026-01-01T00:00:00Z", bumpedBy: "test" }),
    );
    // readSkillGeneration floors it to 3
    expect(readSkillGeneration(workspace)).toBe(3);
    // Bump from 3 → 4
    const result = bumpSkillGeneration(workspace, "test");
    expect(result).toBe(4);
  });
});
