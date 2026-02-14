<<<<<<< HEAD:src/agents/models-config.normalizes-gemini-3-ids-preview-google-providers.test.ts
import { describe, expect, it } from "vitest";
=======
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/models-config.normalizes-gemini-3-ids-preview-google-providers.e2e.test.ts
import type { OpenClawConfig } from "../config/config.js";
import { installModelsConfigTestHooks, withModelsTempHome } from "./models-config.e2e-harness.js";
import { ensureOpenClawModelsJson } from "./models-config.js";
import { readGeneratedModelsJson } from "./models-config.test-utils.js";

describe("models-config", () => {
  installModelsConfigTestHooks();

  it("normalizes gemini 3 ids to preview for google providers", async () => {
<<<<<<< HEAD:src/agents/models-config.normalizes-gemini-3-ids-preview-google-providers.test.ts
    await withModelsTempHome(async () => {
=======
    await withTempHome(async () => {
      const { ensureOpenClawModelsJson } = await import("./models-config.js");
      const { resolveOpenClawAgentDir } = await import("./agent-paths.js");

>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/models-config.normalizes-gemini-3-ids-preview-google-providers.e2e.test.ts
      const cfg: OpenClawConfig = {
        models: {
          providers: {
            google: {
              baseUrl: "https://generativelanguage.googleapis.com/v1beta",
              apiKey: "GEMINI_KEY",
              api: "google-generative-ai",
              models: [
                {
                  id: "gemini-3-pro",
                  name: "Gemini 3 Pro",
                  api: "google-generative-ai",
                  reasoning: true,
                  input: ["text", "image"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 1048576,
                  maxTokens: 65536,
                },
                {
                  id: "gemini-3-flash",
                  name: "Gemini 3 Flash",
                  api: "google-generative-ai",
                  reasoning: false,
                  input: ["text", "image"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 1048576,
                  maxTokens: 65536,
                },
              ],
            },
          },
        },
      };

      await ensureOpenClawModelsJson(cfg);

      const parsed = await readGeneratedModelsJson<{
        providers: Record<string, { models: Array<{ id: string }> }>;
      }>();
      const ids = parsed.providers.google?.models?.map((model) => model.id);
      expect(ids).toEqual(["gemini-3-pro-preview", "gemini-3-flash-preview"]);
    });
  });
});
