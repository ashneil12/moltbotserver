import {
  getOAuthApiKey,
  getOAuthProviders,
  type OAuthCredentials,
  type OAuthProvider,
} from "@mariozechner/pi-ai";
import { loadConfig, type OpenClawConfig } from "../../config/config.js";
import { coerceSecretRef } from "../../config/types.secrets.js";
import { withFileLock } from "../../infra/file-lock.js";
import { refreshQwenPortalCredentials } from "../../providers/qwen-portal-oauth.js";
import { resolveSecretRefString, type SecretRefResolveCache } from "../../secrets/resolve.js";
import { refreshChutesTokens } from "../chutes-oauth.js";
import { AUTH_STORE_LOCK_OPTIONS, log } from "./constants.js";
import { formatAuthDoctorHint } from "./doctor.js";
import { ensureAuthStoreFile, resolveAuthStorePath } from "./paths.js";
import { suggestOAuthProfileIdForLegacyDefault } from "./repair.js";
import { ensureAuthProfileStore, saveAuthProfileStore } from "./store.js";
import type { AuthProfileStore } from "./types.js";

const OAUTH_PROVIDER_IDS = new Set<string>(getOAuthProviders().map((provider) => provider.id));

const isOAuthProvider = (provider: string): provider is OAuthProvider =>
  OAUTH_PROVIDER_IDS.has(provider);

const resolveOAuthProvider = (provider: string): OAuthProvider | null =>
  isOAuthProvider(provider) ? provider : null;

/** Bearer-token auth modes that are interchangeable (oauth tokens and raw tokens). */
const BEARER_AUTH_MODES = new Set(["oauth", "token"]);

const isCompatibleModeType = (mode: string | undefined, type: string | undefined): boolean => {
  if (!mode || !type) {
    return false;
  }
  if (mode === type) {
    return true;
  }
  // Both token and oauth represent bearer-token auth paths — allow bidirectional compat.
  return BEARER_AUTH_MODES.has(mode) && BEARER_AUTH_MODES.has(type);
};

function isProfileConfigCompatible(params: {
  cfg?: OpenClawConfig;
  profileId: string;
  provider: string;
  mode: "api_key" | "token" | "oauth";
  allowOAuthTokenCompatibility?: boolean;
}): boolean {
  const profileConfig = params.cfg?.auth?.profiles?.[params.profileId];
  if (profileConfig && profileConfig.provider !== params.provider) {
    return false;
  }
  if (profileConfig && !isCompatibleModeType(profileConfig.mode, params.mode)) {
    return false;
  }
  return true;
}

function buildOAuthApiKey(provider: string, credentials: OAuthCredentials): string {
  const needsProjectId = provider === "google-gemini-cli";
  return needsProjectId
    ? JSON.stringify({
        token: credentials.access,
        projectId: credentials.projectId,
      })
    : credentials.access;
}

function buildApiKeyProfileResult(params: { apiKey: string; provider: string; email?: string }) {
  return {
    apiKey: params.apiKey,
    provider: params.provider,
    email: params.email,
  };
}

function buildOAuthProfileResult(params: {
  provider: string;
  credentials: OAuthCredentials;
  email?: string;
}) {
  return buildApiKeyProfileResult({
    apiKey: buildOAuthApiKey(params.provider, params.credentials),
    provider: params.provider,
    email: params.email,
  });
}

function isExpiredCredential(expires: number | undefined): boolean {
  return (
    typeof expires === "number" && Number.isFinite(expires) && expires > 0 && Date.now() >= expires
  );
}

type ResolveApiKeyForProfileParams = {
  cfg?: OpenClawConfig;
  store: AuthProfileStore;
  profileId: string;
  agentDir?: string;
};

type SecretDefaults = NonNullable<OpenClawConfig["secrets"]>["defaults"];

async function refreshOAuthTokenWithLock(params: {
  profileId: string;
  agentDir?: string;
}): Promise<{ apiKey: string; newCredentials: OAuthCredentials } | null> {
  const authPath = resolveAuthStorePath(params.agentDir);
  ensureAuthStoreFile(authPath);

  return await withFileLock(authPath, AUTH_STORE_LOCK_OPTIONS, async () => {
    const store = ensureAuthProfileStore(params.agentDir);
    const cred = store.profiles[params.profileId];
    if (!cred || cred.type !== "oauth") {
      return null;
    }

    if (Date.now() < cred.expires) {
      return {
        apiKey: buildOAuthApiKey(cred.provider, cred),
        newCredentials: cred,
      };
    }

    const oauthCreds: Record<string, OAuthCredentials> = {
      [cred.provider]: cred,
    };

    const result =
      String(cred.provider) === "chutes"
        ? await (async () => {
            const newCredentials = await refreshChutesTokens({
              credential: cred,
            });
            return { apiKey: newCredentials.access, newCredentials };
          })()
        : String(cred.provider) === "qwen-portal"
          ? await (async () => {
              const newCredentials = await refreshQwenPortalCredentials(cred);
              return { apiKey: newCredentials.access, newCredentials };
            })()
          : await (async () => {
              const oauthProvider = resolveOAuthProvider(cred.provider);
              if (!oauthProvider) {
                return null;
              }
              return await getOAuthApiKey(oauthProvider, oauthCreds);
            })();
    if (!result) {
      return null;
    }
    store.profiles[params.profileId] = {
      ...cred,
      ...result.newCredentials,
      type: "oauth",
    };
    saveAuthProfileStore(store, params.agentDir);

    return result;
  });
}

async function tryResolveOAuthProfile(
  params: ResolveApiKeyForProfileParams,
): Promise<{ apiKey: string; provider: string; email?: string } | null> {
  const { cfg, store, profileId } = params;
  const cred = store.profiles[profileId];
  if (!cred || cred.type !== "oauth") {
    return null;
  }
  if (
    !isProfileConfigCompatible({
      cfg,
      profileId,
      provider: cred.provider,
      mode: cred.type,
    })
  ) {
    return null;
  }

  if (Date.now() < cred.expires) {
    return buildOAuthProfileResult({
      provider: cred.provider,
      credentials: cred,
      email: cred.email,
    });
  }

  const refreshed = await refreshOAuthTokenWithLock({
    profileId,
    agentDir: params.agentDir,
  });
  if (!refreshed) {
    return null;
  }
  return buildApiKeyProfileResult({
    apiKey: refreshed.apiKey,
    provider: cred.provider,
    email: cred.email,
  });
}

async function resolveProfileSecretString(params: {
  profileId: string;
  provider: string;
  value: string | undefined;
  valueRef: unknown;
  refDefaults: SecretDefaults | undefined;
  configForRefResolution: OpenClawConfig;
  cache: SecretRefResolveCache;
  inlineFailureMessage: string;
  refFailureMessage: string;
}): Promise<string | undefined> {
  let resolvedValue = params.value?.trim();
  if (resolvedValue) {
    const inlineRef = coerceSecretRef(resolvedValue, params.refDefaults);
    if (inlineRef) {
      try {
        resolvedValue = await resolveSecretRefString(inlineRef, {
          config: params.configForRefResolution,
          env: process.env,
          cache: params.cache,
        });
      } catch (err) {
        log.debug(params.inlineFailureMessage, {
          profileId: params.profileId,
          provider: params.provider,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const explicitRef = coerceSecretRef(params.valueRef, params.refDefaults);
  if (!resolvedValue && explicitRef) {
    try {
      resolvedValue = await resolveSecretRefString(explicitRef, {
        config: params.configForRefResolution,
        env: process.env,
        cache: params.cache,
      });
    } catch (err) {
      log.debug(params.refFailureMessage, {
        profileId: params.profileId,
        provider: params.provider,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return resolvedValue;
}

export async function resolveApiKeyForProfile(
  params: ResolveApiKeyForProfileParams,
): Promise<{ apiKey: string; provider: string; email?: string } | null> {
  const { cfg, store, profileId } = params;
  const cred = store.profiles[profileId];
  if (!cred) {
    return null;
  }
  if (
    !isProfileConfigCompatible({
      cfg,
      profileId,
      provider: cred.provider,
      mode: cred.type,
      // Compatibility: treat "oauth" config as compatible with stored token profiles.
      allowOAuthTokenCompatibility: true,
    })
  ) {
    return null;
  }

  const refResolveCache: SecretRefResolveCache = {};
  const configForRefResolution = cfg ?? loadConfig();
  const refDefaults = configForRefResolution.secrets?.defaults;

  if (cred.type === "api_key") {
    const key = await resolveProfileSecretString({
      profileId,
      provider: cred.provider,
      value: cred.key,
      valueRef: cred.keyRef,
      refDefaults,
      configForRefResolution,
      cache: refResolveCache,
      inlineFailureMessage: "failed to resolve inline auth profile api_key ref",
      refFailureMessage: "failed to resolve auth profile api_key ref",
    });
    if (!key) {
      return null;
    }
    return buildApiKeyProfileResult({ apiKey: key, provider: cred.provider, email: cred.email });
  }
  if (cred.type === "token") {
    const token = await resolveProfileSecretString({
      profileId,
      provider: cred.provider,
      value: cred.token,
      valueRef: cred.tokenRef,
      refDefaults,
      configForRefResolution,
      cache: refResolveCache,
      inlineFailureMessage: "failed to resolve inline auth profile token ref",
      refFailureMessage: "failed to resolve auth profile token ref",
    });
    if (!token) {
      return null;
    }
    if (isExpiredCredential(cred.expires)) {
      return null;
    }
    return buildApiKeyProfileResult({ apiKey: token, provider: cred.provider, email: cred.email });
  }

  // Per-agent isolation: use this agent's own credential only.
  // (adoptNewerMainOAuthCredential was removed — it replaced per-agent tokens with
  // main's whenever main was fresher, breaking per-agent OAuth isolation.)
  if (Date.now() < cred.expires) {
    return buildOAuthProfileResult({
      provider: cred.provider,
      credentials: cred,
      email: cred.email,
    });
  }

  try {
    const result = await refreshOAuthTokenWithLock({
      profileId,
      agentDir: params.agentDir,
    });
    if (!result) {
      return null;
    }
    return buildApiKeyProfileResult({
      apiKey: result.apiKey,
      provider: cred.provider,
      email: cred.email,
    });
  } catch (error) {
    const refreshedStore = ensureAuthProfileStore(params.agentDir);
    const refreshed = refreshedStore.profiles[profileId];
    if (refreshed?.type === "oauth" && Date.now() < refreshed.expires) {
      return buildOAuthProfileResult({
        provider: refreshed.provider,
        credentials: refreshed,
        email: refreshed.email ?? cred.email,
      });
    }
    const fallbackProfileId = suggestOAuthProfileIdForLegacyDefault({
      cfg,
      store: refreshedStore,
      provider: cred.provider,
      legacyProfileId: profileId,
    });
    if (fallbackProfileId && fallbackProfileId !== profileId) {
      try {
        const fallbackResolved = await tryResolveOAuthProfile({
          cfg,
          store: refreshedStore,
          profileId: fallbackProfileId,
          agentDir: params.agentDir,
        });
        if (fallbackResolved) {
          return fallbackResolved;
        }
      } catch {
        // keep original error
      }
    }

    // Per-agent isolation: do NOT fall back to main agent's credentials.
    // Each agent must be authenticated independently. If refresh fails, surface
    // the error clearly so the operator can re-auth the specific agent.
    const message = error instanceof Error ? error.message : String(error);
    const hint = formatAuthDoctorHint({
      cfg,
      store: refreshedStore,
      provider: cred.provider,
      profileId,
    });
    throw new Error(
      `OAuth token refresh failed for ${cred.provider}: ${message}. ` +
        "Please try again or re-authenticate." +
        (hint ? `\n\n${hint}` : ""),
      { cause: error },
    );
  }
}
