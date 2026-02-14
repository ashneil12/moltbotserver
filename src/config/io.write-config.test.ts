import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
<<<<<<< HEAD
import { describe, expect, it, vi } from "vitest";
import { withTempHome } from "./home-env.test-harness.js";
import { createConfigIO } from "./io.js";
import type { OpenClawConfig } from "./types.js";

describe("config io write", () => {
=======
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createConfigIO } from "./io.js";

type HomeEnvSnapshot = {
  home: string | undefined;
  userProfile: string | undefined;
  homeDrive: string | undefined;
  homePath: string | undefined;
  stateDir: string | undefined;
};

function snapshotHomeEnv(): HomeEnvSnapshot {
  return {
    home: process.env.HOME,
    userProfile: process.env.USERPROFILE,
    homeDrive: process.env.HOMEDRIVE,
    homePath: process.env.HOMEPATH,
    stateDir: process.env.OPENCLAW_STATE_DIR,
  };
}

function restoreHomeEnv(snapshot: HomeEnvSnapshot) {
  const restoreKey = (key: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  };
  restoreKey("HOME", snapshot.home);
  restoreKey("USERPROFILE", snapshot.userProfile);
  restoreKey("HOMEDRIVE", snapshot.homeDrive);
  restoreKey("HOMEPATH", snapshot.homePath);
  restoreKey("OPENCLAW_STATE_DIR", snapshot.stateDir);
}

describe("config io write", () => {
  let fixtureRoot = "";
  let fixtureCount = 0;
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  const silentLogger = {
    warn: () => {},
    error: () => {},
  };

<<<<<<< HEAD
  async function writeConfigAndCreateIo(params: {
    home: string;
    initialConfig: Record<string, unknown>;
    env?: NodeJS.ProcessEnv;
    logger?: { warn: (msg: string) => void; error: (msg: string) => void };
  }) {
    const configPath = path.join(params.home, ".openclaw", "openclaw.json");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(params.initialConfig, null, 2), "utf-8");

    const io = createConfigIO({
      env: params.env ?? {},
      homedir: () => params.home,
      logger: params.logger ?? silentLogger,
    });
    const snapshot = await io.readConfigFileSnapshot();
    expect(snapshot.valid).toBe(true);
    return { configPath, io, snapshot };
  }

  async function writeTokenAuthAndReadConfig(params: {
    io: { writeConfigFile: (config: Record<string, unknown>) => Promise<void> };
    snapshot: { config: Record<string, unknown> };
    configPath: string;
  }) {
    const next = structuredClone(params.snapshot.config);
    const gateway =
      next.gateway && typeof next.gateway === "object"
        ? (next.gateway as Record<string, unknown>)
        : {};
    next.gateway = {
      ...gateway,
      auth: { mode: "token" },
    };
    await params.io.writeConfigFile(next);
    return JSON.parse(await fs.readFile(params.configPath, "utf-8")) as Record<string, unknown>;
  }

  async function writeGatewayPatchAndReadLastAuditEntry(params: {
    home: string;
    initialConfig: Record<string, unknown>;
    gatewayPatch: Record<string, unknown>;
    env?: NodeJS.ProcessEnv;
  }) {
    const { io, snapshot, configPath } = await writeConfigAndCreateIo({
      home: params.home,
      initialConfig: params.initialConfig,
      env: params.env,
      logger: {
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
    const auditPath = path.join(params.home, ".openclaw", "logs", "config-audit.jsonl");
    const next = structuredClone(snapshot.config);
    const gateway =
      next.gateway && typeof next.gateway === "object"
        ? (next.gateway as Record<string, unknown>)
        : {};
    next.gateway = {
      ...gateway,
      ...params.gatewayPatch,
    };
    await io.writeConfigFile(next);
    const lines = (await fs.readFile(auditPath, "utf-8")).trim().split("\n").filter(Boolean);
    const last = JSON.parse(lines.at(-1) ?? "{}") as Record<string, unknown>;
    return { last, lines, configPath };
  }

  const createGatewayCommandsInput = (): Record<string, unknown> => ({
    gateway: { mode: "local" },
    commands: { ownerDisplay: "hash" },
  });

  const expectInputOwnerDisplayUnchanged = (input: Record<string, unknown>) => {
    expect((input.commands as Record<string, unknown>).ownerDisplay).toBe("hash");
  };

  const readPersistedCommands = async (configPath: string) => {
    const persisted = JSON.parse(await fs.readFile(configPath, "utf-8")) as {
      commands?: Record<string, unknown>;
    };
    return persisted.commands;
  };

  async function runUnsetNoopCase(params: { home: string; unsetPaths: string[][] }) {
    const { configPath, io } = await writeConfigAndCreateIo({
      home: params.home,
      initialConfig: createGatewayCommandsInput(),
    });

    const input = createGatewayCommandsInput();
    await io.writeConfigFile(input, { unsetPaths: params.unsetPaths });

    expectInputOwnerDisplayUnchanged(input);
    expect((await readPersistedCommands(configPath))?.ownerDisplay).toBe("hash");
  }

  it("persists caller changes onto resolved config without leaking runtime defaults", async () => {
    await withTempHome("openclaw-config-io-", async (home) => {
      const { configPath, io, snapshot } = await writeConfigAndCreateIo({
        home,
        initialConfig: { gateway: { port: 18789 } },
=======
  beforeAll(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-config-io-"));
  });

  afterAll(async () => {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });

  const withTempHome = async <T>(fn: (home: string) => Promise<T>): Promise<T> => {
    const home = path.join(fixtureRoot, `home-${fixtureCount++}`);
    await fs.mkdir(path.join(home, ".openclaw"), { recursive: true });

    const snapshot = snapshotHomeEnv();
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.OPENCLAW_STATE_DIR = path.join(home, ".openclaw");

    if (process.platform === "win32") {
      const match = home.match(/^([A-Za-z]:)(.*)$/);
      if (match) {
        process.env.HOMEDRIVE = match[1];
        process.env.HOMEPATH = match[2] || "\\";
      }
    }

    try {
      return await fn(home);
    } finally {
      restoreHomeEnv(snapshot);
    }
  };

  it("persists caller changes onto resolved config without leaking runtime defaults", async () => {
    await withTempHome(async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({ gateway: { port: 18789 } }, null, 2),
        "utf-8",
      );

      const io = createConfigIO({
        env: {} as NodeJS.ProcessEnv,
        homedir: () => home,
        logger: silentLogger,
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
      });
      const persisted = await writeTokenAuthAndReadConfig({ io, snapshot, configPath });
      expect(persisted.gateway).toEqual({
        port: 18789,
        auth: { mode: "token" },
      });
      expect(persisted).not.toHaveProperty("agents.defaults");
      expect(persisted).not.toHaveProperty("messages.ackReaction");
      expect(persisted).not.toHaveProperty("sessions.persistence");
    });
  });

<<<<<<< HEAD
  it('shows actionable guidance for dmPolicy="open" without wildcard allowFrom', async () => {
    await withTempHome("openclaw-config-io-", async (home) => {
      const io = createConfigIO({
        env: {} as NodeJS.ProcessEnv,
        homedir: () => home,
        logger: silentLogger,
      });

      const invalidConfig: OpenClawConfig = {
        channels: {
          telegram: {
            dmPolicy: "open",
            allowFrom: [],
          },
        },
      } satisfies OpenClawConfig;

      await expect(io.writeConfigFile(invalidConfig)).rejects.toThrow(
        "openclaw config set channels.telegram.allowFrom '[\"*\"]'",
      );
      await expect(io.writeConfigFile(invalidConfig)).rejects.toThrow(
        'openclaw config set channels.telegram.dmPolicy "pairing"',
      );
    });
  });

  it("honors explicit unset paths when schema defaults would otherwise reappear", async () => {
    await withTempHome("openclaw-config-io-", async (home) => {
      const { configPath, io, snapshot } = await writeConfigAndCreateIo({
        home,
        initialConfig: {
          gateway: { auth: { mode: "none" } },
          commands: { ownerDisplay: "hash" },
        },
      });

      const next = structuredClone(snapshot.resolved) as Record<string, unknown>;
      if (
        next.commands &&
        typeof next.commands === "object" &&
        "ownerDisplay" in (next.commands as Record<string, unknown>)
      ) {
        delete (next.commands as Record<string, unknown>).ownerDisplay;
      }

      await io.writeConfigFile(next, { unsetPaths: [["commands", "ownerDisplay"]] });

      const persisted = JSON.parse(await fs.readFile(configPath, "utf-8")) as {
        commands?: Record<string, unknown>;
      };
      expect(persisted.commands ?? {}).not.toHaveProperty("ownerDisplay");
    });
  });

  it("does not mutate caller config when unsetPaths is applied on first write", async () => {
    await withTempHome("openclaw-config-io-", async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      const io = createConfigIO({
        env: {} as NodeJS.ProcessEnv,
        homedir: () => home,
        logger: silentLogger,
      });

      const input: Record<string, unknown> = {
        gateway: { mode: "local" },
        commands: { ownerDisplay: "hash" },
      };

      await io.writeConfigFile(input, { unsetPaths: [["commands", "ownerDisplay"]] });

      expect(input).toEqual({
        gateway: { mode: "local" },
        commands: { ownerDisplay: "hash" },
      });
      expectInputOwnerDisplayUnchanged(input);
      expect((await readPersistedCommands(configPath)) ?? {}).not.toHaveProperty("ownerDisplay");
    });
  });

  it("does not mutate caller config when unsetPaths is applied on existing files", async () => {
    await withTempHome("openclaw-config-io-", async (home) => {
      const { configPath, io, snapshot } = await writeConfigAndCreateIo({
        home,
        initialConfig: {
          gateway: { mode: "local" },
          commands: { ownerDisplay: "hash" },
        },
      });

      const input = structuredClone(snapshot.config) as Record<string, unknown>;
      await io.writeConfigFile(input, { unsetPaths: [["commands", "ownerDisplay"]] });

      expectInputOwnerDisplayUnchanged(input);
      expect((await readPersistedCommands(configPath)) ?? {}).not.toHaveProperty("ownerDisplay");
    });
  });

  it("keeps caller arrays immutable when unsetting array entries", async () => {
    await withTempHome("openclaw-config-io-", async (home) => {
      const { configPath, io, snapshot } = await writeConfigAndCreateIo({
        home,
        initialConfig: {
          gateway: { mode: "local" },
          tools: { alsoAllow: ["exec", "fetch", "read"] },
        },
      });

      const input = structuredClone(snapshot.config) as Record<string, unknown>;
      await io.writeConfigFile(input, { unsetPaths: [["tools", "alsoAllow", "1"]] });

      expect((input.tools as { alsoAllow: string[] }).alsoAllow).toEqual(["exec", "fetch", "read"]);
      const persisted = JSON.parse(await fs.readFile(configPath, "utf-8")) as {
        tools?: { alsoAllow?: string[] };
      };
      expect(persisted.tools?.alsoAllow).toEqual(["exec", "read"]);
    });
  });

  it("treats missing unset paths as no-op without mutating caller config", async () => {
    await withTempHome("openclaw-config-io-", async (home) => {
      await runUnsetNoopCase({
        home,
        unsetPaths: [["commands", "missingKey"]],
      });
    });
  });

  it("ignores blocked prototype-key unset path segments", async () => {
    await withTempHome("openclaw-config-io-", async (home) => {
      await runUnsetNoopCase({
        home,
        unsetPaths: [
          ["commands", "__proto__"],
          ["commands", "constructor"],
          ["commands", "prototype"],
        ],
      });
    });
  });

  it("preserves env var references when writing", async () => {
    await withTempHome("openclaw-config-io-", async (home) => {
      const { configPath, io, snapshot } = await writeConfigAndCreateIo({
        home,
        env: { OPENAI_API_KEY: "sk-secret" } as NodeJS.ProcessEnv,
        initialConfig: {
          agents: {
            defaults: {
              cliBackends: {
                codex: {
                  command: "codex",
                  env: {
                    OPENAI_API_KEY: "${OPENAI_API_KEY}",
=======
  it("preserves env var references when writing", async () => {
    await withTempHome(async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify(
          {
            agents: {
              defaults: {
                cliBackends: {
                  codex: {
                    command: "codex",
                    env: {
                      OPENAI_API_KEY: "${OPENAI_API_KEY}",
                    },
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
                  },
                },
              },
            },
<<<<<<< HEAD
          },
          gateway: { port: 18789 },
        },
      });
      const persisted = (await writeTokenAuthAndReadConfig({ io, snapshot, configPath })) as {
=======
            gateway: { port: 18789 },
          },
          null,
          2,
        ),
        "utf-8",
      );

      const io = createConfigIO({
        env: { OPENAI_API_KEY: "sk-secret" } as NodeJS.ProcessEnv,
        homedir: () => home,
        logger: silentLogger,
      });

      const snapshot = await io.readConfigFileSnapshot();
      expect(snapshot.valid).toBe(true);

      const next = structuredClone(snapshot.config);
      next.gateway = {
        ...next.gateway,
        auth: { mode: "token" },
      };

      await io.writeConfigFile(next);

      const persisted = JSON.parse(await fs.readFile(configPath, "utf-8")) as {
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
        agents: { defaults: { cliBackends: { codex: { env: { OPENAI_API_KEY: string } } } } };
        gateway: { port: number; auth: { mode: string } };
      };
      expect(persisted.agents.defaults.cliBackends.codex.env.OPENAI_API_KEY).toBe(
        "${OPENAI_API_KEY}",
      );
      expect(persisted.gateway).toEqual({
        port: 18789,
        auth: { mode: "token" },
      });
    });
  });

<<<<<<< HEAD
  it("does not reintroduce Slack/Discord legacy dm.policy defaults when writing", async () => {
    await withTempHome("openclaw-config-io-", async (home) => {
      const { configPath, io, snapshot } = await writeConfigAndCreateIo({
        home,
        initialConfig: {
          channels: {
            discord: {
              dmPolicy: "pairing",
              dm: { enabled: true, policy: "pairing" },
            },
            slack: {
              dmPolicy: "pairing",
              dm: { enabled: true, policy: "pairing" },
            },
          },
          gateway: { port: 18789 },
        },
      });

      const next = structuredClone(snapshot.config);
      // Simulate doctor removing legacy keys while keeping dm enabled.
      if (next.channels?.discord?.dm && typeof next.channels.discord.dm === "object") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
        delete (next.channels.discord.dm as any).policy;
      }
      if (next.channels?.slack?.dm && typeof next.channels.slack.dm === "object") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
        delete (next.channels.slack.dm as any).policy;
      }

      await io.writeConfigFile(next);

      const persisted = JSON.parse(await fs.readFile(configPath, "utf-8")) as {
        channels?: {
          discord?: { dm?: Record<string, unknown>; dmPolicy?: unknown };
          slack?: { dm?: Record<string, unknown>; dmPolicy?: unknown };
        };
      };

      expect(persisted.channels?.discord?.dmPolicy).toBe("pairing");
      expect(persisted.channels?.discord?.dm).toEqual({ enabled: true });
      expect(persisted.channels?.slack?.dmPolicy).toBe("pairing");
      expect(persisted.channels?.slack?.dm).toEqual({ enabled: true });
    });
  });

  it("keeps env refs in arrays when appending entries", async () => {
    await withTempHome("openclaw-config-io-", async (home) => {
=======
  it("keeps env refs in arrays when appending entries", async () => {
    await withTempHome(async (home) => {
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify(
          {
            agents: {
              defaults: {
                cliBackends: {
                  codex: {
                    command: "codex",
                    args: ["${DISCORD_USER_ID}", "123"],
                  },
                },
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      const io = createConfigIO({
        env: { DISCORD_USER_ID: "999" } as NodeJS.ProcessEnv,
        homedir: () => home,
        logger: silentLogger,
      });

      const snapshot = await io.readConfigFileSnapshot();
      expect(snapshot.valid).toBe(true);

      const next = structuredClone(snapshot.config);
      const codexBackend = next.agents?.defaults?.cliBackends?.codex;
      const args = Array.isArray(codexBackend?.args) ? codexBackend?.args : [];
      next.agents = {
        ...next.agents,
        defaults: {
          ...next.agents?.defaults,
          cliBackends: {
            ...next.agents?.defaults?.cliBackends,
            codex: {
              ...codexBackend,
              command: typeof codexBackend?.command === "string" ? codexBackend.command : "codex",
              args: [...args, "456"],
            },
          },
        },
      };

      await io.writeConfigFile(next);

      const persisted = JSON.parse(await fs.readFile(configPath, "utf-8")) as {
        agents: {
          defaults: {
            cliBackends: {
              codex: {
                args: string[];
              };
            };
          };
        };
      };
      expect(persisted.agents.defaults.cliBackends.codex.args).toEqual([
        "${DISCORD_USER_ID}",
        "123",
        "456",
      ]);
    });
  });

  it("logs an overwrite audit entry when replacing an existing config file", async () => {
<<<<<<< HEAD
    await withTempHome("openclaw-config-io-", async (home) => {
      const warn = vi.fn();
      const { configPath, io, snapshot } = await writeConfigAndCreateIo({
        home,
        initialConfig: { gateway: { port: 18789 } },
        env: {} as NodeJS.ProcessEnv,
        logger: {
          warn: warn as (msg: string) => void,
          error: vi.fn() as (msg: string) => void,
        },
      });
=======
    await withTempHome(async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({ gateway: { port: 18789 } }, null, 2),
        "utf-8",
      );
      const warn = vi.fn();
      const io = createConfigIO({
        env: {} as NodeJS.ProcessEnv,
        homedir: () => home,
        logger: {
          warn,
          error: vi.fn(),
        },
      });

      const snapshot = await io.readConfigFileSnapshot();
      expect(snapshot.valid).toBe(true);
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
      const next = structuredClone(snapshot.config);
      next.gateway = {
        ...next.gateway,
        auth: { mode: "token" },
      };

      await io.writeConfigFile(next);

      const overwriteLog = warn.mock.calls
        .map((call) => call[0])
        .find((entry) => typeof entry === "string" && entry.startsWith("Config overwrite:"));
      expect(typeof overwriteLog).toBe("string");
      expect(overwriteLog).toContain(configPath);
      expect(overwriteLog).toContain(`${configPath}.bak`);
      expect(overwriteLog).toContain("sha256");
    });
  });

  it("does not log an overwrite audit entry when creating config for the first time", async () => {
<<<<<<< HEAD
    await withTempHome("openclaw-config-io-", async (home) => {
=======
    await withTempHome(async (home) => {
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
      const warn = vi.fn();
      const io = createConfigIO({
        env: {} as NodeJS.ProcessEnv,
        homedir: () => home,
        logger: {
          warn,
          error: vi.fn(),
        },
      });

      await io.writeConfigFile({
        gateway: { mode: "local" },
      });

      const overwriteLogs = warn.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].startsWith("Config overwrite:"),
      );
      expect(overwriteLogs).toHaveLength(0);
    });
  });

  it("appends config write audit JSONL entries with forensic metadata", async () => {
<<<<<<< HEAD
    await withTempHome("openclaw-config-io-", async (home) => {
      const { configPath, lines, last } = await writeGatewayPatchAndReadLastAuditEntry({
        home,
        initialConfig: { gateway: { port: 18789 } },
        gatewayPatch: { mode: "local" },
        env: {} as NodeJS.ProcessEnv,
      });
      expect(lines.length).toBeGreaterThan(0);
=======
    await withTempHome(async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      const auditPath = path.join(home, ".openclaw", "logs", "config-audit.jsonl");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({ gateway: { port: 18789 } }, null, 2),
        "utf-8",
      );

      const io = createConfigIO({
        env: {} as NodeJS.ProcessEnv,
        homedir: () => home,
        logger: {
          warn: vi.fn(),
          error: vi.fn(),
        },
      });

      const snapshot = await io.readConfigFileSnapshot();
      expect(snapshot.valid).toBe(true);

      const next = structuredClone(snapshot.config);
      next.gateway = {
        ...next.gateway,
        mode: "local",
      };

      await io.writeConfigFile(next);

      const lines = (await fs.readFile(auditPath, "utf-8")).trim().split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      const last = JSON.parse(lines.at(-1) ?? "{}") as Record<string, unknown>;
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
      expect(last.source).toBe("config-io");
      expect(last.event).toBe("config.write");
      expect(last.configPath).toBe(configPath);
      expect(last.existsBefore).toBe(true);
      expect(last.hasMetaAfter).toBe(true);
      expect(last.previousHash).toBeTypeOf("string");
      expect(last.nextHash).toBeTypeOf("string");
      expect(last.result === "rename" || last.result === "copy-fallback").toBe(true);
    });
  });

  it("records gateway watch session markers in config audit entries", async () => {
<<<<<<< HEAD
    await withTempHome("openclaw-config-io-", async (home) => {
      const { last } = await writeGatewayPatchAndReadLastAuditEntry({
        home,
        initialConfig: { gateway: { mode: "local" } },
        gatewayPatch: { bind: "loopback" },
=======
    await withTempHome(async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      const auditPath = path.join(home, ".openclaw", "logs", "config-audit.jsonl");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({ gateway: { mode: "local" } }, null, 2),
        "utf-8",
      );

      const io = createConfigIO({
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
        env: {
          OPENCLAW_WATCH_MODE: "1",
          OPENCLAW_WATCH_SESSION: "watch-session-1",
          OPENCLAW_WATCH_COMMAND: "gateway --force",
        } as NodeJS.ProcessEnv,
<<<<<<< HEAD
      });
=======
        homedir: () => home,
        logger: {
          warn: vi.fn(),
          error: vi.fn(),
        },
      });

      const snapshot = await io.readConfigFileSnapshot();
      expect(snapshot.valid).toBe(true);
      const next = structuredClone(snapshot.config);
      next.gateway = {
        ...next.gateway,
        bind: "loopback",
      };

      await io.writeConfigFile(next);

      const lines = (await fs.readFile(auditPath, "utf-8")).trim().split("\n").filter(Boolean);
      const last = JSON.parse(lines.at(-1) ?? "{}") as Record<string, unknown>;
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
      expect(last.watchMode).toBe(true);
      expect(last.watchSession).toBe("watch-session-1");
      expect(last.watchCommand).toBe("gateway --force");
    });
  });
});
