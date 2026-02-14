import fs from "node:fs/promises";
<<<<<<< HEAD
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadExtraBootstrapFiles } from "./workspace.js";

describe("loadExtraBootstrapFiles", () => {
  let fixtureRoot = "";
  let fixtureCount = 0;

  const createWorkspaceDir = async (prefix: string) => {
    const dir = path.join(fixtureRoot, `${prefix}-${fixtureCount++}`);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  };

  beforeAll(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-extra-bootstrap-"));
  });

  afterAll(async () => {
    if (fixtureRoot) {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("loads recognized bootstrap files from glob patterns", async () => {
    const workspaceDir = await createWorkspaceDir("glob");
=======
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import { loadExtraBootstrapFiles } from "./workspace.js";

describe("loadExtraBootstrapFiles", () => {
  it("loads recognized bootstrap files from glob patterns", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-extra-bootstrap-glob-");
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    const packageDir = path.join(workspaceDir, "packages", "core");
    await fs.mkdir(packageDir, { recursive: true });
    await fs.writeFile(path.join(packageDir, "TOOLS.md"), "tools", "utf-8");
    await fs.writeFile(path.join(packageDir, "README.md"), "not bootstrap", "utf-8");

    const files = await loadExtraBootstrapFiles(workspaceDir, ["packages/*/*"]);

    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("TOOLS.md");
    expect(files[0]?.content).toBe("tools");
  });

  it("keeps path-traversal attempts outside workspace excluded", async () => {
<<<<<<< HEAD
    const rootDir = await createWorkspaceDir("root");
=======
    const rootDir = await makeTempWorkspace("openclaw-extra-bootstrap-root-");
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    const workspaceDir = path.join(rootDir, "workspace");
    const outsideDir = path.join(rootDir, "outside");
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(path.join(outsideDir, "AGENTS.md"), "outside", "utf-8");

    const files = await loadExtraBootstrapFiles(workspaceDir, ["../outside/AGENTS.md"]);

    expect(files).toHaveLength(0);
  });

  it("supports symlinked workspace roots with realpath checks", async () => {
    if (process.platform === "win32") {
      return;
    }

<<<<<<< HEAD
    const rootDir = await createWorkspaceDir("symlink");
=======
    const rootDir = await makeTempWorkspace("openclaw-extra-bootstrap-symlink-");
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    const realWorkspace = path.join(rootDir, "real-workspace");
    const linkedWorkspace = path.join(rootDir, "linked-workspace");
    await fs.mkdir(realWorkspace, { recursive: true });
    await fs.writeFile(path.join(realWorkspace, "AGENTS.md"), "linked agents", "utf-8");
    await fs.symlink(realWorkspace, linkedWorkspace, "dir");

    const files = await loadExtraBootstrapFiles(linkedWorkspace, ["AGENTS.md"]);

    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("AGENTS.md");
    expect(files[0]?.content).toBe("linked agents");
  });
});
