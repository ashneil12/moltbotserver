import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../../config/config.js";
<<<<<<< HEAD
import { makeTempWorkspace, writeWorkspaceFile } from "../../../test-helpers/workspace.js";
import type { AgentBootstrapHookContext } from "../../hooks.js";
import { createHookEvent } from "../../hooks.js";
import handler from "./handler.js";

function createBootstrapExtraConfig(paths: string[]): OpenClawConfig {
  return {
    hooks: {
      internal: {
        entries: {
          "bootstrap-extra-files": {
            enabled: true,
            paths,
          },
        },
      },
    },
  };
}

async function createBootstrapContext(params: {
  workspaceDir: string;
  cfg: OpenClawConfig;
  sessionKey: string;
  rootFiles: Array<{ name: string; content: string }>;
}): Promise<AgentBootstrapHookContext> {
  const bootstrapFiles = (await Promise.all(
    params.rootFiles.map(async (file) => ({
      name: file.name,
      path: await writeWorkspaceFile({
        dir: params.workspaceDir,
        name: file.name,
        content: file.content,
      }),
      content: file.content,
      missing: false,
    })),
  )) as AgentBootstrapHookContext["bootstrapFiles"];
  return {
    workspaceDir: params.workspaceDir,
    bootstrapFiles,
    cfg: params.cfg,
    sessionKey: params.sessionKey,
  };
}

=======
import type { AgentBootstrapHookContext } from "../../hooks.js";
import { makeTempWorkspace, writeWorkspaceFile } from "../../../test-helpers/workspace.js";
import { createHookEvent } from "../../hooks.js";
import handler from "./handler.js";

>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
describe("bootstrap-extra-files hook", () => {
  it("appends extra bootstrap files from configured patterns", async () => {
    const tempDir = await makeTempWorkspace("openclaw-bootstrap-extra-");
    const extraDir = path.join(tempDir, "packages", "core");
    await fs.mkdir(extraDir, { recursive: true });
    await fs.writeFile(path.join(extraDir, "AGENTS.md"), "extra agents", "utf-8");

<<<<<<< HEAD
    const cfg = createBootstrapExtraConfig(["packages/*/AGENTS.md"]);
    const context = await createBootstrapContext({
      workspaceDir: tempDir,
      cfg,
      sessionKey: "agent:main:main",
      rootFiles: [{ name: "AGENTS.md", content: "root agents" }],
    });
=======
    const cfg: OpenClawConfig = {
      hooks: {
        internal: {
          entries: {
            "bootstrap-extra-files": {
              enabled: true,
              paths: ["packages/*/AGENTS.md"],
            },
          },
        },
      },
    };

    const context: AgentBootstrapHookContext = {
      workspaceDir: tempDir,
      bootstrapFiles: [
        {
          name: "AGENTS.md",
          path: await writeWorkspaceFile({
            dir: tempDir,
            name: "AGENTS.md",
            content: "root agents",
          }),
          content: "root agents",
          missing: false,
        },
      ],
      cfg,
      sessionKey: "agent:main:main",
    };
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

    const event = createHookEvent("agent", "bootstrap", "agent:main:main", context);
    await handler(event);

    const injected = context.bootstrapFiles.filter((f) => f.name === "AGENTS.md");
    expect(injected).toHaveLength(2);
    expect(injected.some((f) => f.path.endsWith(path.join("packages", "core", "AGENTS.md")))).toBe(
      true,
    );
  });

  it("re-applies subagent bootstrap allowlist after extras are added", async () => {
    const tempDir = await makeTempWorkspace("openclaw-bootstrap-extra-subagent-");
    const extraDir = path.join(tempDir, "packages", "persona");
    await fs.mkdir(extraDir, { recursive: true });
    await fs.writeFile(path.join(extraDir, "SOUL.md"), "evil", "utf-8");

<<<<<<< HEAD
    const cfg = createBootstrapExtraConfig(["packages/*/SOUL.md"]);
    const context = await createBootstrapContext({
      workspaceDir: tempDir,
      cfg,
      sessionKey: "agent:main:subagent:abc",
      rootFiles: [
        { name: "AGENTS.md", content: "root agents" },
        { name: "TOOLS.md", content: "root tools" },
      ],
    });

    const event = createHookEvent("agent", "bootstrap", "agent:main:subagent:abc", context);
    await handler(event);
    expect(context.bootstrapFiles.map((f) => f.name).toSorted()).toEqual([
      "AGENTS.md",
      "SOUL.md",
      "TOOLS.md",
    ]);
=======
    const cfg: OpenClawConfig = {
      hooks: {
        internal: {
          entries: {
            "bootstrap-extra-files": {
              enabled: true,
              paths: ["packages/*/SOUL.md"],
            },
          },
        },
      },
    };

    const context: AgentBootstrapHookContext = {
      workspaceDir: tempDir,
      bootstrapFiles: [
        {
          name: "AGENTS.md",
          path: await writeWorkspaceFile({
            dir: tempDir,
            name: "AGENTS.md",
            content: "root agents",
          }),
          content: "root agents",
          missing: false,
        },
        {
          name: "TOOLS.md",
          path: await writeWorkspaceFile({ dir: tempDir, name: "TOOLS.md", content: "root tools" }),
          content: "root tools",
          missing: false,
        },
      ],
      cfg,
      sessionKey: "agent:main:subagent:abc",
    };

    const event = createHookEvent("agent", "bootstrap", "agent:main:subagent:abc", context);
    await handler(event);

    expect(context.bootstrapFiles.map((f) => f.name).toSorted()).toEqual(["AGENTS.md", "TOOLS.md"]);
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  });
});
