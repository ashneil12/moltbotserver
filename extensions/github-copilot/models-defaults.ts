import type { ModelDefinitionConfig } from "openclaw/plugin-sdk/provider-models";

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8192;

// Copilot model ids vary by plan/org and can change.
// We keep this list intentionally broad; if a model isn't available Copilot will
// return an error and users can remove it from their config.
const DEFAULT_MODEL_IDS = [
  // OpenAI
  "gpt-4o",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5.2",
  "gpt-5.3-codex",
  "gpt-5.4",
  "o1",
  "o1-mini",
  "o3",
  "o3-mini",
  "o4-mini",
  // Anthropic — GitHub Copilot uses dot notation (e.g. claude-haiku-4.5)
  // Dash aliases kept for forward-compat with existing agent configs
  "claude-haiku-4.5",
  "claude-haiku-4-5", // alias: same model, dash form used by some configs
  "claude-sonnet-4.5",
  "claude-sonnet-4-5", // alias
  "claude-sonnet-4.6",
  "claude-sonnet-4-6", // alias
  "claude-opus-4.5",
  "claude-opus-4-5", // alias
  "claude-opus-4.6",
  "claude-opus-4-6", // alias
  // Google
  "gemini-2.5-pro",
  "gemini-3-flash",
  "gemini-3-pro",
  "gemini-3.1-pro",
] as const;

export function getDefaultCopilotModelIds(): string[] {
  return [...DEFAULT_MODEL_IDS];
}

export function buildCopilotModelDefinition(modelId: string): ModelDefinitionConfig {
  const id = modelId.trim();
  if (!id) {
    throw new Error("Model id required");
  }
  return {
    id,
    name: id,
    // pi-coding-agent's registry schema doesn't know about a "github-copilot" API.
    // We use OpenAI-compatible responses API, while keeping the provider id as
    // "github-copilot" (pi-ai uses that to attach Copilot-specific headers).
    api: "openai-responses",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}
