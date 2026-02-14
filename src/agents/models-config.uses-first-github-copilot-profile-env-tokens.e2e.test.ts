import fs from "node:fs/promises";
import path from "node:path";
<<<<<<< HEAD:src/agents/models-config.uses-first-github-copilot-profile-env-tokens.test.ts
import { describe, expect, it } from "vitest";
import { resolveOpenClawAgentDir } from "./agent-paths.js";
import {
  installModelsConfigTestHooks,
  mockCopilotTokenExchangeSuccess,
  withCopilotGithubToken,
  withUnsetCopilotTokenEnv,
  withModelsTempHome as withTempHome,
} from "./models-config.e2e-harness.js";
=======
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { withTempHome as withTempHomeBase } from "../../test/helpers/temp-home.js";
import { resolveOpenClawAgentDir } from "./agent-paths.js";
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/models-config.uses-first-github-copilot-profile-env-tokens.e2e.test.ts
import { ensureOpenClawModelsJson } from "./models-config.js";

installModelsConfigTestHooks({ restoreFetch: true });

describe("models-config", () => {
<<<<<<< HEAD:src/agents/models-config.uses-first-github-copilot-profile-env-tokens.test.ts
  it("uses the first github-copilot profile when env tokens are missing", async () => {
    await withTempHome(async (home) => {
      await withUnsetCopilotTokenEnv(async () => {
        const fetchMock = mockCopilotTokenExchangeSuccess();
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

  it("uses the first github-copilot profile when env tokens are missing", async () => {
    await withTempHome(async (home) => {
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
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/models-config.uses-first-github-copilot-profile-env-tokens.e2e.test.ts
        const agentDir = path.join(home, "agent-profiles");
        await fs.mkdir(agentDir, { recursive: true });
        await fs.writeFile(
          path.join(agentDir, "auth-profiles.json"),
          JSON.stringify(
            {
              version: 1,
              profiles: {
                "github-copilot:alpha": {
                  type: "token",
                  provider: "github-copilot",
                  token: "alpha-token",
                },
                "github-copilot:beta": {
                  type: "token",
                  provider: "github-copilot",
                  token: "beta-token",
                },
              },
            },
            null,
            2,
          ),
        );

        await ensureOpenClawModelsJson({ models: { providers: {} } }, agentDir);

        const [, opts] = fetchMock.mock.calls[0] as [string, { headers?: Record<string, string> }];
        expect(opts?.headers?.Authorization).toBe("Bearer alpha-token");
<<<<<<< HEAD:src/agents/models-config.uses-first-github-copilot-profile-env-tokens.test.ts
      });
=======
      } finally {
        if (previous === undefined) {
          delete process.env.COPILOT_GITHUB_TOKEN;
        } else {
          process.env.COPILOT_GITHUB_TOKEN = previous;
        }
        if (previousGh === undefined) {
          delete process.env.GH_TOKEN;
        } else {
          process.env.GH_TOKEN = previousGh;
        }
        if (previousGithub === undefined) {
          delete process.env.GITHUB_TOKEN;
        } else {
          process.env.GITHUB_TOKEN = previousGithub;
        }
      }
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/models-config.uses-first-github-copilot-profile-env-tokens.e2e.test.ts
    });
  });

  it("does not override explicit github-copilot provider config", async () => {
    await withTempHome(async () => {
<<<<<<< HEAD:src/agents/models-config.uses-first-github-copilot-profile-env-tokens.test.ts
      await withCopilotGithubToken("gh-token", async () => {
=======
      const previous = process.env.COPILOT_GITHUB_TOKEN;
      process.env.COPILOT_GITHUB_TOKEN = "gh-token";
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
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/models-config.uses-first-github-copilot-profile-env-tokens.e2e.test.ts
        await ensureOpenClawModelsJson({
          models: {
            providers: {
              "github-copilot": {
                baseUrl: "https://copilot.local",
                api: "openai-responses",
                models: [],
              },
            },
          },
        });

        const agentDir = resolveOpenClawAgentDir();
        const raw = await fs.readFile(path.join(agentDir, "models.json"), "utf8");
        const parsed = JSON.parse(raw) as {
          providers: Record<string, { baseUrl?: string }>;
        };

        expect(parsed.providers["github-copilot"]?.baseUrl).toBe("https://copilot.local");
      });
    });
  });
});
