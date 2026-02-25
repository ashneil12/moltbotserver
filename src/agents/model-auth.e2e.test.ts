import { describe, expect, it } from "vitest";
import type { AuthProfileStore } from "./auth-profiles.js";
import { requireApiKey, resolveAwsSdkEnvVarName, resolveModelAuthMode } from "./model-auth.js";

describe("resolveAwsSdkEnvVarName", () => {
  it("prefers bearer token over access keys and profile", () => {
    const env = {
      AWS_BEARER_TOKEN_BEDROCK: "bearer",
      AWS_ACCESS_KEY_ID: "access",
      AWS_SECRET_ACCESS_KEY: "secret",
      AWS_PROFILE: "default",
    } as NodeJS.ProcessEnv;

    expect(resolveAwsSdkEnvVarName(env)).toBe("AWS_BEARER_TOKEN_BEDROCK");
  });

  it("uses access keys when bearer token is missing", () => {
    const env = {
      AWS_ACCESS_KEY_ID: "access",
      AWS_SECRET_ACCESS_KEY: "secret",
      AWS_PROFILE: "default",
    } as NodeJS.ProcessEnv;

    expect(resolveAwsSdkEnvVarName(env)).toBe("AWS_ACCESS_KEY_ID");
  });

  it("uses profile when no bearer token or access keys exist", () => {
    const env = {
      AWS_PROFILE: "default",
    } as NodeJS.ProcessEnv;

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
          models: {
            providers: {
              "amazon-bedrock": {
                baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
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
