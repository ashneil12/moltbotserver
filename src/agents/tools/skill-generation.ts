/**
 * Skill Generation Versioning
 *
 * Tracks the current "skill generation" — a monotonically increasing counter
 * that bumps each time the skill-evolution cron creates or revises skills.
 *
 * Skills created/updated by agents are tagged with the current generation in
 * their frontmatter. When skill-evolution bumps the generation, downstream
 * consumers can detect that skills have changed (e.g. invalidate caches,
 * flush stale RL training data).
 *
 * Inspired by MetaClaw's ConversationSample.skill_generation field and
 * MAML support/query set separation.
 *
 * State is stored in `skills/.generation.json` within the agent workspace.
 */

import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("skill-generation");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkillGenerationState = {
  /** Current skill generation number (starts at 1). */
  generation: number;
  /** ISO timestamp of the last bump. */
  bumpedAt: string;
  /** Who or what triggered the bump (e.g. "skill-evolution", "agent"). */
  bumpedBy: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GENERATION_FILENAME = ".generation.json";

/** Default generation for new/missing/corrupt state files. */
const INITIAL_GENERATION = 1;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGenerationFilePath(workspaceDir: string): string {
  return path.join(workspaceDir, "skills", GENERATION_FILENAME);
}

function parseGenerationFile(content: string): SkillGenerationState | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const gen = parsed.generation;
    if (typeof gen !== "number" || !Number.isFinite(gen) || gen < 1) {
      return null;
    }
    return {
      generation: Math.floor(gen),
      bumpedAt: typeof parsed.bumpedAt === "string" ? parsed.bumpedAt : new Date().toISOString(),
      bumpedBy: typeof parsed.bumpedBy === "string" ? parsed.bumpedBy : "unknown",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the current skill generation number.
 * Returns INITIAL_GENERATION (1) if the file doesn't exist or is corrupt.
 */
export function readSkillGeneration(workspaceDir: string): number {
  const filePath = getGenerationFilePath(workspaceDir);
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const state = parseGenerationFile(content);
    return state?.generation ?? INITIAL_GENERATION;
  } catch {
    return INITIAL_GENERATION;
  }
}

/**
 * Read the full skill generation state (generation + metadata).
 * Returns null if the file doesn't exist or is corrupt.
 */
export function readSkillGenerationState(workspaceDir: string): SkillGenerationState | null {
  const filePath = getGenerationFilePath(workspaceDir);
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return parseGenerationFile(content);
  } catch {
    return null;
  }
}

/**
 * Bump the skill generation by 1 and persist the new state.
 * Creates the skills directory and generation file if they don't exist.
 *
 * @returns The new generation number after bumping.
 */
export function bumpSkillGeneration(workspaceDir: string, bumpedBy: string): number {
  const currentGen = readSkillGeneration(workspaceDir);
  const newGen = currentGen + 1;

  const state: SkillGenerationState = {
    generation: newGen,
    bumpedAt: new Date().toISOString(),
    bumpedBy,
  };

  const filePath = getGenerationFilePath(workspaceDir);
  const skillsDir = path.dirname(filePath);

  try {
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
    log.info(`skill generation bumped: ${currentGen} → ${newGen} (by: ${bumpedBy})`);
  } catch (err) {
    log.warn(`failed to persist skill generation: ${String(err)}`);
  }

  return newGen;
}
