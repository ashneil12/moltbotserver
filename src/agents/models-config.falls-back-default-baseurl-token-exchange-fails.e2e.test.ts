import fs from "node:fs/promises";
import path from "node:path";
<<<<<<< HEAD:src/agents/models-config.falls-back-default-baseurl-token-exchange-fails.test.ts
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COPILOT_API_BASE_URL } from "../providers/github-copilot-token.js";
import { withEnvAsync } from "../test-utils/env.js";
import {
  installModelsConfigTestHooks,
  mockCopilotTokenExchangeSuccess,
  withUnsetCopilotTokenEnv,
  withModelsTempHome as withTempHome,
} from "./models-config.e2e-harness.js";
=======
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { withTempHome as withTempHomeBase } from "../../test/helpers/temp-home.js";
import { DEFAULT_COPILOT_API_BASE_URL } from "../providers/github-copilot-token.js";
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/models-config.falls-back-default-baseurl-token-exchange-fails.e2e.test.ts
import { ensureOpenClawModelsJson } from "./models-config.js";

installModelsConfigTestHooks({ restoreFetch: true });

async function readCopilotBaseUrl(agentDir: string) {
  const raw = await fs.readFile(path.join(agentDir, "models.json"), "utf8");
  const parsed = JSON.parse(raw) as {
    providers: Record<string, { baseUrl?: string }>;
  };
  return parsed.providers["github-copilot"]?.baseUrl;
}

describe("models-config", () => {
<<<<<<< HEAD:src/agents/models-config.falls-back-default-baseurl-token-exchange-fails.test.ts
  it("falls back to default baseUrl when token exchange fails", async () => {
    await withTempHome(async () => {
      await withEnvAsync({ COPILOT_GITHUB_TOKEN: "gh-token" }, async () => {
        const fetchMock = vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: async () => ({ message: "boom" }),
        });
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const { agentDir } = await ensureOpenClawModelsJson({ models: { providers: {} } });
        expect(await readCopilotBaseUrl(agentDir)).toBe(DEFAULT_COPILOT_API_BASE_URL);
      });
=======
  let previousHome: string | undefined;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    previousHome = process.env.HOME;
  });

  afterEach(() => {
    process.env.HOME = previousHome;
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
  });

  it("falls back to default baseUrl when token exchange fails", async () => {
    await withTempHome(async () => {
      const previous = process.env.COPILOT_GITHUB_TOKEN;
      process.env.COPILOT_GITHUB_TOKEN = "gh-token";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: "boom" }),
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      try {
        await ensureOpenClawModelsJson({ models: { providers: {} } });

        const agentDir = path.join(process.env.HOME ?? "", ".openclaw", "agents", "main", "agent");
        const raw = await fs.readFile(path.join(agentDir, "models.json"), "utf8");
        const parsed = JSON.parse(raw) as {
          providers: Record<string, { baseUrl?: string }>;
        };

        expect(parsed.providers["github-copilot"]?.baseUrl).toBe(DEFAULT_COPILOT_API_BASE_URL);
      } finally {
        process.env.COPILOT_GITHUB_TOKEN = previous;
      }
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/models-config.falls-back-default-baseurl-token-exchange-fails.e2e.test.ts
    });
  });

  it("uses agentDir override auth profiles for copilot injection", async () => {
    await withTempHome(async (home) => {
<<<<<<< HEAD:src/agents/models-config.falls-back-default-baseurl-token-exchange-fails.test.ts
      await withUnsetCopilotTokenEnv(async () => {
        mockCopilotTokenExchangeSuccess();
=======
      const previous = process.env.COPILOT_GITHUB_TOKEN;
      const previousGh = process.env.GH_TOKEN;
      const previousGithub = process.env.GITHUB_TOKEN;
      delete process.env.COPILOT_GITHUB_TOKEN;
      delete process.env.GH_TOKEN;
      delete process.env.GITHUB_TOKEN;

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          token: "copilot-token;proxy-ep=proxy.copilot.example",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        }),
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      try {
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/models-config.falls-back-default-baseurl-token-exchange-fails.e2e.test.ts
        const agentDir = path.join(home, "agent-override");
        await fs.mkdir(agentDir, { recursive: true });
        await fs.writeFile(
          path.join(agentDir, "auth-profiles.json"),
          JSON.stringify(
            {
              version: 1,
              profiles: {
                "github-copilot:github": {
                  type: "token",
                  provider: "github-copilot",
                  token: "gh-profile-token",
                },
              },
            },
            null,
            2,
          ),
        );

        await ensureOpenClawModelsJson({ models: { providers: {} } }, agentDir);

        expect(await readCopilotBaseUrl(agentDir)).toBe("https://api.copilot.example");
      });
    });
  });
});
