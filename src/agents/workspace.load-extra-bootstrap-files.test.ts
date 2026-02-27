import fs from "node:fs/promises";
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

  it("loads files from glob patterns within workspace", async () => {
    const workspaceDir = await createWorkspaceDir("glob");
    const packageDir = path.join(workspaceDir, "packages", "core");
    await fs.mkdir(packageDir, { recursive: true });
    await fs.writeFile(path.join(packageDir, "TOOLS.md"), "tools", "utf-8");
    await fs.writeFile(path.join(packageDir, "README.md"), "readme", "utf-8");

    const files = await loadExtraBootstrapFiles(workspaceDir, ["packages/*/*"]);

    expect(files).toHaveLength(2);
    expect(files.some((f) => f.name === "TOOLS.md" && f.content === "tools")).toBe(true);
    expect(files.some((f) => f.name === "README.md" && f.content === "readme")).toBe(true);
  });

  it("loads arbitrary-named extra files like humanvoice.md", async () => {
    const workspaceDir = await createWorkspaceDir("arbitrary");
    await fs.writeFile(path.join(workspaceDir, "humanvoice.md"), "voice guide", "utf-8");
    await fs.writeFile(path.join(workspaceDir, "OPERATIONS.md"), "ops guide", "utf-8");

    const files = await loadExtraBootstrapFiles(workspaceDir, ["humanvoice.md", "OPERATIONS.md"]);

    expect(files).toHaveLength(2);
    expect(files.some((f) => f.name === "humanvoice.md" && f.content === "voice guide")).toBe(true);
    expect(files.some((f) => f.name === "OPERATIONS.md" && f.content === "ops guide")).toBe(true);
  });

  it("keeps path-traversal attempts outside workspace excluded", async () => {
    const rootDir = await createWorkspaceDir("root");
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

    const rootDir = await createWorkspaceDir("symlink");
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
