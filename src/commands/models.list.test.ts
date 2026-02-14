<<<<<<< HEAD
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let modelsListCommand: typeof import("./models/list.list-command.js").modelsListCommand;
let loadModelRegistry: typeof import("./models/list.registry.js").loadModelRegistry;
let toModelRow: typeof import("./models/list.registry.js").toModelRow;
=======
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

const loadConfig = vi.fn();
const ensureOpenClawModelsJson = vi.fn().mockResolvedValue(undefined);
const ensurePiAuthJsonFromAuthProfiles = vi
  .fn()
  .mockResolvedValue({ wrote: false, authPath: "/tmp/openclaw-agent/auth.json" });
const resolveOpenClawAgentDir = vi.fn().mockReturnValue("/tmp/openclaw-agent");
const ensureAuthProfileStore = vi.fn().mockReturnValue({ version: 1, profiles: {} });
const listProfilesForProvider = vi.fn().mockReturnValue([]);
const resolveAuthProfileDisplayLabel = vi.fn(({ profileId }: { profileId: string }) => profileId);
const resolveAuthStorePathForDisplay = vi
  .fn()
  .mockReturnValue("/tmp/openclaw-agent/auth-profiles.json");
const resolveProfileUnusableUntilForDisplay = vi.fn().mockReturnValue(null);
const resolveEnvApiKey = vi.fn().mockReturnValue(undefined);
const resolveAwsSdkEnvVarName = vi.fn().mockReturnValue(undefined);
const getCustomProviderApiKey = vi.fn().mockReturnValue(undefined);
const modelRegistryState = {
  models: [] as Array<Record<string, unknown>>,
  available: [] as Array<Record<string, unknown>>,
  getAllError: undefined as unknown,
  getAvailableError: undefined as unknown,
};
<<<<<<< HEAD
let previousExitCode: typeof process.exitCode;
=======
let previousExitCode: number | undefined;
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

vi.mock("../config/config.js", () => ({
  CONFIG_PATH: "/tmp/openclaw.json",
  STATE_DIR: "/tmp/openclaw-state",
  loadConfig,
}));

vi.mock("../agents/models-config.js", () => ({
  ensureOpenClawModelsJson,
}));

vi.mock("../agents/pi-auth-json.js", () => ({
  ensurePiAuthJsonFromAuthProfiles,
}));

vi.mock("../agents/agent-paths.js", () => ({
  resolveOpenClawAgentDir,
}));

vi.mock("../agents/auth-profiles.js", () => ({
  ensureAuthProfileStore,
  listProfilesForProvider,
  resolveAuthProfileDisplayLabel,
  resolveAuthStorePathForDisplay,
  resolveProfileUnusableUntilForDisplay,
}));

vi.mock("../agents/model-auth.js", () => ({
  resolveEnvApiKey,
  resolveAwsSdkEnvVarName,
  getCustomProviderApiKey,
}));

<<<<<<< HEAD
vi.mock("../agents/pi-model-discovery.js", () => {
  class MockModelRegistry {
    find(provider: string, id: string) {
      return (
        modelRegistryState.models.find((model) => model.provider === provider && model.id === id) ??
        null
      );
=======
vi.mock("@mariozechner/pi-coding-agent", async () => {
  class MockAuthStorage {}

  class MockModelRegistry {
    find(provider: string, id: string) {
      const found =
        modelRegistryState.models.find((model) => model.provider === provider && model.id === id) ??
        null;
      return found;
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    }

    getAll() {
      if (modelRegistryState.getAllError !== undefined) {
        throw modelRegistryState.getAllError;
      }
      return modelRegistryState.models;
    }

    getAvailable() {
      if (modelRegistryState.getAvailableError !== undefined) {
        throw modelRegistryState.getAvailableError;
      }
      return modelRegistryState.available;
    }
  }

  return {
<<<<<<< HEAD
    discoverAuthStorage: () => ({}) as unknown,
    discoverModels: () => new MockModelRegistry() as unknown,
  };
});

vi.mock("../agents/pi-embedded-runner/model.js", () => ({
  resolveModel: () => {
    throw new Error("resolveModel should not be called from models.list tests");
  },
}));
=======
    AuthStorage: MockAuthStorage,
    ModelRegistry: MockModelRegistry,
  };
});
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

function makeRuntime() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  };
}

<<<<<<< HEAD
function expectModelRegistryUnavailable(
  runtime: ReturnType<typeof makeRuntime>,
  expectedDetail: string,
) {
  expect(runtime.error).toHaveBeenCalledTimes(1);
  expect(runtime.error.mock.calls[0]?.[0]).toContain("Model registry unavailable:");
  expect(runtime.error.mock.calls[0]?.[0]).toContain(expectedDetail);
  expect(runtime.log).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
}

=======
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
beforeEach(() => {
  previousExitCode = process.exitCode;
  process.exitCode = undefined;
  modelRegistryState.getAllError = undefined;
  modelRegistryState.getAvailableError = undefined;
  listProfilesForProvider.mockReturnValue([]);
<<<<<<< HEAD
  ensurePiAuthJsonFromAuthProfiles.mockClear();
=======
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
});

afterEach(() => {
  process.exitCode = previousExitCode;
});

describe("models list/status", () => {
<<<<<<< HEAD
  const ZAI_MODEL = {
    provider: "zai",
    id: "glm-4.7",
    name: "GLM-4.7",
    input: ["text"],
    baseUrl: "https://api.z.ai/v1",
    contextWindow: 128000,
  };
  const OPENAI_MODEL = {
    provider: "openai",
    id: "gpt-4.1-mini",
    name: "GPT-4.1 mini",
    input: ["text"],
    baseUrl: "https://api.openai.com/v1",
    contextWindow: 128000,
  };
  const GOOGLE_ANTIGRAVITY_TEMPLATE_BASE = {
    provider: "google-antigravity",
    api: "google-gemini-cli",
    input: ["text", "image"],
    baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com",
    contextWindow: 200000,
    maxTokens: 64000,
    reasoning: true,
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  };

  function setDefaultModel(model: string) {
    loadConfig.mockReturnValue({
      agents: { defaults: { model } },
    });
  }

  function configureModelAsConfigured(model: string) {
    loadConfig.mockReturnValue({
      agents: {
        defaults: {
          model,
          models: {
            [model]: {},
          },
        },
      },
    });
  }

  function configureGoogleAntigravityModel(modelId: string) {
    configureModelAsConfigured(`google-antigravity/${modelId}`);
  }

  function makeGoogleAntigravityTemplate(id: string, name: string) {
    return {
      ...GOOGLE_ANTIGRAVITY_TEMPLATE_BASE,
      id,
      name,
    };
  }

  function enableGoogleAntigravityAuthProfile() {
    listProfilesForProvider.mockImplementation((_: unknown, provider: string) =>
      provider === "google-antigravity"
        ? ([{ id: "profile-1" }] as Array<Record<string, unknown>>)
        : [],
    );
  }

  function parseJsonLog(runtime: ReturnType<typeof makeRuntime>) {
    expect(runtime.log).toHaveBeenCalledTimes(1);
    return JSON.parse(String(runtime.log.mock.calls[0]?.[0]));
  }

  async function expectZaiProviderFilter(provider: string) {
    setDefaultZaiRegistry();
    const runtime = makeRuntime();

    await modelsListCommand({ all: true, provider, json: true }, runtime);

    const payload = parseJsonLog(runtime);
    expect(payload.count).toBe(1);
    expect(payload.models[0]?.key).toBe("zai/glm-4.7");
  }

  function setDefaultZaiRegistry(params: { available?: boolean } = {}) {
    const available = params.available ?? true;
    setDefaultModel("z.ai/glm-4.7");
    modelRegistryState.models = [ZAI_MODEL, OPENAI_MODEL];
    modelRegistryState.available = available ? [ZAI_MODEL, OPENAI_MODEL] : [];
  }

  beforeAll(async () => {
    ({ modelsListCommand } = await import("./models/list.list-command.js"));
    ({ loadModelRegistry, toModelRow } = await import("./models/list.registry.js"));
  });

  it("models list syncs auth-profiles into auth.json before availability checks", async () => {
    setDefaultZaiRegistry();
    const runtime = makeRuntime();

    await modelsListCommand({ all: true, json: true }, runtime);

    expect(ensurePiAuthJsonFromAuthProfiles).toHaveBeenCalledWith("/tmp/openclaw-agent");
  });

=======
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  it("models list outputs canonical zai key for configured z.ai model", async () => {
    setDefaultZaiRegistry();
    const runtime = makeRuntime();

<<<<<<< HEAD
=======
    const model = {
      provider: "zai",
      id: "glm-4.7",
      name: "GLM-4.7",
      input: ["text"],
      baseUrl: "https://api.z.ai/v1",
      contextWindow: 128000,
    };

    modelRegistryState.models = [model];
    modelRegistryState.available = [model];

    const { modelsListCommand } = await import("./models/list.list-command.js");
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    await modelsListCommand({ json: true }, runtime);

    const payload = parseJsonLog(runtime);
    expect(payload.models[0]?.key).toBe("zai/glm-4.7");
  });

  it("models list plain outputs canonical zai key", async () => {
    loadConfig.mockReturnValue({
      agents: { defaults: { model: "z.ai/glm-4.7" } },
    });
    const runtime = makeRuntime();

<<<<<<< HEAD
    modelRegistryState.models = [ZAI_MODEL];
    modelRegistryState.available = [ZAI_MODEL];
=======
    const model = {
      provider: "zai",
      id: "glm-4.7",
      name: "GLM-4.7",
      input: ["text"],
      baseUrl: "https://api.z.ai/v1",
      contextWindow: 128000,
    };

    modelRegistryState.models = [model];
    modelRegistryState.available = [model];

    const { modelsListCommand } = await import("./models/list.list-command.js");
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    await modelsListCommand({ plain: true }, runtime);

    expect(runtime.log).toHaveBeenCalledTimes(1);
    expect(runtime.log.mock.calls[0]?.[0]).toBe("zai/glm-4.7");
  });

<<<<<<< HEAD
  it.each(["z.ai", "Z.AI", "z-ai"] as const)(
    "models list provider filter normalizes %s alias",
    async (provider) => {
      await expectZaiProviderFilter(provider);
    },
  );
=======
  it("models list provider filter normalizes z.ai alias", async () => {
    loadConfig.mockReturnValue({
      agents: { defaults: { model: "z.ai/glm-4.7" } },
    });
    const runtime = makeRuntime();

    const models = [
      {
        provider: "zai",
        id: "glm-4.7",
        name: "GLM-4.7",
        input: ["text"],
        baseUrl: "https://api.z.ai/v1",
        contextWindow: 128000,
      },
      {
        provider: "openai",
        id: "gpt-4.1-mini",
        name: "GPT-4.1 mini",
        input: ["text"],
        baseUrl: "https://api.openai.com/v1",
        contextWindow: 128000,
      },
    ];

    modelRegistryState.models = models;
    modelRegistryState.available = models;

    const { modelsListCommand } = await import("./models/list.list-command.js");
    await modelsListCommand({ all: true, provider: "z.ai", json: true }, runtime);

    expect(runtime.log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(runtime.log.mock.calls[0]?.[0]));
    expect(payload.count).toBe(1);
    expect(payload.models[0]?.key).toBe("zai/glm-4.7");
  });

  it("models list provider filter normalizes Z.AI alias casing", async () => {
    loadConfig.mockReturnValue({
      agents: { defaults: { model: "z.ai/glm-4.7" } },
    });
    const runtime = makeRuntime();

    const models = [
      {
        provider: "zai",
        id: "glm-4.7",
        name: "GLM-4.7",
        input: ["text"],
        baseUrl: "https://api.z.ai/v1",
        contextWindow: 128000,
      },
      {
        provider: "openai",
        id: "gpt-4.1-mini",
        name: "GPT-4.1 mini",
        input: ["text"],
        baseUrl: "https://api.openai.com/v1",
        contextWindow: 128000,
      },
    ];

    modelRegistryState.models = models;
    modelRegistryState.available = models;

    const { modelsListCommand } = await import("./models/list.list-command.js");
    await modelsListCommand({ all: true, provider: "Z.AI", json: true }, runtime);

    expect(runtime.log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(runtime.log.mock.calls[0]?.[0]));
    expect(payload.count).toBe(1);
    expect(payload.models[0]?.key).toBe("zai/glm-4.7");
  });

  it("models list provider filter normalizes z-ai alias", async () => {
    loadConfig.mockReturnValue({
      agents: { defaults: { model: "z.ai/glm-4.7" } },
    });
    const runtime = makeRuntime();

    const models = [
      {
        provider: "zai",
        id: "glm-4.7",
        name: "GLM-4.7",
        input: ["text"],
        baseUrl: "https://api.z.ai/v1",
        contextWindow: 128000,
      },
      {
        provider: "openai",
        id: "gpt-4.1-mini",
        name: "GPT-4.1 mini",
        input: ["text"],
        baseUrl: "https://api.openai.com/v1",
        contextWindow: 128000,
      },
    ];

    modelRegistryState.models = models;
    modelRegistryState.available = models;

    const { modelsListCommand } = await import("./models/list.list-command.js");
    await modelsListCommand({ all: true, provider: "z-ai", json: true }, runtime);

    expect(runtime.log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(runtime.log.mock.calls[0]?.[0]));
    expect(payload.count).toBe(1);
    expect(payload.models[0]?.key).toBe("zai/glm-4.7");
  });
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

  it("models list marks auth as unavailable when ZAI key is missing", async () => {
    setDefaultZaiRegistry({ available: false });
    const runtime = makeRuntime();

    await modelsListCommand({ all: true, json: true }, runtime);

    const payload = parseJsonLog(runtime);
    expect(payload.models[0]?.available).toBe(false);
  });

  it("models list does not treat availability-unavailable code as discovery fallback", async () => {
    configureGoogleAntigravityModel("claude-opus-4-6-thinking");
    modelRegistryState.getAllError = Object.assign(new Error("model discovery failed"), {
      code: "MODEL_AVAILABILITY_UNAVAILABLE",
    });
    const runtime = makeRuntime();
    await modelsListCommand({ json: true }, runtime);

    expectModelRegistryUnavailable(runtime, "model discovery failed");
    expect(runtime.error.mock.calls[0]?.[0]).not.toContain("configured models may appear missing");
  });

  it("models list fails fast when registry model discovery is unavailable", async () => {
    configureGoogleAntigravityModel("claude-opus-4-6-thinking");
    enableGoogleAntigravityAuthProfile();
    modelRegistryState.getAllError = Object.assign(new Error("model discovery unavailable"), {
      code: "MODEL_DISCOVERY_UNAVAILABLE",
    });
    const runtime = makeRuntime();

    modelRegistryState.models = [];
    modelRegistryState.available = [];
    await modelsListCommand({ json: true }, runtime);

<<<<<<< HEAD
    expectModelRegistryUnavailable(runtime, "model discovery unavailable");
  });
=======
    const { modelsListCommand } = await import("./models/list.list-command.js");
    await modelsListCommand({ all: true, json: true }, runtime);
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

  it("loadModelRegistry throws when model discovery is unavailable", async () => {
    modelRegistryState.getAllError = Object.assign(new Error("model discovery unavailable"), {
      code: "MODEL_DISCOVERY_UNAVAILABLE",
    });
    modelRegistryState.available = [
      makeGoogleAntigravityTemplate("claude-opus-4-5-thinking", "Claude Opus 4.5 Thinking"),
    ];

    await expect(loadModelRegistry({})).rejects.toThrow("model discovery unavailable");
  });

  it("toModelRow does not crash without cfg/authStore when availability is undefined", async () => {
    const row = toModelRow({
      model: makeGoogleAntigravityTemplate(
        "claude-opus-4-6-thinking",
        "Claude Opus 4.6 Thinking",
      ) as never,
      key: "google-antigravity/claude-opus-4-6-thinking",
      tags: [],
      availableKeys: undefined,
    });

    expect(row.missing).toBe(false);
    expect(row.available).toBe(false);
  });

  it("models list resolves antigravity opus 4.6 thinking from 4.5 template", async () => {
    loadConfig.mockReturnValue({
      agents: {
        defaults: {
          model: "google-antigravity/claude-opus-4-6-thinking",
          models: {
            "google-antigravity/claude-opus-4-6-thinking": {},
          },
        },
      },
    });
    const runtime = makeRuntime();

    modelRegistryState.models = [
      {
        provider: "google-antigravity",
        id: "claude-opus-4-5-thinking",
        name: "Claude Opus 4.5 Thinking",
        api: "google-gemini-cli",
        input: ["text", "image"],
        baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com",
        contextWindow: 200000,
        maxTokens: 64000,
        reasoning: true,
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
    ];
    modelRegistryState.available = [];

    const { modelsListCommand } = await import("./models/list.list-command.js");
    await modelsListCommand({ json: true }, runtime);

    expect(runtime.log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(runtime.log.mock.calls[0]?.[0]));
    expect(payload.models[0]?.key).toBe("google-antigravity/claude-opus-4-6-thinking");
    expect(payload.models[0]?.missing).toBe(false);
    expect(payload.models[0]?.tags).toContain("default");
    expect(payload.models[0]?.tags).toContain("configured");
  });

  it("models list resolves antigravity opus 4.6 (non-thinking) from 4.5 template", async () => {
    loadConfig.mockReturnValue({
      agents: {
        defaults: {
          model: "google-antigravity/claude-opus-4-6",
          models: {
            "google-antigravity/claude-opus-4-6": {},
          },
        },
      },
    });
    const runtime = makeRuntime();

    modelRegistryState.models = [
      {
        provider: "google-antigravity",
        id: "claude-opus-4-5",
        name: "Claude Opus 4.5",
        api: "google-gemini-cli",
        input: ["text", "image"],
        baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com",
        contextWindow: 200000,
        maxTokens: 64000,
        reasoning: true,
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
    ];
    modelRegistryState.available = [];

    const { modelsListCommand } = await import("./models/list.list-command.js");
    await modelsListCommand({ json: true }, runtime);

    expect(runtime.log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(runtime.log.mock.calls[0]?.[0]));
    expect(payload.models[0]?.key).toBe("google-antigravity/claude-opus-4-6");
    expect(payload.models[0]?.missing).toBe(false);
    expect(payload.models[0]?.tags).toContain("default");
    expect(payload.models[0]?.tags).toContain("configured");
  });

  it("models list marks synthesized antigravity opus 4.6 thinking as available when template is available", async () => {
    loadConfig.mockReturnValue({
      agents: {
        defaults: {
          model: "google-antigravity/claude-opus-4-6-thinking",
          models: {
            "google-antigravity/claude-opus-4-6-thinking": {},
          },
        },
      },
    });
    const runtime = makeRuntime();

    const template = {
      provider: "google-antigravity",
      id: "claude-opus-4-5-thinking",
      name: "Claude Opus 4.5 Thinking",
      api: "google-gemini-cli",
      input: ["text", "image"],
      baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com",
      contextWindow: 200000,
      maxTokens: 64000,
      reasoning: true,
      cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    };
    modelRegistryState.models = [template];
    modelRegistryState.available = [template];

    const { modelsListCommand } = await import("./models/list.list-command.js");
    await modelsListCommand({ json: true }, runtime);

    expect(runtime.log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(runtime.log.mock.calls[0]?.[0]));
    expect(payload.models[0]?.key).toBe("google-antigravity/claude-opus-4-6-thinking");
    expect(payload.models[0]?.missing).toBe(false);
    expect(payload.models[0]?.available).toBe(true);
  });

  it("models list marks synthesized antigravity opus 4.6 (non-thinking) as available when template is available", async () => {
    loadConfig.mockReturnValue({
      agents: {
        defaults: {
          model: "google-antigravity/claude-opus-4-6",
          models: {
            "google-antigravity/claude-opus-4-6": {},
          },
        },
      },
    });
    const runtime = makeRuntime();

    const template = {
      provider: "google-antigravity",
      id: "claude-opus-4-5",
      name: "Claude Opus 4.5",
      api: "google-gemini-cli",
      input: ["text", "image"],
      baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com",
      contextWindow: 200000,
      maxTokens: 64000,
      reasoning: true,
      cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    };
    modelRegistryState.models = [template];
    modelRegistryState.available = [template];

    const { modelsListCommand } = await import("./models/list.list-command.js");
    await modelsListCommand({ json: true }, runtime);

    expect(runtime.log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(runtime.log.mock.calls[0]?.[0]));
    expect(payload.models[0]?.key).toBe("google-antigravity/claude-opus-4-6");
    expect(payload.models[0]?.missing).toBe(false);
    expect(payload.models[0]?.available).toBe(true);
  });

  it("models list prefers registry availability over provider auth heuristics", async () => {
    loadConfig.mockReturnValue({
      agents: {
        defaults: {
          model: "google-antigravity/claude-opus-4-6-thinking",
          models: {
            "google-antigravity/claude-opus-4-6-thinking": {},
          },
        },
      },
    });
    listProfilesForProvider.mockImplementation((_: unknown, provider: string) =>
      provider === "google-antigravity"
        ? ([{ id: "profile-1" }] as Array<Record<string, unknown>>)
        : [],
    );
    const runtime = makeRuntime();

    const template = {
      provider: "google-antigravity",
      id: "claude-opus-4-5-thinking",
      name: "Claude Opus 4.5 Thinking",
      api: "google-gemini-cli",
      input: ["text", "image"],
      baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com",
      contextWindow: 200000,
      maxTokens: 64000,
      reasoning: true,
      cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    };
    modelRegistryState.models = [template];
    modelRegistryState.available = [];

    const { modelsListCommand } = await import("./models/list.list-command.js");
    await modelsListCommand({ json: true }, runtime);

    expect(runtime.log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(runtime.log.mock.calls[0]?.[0]));
    expect(payload.models[0]?.key).toBe("google-antigravity/claude-opus-4-6-thinking");
    expect(payload.models[0]?.missing).toBe(false);
    expect(payload.models[0]?.available).toBe(false);
    listProfilesForProvider.mockReturnValue([]);
  });

  it("models list falls back to auth heuristics when registry availability is unavailable", async () => {
    loadConfig.mockReturnValue({
      agents: {
        defaults: {
          model: "google-antigravity/claude-opus-4-6-thinking",
          models: {
            "google-antigravity/claude-opus-4-6-thinking": {},
          },
        },
      },
    });
    listProfilesForProvider.mockImplementation((_: unknown, provider: string) =>
      provider === "google-antigravity"
        ? ([{ id: "profile-1" }] as Array<Record<string, unknown>>)
        : [],
    );
    modelRegistryState.getAvailableError = Object.assign(
      new Error("availability unsupported: getAvailable failed"),
      { code: "MODEL_AVAILABILITY_UNAVAILABLE" },
    );
    const runtime = makeRuntime();

    modelRegistryState.models = [
      {
        provider: "google-antigravity",
        id: "claude-opus-4-5-thinking",
        name: "Claude Opus 4.5 Thinking",
        api: "google-gemini-cli",
        input: ["text", "image"],
        baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com",
        contextWindow: 200000,
        maxTokens: 64000,
        reasoning: true,
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
    ];
    modelRegistryState.available = [];

    const { modelsListCommand } = await import("./models/list.list-command.js");
    await modelsListCommand({ json: true }, runtime);

    expect(runtime.error).toHaveBeenCalledTimes(1);
    expect(runtime.error.mock.calls[0]?.[0]).toContain("falling back to auth heuristics");
    expect(runtime.error.mock.calls[0]?.[0]).toContain("getAvailable failed");
    expect(runtime.log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(runtime.log.mock.calls[0]?.[0]));
    expect(payload.models[0]?.key).toBe("google-antigravity/claude-opus-4-6-thinking");
    expect(payload.models[0]?.missing).toBe(false);
    expect(payload.models[0]?.available).toBe(true);
  });

  it("models list falls back to auth heuristics when getAvailable returns invalid shape", async () => {
    loadConfig.mockReturnValue({
      agents: {
        defaults: {
          model: "google-antigravity/claude-opus-4-6-thinking",
          models: {
            "google-antigravity/claude-opus-4-6-thinking": {},
          },
        },
      },
    });
    listProfilesForProvider.mockImplementation((_: unknown, provider: string) =>
      provider === "google-antigravity"
        ? ([{ id: "profile-1" }] as Array<Record<string, unknown>>)
        : [],
    );
    modelRegistryState.available = { bad: true } as unknown as Array<Record<string, unknown>>;
    const runtime = makeRuntime();

    modelRegistryState.models = [
      {
        provider: "google-antigravity",
        id: "claude-opus-4-5-thinking",
        name: "Claude Opus 4.5 Thinking",
        api: "google-gemini-cli",
        input: ["text", "image"],
        baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com",
        contextWindow: 200000,
        maxTokens: 64000,
        reasoning: true,
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
    ];

    const { modelsListCommand } = await import("./models/list.list-command.js");
    await modelsListCommand({ json: true }, runtime);

    expect(runtime.error).toHaveBeenCalledTimes(1);
    expect(runtime.error.mock.calls[0]?.[0]).toContain("falling back to auth heuristics");
    expect(runtime.error.mock.calls[0]?.[0]).toContain("non-array value");
    expect(runtime.log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(runtime.log.mock.calls[0]?.[0]));
    expect(payload.models[0]?.key).toBe("google-antigravity/claude-opus-4-6-thinking");
    expect(payload.models[0]?.missing).toBe(false);
    expect(payload.models[0]?.available).toBe(true);
  });

  it("models list falls back to auth heuristics when getAvailable throws", async () => {
    loadConfig.mockReturnValue({
      agents: {
        defaults: {
          model: "google-antigravity/claude-opus-4-6-thinking",
          models: {
            "google-antigravity/claude-opus-4-6-thinking": {},
          },
        },
      },
    });
    listProfilesForProvider.mockImplementation((_: unknown, provider: string) =>
      provider === "google-antigravity"
        ? ([{ id: "profile-1" }] as Array<Record<string, unknown>>)
        : [],
    );
    modelRegistryState.getAvailableError = new Error(
      "availability unsupported: getAvailable failed",
    );
    const runtime = makeRuntime();

    modelRegistryState.models = [
      {
        provider: "google-antigravity",
        id: "claude-opus-4-5-thinking",
        name: "Claude Opus 4.5 Thinking",
        api: "google-gemini-cli",
        input: ["text", "image"],
        baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com",
        contextWindow: 200000,
        maxTokens: 64000,
        reasoning: true,
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
    ];
    modelRegistryState.available = [];

    const { modelsListCommand } = await import("./models/list.list-command.js");
    await modelsListCommand({ json: true }, runtime);

    expect(runtime.error).toHaveBeenCalledTimes(1);
    expect(runtime.error.mock.calls[0]?.[0]).toContain("falling back to auth heuristics");
    expect(runtime.error.mock.calls[0]?.[0]).toContain(
      "availability unsupported: getAvailable failed",
    );
    expect(runtime.log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(runtime.log.mock.calls[0]?.[0]));
    expect(payload.models[0]?.key).toBe("google-antigravity/claude-opus-4-6-thinking");
    expect(payload.models[0]?.missing).toBe(false);
    expect(payload.models[0]?.available).toBe(true);
  });

  it("models list does not treat availability-unavailable code as discovery fallback", async () => {
    loadConfig.mockReturnValue({
      agents: {
        defaults: {
          model: "google-antigravity/claude-opus-4-6-thinking",
          models: {
            "google-antigravity/claude-opus-4-6-thinking": {},
          },
        },
      },
    });
    modelRegistryState.getAllError = Object.assign(new Error("model discovery failed"), {
      code: "MODEL_AVAILABILITY_UNAVAILABLE",
    });
    const runtime = makeRuntime();

    const { modelsListCommand } = await import("./models/list.list-command.js");
    await modelsListCommand({ json: true }, runtime);

    expect(runtime.error).toHaveBeenCalledTimes(1);
    expect(runtime.error.mock.calls[0]?.[0]).toContain("Model registry unavailable:");
    expect(runtime.error.mock.calls[0]?.[0]).toContain("model discovery failed");
    expect(runtime.error.mock.calls[0]?.[0]).not.toContain("configured models may appear missing");
    expect(runtime.log).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("models list fails fast when registry model discovery is unavailable", async () => {
    loadConfig.mockReturnValue({
      agents: {
        defaults: {
          model: "google-antigravity/claude-opus-4-6-thinking",
          models: {
            "google-antigravity/claude-opus-4-6-thinking": {},
          },
        },
      },
    });
    listProfilesForProvider.mockImplementation((_: unknown, provider: string) =>
      provider === "google-antigravity"
        ? ([{ id: "profile-1" }] as Array<Record<string, unknown>>)
        : [],
    );
    modelRegistryState.getAllError = Object.assign(new Error("model discovery unavailable"), {
      code: "MODEL_DISCOVERY_UNAVAILABLE",
    });
    const runtime = makeRuntime();

    modelRegistryState.models = [];
    modelRegistryState.available = [];

    const { modelsListCommand } = await import("./models/list.list-command.js");
    await modelsListCommand({ json: true }, runtime);

    expect(runtime.error).toHaveBeenCalledTimes(1);
    expect(runtime.error.mock.calls[0]?.[0]).toContain("Model registry unavailable:");
    expect(runtime.error.mock.calls[0]?.[0]).toContain("model discovery unavailable");
    expect(runtime.log).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("loadModelRegistry throws when model discovery is unavailable", async () => {
    modelRegistryState.getAllError = Object.assign(new Error("model discovery unavailable"), {
      code: "MODEL_DISCOVERY_UNAVAILABLE",
    });
    modelRegistryState.available = [
      {
        provider: "google-antigravity",
        id: "claude-opus-4-5-thinking",
        name: "Claude Opus 4.5 Thinking",
        api: "google-gemini-cli",
        input: ["text", "image"],
        baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com",
        contextWindow: 200000,
        maxTokens: 64000,
        reasoning: true,
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
    ];

    const { loadModelRegistry } = await import("./models/list.registry.js");
    await expect(loadModelRegistry({})).rejects.toThrow("model discovery unavailable");
  });

  it("toModelRow does not crash without cfg/authStore when availability is undefined", async () => {
    const { toModelRow } = await import("./models/list.registry.js");

    const row = toModelRow({
      model: {
        provider: "google-antigravity",
        id: "claude-opus-4-6-thinking",
        name: "Claude Opus 4.6 Thinking",
        api: "google-gemini-cli",
        input: ["text", "image"],
        baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com",
        contextWindow: 200000,
        maxTokens: 64000,
        reasoning: true,
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      key: "google-antigravity/claude-opus-4-6-thinking",
      tags: [],
      availableKeys: undefined,
    });

    expect(row.missing).toBe(false);
    expect(row.available).toBe(false);
  });
});
