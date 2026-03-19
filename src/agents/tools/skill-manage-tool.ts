/**
 * Skill Manage Tool
 *
 * Allows agents to autonomously create, update, delete, and list skill documents.
 * Agent-created skills are written to the agent's workspace `skills/` directory,
 * keeping them local to the agent and separate from global bundled skills.
 *
 * Inspired by NousResearch/hermes-agent's autonomous skill creation pattern.
 */

import fs from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveAgentWorkspaceDir } from "../agent-scope.js";
import { DEFAULT_AGENT_WORKSPACE_DIR } from "../workspace.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";
import { readSkillGeneration } from "./skill-generation.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum content size for a skill document (10KB). */
const MAX_SKILL_CONTENT_BYTES = 10_240;

/** Regex for valid skill names: lowercase alphanumeric + hyphens, 2-50 chars. */
const VALID_SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

const SKILL_FILENAME = "SKILL.md";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SkillManageSchema = Type.Object({
  action: Type.Union(
    [Type.Literal("create"), Type.Literal("update"), Type.Literal("delete"), Type.Literal("list")],
    { description: "The action to perform." },
  ),
  name: Type.Optional(
    Type.String({
      description: "Skill name (lowercase, hyphens). Required for create/update/delete.",
    }),
  ),
  description: Type.Optional(
    Type.String({ description: "One-line description for skill frontmatter (for create)." }),
  ),
  content: Type.Optional(
    Type.String({ description: "The skill markdown body (for create/update)." }),
  ),
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sanitizeSkillName(name: string): string | null {
  const cleaned = name.trim().toLowerCase().replace(/\s+/g, "-");
  if (!VALID_SKILL_NAME_RE.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function buildSkillFrontmatter(name: string, description: string, generation: number): string {
  return `---
name: ${name}
description: ${description}
created_by: agent
created_at: ${new Date().toISOString()}
generation: ${generation}
---`;
}

function getSkillsDir(workspaceDir: string): string {
  return path.join(workspaceDir, "skills");
}

function getSkillDir(workspaceDir: string, skillName: string): string {
  return path.join(getSkillsDir(workspaceDir), skillName);
}

function getSkillPath(workspaceDir: string, skillName: string): string {
  return path.join(getSkillDir(workspaceDir, skillName), SKILL_FILENAME);
}

type SkillInfo = {
  name: string;
  description: string;
  createdBy?: string;
  generation?: number;
  path: string;
};

function readSkillInfo(skillDir: string): SkillInfo | null {
  const skillPath = path.join(skillDir, SKILL_FILENAME);
  try {
    const content = fs.readFileSync(skillPath, "utf-8");
    const name = path.basename(skillDir);

    // Parse frontmatter
    const fmMatch = /^---\n([\s\S]*?)\n---/m.exec(content);
    let description = "";
    let createdBy: string | undefined;

    if (fmMatch) {
      const fm = fmMatch[1];
      const descMatch = /^description:\s*(.+)$/m.exec(fm);
      description = descMatch?.[1]?.trim() ?? "";

      const createdByMatch = /^created_by:\s*(.+)$/m.exec(fm);
      createdBy = createdByMatch?.[1]?.trim();

      const genMatch = /^generation:\s*(\d+)$/m.exec(fm);
      const generation = genMatch ? Number(genMatch[1]) : undefined;

      return { name, description, createdBy, generation, path: skillPath };
    }

    return { name, description, createdBy, path: skillPath };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createSkillManageTool(options: {
  config?: OpenClawConfig;
  agentId?: string;
  /** Explicit workspace dir override (useful for testing). */
  workspaceDir?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }

  const agentId = options.agentId;
  const workspaceDir =
    options.workspaceDir ??
    (agentId ? resolveAgentWorkspaceDir(cfg, agentId) : DEFAULT_AGENT_WORKSPACE_DIR);

  return {
    label: "Skill Manage",
    name: "skill_manage",
    description:
      "Create, update, delete, or list skill documents. Skills are reusable instruction sets " +
      "that guide how to perform specific tasks. Use this to capture successful problem-solving " +
      "patterns, workflows, or domain expertise as skills that can be referenced in future sessions.",
    parameters: SkillManageSchema,
    execute: async (_toolCallId, params) => {
      const action = readStringParam(params, "action", { required: true }) as
        | "create"
        | "update"
        | "delete"
        | "list";
      const rawName = readStringParam(params, "name");
      const description = readStringParam(params, "description");
      const content = readStringParam(params, "content");

      switch (action) {
        case "list":
          return jsonResult(listSkills(workspaceDir));
        case "create":
          return jsonResult(createSkill(workspaceDir, rawName, description, content));
        case "update":
          return jsonResult(updateSkill(workspaceDir, rawName, content));
        case "delete":
          return jsonResult(deleteSkill(workspaceDir, rawName));
        default:
          return jsonResult({ error: `Unknown action: ${String(action)}` });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Action implementations
// ---------------------------------------------------------------------------

function listSkills(workspaceDir: string): {
  skills: SkillInfo[];
  count: number;
} {
  const skillsDir = getSkillsDir(workspaceDir);
  const skills: SkillInfo[] = [];

  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const info = readSkillInfo(path.join(skillsDir, entry.name));
      if (info) {
        skills.push(info);
      }
    }
  } catch {
    // Skills directory doesn't exist yet — that's fine
  }

  return { skills, count: skills.length };
}

function createSkill(
  workspaceDir: string,
  rawName: string | null | undefined,
  description: string | null | undefined,
  content: string | null | undefined,
): { created: boolean; path?: string; error?: string } {
  if (!rawName) {
    return { created: false, error: "name is required for create action" };
  }
  if (!content) {
    return { created: false, error: "content is required for create action" };
  }

  const name = sanitizeSkillName(rawName);
  if (!name) {
    return {
      created: false,
      error: `Invalid skill name "${rawName}". Must be lowercase alphanumeric with hyphens, 2-50 chars.`,
    };
  }

  const fullContent = content.trim();
  if (Buffer.byteLength(fullContent, "utf-8") > MAX_SKILL_CONTENT_BYTES) {
    return {
      created: false,
      error: `Skill content exceeds maximum size of ${MAX_SKILL_CONTENT_BYTES} bytes.`,
    };
  }

  const skillDir = getSkillDir(workspaceDir, name);
  const skillPath = getSkillPath(workspaceDir, name);

  // Check if already exists
  if (fs.existsSync(skillPath)) {
    return {
      created: false,
      error: `Skill "${name}" already exists. Use the "update" action instead.`,
    };
  }

  try {
    fs.mkdirSync(skillDir, { recursive: true });
  } catch (err) {
    return {
      created: false,
      error: `Failed to create skill directory: ${String(err)}`,
    };
  }

  const frontmatter = buildSkillFrontmatter(
    name,
    description?.trim() || `Auto-created skill: ${name}`,
    readSkillGeneration(workspaceDir),
  );
  const fileContent = `${frontmatter}\n\n${fullContent}\n`;

  try {
    fs.writeFileSync(skillPath, fileContent, "utf-8");
    return { created: true, path: skillPath };
  } catch (err) {
    return { created: false, error: `Failed to write skill: ${String(err)}` };
  }
}

function updateSkill(
  workspaceDir: string,
  rawName: string | null | undefined,
  content: string | null | undefined,
): { updated: boolean; path?: string; error?: string } {
  if (!rawName) {
    return { updated: false, error: "name is required for update action" };
  }
  if (!content) {
    return { updated: false, error: "content is required for update action" };
  }

  const name = sanitizeSkillName(rawName);
  if (!name) {
    return {
      updated: false,
      error: `Invalid skill name "${rawName}".`,
    };
  }

  const skillPath = getSkillPath(workspaceDir, name);

  if (!fs.existsSync(skillPath)) {
    return {
      updated: false,
      error: `Skill "${name}" does not exist. Use the "create" action first.`,
    };
  }

  // Read existing to check if it's agent-created (safety: don't overwrite human-authored)
  const info = readSkillInfo(getSkillDir(workspaceDir, name));
  if (info && info.createdBy && info.createdBy !== "agent") {
    return {
      updated: false,
      error:
        `Skill "${name}" was not created by an agent (created_by: ${info.createdBy}). ` +
        `Only agent-created skills can be updated via this tool.`,
    };
  }

  const fullContent = content.trim();
  if (Buffer.byteLength(fullContent, "utf-8") > MAX_SKILL_CONTENT_BYTES) {
    return {
      updated: false,
      error: `Skill content exceeds maximum size of ${MAX_SKILL_CONTENT_BYTES} bytes.`,
    };
  }

  // Preserve existing frontmatter, replace body
  let existingContent: string;
  try {
    existingContent = fs.readFileSync(skillPath, "utf-8");
  } catch (err) {
    return { updated: false, error: `Failed to read existing skill: ${String(err)}` };
  }

  let newFileContent: string;
  const fmMatch = /^(---\n[\s\S]*?\n---)\n*/m.exec(existingContent);
  if (fmMatch) {
    newFileContent = `${fmMatch[1]}\n\n${fullContent}\n`;
  } else {
    // No frontmatter — just replace entirely
    newFileContent = fullContent + "\n";
  }

  try {
    fs.writeFileSync(skillPath, newFileContent, "utf-8");
    return { updated: true, path: skillPath };
  } catch (err) {
    return { updated: false, error: `Failed to write skill: ${String(err)}` };
  }
}

function deleteSkill(
  workspaceDir: string,
  rawName: string | null | undefined,
): { deleted: boolean; error?: string } {
  if (!rawName) {
    return { deleted: false, error: "name is required for delete action" };
  }

  const name = sanitizeSkillName(rawName);
  if (!name) {
    return {
      deleted: false,
      error: `Invalid skill name "${rawName}".`,
    };
  }

  const skillDir = getSkillDir(workspaceDir, name);
  const skillPath = getSkillPath(workspaceDir, name);

  if (!fs.existsSync(skillPath)) {
    return {
      deleted: false,
      error: `Skill "${name}" does not exist.`,
    };
  }

  // Safety: only delete agent-created skills
  const info = readSkillInfo(skillDir);
  if (info && info.createdBy && info.createdBy !== "agent") {
    return {
      deleted: false,
      error: `Skill "${name}" was not created by an agent. Only agent-created skills can be deleted via this tool.`,
    };
  }

  try {
    fs.rmSync(skillDir, { recursive: true, force: true });
    return { deleted: true };
  } catch (err) {
    return { deleted: false, error: `Failed to delete skill: ${String(err)}` };
  }
}
