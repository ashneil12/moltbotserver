import fs from "node:fs/promises";
import path from "node:path";
<<<<<<< HEAD:src/agents/models-config.auto-injects-github-copilot-provider-token-is.test.ts
import { describe, expect, it } from "vitest";
import { withEnvAsync } from "../test-utils/env.js";
import {
  installModelsConfigTestHooks,
  mockCopilotTokenExchangeSuccess,
  withCopilotGithubToken,
  withModelsTempHome as withTempHome,
} from "./models-config.e2e-harness.js";
=======
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { withTempHome as withTempHomeBase } from "../../test/helpers/temp-home.js";
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/models-config.auto-injects-github-copilot-provider-token-is.e2e.test.ts
import { ensureOpenClawModelsJson } from "./models-config.js";

installModelsConfigTestHooks({ restoreFetch: true });

describe("models-config", () => {
<<<<<<< HEAD:src/agents/models-config.auto-injects-github-copilot-provider-token-is.test.ts
  it("auto-injects github-copilot provider when token is present", async () => {
    await withTempHome(async (home) => {
      await withCopilotGithubToken("gh-token", async () => {
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

  it("auto-injects github-copilot provider when token is present", async () => {
    await withTempHome(async (home) => {
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
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/models-config.auto-injects-github-copilot-provider-token-is.e2e.test.ts
        const agentDir = path.join(home, "agent-default-base-url");
        await ensureOpenClawModelsJson({ models: { providers: {} } }, agentDir);

        const raw = await fs.readFile(path.join(agentDir, "models.json"), "utf8");
        const parsed = JSON.parse(raw) as {
          providers: Record<string, { baseUrl?: string; models?: unknown[] }>;
        };

        expect(parsed.providers["github-copilot"]?.baseUrl).toBe("https://api.copilot.example");
        expect(parsed.providers["github-copilot"]?.models?.length ?? 0).toBe(0);
      });
    });
  });

  it("prefers COPILOT_GITHUB_TOKEN over GH_TOKEN and GITHUB_TOKEN", async () => {
    await withTempHome(async () => {
      await withEnvAsync(
        {
          COPILOT_GITHUB_TOKEN: "copilot-token",
          GH_TOKEN: "gh-token",
          GITHUB_TOKEN: "github-token",
        },
        async () => {
          const fetchMock = mockCopilotTokenExchangeSuccess();

<<<<<<< HEAD:src/agents/models-config.auto-injects-github-copilot-provider-token-is.test.ts
          await ensureOpenClawModelsJson({ models: { providers: {} } });

          const [, opts] = fetchMock.mock.calls[0] as [
            string,
            { headers?: Record<string, string> },
          ];
          expect(opts?.headers?.Authorization).toBe("Bearer copilot-token");
        },
      );
=======
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
        await ensureOpenClawModelsJson({ models: { providers: {} } });

        const [, opts] = fetchMock.mock.calls[0] as [string, { headers?: Record<string, string> }];
        expect(opts?.headers?.Authorization).toBe("Bearer copilot-token");
      } finally {
        process.env.COPILOT_GITHUB_TOKEN = previous;
        process.env.GH_TOKEN = previousGh;
        process.env.GITHUB_TOKEN = previousGithub;
      }
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/models-config.auto-injects-github-copilot-provider-token-is.e2e.test.ts
    });
  });
});
