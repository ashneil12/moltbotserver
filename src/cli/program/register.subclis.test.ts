import { Command } from "commander";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { acpAction, registerAcpCli } = vi.hoisted(() => {
  const action = vi.fn();
  const register = vi.fn((program: Command) => {
    program.command("acp").action(action);
  });
  return { acpAction: action, registerAcpCli: register };
});

const { nodesAction, registerNodesCli } = vi.hoisted(() => {
  const action = vi.fn();
  const register = vi.fn((program: Command) => {
    const nodes = program.command("nodes");
    nodes.command("list").action(action);
  });
  return { nodesAction: action, registerNodesCli: register };
});

const configModule = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  readConfigFileSnapshot: vi.fn(),
}));

vi.mock("../acp-cli.js", () => ({ registerAcpCli }));
vi.mock("../nodes-cli.js", () => ({ registerNodesCli }));
vi.mock("../../config/config.js", () => configModule);

const mockedModuleIds = ["../acp-cli.js", "../nodes-cli.js", "../../config/config.js"];

const { loadValidatedConfigForPluginRegistration, registerSubCliByName, registerSubCliCommands } =
  await import("./register.subclis.js");

afterAll(() => {
  for (const id of mockedModuleIds) {
    vi.doUnmock(id);
  }
  vi.resetModules();
});

describe("registerSubCliCommands", () => {
  const originalArgv = process.argv;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENCLAW_DISABLE_LAZY_SUBCOMMANDS;
    registerAcpCli.mockClear();
    acpAction.mockClear();
    registerNodesCli.mockClear();
    nodesAction.mockClear();
    configModule.loadConfig.mockReset();
    configModule.readConfigFileSnapshot.mockReset();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = { ...originalEnv };
  });

  it("registers only the primary placeholder and dispatches", async () => {
    process.argv = ["node", "openclaw", "acp"];
    const program = new Command();
    registerSubCliCommands(program, process.argv);

    expect(program.commands.map((cmd) => cmd.name())).toEqual(["acp"]);

    await program.parseAsync(process.argv);

    expect(registerAcpCli).toHaveBeenCalledTimes(1);
    expect(acpAction).toHaveBeenCalledTimes(1);
  });

  it("registers placeholders for all subcommands when no primary", () => {
    process.argv = ["node", "openclaw"];
    const program = new Command();
    registerSubCliCommands(program, process.argv);

    const names = program.commands.map((cmd) => cmd.name());
    expect(names).toContain("acp");
    expect(names).toContain("gateway");
    expect(registerAcpCli).not.toHaveBeenCalled();
  });

  it("returns null for plugin registration when the config snapshot is invalid", async () => {
    configModule.readConfigFileSnapshot.mockResolvedValueOnce({
      valid: false,
      config: { plugins: { load: { paths: ["/tmp/evil"] } } },
    });

    await expect(loadValidatedConfigForPluginRegistration()).resolves.toBeNull();
    expect(configModule.loadConfig).not.toHaveBeenCalled();
  });

  it("loads validated config for plugin registration when the snapshot is valid", async () => {
    const loadedConfig = { plugins: { enabled: true } };
    configModule.readConfigFileSnapshot.mockResolvedValueOnce({
      valid: true,
      config: loadedConfig,
    });
    configModule.loadConfig.mockReturnValueOnce(loadedConfig);

    await expect(loadValidatedConfigForPluginRegistration()).resolves.toBe(loadedConfig);
    expect(configModule.loadConfig).toHaveBeenCalledTimes(1);
  });

  it("re-parses argv for lazy subcommands", async () => {
    process.argv = ["node", "openclaw", "nodes", "list"];
    const program = new Command();
    program.name("openclaw");
    registerSubCliCommands(program, process.argv);

    expect(program.commands.map((cmd) => cmd.name())).toEqual(["nodes"]);

    await program.parseAsync(["nodes", "list"], { from: "user" });

    expect(registerNodesCli).toHaveBeenCalledTimes(1);
    expect(nodesAction).toHaveBeenCalledTimes(1);
  });

  it("replaces placeholder when registering a subcommand by name", async () => {
    process.argv = ["node", "openclaw", "acp", "--help"];
    const program = new Command();
    program.name("openclaw");
    registerSubCliCommands(program, process.argv);

    await registerSubCliByName(program, "acp");

    const names = program.commands.map((cmd) => cmd.name());
    expect(names.filter((name) => name === "acp")).toHaveLength(1);

    await program.parseAsync(["node", "openclaw", "acp"], { from: "user" });
    expect(registerAcpCli).toHaveBeenCalledTimes(1);
    expect(acpAction).toHaveBeenCalledTimes(1);
  });
});
