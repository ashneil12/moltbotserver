/**
 * Skill View Tool — Progressive Disclosure Tier 2
 *
 * Provides on-demand loading of full SKILL.md content when the system prompt
 * only includes compact skill metadata (name + description).
 *
 * Inspired by Hermes Agent's progressive disclosure architecture:
 * - Tier 1: System prompt shows compact index (name + description)
 * - Tier 2: Agent calls skill_view(name) to load full instructions
 * - Tier 3: Agent reads linked files within the skill directory
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { Skill } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const SkillViewSchema = Type.Object({
  name: Type.String({
    description: "Skill name to load (as shown in the skills index).",
  }),
  file: Type.Optional(
    Type.String({
      description:
        "Optional relative path to a linked file within the skill directory " +
        '(e.g. "references/api.md"). Omit to load the main SKILL.md.',
    }),
  ),
});

const MAX_SKILL_CONTENT_CHARS = 200_000;

/**
 * Creates the skill_view tool.
 *
 * @param resolvedSkills - The list of resolved skills from the workspace.
 *   This is the same list used to build the compact prompt index.
 */
export function createSkillViewTool(options: { resolvedSkills: Skill[] }): AnyAgentTool {
  // Build a lookup map for O(1) name resolution
  const skillsByName = new Map<string, Skill>();
  for (const skill of options.resolvedSkills) {
    // Index by exact name and lowercase for case-insensitive matching
    skillsByName.set(skill.name, skill);
    skillsByName.set(skill.name.toLowerCase(), skill);
  }

  return {
    label: "Skill View",
    name: "skill_view",
    description:
      "Load the full instructions for a skill by name. Use this when a task matches " +
      "a skill from the skills index. Optionally load linked files within the skill " +
      'directory (e.g. references, templates) by specifying a relative "file" path.',
    parameters: SkillViewSchema,
    execute: async (_toolCallId, params) => {
      const name = readStringParam(params as Record<string, unknown>, "name", { required: true });
      const file = readStringParam(params as Record<string, unknown>, "file");

      // Resolve skill by name (case-insensitive)
      const skill = skillsByName.get(name) ?? skillsByName.get(name.toLowerCase());
      if (!skill) {
        const availableNames = options.resolvedSkills.map((s) => s.name).toSorted();
        return jsonResult({
          error: `Unknown skill: "${name}". Available skills: ${availableNames.join(", ")}`,
        });
      }

      // Determine target file path
      let targetPath: string;
      if (file) {
        // Resolve relative path within skill's base directory
        const resolved = path.resolve(skill.baseDir, file);
        // Security: ensure resolved path stays inside the skill directory
        const normalizedBase = path.resolve(skill.baseDir);
        if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
          return jsonResult({
            error: `Path "${file}" escapes skill directory. Must be relative to ${skill.baseDir}`,
          });
        }
        targetPath = resolved;
      } else {
        targetPath = skill.filePath;
      }

      try {
        const stat = await fs.stat(targetPath);
        if (!stat.isFile()) {
          return jsonResult({
            error: `Not a file: ${targetPath}`,
          });
        }

        let content = await fs.readFile(targetPath, "utf-8");

        // Truncate very large files to avoid context overflow
        if (content.length > MAX_SKILL_CONTENT_CHARS) {
          const truncated = content.slice(0, MAX_SKILL_CONTENT_CHARS);
          content =
            truncated +
            `\n\n[...truncated: showing ${MAX_SKILL_CONTENT_CHARS.toLocaleString()} of ${content.length.toLocaleString()} chars]`;
        }

        return jsonResult({
          skill: skill.name,
          path: targetPath,
          content,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return jsonResult({
            error: `File not found: ${targetPath}`,
            skill: skill.name,
            baseDir: skill.baseDir,
          });
        }
        return jsonResult({
          error: `Failed to read skill file: ${message}`,
        });
      }
    },
  };
}
