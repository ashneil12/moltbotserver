<<<<<<< HEAD
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAgentModelPrimaryValue } from "../config/model-input.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { applyAuthChoiceHuggingface } from "./auth-choice.apply.huggingface.js";
import {
  createAuthTestLifecycle,
  createExitThrowingRuntime,
  createWizardPrompter,
  readAuthProfilesForAgent,
  setupAuthTestEnv,
} from "./test-wizard-helpers.js";

function createHuggingfacePrompter(params: {
  text: WizardPrompter["text"];
  select: WizardPrompter["select"];
  confirm?: WizardPrompter["confirm"];
  note?: WizardPrompter["note"];
}): WizardPrompter {
  const overrides: Partial<WizardPrompter> = {
    text: params.text,
    select: params.select,
  };
  if (params.confirm) {
    overrides.confirm = params.confirm;
  }
  if (params.note) {
    overrides.note = params.note;
  }
  return createWizardPrompter(overrides, { defaultSelect: "" });
}

describe("applyAuthChoiceHuggingface", () => {
  const lifecycle = createAuthTestLifecycle([
    "OPENCLAW_STATE_DIR",
    "OPENCLAW_AGENT_DIR",
    "PI_CODING_AGENT_DIR",
    "HF_TOKEN",
    "HUGGINGFACE_HUB_TOKEN",
  ]);

  async function setupTempState() {
    const env = await setupAuthTestEnv("openclaw-hf-");
    lifecycle.setStateDir(env.stateDir);
    return env.agentDir;
  }

  async function readAuthProfiles(agentDir: string) {
    return await readAuthProfilesForAgent<{
      profiles?: Record<string, { key?: string }>;
    }>(agentDir);
  }

  afterEach(async () => {
    await lifecycle.cleanup();
=======
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { applyAuthChoiceHuggingface } from "./auth-choice.apply.huggingface.js";

const noopAsync = async () => {};
const noop = () => {};
const authProfilePathFor = (agentDir: string) => path.join(agentDir, "auth-profiles.json");

describe("applyAuthChoiceHuggingface", () => {
  const previousAgentDir = process.env.OPENCLAW_AGENT_DIR;
  const previousHfToken = process.env.HF_TOKEN;
  const previousHubToken = process.env.HUGGINGFACE_HUB_TOKEN;
  let tempStateDir: string | null = null;

  afterEach(async () => {
    if (tempStateDir) {
      await fs.rm(tempStateDir, { recursive: true, force: true });
      tempStateDir = null;
    }
    if (previousAgentDir === undefined) {
      delete process.env.OPENCLAW_AGENT_DIR;
    } else {
      process.env.OPENCLAW_AGENT_DIR = previousAgentDir;
    }
    if (previousHfToken === undefined) {
      delete process.env.HF_TOKEN;
    } else {
      process.env.HF_TOKEN = previousHfToken;
    }
    if (previousHubToken === undefined) {
      delete process.env.HUGGINGFACE_HUB_TOKEN;
    } else {
      process.env.HUGGINGFACE_HUB_TOKEN = previousHubToken;
    }
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  });

  it("returns null when authChoice is not huggingface-api-key", async () => {
    const result = await applyAuthChoiceHuggingface({
      authChoice: "openrouter-api-key",
      config: {},
      prompter: {} as WizardPrompter,
<<<<<<< HEAD
      runtime: createExitThrowingRuntime(),
=======
      runtime: {} as RuntimeEnv,
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
      setDefaultModel: false,
    });
    expect(result).toBeNull();
  });

  it("prompts for key and model, then writes config and auth profile", async () => {
<<<<<<< HEAD
    const agentDir = await setupTempState();
=======
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hf-"));
    const agentDir = path.join(tempStateDir, "agent");
    process.env.OPENCLAW_AGENT_DIR = agentDir;
    await fs.mkdir(agentDir, { recursive: true });
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

    const text = vi.fn().mockResolvedValue("hf-test-token");
    const select: WizardPrompter["select"] = vi.fn(
      async (params) => params.options?.[0]?.value as never,
    );
<<<<<<< HEAD
    const prompter = createHuggingfacePrompter({ text, select });
    const runtime = createExitThrowingRuntime();
=======
    const prompter: WizardPrompter = {
      intro: vi.fn(noopAsync),
      outro: vi.fn(noopAsync),
      note: vi.fn(noopAsync),
      select,
      multiselect: vi.fn(async () => []),
      text,
      confirm: vi.fn(async () => false),
      progress: vi.fn(() => ({ update: noop, stop: noop })),
    };
    const runtime: RuntimeEnv = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code: number) => {
        throw new Error(`exit:${code}`);
      }),
    };
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

    const result = await applyAuthChoiceHuggingface({
      authChoice: "huggingface-api-key",
      config: {},
      prompter,
      runtime,
      setDefaultModel: true,
    });

    expect(result).not.toBeNull();
    expect(result?.config.auth?.profiles?.["huggingface:default"]).toMatchObject({
      provider: "huggingface",
      mode: "api_key",
    });
<<<<<<< HEAD
    expect(resolveAgentModelPrimaryValue(result?.config.agents?.defaults?.model)).toMatch(
      /^huggingface\/.+/,
    );
=======
    expect(result?.config.agents?.defaults?.model?.primary).toMatch(/^huggingface\/.+/);
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Hugging Face") }),
    );
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Default Hugging Face model" }),
    );

<<<<<<< HEAD
    const parsed = await readAuthProfiles(agentDir);
    expect(parsed.profiles?.["huggingface:default"]?.key).toBe("hf-test-token");
  });

  it.each([
    {
      caseName: "does not prompt to reuse env token when opts.token already provided",
      tokenProvider: "huggingface",
      token: "hf-opts-token",
      envToken: "hf-env-token",
    },
    {
      caseName: "accepts mixed-case tokenProvider from opts without prompting",
      tokenProvider: "  HuGgInGfAcE  ",
      token: "hf-opts-mixed",
      envToken: undefined,
    },
  ])("$caseName", async ({ tokenProvider, token, envToken }) => {
    const agentDir = await setupTempState();
    if (envToken) {
      process.env.HF_TOKEN = envToken;
    } else {
      delete process.env.HF_TOKEN;
    }
    delete process.env.HUGGINGFACE_HUB_TOKEN;
=======
    const authProfilePath = authProfilePathFor(agentDir);
    const raw = await fs.readFile(authProfilePath, "utf8");
    const parsed = JSON.parse(raw) as {
      profiles?: Record<string, { key?: string }>;
    };
    expect(parsed.profiles?.["huggingface:default"]?.key).toBe("hf-test-token");
  });

  it("does not prompt to reuse env token when opts.token already provided", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hf-"));
    const agentDir = path.join(tempStateDir, "agent");
    process.env.OPENCLAW_AGENT_DIR = agentDir;
    process.env.HF_TOKEN = "hf-env-token";
    delete process.env.HUGGINGFACE_HUB_TOKEN;
    await fs.mkdir(agentDir, { recursive: true });
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

    const text = vi.fn().mockResolvedValue("hf-text-token");
    const select: WizardPrompter["select"] = vi.fn(
      async (params) => params.options?.[0]?.value as never,
    );
    const confirm = vi.fn(async () => true);
<<<<<<< HEAD
    const prompter = createHuggingfacePrompter({ text, select, confirm });
    const runtime = createExitThrowingRuntime();
=======
    const prompter: WizardPrompter = {
      intro: vi.fn(noopAsync),
      outro: vi.fn(noopAsync),
      note: vi.fn(noopAsync),
      select,
      multiselect: vi.fn(async () => []),
      text,
      confirm,
      progress: vi.fn(() => ({ update: noop, stop: noop })),
    };
    const runtime: RuntimeEnv = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code: number) => {
        throw new Error(`exit:${code}`);
      }),
    };
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

    const result = await applyAuthChoiceHuggingface({
      authChoice: "huggingface-api-key",
      config: {},
      prompter,
      runtime,
      setDefaultModel: true,
      opts: {
<<<<<<< HEAD
        tokenProvider,
        token,
=======
        tokenProvider: "huggingface",
        token: "hf-opts-token",
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
      },
    });

    expect(result).not.toBeNull();
    expect(confirm).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();

<<<<<<< HEAD
    const parsed = await readAuthProfiles(agentDir);
    expect(parsed.profiles?.["huggingface:default"]?.key).toBe(token);
  });

  it("notes when selected Hugging Face model uses a locked router policy", async () => {
    await setupTempState();
    delete process.env.HF_TOKEN;
    delete process.env.HUGGINGFACE_HUB_TOKEN;

    const text = vi.fn().mockResolvedValue("hf-test-token");
    const select: WizardPrompter["select"] = vi.fn(async (params) => {
      const options = (params.options ?? []) as Array<{ value: string }>;
      const cheapest = options.find((option) => option.value.endsWith(":cheapest"));
      return (cheapest?.value ?? options[0]?.value ?? "") as never;
    });
    const note: WizardPrompter["note"] = vi.fn(async () => {});
    const prompter = createHuggingfacePrompter({ text, select, note });
    const runtime = createExitThrowingRuntime();

    const result = await applyAuthChoiceHuggingface({
      authChoice: "huggingface-api-key",
      config: {},
      prompter,
      runtime,
      setDefaultModel: true,
    });

    expect(result).not.toBeNull();
    expect(String(resolveAgentModelPrimaryValue(result?.config.agents?.defaults?.model))).toContain(
      ":cheapest",
    );
    expect(note).toHaveBeenCalledWith(
      "Provider locked — router will choose backend by cost or speed.",
      "Hugging Face",
    );
=======
    const authProfilePath = authProfilePathFor(agentDir);
    const raw = await fs.readFile(authProfilePath, "utf8");
    const parsed = JSON.parse(raw) as {
      profiles?: Record<string, { key?: string }>;
    };
    expect(parsed.profiles?.["huggingface:default"]?.key).toBe("hf-opts-token");
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  });
});
