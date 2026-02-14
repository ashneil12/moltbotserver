<<<<<<< HEAD
=======
import type { OpenClawConfig } from "../config/config.js";
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
import {
  buildCloudflareAiGatewayModelDefinition,
  resolveCloudflareAiGatewayBaseUrl,
} from "../agents/cloudflare-ai-gateway.js";
<<<<<<< HEAD
import type { OpenClawConfig } from "../config/config.js";
import {
  applyAgentDefaultModelPrimary,
  applyProviderConfigWithDefaultModel,
} from "./onboard-auth.config-shared.js";
=======
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
import {
  CLOUDFLARE_AI_GATEWAY_DEFAULT_MODEL_REF,
  VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF,
} from "./onboard-auth.credentials.js";

export function applyVercelAiGatewayProviderConfig(cfg: OpenClawConfig): OpenClawConfig {
  const models = { ...cfg.agents?.defaults?.models };
  models[VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF] = {
    ...models[VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF],
    alias: models[VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF]?.alias ?? "Vercel AI Gateway",
  };

  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        models,
      },
    },
  };
}

export function applyCloudflareAiGatewayProviderConfig(
  cfg: OpenClawConfig,
  params?: { accountId?: string; gatewayId?: string },
): OpenClawConfig {
  const models = { ...cfg.agents?.defaults?.models };
  models[CLOUDFLARE_AI_GATEWAY_DEFAULT_MODEL_REF] = {
    ...models[CLOUDFLARE_AI_GATEWAY_DEFAULT_MODEL_REF],
    alias: models[CLOUDFLARE_AI_GATEWAY_DEFAULT_MODEL_REF]?.alias ?? "Cloudflare AI Gateway",
  };

<<<<<<< HEAD
  const defaultModel = buildCloudflareAiGatewayModelDefinition();
  const existingProvider = cfg.models?.providers?.["cloudflare-ai-gateway"] as
    | { baseUrl?: unknown }
    | undefined;
=======
  const providers = { ...cfg.models?.providers };
  const existingProvider = providers["cloudflare-ai-gateway"];
  const existingModels = Array.isArray(existingProvider?.models) ? existingProvider.models : [];
  const defaultModel = buildCloudflareAiGatewayModelDefinition();
  const hasDefaultModel = existingModels.some((model) => model.id === defaultModel.id);
  const mergedModels = hasDefaultModel ? existingModels : [...existingModels, defaultModel];
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  const baseUrl =
    params?.accountId && params?.gatewayId
      ? resolveCloudflareAiGatewayBaseUrl({
          accountId: params.accountId,
          gatewayId: params.gatewayId,
        })
<<<<<<< HEAD
      : typeof existingProvider?.baseUrl === "string"
        ? existingProvider.baseUrl
        : undefined;
=======
      : existingProvider?.baseUrl;
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

  if (!baseUrl) {
    return {
      ...cfg,
      agents: {
        ...cfg.agents,
        defaults: {
          ...cfg.agents?.defaults,
          models,
        },
      },
    };
  }

<<<<<<< HEAD
  return applyProviderConfigWithDefaultModel(cfg, {
    agentModels: models,
    providerId: "cloudflare-ai-gateway",
    api: "anthropic-messages",
    baseUrl,
    defaultModel,
  });
=======
  const { apiKey: existingApiKey, ...existingProviderRest } = (existingProvider ?? {}) as Record<
    string,
    unknown
  > as { apiKey?: string };
  const resolvedApiKey = typeof existingApiKey === "string" ? existingApiKey : undefined;
  const normalizedApiKey = resolvedApiKey?.trim();
  providers["cloudflare-ai-gateway"] = {
    ...existingProviderRest,
    baseUrl,
    api: "anthropic-messages",
    ...(normalizedApiKey ? { apiKey: normalizedApiKey } : {}),
    models: mergedModels.length > 0 ? mergedModels : [defaultModel],
  };

  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        models,
      },
    },
    models: {
      mode: cfg.models?.mode ?? "merge",
      providers,
    },
  };
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
}

export function applyVercelAiGatewayConfig(cfg: OpenClawConfig): OpenClawConfig {
  const next = applyVercelAiGatewayProviderConfig(cfg);
<<<<<<< HEAD
  return applyAgentDefaultModelPrimary(next, VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF);
=======
  const existingModel = next.agents?.defaults?.model;
  return {
    ...next,
    agents: {
      ...next.agents,
      defaults: {
        ...next.agents?.defaults,
        model: {
          ...(existingModel && "fallbacks" in (existingModel as Record<string, unknown>)
            ? {
                fallbacks: (existingModel as { fallbacks?: string[] }).fallbacks,
              }
            : undefined),
          primary: VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF,
        },
      },
    },
  };
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
}

export function applyCloudflareAiGatewayConfig(
  cfg: OpenClawConfig,
  params?: { accountId?: string; gatewayId?: string },
): OpenClawConfig {
  const next = applyCloudflareAiGatewayProviderConfig(cfg, params);
<<<<<<< HEAD
  return applyAgentDefaultModelPrimary(next, CLOUDFLARE_AI_GATEWAY_DEFAULT_MODEL_REF);
=======
  const existingModel = next.agents?.defaults?.model;
  return {
    ...next,
    agents: {
      ...next.agents,
      defaults: {
        ...next.agents?.defaults,
        model: {
          ...(existingModel && "fallbacks" in (existingModel as Record<string, unknown>)
            ? {
                fallbacks: (existingModel as { fallbacks?: string[] }).fallbacks,
              }
            : undefined),
          primary: CLOUDFLARE_AI_GATEWAY_DEFAULT_MODEL_REF,
        },
      },
    },
  };
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
}
