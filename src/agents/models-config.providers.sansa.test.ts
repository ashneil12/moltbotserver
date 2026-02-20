import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveImplicitProviders } from "./models-config.providers.js";

describe("Sansa implicit provider", () => {
  it("should use openai-completions API when SANSA_API_KEY is set", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "openclaw-test-"));
    const previous = process.env.SANSA_API_KEY;
    process.env.SANSA_API_KEY = "sk-sansa-test-key";

    try {
      const providers = await resolveImplicitProviders({ agentDir });
      expect(providers?.sansa).toBeDefined();
      expect(providers?.sansa?.api).toBe("openai-completions");
      expect(providers?.sansa?.baseUrl).toBe("https://api.sansaml.com/v1");
    } finally {
      if (previous === undefined) {
        delete process.env.SANSA_API_KEY;
      } else {
        process.env.SANSA_API_KEY = previous;
      }
    }
  });
});
