import fs from "node:fs/promises";
import path from "node:path";
<<<<<<< HEAD:src/agents/models-config.skips-writing-models-json-no-env-token.test.ts
import { describe, expect, it } from "vitest";
import { resolveOpenClawAgentDir } from "./agent-paths.js";
import {
  CUSTOM_PROXY_MODELS_CONFIG,
  installModelsConfigTestHooks,
  MODELS_CONFIG_IMPLICIT_ENV_VARS,
  unsetEnv,
  withTempEnv,
  withModelsTempHome as withTempHome,
} from "./models-config.e2e-harness.js";
=======
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { withTempHome as withTempHomeBase } from "../../test/helpers/temp-home.js";
import { resolveOpenClawAgentDir } from "./agent-paths.js";
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/models-config.skips-writing-models-json-no-env-token.e2e.test.ts
import { ensureOpenClawModelsJson } from "./models-config.js";

installModelsConfigTestHooks();

type ProviderConfig = {
  baseUrl?: string;
  apiKey?: string;
  models?: Array<{ id: string }>;
};

async function runEnvProviderCase(params: {
  envVar: "MINIMAX_API_KEY" | "SYNTHETIC_API_KEY";
  envValue: string;
  providerKey: "minimax" | "synthetic";
  expectedBaseUrl: string;
  expectedApiKeyRef: string;
  expectedModelIds: string[];
}) {
  const previousValue = process.env[params.envVar];
  process.env[params.envVar] = params.envValue;
  try {
    await ensureOpenClawModelsJson({});

    const modelPath = path.join(resolveOpenClawAgentDir(), "models.json");
    const raw = await fs.readFile(modelPath, "utf8");
    const parsed = JSON.parse(raw) as { providers: Record<string, ProviderConfig> };
    const provider = parsed.providers[params.providerKey];
    expect(provider?.baseUrl).toBe(params.expectedBaseUrl);
    expect(provider?.apiKey).toBe(params.expectedApiKeyRef);
    const ids = provider?.models?.map((model) => model.id) ?? [];
    for (const expectedId of params.expectedModelIds) {
      expect(ids).toContain(expectedId);
    }
  } finally {
    if (previousValue === undefined) {
      delete process.env[params.envVar];
    } else {
      process.env[params.envVar] = previousValue;
    }
  }
}

describe("models-config", () => {
  it("skips writing models.json when no env token or profile exists", async () => {
    await withTempHome(async (home) => {
<<<<<<< HEAD:src/agents/models-config.skips-writing-models-json-no-env-token.test.ts
      await withTempEnv([...MODELS_CONFIG_IMPLICIT_ENV_VARS, "KIMI_API_KEY"], async () => {
        unsetEnv([...MODELS_CONFIG_IMPLICIT_ENV_VARS, "KIMI_API_KEY"]);

=======
      const previous = process.env.COPILOT_GITHUB_TOKEN;
      const previousGh = process.env.GH_TOKEN;
      const previousGithub = process.env.GITHUB_TOKEN;
      const previousKimiCode = process.env.KIMI_API_KEY;
      const previousMinimax = process.env.MINIMAX_API_KEY;
      const previousMoonshot = process.env.MOONSHOT_API_KEY;
      const previousSynthetic = process.env.SYNTHETIC_API_KEY;
      const previousVenice = process.env.VENICE_API_KEY;
      const previousXiaomi = process.env.XIAOMI_API_KEY;
      delete process.env.COPILOT_GITHUB_TOKEN;
      delete process.env.GH_TOKEN;
      delete process.env.GITHUB_TOKEN;
      delete process.env.KIMI_API_KEY;
      delete process.env.MINIMAX_API_KEY;
      delete process.env.MOONSHOT_API_KEY;
      delete process.env.SYNTHETIC_API_KEY;
      delete process.env.VENICE_API_KEY;
      delete process.env.XIAOMI_API_KEY;

      try {
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/models-config.skips-writing-models-json-no-env-token.e2e.test.ts
        const agentDir = path.join(home, "agent-empty");
        // ensureAuthProfileStore merges the main auth store into non-main dirs; point main at our temp dir.
        process.env.OPENCLAW_AGENT_DIR = agentDir;
        process.env.PI_CODING_AGENT_DIR = agentDir;

        const result = await ensureOpenClawModelsJson(
          {
            models: { providers: {} },
          },
          agentDir,
        );

        await expect(fs.stat(path.join(agentDir, "models.json"))).rejects.toThrow();
        expect(result.wrote).toBe(false);
      });
    });
  });

  it("writes models.json for configured providers", async () => {
    await withTempHome(async () => {
<<<<<<< HEAD:src/agents/models-config.skips-writing-models-json-no-env-token.test.ts
      await ensureOpenClawModelsJson(CUSTOM_PROXY_MODELS_CONFIG);
=======
      await ensureOpenClawModelsJson(MODELS_CONFIG);
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/models-config.skips-writing-models-json-no-env-token.e2e.test.ts

      const modelPath = path.join(resolveOpenClawAgentDir(), "models.json");
      const raw = await fs.readFile(modelPath, "utf8");
      const parsed = JSON.parse(raw) as {
        providers: Record<string, { baseUrl?: string }>;
      };

      expect(parsed.providers["custom-proxy"]?.baseUrl).toBe("http://localhost:4000/v1");
    });
  });

  it("adds minimax provider when MINIMAX_API_KEY is set", async () => {
    await withTempHome(async () => {
<<<<<<< HEAD:src/agents/models-config.skips-writing-models-json-no-env-token.test.ts
      await runEnvProviderCase({
        envVar: "MINIMAX_API_KEY",
        envValue: "sk-minimax-test",
        providerKey: "minimax",
        expectedBaseUrl: "https://api.minimax.io/anthropic",
        expectedApiKeyRef: "MINIMAX_API_KEY",
        expectedModelIds: ["MiniMax-M2.1", "MiniMax-VL-01"],
      });
=======
      const prevKey = process.env.MINIMAX_API_KEY;
      process.env.MINIMAX_API_KEY = "sk-minimax-test";
      try {
        await ensureOpenClawModelsJson({});

        const modelPath = path.join(resolveOpenClawAgentDir(), "models.json");
        const raw = await fs.readFile(modelPath, "utf8");
        const parsed = JSON.parse(raw) as {
          providers: Record<
            string,
            {
              baseUrl?: string;
              apiKey?: string;
              models?: Array<{ id: string }>;
            }
          >;
        };
        expect(parsed.providers.minimax?.baseUrl).toBe("https://api.minimax.chat/v1");
        expect(parsed.providers.minimax?.apiKey).toBe("MINIMAX_API_KEY");
        const ids = parsed.providers.minimax?.models?.map((model) => model.id);
        expect(ids).toContain("MiniMax-M2.1");
        expect(ids).toContain("MiniMax-VL-01");
      } finally {
        if (prevKey === undefined) {
          delete process.env.MINIMAX_API_KEY;
        } else {
          process.env.MINIMAX_API_KEY = prevKey;
        }
      }
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/models-config.skips-writing-models-json-no-env-token.e2e.test.ts
    });
  });

  it("adds synthetic provider when SYNTHETIC_API_KEY is set", async () => {
    await withTempHome(async () => {
<<<<<<< HEAD:src/agents/models-config.skips-writing-models-json-no-env-token.test.ts
      await runEnvProviderCase({
        envVar: "SYNTHETIC_API_KEY",
        envValue: "sk-synthetic-test",
        providerKey: "synthetic",
        expectedBaseUrl: "https://api.synthetic.new/anthropic",
        expectedApiKeyRef: "SYNTHETIC_API_KEY",
        expectedModelIds: ["hf:MiniMaxAI/MiniMax-M2.1"],
      });
=======
      const prevKey = process.env.SYNTHETIC_API_KEY;
      process.env.SYNTHETIC_API_KEY = "sk-synthetic-test";
      try {
        await ensureOpenClawModelsJson({});

        const modelPath = path.join(resolveOpenClawAgentDir(), "models.json");
        const raw = await fs.readFile(modelPath, "utf8");
        const parsed = JSON.parse(raw) as {
          providers: Record<
            string,
            {
              baseUrl?: string;
              apiKey?: string;
              models?: Array<{ id: string }>;
            }
          >;
        };
        expect(parsed.providers.synthetic?.baseUrl).toBe("https://api.synthetic.new/anthropic");
        expect(parsed.providers.synthetic?.apiKey).toBe("SYNTHETIC_API_KEY");
        const ids = parsed.providers.synthetic?.models?.map((model) => model.id);
        expect(ids).toContain("hf:MiniMaxAI/MiniMax-M2.1");
      } finally {
        if (prevKey === undefined) {
          delete process.env.SYNTHETIC_API_KEY;
        } else {
          process.env.SYNTHETIC_API_KEY = prevKey;
        }
      }
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/models-config.skips-writing-models-json-no-env-token.e2e.test.ts
    });
  });
});
