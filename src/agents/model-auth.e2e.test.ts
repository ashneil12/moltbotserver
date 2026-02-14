<<<<<<< HEAD:src/agents/model-auth.test.ts
import { describe, expect, it } from "vitest";
import type { AuthProfileStore } from "./auth-profiles.js";
import { requireApiKey, resolveAwsSdkEnvVarName, resolveModelAuthMode } from "./model-auth.js";
=======
import type { Api, Model } from "@mariozechner/pi-ai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureAuthProfileStore } from "./auth-profiles.js";
import { getApiKeyForModel, resolveApiKeyForProvider, resolveEnvApiKey } from "./model-auth.js";
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/model-auth.e2e.test.ts

describe("resolveAwsSdkEnvVarName", () => {
  it("prefers bearer token over access keys and profile", () => {
    const env = {
      AWS_BEARER_TOKEN_BEDROCK: "bearer",
      AWS_ACCESS_KEY_ID: "access",
      AWS_SECRET_ACCESS_KEY: "secret",
      AWS_PROFILE: "default",
    } as NodeJS.ProcessEnv;

<<<<<<< HEAD:src/agents/model-auth.test.ts
    expect(resolveAwsSdkEnvVarName(env)).toBe("AWS_BEARER_TOKEN_BEDROCK");
=======
describe("getApiKeyForModel", () => {
  it("migrates legacy oauth.json into auth-profiles.json", async () => {
    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    const previousAgentDir = process.env.OPENCLAW_AGENT_DIR;
    const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-oauth-"));

    try {
      process.env.OPENCLAW_STATE_DIR = tempDir;
      process.env.OPENCLAW_AGENT_DIR = path.join(tempDir, "agent");
      process.env.PI_CODING_AGENT_DIR = process.env.OPENCLAW_AGENT_DIR;

      const oauthDir = path.join(tempDir, "credentials");
      await fs.mkdir(oauthDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(
        path.join(oauthDir, "oauth.json"),
        `${JSON.stringify({ "openai-codex": oauthFixture }, null, 2)}\n`,
        "utf8",
      );

      const model = {
        id: "codex-mini-latest",
        provider: "openai-codex",
        api: "openai-codex-responses",
      } as Model<Api>;

      const store = ensureAuthProfileStore(process.env.OPENCLAW_AGENT_DIR, {
        allowKeychainPrompt: false,
      });
      const apiKey = await getApiKeyForModel({
        model,
        cfg: {
          auth: {
            profiles: {
              "openai-codex:default": {
                provider: "openai-codex",
                mode: "oauth",
              },
            },
          },
        },
        store,
        agentDir: process.env.OPENCLAW_AGENT_DIR,
      });
      expect(apiKey.apiKey).toBe(oauthFixture.access);

      const authProfiles = await fs.readFile(
        path.join(tempDir, "agent", "auth-profiles.json"),
        "utf8",
      );
      const authData = JSON.parse(authProfiles) as Record<string, unknown>;
      expect(authData.profiles).toMatchObject({
        "openai-codex:default": {
          type: "oauth",
          provider: "openai-codex",
          access: oauthFixture.access,
          refresh: oauthFixture.refresh,
        },
      });
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
      if (previousAgentDir === undefined) {
        delete process.env.OPENCLAW_AGENT_DIR;
      } else {
        process.env.OPENCLAW_AGENT_DIR = previousAgentDir;
      }
      if (previousPiAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
      }
      await fs.rm(tempDir, { recursive: true, force: true });
    }
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/model-auth.e2e.test.ts
  });

  it("uses access keys when bearer token is missing", () => {
    const env = {
      AWS_ACCESS_KEY_ID: "access",
      AWS_SECRET_ACCESS_KEY: "secret",
      AWS_PROFILE: "default",
    } as NodeJS.ProcessEnv;

<<<<<<< HEAD:src/agents/model-auth.test.ts
    expect(resolveAwsSdkEnvVarName(env)).toBe("AWS_ACCESS_KEY_ID");
=======
    try {
      delete process.env.OPENAI_API_KEY;
      process.env.OPENCLAW_STATE_DIR = tempDir;
      process.env.OPENCLAW_AGENT_DIR = path.join(tempDir, "agent");
      process.env.PI_CODING_AGENT_DIR = process.env.OPENCLAW_AGENT_DIR;

      const authProfilesPath = path.join(tempDir, "agent", "auth-profiles.json");
      await fs.mkdir(path.dirname(authProfilesPath), {
        recursive: true,
        mode: 0o700,
      });
      await fs.writeFile(
        authProfilesPath,
        `${JSON.stringify(
          {
            version: 1,
            profiles: {
              "openai-codex:default": {
                type: "oauth",
                provider: "openai-codex",
                ...oauthFixture,
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      let error: unknown = null;
      try {
        await resolveApiKeyForProvider({ provider: "openai" });
      } catch (err) {
        error = err;
      }
      expect(String(error)).toContain("openai-codex/gpt-5.3-codex");
    } finally {
      if (previousOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiKey;
      }
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
      if (previousAgentDir === undefined) {
        delete process.env.OPENCLAW_AGENT_DIR;
      } else {
        process.env.OPENCLAW_AGENT_DIR = previousAgentDir;
      }
      if (previousPiAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
      }
      await fs.rm(tempDir, { recursive: true, force: true });
    }
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/model-auth.e2e.test.ts
  });

  it("uses profile when no bearer token or access keys exist", () => {
    const env = {
      AWS_PROFILE: "default",
    } as NodeJS.ProcessEnv;

<<<<<<< HEAD:src/agents/model-auth.test.ts
    expect(resolveAwsSdkEnvVarName(env)).toBe("AWS_PROFILE");
  });

  it("returns undefined when no AWS auth env is set", () => {
    expect(resolveAwsSdkEnvVarName({} as NodeJS.ProcessEnv)).toBeUndefined();
  });
});

describe("resolveModelAuthMode", () => {
  it("returns mixed when provider has both token and api key profiles", () => {
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "openai:token": {
          type: "token",
          provider: "openai",
          token: "token-value",
        },
        "openai:key": {
          type: "api_key",
          provider: "openai",
          key: "api-key",
        },
      },
    };

    expect(resolveModelAuthMode("openai", undefined, store)).toBe("mixed");
  });

  it("returns aws-sdk when provider auth is overridden", () => {
    expect(
      resolveModelAuthMode(
        "amazon-bedrock",
        {
=======
    try {
      delete process.env.ZAI_API_KEY;
      delete process.env.Z_AI_API_KEY;

      let error: unknown = null;
      try {
        await resolveApiKeyForProvider({
          provider: "zai",
          store: { version: 1, profiles: {} },
        });
      } catch (err) {
        error = err;
      }

      expect(String(error)).toContain('No API key found for provider "zai".');
    } finally {
      if (previousZai === undefined) {
        delete process.env.ZAI_API_KEY;
      } else {
        process.env.ZAI_API_KEY = previousZai;
      }
      if (previousLegacy === undefined) {
        delete process.env.Z_AI_API_KEY;
      } else {
        process.env.Z_AI_API_KEY = previousLegacy;
      }
    }
  });

  it("accepts legacy Z_AI_API_KEY for zai", async () => {
    const previousZai = process.env.ZAI_API_KEY;
    const previousLegacy = process.env.Z_AI_API_KEY;

    try {
      delete process.env.ZAI_API_KEY;
      process.env.Z_AI_API_KEY = "zai-test-key";

      const resolved = await resolveApiKeyForProvider({
        provider: "zai",
        store: { version: 1, profiles: {} },
      });
      expect(resolved.apiKey).toBe("zai-test-key");
      expect(resolved.source).toContain("Z_AI_API_KEY");
    } finally {
      if (previousZai === undefined) {
        delete process.env.ZAI_API_KEY;
      } else {
        process.env.ZAI_API_KEY = previousZai;
      }
      if (previousLegacy === undefined) {
        delete process.env.Z_AI_API_KEY;
      } else {
        process.env.Z_AI_API_KEY = previousLegacy;
      }
    }
  });

  it("resolves Synthetic API key from env", async () => {
    const previousSynthetic = process.env.SYNTHETIC_API_KEY;

    try {
      process.env.SYNTHETIC_API_KEY = "synthetic-test-key";

      const resolved = await resolveApiKeyForProvider({
        provider: "synthetic",
        store: { version: 1, profiles: {} },
      });
      expect(resolved.apiKey).toBe("synthetic-test-key");
      expect(resolved.source).toContain("SYNTHETIC_API_KEY");
    } finally {
      if (previousSynthetic === undefined) {
        delete process.env.SYNTHETIC_API_KEY;
      } else {
        process.env.SYNTHETIC_API_KEY = previousSynthetic;
      }
    }
  });

  it("resolves Qianfan API key from env", async () => {
    const previous = process.env.QIANFAN_API_KEY;

    try {
      process.env.QIANFAN_API_KEY = "qianfan-test-key";

      const resolved = await resolveApiKeyForProvider({
        provider: "qianfan",
        store: { version: 1, profiles: {} },
      });
      expect(resolved.apiKey).toBe("qianfan-test-key");
      expect(resolved.source).toContain("QIANFAN_API_KEY");
    } finally {
      if (previous === undefined) {
        delete process.env.QIANFAN_API_KEY;
      } else {
        process.env.QIANFAN_API_KEY = previous;
      }
    }
  });

  it("resolves Vercel AI Gateway API key from env", async () => {
    const previousGatewayKey = process.env.AI_GATEWAY_API_KEY;

    try {
      process.env.AI_GATEWAY_API_KEY = "gateway-test-key";

      const resolved = await resolveApiKeyForProvider({
        provider: "vercel-ai-gateway",
        store: { version: 1, profiles: {} },
      });
      expect(resolved.apiKey).toBe("gateway-test-key");
      expect(resolved.source).toContain("AI_GATEWAY_API_KEY");
    } finally {
      if (previousGatewayKey === undefined) {
        delete process.env.AI_GATEWAY_API_KEY;
      } else {
        process.env.AI_GATEWAY_API_KEY = previousGatewayKey;
      }
    }
  });

  it("prefers Bedrock bearer token over access keys and profile", async () => {
    const previous = {
      bearer: process.env.AWS_BEARER_TOKEN_BEDROCK,
      access: process.env.AWS_ACCESS_KEY_ID,
      secret: process.env.AWS_SECRET_ACCESS_KEY,
      profile: process.env.AWS_PROFILE,
    };

    try {
      process.env.AWS_BEARER_TOKEN_BEDROCK = "bedrock-token";
      process.env.AWS_ACCESS_KEY_ID = "access-key";
      process.env.AWS_SECRET_ACCESS_KEY = "secret-key";
      process.env.AWS_PROFILE = "profile";

      const resolved = await resolveApiKeyForProvider({
        provider: "amazon-bedrock",
        store: { version: 1, profiles: {} },
        cfg: {
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/model-auth.e2e.test.ts
          models: {
            providers: {
              "amazon-bedrock": {
                baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
<<<<<<< HEAD:src/agents/model-auth.test.ts
                models: [],
                auth: "aws-sdk",
              },
            },
          },
        },
        { version: 1, profiles: {} },
      ),
    ).toBe("aws-sdk");
  });

  it("returns aws-sdk for bedrock alias without explicit auth override", () => {
    expect(resolveModelAuthMode("bedrock", undefined, { version: 1, profiles: {} })).toBe(
      "aws-sdk",
    );
  });

  it("returns aws-sdk for aws-bedrock alias without explicit auth override", () => {
    expect(resolveModelAuthMode("aws-bedrock", undefined, { version: 1, profiles: {} })).toBe(
      "aws-sdk",
    );
  });
});

describe("requireApiKey", () => {
  it("normalizes line breaks in resolved API keys", () => {
    const key = requireApiKey(
      {
        apiKey: "\n sk-test-abc\r\n",
        source: "env: OPENAI_API_KEY",
        mode: "api-key",
      },
      "openai",
    );

    expect(key).toBe("sk-test-abc");
  });

  it("throws when no API key is present", () => {
    expect(() =>
      requireApiKey(
        {
          source: "env: OPENAI_API_KEY",
          mode: "api-key",
        },
        "openai",
      ),
    ).toThrow('No API key resolved for provider "openai"');
=======
                api: "bedrock-converse-stream",
                auth: "aws-sdk",
                models: [],
              },
            },
          },
        } as never,
      });

      expect(resolved.mode).toBe("aws-sdk");
      expect(resolved.apiKey).toBeUndefined();
      expect(resolved.source).toContain("AWS_BEARER_TOKEN_BEDROCK");
    } finally {
      if (previous.bearer === undefined) {
        delete process.env.AWS_BEARER_TOKEN_BEDROCK;
      } else {
        process.env.AWS_BEARER_TOKEN_BEDROCK = previous.bearer;
      }
      if (previous.access === undefined) {
        delete process.env.AWS_ACCESS_KEY_ID;
      } else {
        process.env.AWS_ACCESS_KEY_ID = previous.access;
      }
      if (previous.secret === undefined) {
        delete process.env.AWS_SECRET_ACCESS_KEY;
      } else {
        process.env.AWS_SECRET_ACCESS_KEY = previous.secret;
      }
      if (previous.profile === undefined) {
        delete process.env.AWS_PROFILE;
      } else {
        process.env.AWS_PROFILE = previous.profile;
      }
    }
  });

  it("prefers Bedrock access keys over profile", async () => {
    const previous = {
      bearer: process.env.AWS_BEARER_TOKEN_BEDROCK,
      access: process.env.AWS_ACCESS_KEY_ID,
      secret: process.env.AWS_SECRET_ACCESS_KEY,
      profile: process.env.AWS_PROFILE,
    };

    try {
      delete process.env.AWS_BEARER_TOKEN_BEDROCK;
      process.env.AWS_ACCESS_KEY_ID = "access-key";
      process.env.AWS_SECRET_ACCESS_KEY = "secret-key";
      process.env.AWS_PROFILE = "profile";

      const resolved = await resolveApiKeyForProvider({
        provider: "amazon-bedrock",
        store: { version: 1, profiles: {} },
        cfg: {
          models: {
            providers: {
              "amazon-bedrock": {
                baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
                api: "bedrock-converse-stream",
                auth: "aws-sdk",
                models: [],
              },
            },
          },
        } as never,
      });

      expect(resolved.mode).toBe("aws-sdk");
      expect(resolved.apiKey).toBeUndefined();
      expect(resolved.source).toContain("AWS_ACCESS_KEY_ID");
    } finally {
      if (previous.bearer === undefined) {
        delete process.env.AWS_BEARER_TOKEN_BEDROCK;
      } else {
        process.env.AWS_BEARER_TOKEN_BEDROCK = previous.bearer;
      }
      if (previous.access === undefined) {
        delete process.env.AWS_ACCESS_KEY_ID;
      } else {
        process.env.AWS_ACCESS_KEY_ID = previous.access;
      }
      if (previous.secret === undefined) {
        delete process.env.AWS_SECRET_ACCESS_KEY;
      } else {
        process.env.AWS_SECRET_ACCESS_KEY = previous.secret;
      }
      if (previous.profile === undefined) {
        delete process.env.AWS_PROFILE;
      } else {
        process.env.AWS_PROFILE = previous.profile;
      }
    }
  });

  it("uses Bedrock profile when access keys are missing", async () => {
    const previous = {
      bearer: process.env.AWS_BEARER_TOKEN_BEDROCK,
      access: process.env.AWS_ACCESS_KEY_ID,
      secret: process.env.AWS_SECRET_ACCESS_KEY,
      profile: process.env.AWS_PROFILE,
    };

    try {
      delete process.env.AWS_BEARER_TOKEN_BEDROCK;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      process.env.AWS_PROFILE = "profile";

      const resolved = await resolveApiKeyForProvider({
        provider: "amazon-bedrock",
        store: { version: 1, profiles: {} },
        cfg: {
          models: {
            providers: {
              "amazon-bedrock": {
                baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
                api: "bedrock-converse-stream",
                auth: "aws-sdk",
                models: [],
              },
            },
          },
        } as never,
      });

      expect(resolved.mode).toBe("aws-sdk");
      expect(resolved.apiKey).toBeUndefined();
      expect(resolved.source).toContain("AWS_PROFILE");
    } finally {
      if (previous.bearer === undefined) {
        delete process.env.AWS_BEARER_TOKEN_BEDROCK;
      } else {
        process.env.AWS_BEARER_TOKEN_BEDROCK = previous.bearer;
      }
      if (previous.access === undefined) {
        delete process.env.AWS_ACCESS_KEY_ID;
      } else {
        process.env.AWS_ACCESS_KEY_ID = previous.access;
      }
      if (previous.secret === undefined) {
        delete process.env.AWS_SECRET_ACCESS_KEY;
      } else {
        process.env.AWS_SECRET_ACCESS_KEY = previous.secret;
      }
      if (previous.profile === undefined) {
        delete process.env.AWS_PROFILE;
      } else {
        process.env.AWS_PROFILE = previous.profile;
      }
    }
  });

  it("accepts VOYAGE_API_KEY for voyage", async () => {
    const previous = process.env.VOYAGE_API_KEY;

    try {
      process.env.VOYAGE_API_KEY = "voyage-test-key";

      const resolved = await resolveApiKeyForProvider({
        provider: "voyage",
        store: { version: 1, profiles: {} },
      });
      expect(resolved.apiKey).toBe("voyage-test-key");
      expect(resolved.source).toContain("VOYAGE_API_KEY");
    } finally {
      if (previous === undefined) {
        delete process.env.VOYAGE_API_KEY;
      } else {
        process.env.VOYAGE_API_KEY = previous;
      }
    }
  });

  it("strips embedded CR/LF from ANTHROPIC_API_KEY", async () => {
    const previous = process.env.ANTHROPIC_API_KEY;

    try {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-\r\nkey";

      const resolved = resolveEnvApiKey("anthropic");
      expect(resolved?.apiKey).toBe("sk-ant-test-key");
      expect(resolved?.source).toContain("ANTHROPIC_API_KEY");
    } finally {
      if (previous === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = previous;
      }
    }
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/model-auth.e2e.test.ts
  });

  it("resolveEnvApiKey('huggingface') returns HUGGINGFACE_HUB_TOKEN when set", async () => {
    const prevHub = process.env.HUGGINGFACE_HUB_TOKEN;
    const prevHf = process.env.HF_TOKEN;
    try {
      delete process.env.HF_TOKEN;
      process.env.HUGGINGFACE_HUB_TOKEN = "hf_hub_xyz";

      const resolved = resolveEnvApiKey("huggingface");
      expect(resolved?.apiKey).toBe("hf_hub_xyz");
      expect(resolved?.source).toContain("HUGGINGFACE_HUB_TOKEN");
    } finally {
      if (prevHub === undefined) {
        delete process.env.HUGGINGFACE_HUB_TOKEN;
      } else {
        process.env.HUGGINGFACE_HUB_TOKEN = prevHub;
      }
      if (prevHf === undefined) {
        delete process.env.HF_TOKEN;
      } else {
        process.env.HF_TOKEN = prevHf;
      }
    }
  });

  it("resolveEnvApiKey('huggingface') prefers HUGGINGFACE_HUB_TOKEN over HF_TOKEN when both set", async () => {
    const prevHub = process.env.HUGGINGFACE_HUB_TOKEN;
    const prevHf = process.env.HF_TOKEN;
    try {
      process.env.HUGGINGFACE_HUB_TOKEN = "hf_hub_first";
      process.env.HF_TOKEN = "hf_second";

      const resolved = resolveEnvApiKey("huggingface");
      expect(resolved?.apiKey).toBe("hf_hub_first");
      expect(resolved?.source).toContain("HUGGINGFACE_HUB_TOKEN");
    } finally {
      if (prevHub === undefined) {
        delete process.env.HUGGINGFACE_HUB_TOKEN;
      } else {
        process.env.HUGGINGFACE_HUB_TOKEN = prevHub;
      }
      if (prevHf === undefined) {
        delete process.env.HF_TOKEN;
      } else {
        process.env.HF_TOKEN = prevHf;
      }
    }
  });

  it("resolveEnvApiKey('huggingface') returns HF_TOKEN when only HF_TOKEN set", async () => {
    const prevHub = process.env.HUGGINGFACE_HUB_TOKEN;
    const prevHf = process.env.HF_TOKEN;
    try {
      delete process.env.HUGGINGFACE_HUB_TOKEN;
      process.env.HF_TOKEN = "hf_abc123";

      const resolved = resolveEnvApiKey("huggingface");
      expect(resolved?.apiKey).toBe("hf_abc123");
      expect(resolved?.source).toContain("HF_TOKEN");
    } finally {
      if (prevHub === undefined) {
        delete process.env.HUGGINGFACE_HUB_TOKEN;
      } else {
        process.env.HUGGINGFACE_HUB_TOKEN = prevHub;
      }
      if (prevHf === undefined) {
        delete process.env.HF_TOKEN;
      } else {
        process.env.HF_TOKEN = prevHf;
      }
    }
  });
});
