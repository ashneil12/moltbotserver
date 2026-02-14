import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
<<<<<<< HEAD:src/agents/sandbox-skills.test.ts
import { captureFullEnv } from "../test-utils/env.js";
import { resolveSandboxContext } from "./sandbox/context.js";
import { writeSkill } from "./skills.e2e-test-helpers.js";
=======
import { resolveSandboxContext } from "./sandbox.js";
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/sandbox-skills.e2e.test.ts

vi.mock("./sandbox/docker.js", () => ({
  ensureSandboxContainer: vi.fn(async () => "openclaw-sbx-test"),
}));

vi.mock("./sandbox/browser.js", () => ({
  ensureSandboxBrowser: vi.fn(async () => null),
}));

vi.mock("./sandbox/prune.js", () => ({
  maybePruneSandboxes: vi.fn(async () => undefined),
}));
<<<<<<< HEAD:src/agents/sandbox-skills.test.ts
=======

async function writeSkill(params: { dir: string; name: string; description: string }) {
  const { dir, name, description } = params;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    "utf-8",
  );
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/sandbox-skills.e2e.test.ts

describe("sandbox skill mirroring", () => {
  let envSnapshot: ReturnType<typeof captureFullEnv>;

  beforeEach(() => {
<<<<<<< HEAD:src/agents/sandbox-skills.test.ts
    envSnapshot = captureFullEnv();
  });

  afterEach(() => {
    envSnapshot.restore();
=======
    envSnapshot = { ...process.env };
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/sandbox-skills.e2e.test.ts
  });

  const runContext = async (workspaceAccess: "none" | "ro") => {
    const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-bundled-skills-"));
    await fs.mkdir(bundledDir, { recursive: true });

    process.env.OPENCLAW_BUNDLED_SKILLS_DIR = bundledDir;

    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-workspace-"));
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "demo-skill"),
      name: "demo-skill",
      description: "Demo skill",
    });

    const cfg: OpenClawConfig = {
      agents: {
        defaults: {
          sandbox: {
            mode: "all",
            scope: "session",
            workspaceAccess,
            workspaceRoot: path.join(bundledDir, "sandboxes"),
          },
        },
      },
    };

    const context = await resolveSandboxContext({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir,
    });

    return { context, workspaceDir };
  };

  it.each(["ro", "none"] as const)(
    "copies skills into the sandbox when workspaceAccess is %s",
    async (workspaceAccess) => {
      const { context } = await runContext(workspaceAccess);

      expect(context?.enabled).toBe(true);
      const skillPath = path.join(context?.workspaceDir ?? "", "skills", "demo-skill", "SKILL.md");
      await expect(fs.readFile(skillPath, "utf-8")).resolves.toContain("demo-skill");
    },
    20_000,
  );
});
