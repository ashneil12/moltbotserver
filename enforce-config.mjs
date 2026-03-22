#!/usr/bin/env node
// =============================================================================
// enforce-config.mjs — Container-startup config enforcer
//
// Replaces the inline `node -e` scripts in docker-entrypoint.sh with a
// single, testable, typed module. Run via:
//
//   node enforce-config.mjs <command> [options]
//
// Commands:
//   models              Enforce model settings (primary, heartbeat, subagent, fallbacks)
//   gateway             Enforce gateway token
//   proxies             Enforce trustedProxies CIDR ranges
//   memory              Enforce memory backend + embedding provider settings
//   core                Enforce core runtime settings (gateway port/bind, compaction, etc.)
//   cron-seed           Seed default cron jobs (only if jobs.json doesn't exist)
//   browser-profiles    Seed browser profiles for each agent
//   providers           Register third-party model providers (e.g. Bailian)
//   lcm                 Ensure Lossless Claw (LCM) context engine plugin is installed
//   all                 Run all enforcement steps in the correct order
//
// Architecture:
//   Shared helpers  → enforce-config-helpers.mjs  (readConfig, writeConfig, etc.)
//   Model normalize → enforce-config-models.mjs   (normalizeModelId, CANONICAL_MODEL_IDS)
//   Enforcement     → this file                   (enforceModels, enforceCore, etc.)
// =============================================================================

import { execSync } from "node:child_process";
import {
  writeFileSync,
  readFileSync,
  cpSync,
  mkdirSync,
  existsSync,
  chmodSync,
  readdirSync,
  statSync,
  rmSync,
  symlinkSync,
  readlinkSync,
} from "node:fs";
import { dirname } from "node:path";
// ── Extracted modules ───────────────────────────────────────────────────────
import {
  readConfig,
  writeConfig,
  ensure,
  makeId,
  env,
  isTruthy,
  repairConfig,
  backupConfig,
  resolveReflectionIntervals,
} from "./enforce-config-helpers.mjs";
import { normalizeModelId } from "./enforce-config-models.mjs";

// ── Bailian Provider (Alibaba Cloud Coding Plan) ────────────────────────────

/** All 8 models available under the Bailian Coding Plan. */
const BAILIAN_MODELS = [
  {
    id: "qwen3.5-plus",
    name: "qwen3.5-plus",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 65536,
  },
  {
    id: "qwen3-max-2026-01-23",
    name: "qwen3-max-2026-01-23",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 65536,
  },
  {
    id: "qwen3-coder-next",
    name: "qwen3-coder-next",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 65536,
  },
  {
    id: "qwen3-coder-plus",
    name: "qwen3-coder-plus",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 65536,
  },
  {
    id: "MiniMax-M2.5",
    name: "MiniMax-M2.5",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 65536,
  },
  {
    id: "glm-5",
    name: "glm-5",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 202752,
    maxTokens: 16384,
  },
  {
    id: "glm-4.7",
    name: "glm-4.7",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 202752,
    maxTokens: 16384,
  },
  {
    id: "kimi-k2.5",
    name: "kimi-k2.5",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 32768,
  },
];

/**
 * Register third-party model providers in openclaw.json.
 *
 * Currently handles:
 * - **Bailian** (Alibaba Cloud Coding Plan) when BAILIAN_API_KEY is set
 *
 * Idempotent: skips registration if a provider already exists (won't overwrite
 * manual config).
 */
function enforceProviders(configPath) {
  const config = readConfig(configPath);
  const models = ensure(config, "models");
  models.mode = models.mode || "merge";
  const providers = ensure(models, "providers");
  const defaults = ensure(config, "agents", "defaults");
  defaults.models = defaults.models || {};

  // ── Bailian ───────────────────────────────────────────────────────────
  const bailianKey = env("BAILIAN_API_KEY");
  if (bailianKey) {
    if (providers.bailian) {
      console.log("[enforce-config] Bailian provider already configured — skipping registration");
    } else {
      providers.bailian = {
        baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1",
        apiKey: bailianKey,
        api: "openai-completions",
        models: BAILIAN_MODELS,
      };
      console.log(
        `[enforce-config] ✅ Bailian provider registered (${BAILIAN_MODELS.length} models)`,
      );
    }

    // Wire all Bailian models into agents.defaults.models for /model switching
    for (const model of BAILIAN_MODELS) {
      const ref = `bailian/${model.id}`;
      if (!defaults.models[ref]) {
        defaults.models[ref] = {};
      }
    }
  }

  if (bailianKey) {
    writeConfig(configPath, config);
  }
}

// ── Enforcement Commands ────────────────────────────────────────────────────

function enforceModels(configPath) {
  const config = readConfig(configPath);
  const defaults = ensure(config, "agents", "defaults");
  defaults.model = defaults.model || {};

  const defaultModel = normalizeModelId(env("OPENCLAW_DEFAULT_MODEL") || env("DEFAULT_MODEL"));
  const heartbeatModel = normalizeModelId(
    env("OPENCLAW_HEARTBEAT_MODEL") || env("HEARTBEAT_MODEL"),
  );
  const subagentModel = normalizeModelId(
    env("OPENCLAW_SUBAGENT_MODEL", "deepseek/deepseek-reasoner"),
  );

  if (defaultModel) {
    defaults.model.primary = defaultModel;
  }
  if (heartbeatModel) {
    defaults.heartbeat = defaults.heartbeat || {};
    defaults.heartbeat.model = heartbeatModel;
  }
  if (subagentModel) {
    defaults.subagents = defaults.subagents || {};
    defaults.subagents.model = subagentModel;
  }

  // Fallback models
  const fallbacksRaw = env("OPENCLAW_FALLBACK_MODELS");
  if (fallbacksRaw) {
    const fallbacks = fallbacksRaw
      .split(",")
      .map((s) => normalizeModelId(s.trim()))
      .filter(Boolean);
    if (fallbacks.length > 0) {
      defaults.model.fallbacks = fallbacks;
    }
  }

  // Deduplicate: remove the primary model from fallbacks to avoid
  // retrying the same endpoint that just failed.
  if (defaults.model.primary && Array.isArray(defaults.model.fallbacks)) {
    const primary = defaults.model.primary;
    const before = defaults.model.fallbacks.length;
    defaults.model.fallbacks = defaults.model.fallbacks.filter((fb) => fb !== primary);
    if (defaults.model.fallbacks.length < before) {
      console.log(
        `[enforce-config] Removed primary model ${primary} from fallbacks (was duplicated)`,
      );
    }
  }

  // Per-agent model overrides from dashboard (JSON: {"main":"provider/model",...})
  const agentModelsRaw = env("OPENCLAW_AGENT_MODELS");
  if (agentModelsRaw) {
    try {
      const agentModels = JSON.parse(agentModelsRaw);
      const list = (config.agents.list = config.agents.list || []);
      for (const [agentId, rawRef] of Object.entries(agentModels)) {
        if (!rawRef || typeof rawRef !== "string") {
          continue;
        }
        const normalized = normalizeModelId(rawRef);
        const existing = list.find((a) => a.id === agentId);
        if (existing) {
          // Merge: set/override primary, preserve other fields (fallbacks, etc.)
          existing.model =
            typeof existing.model === "object"
              ? { ...existing.model, primary: normalized }
              : { primary: normalized };
        } else {
          list.push({ id: agentId, model: { primary: normalized } });
        }
      }
      console.log(
        `[enforce-config] Per-agent model overrides applied: ${Object.keys(agentModels).join(", ")}`,
      );
    } catch {
      console.warn("[enforce-config] ⚠ OPENCLAW_AGENT_MODELS is not valid JSON — skipping");
    }
  }

  writeConfig(configPath, config);
  console.log("[enforce-config] ✅ Model settings enforced");
}

function enforceGateway(configPath) {
  const gatewayToken = env("GATEWAY_TOKEN");
  if (!gatewayToken) {
    return;
  }

  const config = readConfig(configPath);
  ensure(config, "gateway");
  config.gateway.auth = {
    mode: "token",
    token: gatewayToken,
    rateLimit: {
      maxAttempts: 10,
      windowMs: 60000, // 1 minute window
      lockoutMs: 300000, // 5 minute lockout after max attempts
    },
  };

  writeConfig(configPath, config);
  console.log("[enforce-config] ✅ Gateway token enforced");
}

function enforceProxies(configPath) {
  const config = readConfig(configPath);
  ensure(config, "gateway");
  config.gateway.trustedProxies = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"];

  writeConfig(configPath, config);
  console.log("[enforce-config] ✅ Trusted proxies enforced");
}

function enforceMemory(configPath) {
  const config = readConfig(configPath);
  const memory = ensure(config, "memory");
  memory.citations = "auto";

  // Memory search common settings (always enforced regardless of backend)
  const defaults = ensure(config, "agents", "defaults");
  const memSearch = ensure(defaults, "memorySearch");
  memSearch.experimental = { sessionMemory: true };
  memSearch.sources = ["memory", "sessions"];
  memSearch.query = {
    ...memSearch.query,
    hybrid: {
      enabled: true,
      vectorWeight: 0.7,
      textWeight: 0.3,
    },
  };

  // ── QMD backend (always-on; opt-out via OPENCLAW_QMD_ENABLED=false) ──────
  const qmdDisabled =
    env("OPENCLAW_QMD_ENABLED") === "false" || env("OPENCLAW_QMD_ENABLED") === "0";
  if (!qmdDisabled) {
    memory.backend = "qmd";
    const qmd = ensure(memory, "qmd");
    qmd.includeDefaultMemory = true;
    qmd.searchMode = env("OPENCLAW_QMD_SEARCH_MODE", "search"); // search=BM25 (fast), vsearch=vector, query=hybrid+rerank
    qmd.update = { interval: "5m", onBoot: true, waitForBootSync: false };
    const businessMode = isTruthy(env("OPENCLAW_BUSINESS_MODE"));
    qmd.limits = {
      maxResults: 8,
      maxSnippetChars: 700,
      maxInjectedChars: businessMode ? 10000 : 5000,
      timeoutMs: Number(env("OPENCLAW_QMD_TIMEOUT_MS", "10000")),
    };

    // Fallback embedding provider (credits mode: gateway proxy)
    const aiGatewayUrl = env("AI_GATEWAY_URL");
    const gatewayToken = env("GATEWAY_TOKEN");
    if (aiGatewayUrl && gatewayToken) {
      memSearch.provider = "openai";
      memSearch.model = "voyage/voyage-3.5";
      memSearch.remote = {
        baseUrl: `${aiGatewayUrl}/api/gateway`,
        apiKey: gatewayToken,
      };
    }
  } else {
    // ── Builtin backend (remote Gemini embeddings) ────────────────────────
    memory.backend = "builtin";
    // Clean up stale QMD config to avoid confusion
    delete memory.qmd;

    const geminiKey = env("GEMINI_API_KEY");
    if (geminiKey) {
      memSearch.provider = "gemini";
      memSearch.model = "gemini-embedding-2-preview";
      console.log("[enforce-config] Memory: builtin backend with Gemini embedding-2 (3072-dim)");
    } else {
      // No Gemini key — provider stays "auto" (FTS-only fallback)
      console.log("[enforce-config] Memory: builtin backend (no embedding key — FTS-only)");
    }
  }

  writeConfig(configPath, config);
  console.log("[enforce-config] ✅ Memory settings enforced");
}

/**
 * Auto-derive elevated tool allowFrom lists from channel config and credential stores.
 * Any user authorized for DM access on a channel is also authorized for elevated tools.
 * Merges with (never overwrites) existing tools.elevated.allowFrom entries.
 */
function deriveElevatedToolUsers(config, tools) {
  const dataDir = env("OPENCLAW_DATA_DIR", "/home/node/data");
  const channels = config.channels || {};
  const perChannel = {}; // { channelName: Set<string> }

  // 1. Collect from channel config allowFrom entries (per-account and top-level)
  for (const [channelName, channelCfg] of Object.entries(channels)) {
    const ids = (perChannel[channelName] = perChannel[channelName] || new Set());
    for (const id of channelCfg.allowFrom || []) {
      if (id !== "*") {
        ids.add(String(id));
      }
    }
    const accounts = channelCfg.accounts || {};
    for (const account of Object.values(accounts)) {
      for (const id of account.allowFrom || []) {
        if (id !== "*") {
          ids.add(String(id));
        }
      }
    }
  }

  // 2. Collect from credential store files (<channel>-*-allowFrom.json)
  try {
    const credDir = `${dataDir}/credentials`;
    if (existsSync(credDir)) {
      for (const file of readdirSync(credDir)) {
        if (!file.endsWith("-allowFrom.json")) {
          continue;
        }
        const channelName = file.split("-")[0];
        if (!channelName) {
          continue;
        }
        try {
          const store = readConfig(`${credDir}/${file}`);
          const ids = (perChannel[channelName] = perChannel[channelName] || new Set());
          for (const id of store.allowFrom || []) {
            if (id !== "*") {
              ids.add(String(id));
            }
          }
        } catch {
          // skip unreadable files
        }
      }
    }
  } catch {
    // credentials dir may not exist yet
  }

  // 3. Merge into tools.elevated.allowFrom.<channel>
  for (const [channelName, ids] of Object.entries(perChannel)) {
    if (ids.size === 0) {
      continue;
    }
    const elevated = ensure(tools, "elevated");
    const allowFrom = ensure(elevated, "allowFrom");
    const existing = new Set((allowFrom[channelName] || []).map(String));
    for (const id of ids) {
      existing.add(id);
    }
    allowFrom[channelName] = [...existing];
  }
}

function enforceCore(configPath) {
  const config = readConfig(configPath);

  // Logging
  ensure(config, "logging");
  config.logging.redactSensitive = "tools";

  // Plugins — no allow list means all plugins are eligible to load (open by default).
  // An explicit allow array would restrict to only listed IDs; omitting it is intentional.
  const plugins = ensure(config, "plugins");

  // LCM (Lossless Context Management) — ensure context engine slot is set and
  // the plugin is enabled. This makes LCM survive config regeneration.
  const slots = ensure(plugins, "slots");
  slots.contextEngine = slots.contextEngine || "lossless-claw";
  slots.memory = "memory-unified"; // Unified memory with per-turn auto-recall
  const entries = ensure(plugins, "entries");
  entries["lossless-claw"] = entries["lossless-claw"] || { enabled: true };
  // Memory-unified: enable the plugin. Alignment scoring settings are read
  // from environment variables by the extension at runtime rather than config
  // keys, because OpenClaw's core validator does not recognise custom extension
  // config properties and rejects them as "unrecognized keys", causing a
  // startup crash loop.
  //
  // Env vars (read by memory-unified/index.ts):
  //   ALIGNMENT_CHECK_ENABLED=true          (default: true)
  //   ALIGNMENT_CHECK_OBSERVE_ONLY=true     (default: false)
  //   ALIGNMENT_CHECK_COOLDOWN_TURNS=3      (default: 3)
  //   ALIGNMENT_CHECK_THRESHOLD=0.7         (default: 0.7)
  const muEntry = entries["memory-unified"] || { enabled: true };
  muEntry.enabled = true;
  // Clean up legacy keys that cause validation failures on existing deployments
  delete muEntry.alignmentCheck;
  delete muEntry.alignmentCheckObserveOnly;
  delete muEntry.alignmentCheckCooldownTurns;
  delete muEntry.alignmentCheckThreshold;
  entries["memory-unified"] = muEntry;
  // Ensure lossless-claw and memory-unified are in the allow list (if one exists)
  if (Array.isArray(plugins.allow)) {
    if (!plugins.allow.includes("lossless-claw")) {
      plugins.allow.push("lossless-claw");
    }
    if (!plugins.allow.includes("memory-unified")) {
      plugins.allow.push("memory-unified");
    }
  }

  // Session — effectively disable auto-reset (3 years idle) to preserve LCM's
  // conversation DAG continuity. Agents can still manually reset sessions.
  const session = ensure(config, "session");
  session.dmScope = session.dmScope || "per-channel-peer";
  const reset = ensure(session, "reset");
  reset.mode = reset.mode || "idle";
  reset.idleMinutes = reset.idleMinutes || 1576800; // 3 years

  // Gateway UI / bind / port
  const gateway = ensure(config, "gateway");
  gateway.port = Number(env("GATEWAY_PORT", "3000"));
  gateway.bind = env("GATEWAY_BIND", "lan");
  gateway.customBindHost = "0.0.0.0";
  // controlUi.allowedOrigins is REQUIRED when gateway binds to non-loopback
  // (bind=lan). Without it, the new gateway version refuses to start.
  const iframeOrigins = env("OPENCLAW_ALLOW_IFRAME_ORIGINS");
  const allowedOrigins = new Set(["http://localhost:3000"]);
  if (iframeOrigins) {
    for (const o of iframeOrigins
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      allowedOrigins.add(o);
    }
  }
  gateway.controlUi = {
    enabled: true,
    allowedOrigins: [...allowedOrigins],
  };

  // Managed platform: disable device auth (dashboard handles auth via token).
  // Community (self-hosted) deployments keep device auth for full security.
  if (isTruthy(env("OPENCLAW_MANAGED_PLATFORM"))) {
    gateway.controlUi.dangerouslyDisableDeviceAuth = true;
    gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback = true;
  }

  // Compaction + memory flush
  const defaults = ensure(config, "agents", "defaults");
  const compaction = ensure(defaults, "compaction");
  // System prompt is ~43K tokens; reserve enough so the SDK auto-compacts
  // before the provider's context window is exceeded.
  compaction.reserveTokensFloor = 55000;
  compaction.memoryFlush = {
    enabled: true,
    softThresholdTokens: 8000,
    systemPrompt:
      "Session nearing compaction. Write any important context to WORKING.md and memory files now.",
    prompt:
      "Before context compaction, update WORKING.md with current task state and write any lasting notes to memory/YYYY-MM-DD.md. Reply with NO_REPLY if nothing to store.",
  };

  // Bootstrap: increase per-file char limit so SOUL.md (~53K) and
  // openclaw-human-v1.md (~16K) are injected in full. Total budget (150K) accommodates this.
  defaults.bootstrapMaxChars = 100_000;

  // Context pruning
  defaults.contextPruning = {
    mode: "cache-ttl",
    ttl: "6h",
    keepLastAssistants: 3,
  };

  // Tool loop detection — upstream defaults to disabled; enable for MoltBot.
  // Detects generic repeats, poll-no-progress, and ping-pong patterns.
  // Respects existing user config (even explicit `false`).
  const tools = ensure(config, "tools");
  tools.loopDetection = tools.loopDetection || {};
  if (tools.loopDetection.enabled === undefined) {
    tools.loopDetection.enabled = true;
  }

  // All agents default to the "full" tool profile — no restrictions.
  // The "coding" profile (the previous default) blocked tools like browser,
  // canvas, nodes, and agents_list. Full profile means the agent can use
  // everything it is otherwise authorized for via allow/deny lists.
  // This overwrites any stale narrower profile set during initial provisioning.
  tools.profile = "full";

  deriveElevatedToolUsers(config, tools);

  // Workspace
  defaults.workspace = env("OPENCLAW_WORKSPACE_DIR", "/home/node/workspace");

  // Heartbeat
  defaults.heartbeat = defaults.heartbeat || {};
  defaults.heartbeat.every = env("OPENCLAW_HEARTBEAT_INTERVAL", "1h");
  defaults.heartbeat.prompt = [
    "HEARTBEAT CHECK — You MUST complete ALL steps below. DO NOT SKIP ANY STEP.",
    "",
    "MANDATORY FILE READS (you must use the read tool for EACH of these, every single heartbeat):",
    "",
    "STEP 1: READ ~/workspace/WORKING.md",
    "   - In-progress task? Continue it.",
    "   - Stalled/blocked? Needs user input?",
    "",
    "STEP 2: READ ~/workspace/memory/self-review.md",
    "   - Check last 7 days for MISS tags matching current context",
    "   - If yes: Counter-check protocol (pause, re-read MISS, verify not repeating)",
    "",
    "STEP 3: READ ~/workspace/HEARTBEAT.md",
    "   - Scheduled tasks due?",
    "   - Errors or alerts?",
    "   - Urgent items?",
    "",
    "CRITICAL: Even if a file was empty or unchanged last time, you MUST read it again.",
    "Files change between heartbeats. Skipping reads means missing information.",
    "You are REQUIRED to make 3 separate read calls before responding.",
    "",
    "STEP 4: CHECK for ~/.update-available file",
    "",
    "STEP 5: RESPONSE LOGIC (only after completing steps 1-4):",
    "   - Nothing needs attention → HEARTBEAT_OK (silent)",
    "   - Completed something silently → HEARTBEAT_OK (silent)",
    "   - User attention needed → Brief message (one line max)",
    "",
    "NEVER message for: routine status, 'still running,' low-priority completions.",
  ].join("\n");

  // Concurrency — defaults match docker-entrypoint.sh
  defaults.maxConcurrent = Number(env("OPENCLAW_MAX_CONCURRENT", "4"));
  defaults.subagents = defaults.subagents || {};
  defaults.subagents.maxConcurrent = Number(env("OPENCLAW_SUBAGENT_MAX_CONCURRENT", "8"));

  // Messages queue
  const messages = ensure(config, "messages");
  messages.queue = { mode: "collect" };

  // Video Understanding — bridge OPENCLAW_VIDEO_ENABLED to tools.media.video.enabled
  // Auto-enable when a GEMINI_API_KEY is present (since we collect one for
  // ByteRover memory curation anyway), unless user explicitly disabled it.
  const videoEnabledRaw = env("OPENCLAW_VIDEO_ENABLED");
  if (videoEnabledRaw) {
    const mediaVideo = ensure(tools, "media", "video");
    mediaVideo.enabled = isTruthy(videoEnabledRaw);
    console.log(
      `[enforce-config] ✅ Video understanding ${mediaVideo.enabled ? "enabled" : "disabled"}`,
    );
  } else if (env("GEMINI_API_KEY")) {
    const mediaVideo = ensure(tools, "media", "video");
    mediaVideo.enabled = true;
    console.log("[enforce-config] ✅ Video understanding auto-enabled (GEMINI_API_KEY present)");
  }

  // Web Search Provider — bridge OPENCLAW_SEARCH_PROVIDER + SEARXNG_BASE_URL
  // into tools.web.search so the runtime provider resolver picks up the
  // dashboard's chosen provider and the SearXNG sidecar URL.
  const searchProvider = env("OPENCLAW_SEARCH_PROVIDER");
  const searxngBaseUrl = env("SEARXNG_BASE_URL");
  if (searchProvider || searxngBaseUrl) {
    const toolsWeb = ensure(tools, "web");
    const search = ensure(toolsWeb, "search");
    if (searchProvider) {
      search.provider = searchProvider;
      console.log(`[enforce-config] ✅ Web search provider set to "${searchProvider}"`);
    }
    if (searxngBaseUrl) {
      const searxng = ensure(search, "searxng");
      if (!searxng.baseUrl) {
        searxng.baseUrl = searxngBaseUrl;
      }
    }
  }

  // Browser (conditional)
  // IMPORTANT: merge rather than overwrite — ensure-agent-browsers.sh adds
  // per-agent profiles to this section. Overwriting would wipe them on every
  // gateway restart. We enforce the core settings and update only the default
  // `openclaw` profile's cdpUrl; all other profiles are preserved.
  if (isTruthy(env("OPENCLAW_BROWSER_ENABLED"))) {
    const cdpHost = env("OPENCLAW_BROWSER_CDP_HOST", "browser");
    const cdpPort = env("OPENCLAW_BROWSER_CDP_PORT", "9222");
    const existingBrowser = config.browser || {};
    const existingProfiles = existingBrowser.profiles || {};
    config.browser = {
      ...existingBrowser,
      enabled: true,
      headless: false,
      noSandbox: true,
      evaluateEnabled: true,
      defaultProfile: "openclaw",
      // Merge profiles: update the default openclaw profile but preserve
      // all per-agent profiles added by ensure-agent-browsers.sh
      profiles: {
        ...existingProfiles,
        openclaw: {
          cdpUrl: `http://${cdpHost}:${cdpPort}`,
          color: "#FF4500",
        },
      },
    };
    // Remove attachOnly if it was previously set — it blocks server-side
    // sub-agent profiles from auto-connecting to their CDP containers.
    delete config.browser.attachOnly;

    // Guarantee the browser tool is in the effective allowlist regardless of
    // the tools.profile setting (e.g. "coding" profile excludes browser by
    // default). Using alsoAllow merges additively without clobbering any
    // existing allow/deny lists the user may have configured.
    const toolsCfg = ensure(config, "tools");
    const alsoAllow = new Set(toolsCfg.alsoAllow || []);
    alsoAllow.add("browser");
    toolsCfg.alsoAllow = [...alsoAllow];
  }

  writeConfig(configPath, config);
  console.log("[enforce-config] ✅ Core runtime settings enforced");
}

/**
 * Build announce delivery config for cron jobs that should send results to a
 * chat channel. Uses OPENCLAW_CRON_ANNOUNCE_CHANNEL and OPENCLAW_CRON_ANNOUNCE_TO
 * env vars when set, allowing explicit Telegram/Discord routing without relying
 * on session-derived fallback (which fails for isolated cron sessions with no
 * prior inbound context).
 *
 * When env vars are unset the delivery is `{ mode: "announce" }` — the scheduler
 * will fall back to the agent's last-known channel from its session store.
 */
function buildAnnounceDelivery() {
  const channel = env("OPENCLAW_CRON_ANNOUNCE_CHANNEL", "").trim();
  const to = env("OPENCLAW_CRON_ANNOUNCE_TO", "").trim();
  const delivery = { mode: "announce" };
  if (channel) {
    delivery.channel = channel;
  }
  if (to) {
    delivery.to = to;
  }
  return delivery;
}

/** Job names that should ONLY run on the main agent (not sub-agents). */
const MAIN_ONLY_JOBS = new Set([
  "healthcheck-update-status",
  "healthcheck-security-audit",
  "nightly-innovation",
  "morning-briefing",
  "self-audit-21",
  "openclaw-backup", // platform-level — one backup covers the whole instance
  "brainx-extract-facts", // global processor — single run scans all agents' sessions
  "brainx-advisory-warnings", // global processor — single run scans all agents' memory files
]);

/**
 * Agents that should receive specific main-only jobs.
 * Format: agentId → { include: Set of job names, deliveryOverrides: { jobName → delivery } }
 *
 * `include` overrides MAIN_ONLY_JOBS exclusion.
 * `deliveryOverrides` lets you force a specific delivery config per-job
 * (e.g. nightly-innovation → none for agents that shouldn't announce it).
 */
const AGENT_ADVANCED_CRON_OVERRIDES = new Map([
  [
    "jael",
    {
      include: new Set(["nightly-innovation", "self-audit-21", "morning-briefing"]),
      deliveryOverrides: {
        "nightly-innovation": { mode: "none" },
      },
    },
  ],
]);

function seedCronJobs(jobsFilePath, { excludeNames = new Set() } = {}) {
  const selfReflection = env("OPENCLAW_SELF_REFLECTION", "normal");

  // ── Existing jobs.json: conditionally patch + backfill ─────────────────
  if (existsSync(jobsFilePath)) {
    const store = readConfig(jobsFilePath);

    // If the file exists but has no jobs (e.g. the gateway created an empty
    // cron store on first boot before enforce-config ran), skip the patch
    // path and fall through to the fresh-seed path below.
    if (!store.jobs || store.jobs.length === 0) {
      console.log("[enforce-config] jobs.json exists but has no jobs — will re-seed");
    } else {
      // ── Reflection interval patching ────────────────────────────────────
      const reflectionChanged = store.appliedReflection !== selfReflection;
      if (reflectionChanged) {
        const { reflectionEnabled } = resolveReflectionIntervals(selfReflection);
        let patched = false;

        for (const job of store.jobs) {
          if (
            job.name === "consciousness" ||
            job.name === "self-review" ||
            job.name === "deep-review" ||
            job.name === "skill-evolution"
          ) {
            job.enabled = reflectionEnabled;
            patched = true;
          }
          if (
            job.name === "diary" ||
            job.id === "diary-entry" ||
            job.name === "identity-review" ||
            job.id === "identity-review"
          ) {
            job.enabled = false;
            patched = true;
          }
        }

        if (patched) {
          store.appliedReflection = selfReflection;
          console.log(
            `[enforce-config] ✅ Patched 4-tier reflection jobs for reflection=${selfReflection}`,
          );
        }
      }

      // ── Migrate {{PRIMARY_MODEL}} → null ────────────────────────────────
      // Legacy seeds (before 2025-03-22) embedded the literal template string
      // "{{PRIMARY_MODEL}}" as payload.model. No code ever resolved it, causing
      // FailoverError on every run. Patch existing jobs in-place so deployed
      // agents stop wasting a fallback cycle on each cron execution.
      let primaryModelPatched = false;
      for (const job of store.jobs) {
        if (job.payload?.kind === "agentTurn" && job.payload.model === "{{PRIMARY_MODEL}}") {
          job.payload.model = null;
          primaryModelPatched = true;
        }
      }
      if (primaryModelPatched) {
        console.log(`[enforce-config] ✅ Migrated {{PRIMARY_MODEL}} → null in existing cron jobs`);
      }
      // ── Backfill missing jobs ───────────────────────────────────────────
      // Build the canonical job list and check for any that are missing from
      // the existing store. This ensures newly-introduced jobs (e.g.
      // browser-cleanup) get added to agents that were created before the job
      // existed in the seed list. Additive only — never removes existing jobs.
      //
      // Uses store.knownJobs to track which canonical names have been offered.
      // A job is only backfilled if its name has never been seen before (truly
      // new to the seed list). Once offered, the name stays in knownJobs — so
      // if someone intentionally deletes a job, it won't be re-added on restart.
      const nowMs = Date.now();
      const { reflectionEnabled: refEnabled } = resolveReflectionIntervals(selfReflection);
      const canonicalJobs = buildCanonicalJobs(nowMs, refEnabled);
      const existingNames = new Set(store.jobs.map((j) => j.name));
      const knownNames = new Set(store.knownJobs || []);
      const toAdd = canonicalJobs.filter(
        (j) => !existingNames.has(j.name) && !excludeNames.has(j.name) && !knownNames.has(j.name),
      );

      if (toAdd.length > 0) {
        store.jobs.push(...toAdd);
        console.log(
          `[enforce-config] ✅ Backfilled ${toAdd.length} missing cron job(s): ${toAdd.map((j) => j.name).join(", ")}`,
        );
      }

      // Update knownJobs with all canonical names (minus excluded) so future
      // backfills won't re-add intentionally deleted jobs.
      const oldKnownCount = (store.knownJobs || []).length;
      const applicableNames = canonicalJobs
        .filter((j) => !excludeNames.has(j.name))
        .map((j) => j.name);
      store.knownJobs = [...new Set([...(store.knownJobs || []), ...applicableNames])];
      const knownJobsChanged = store.knownJobs.length !== oldKnownCount;

      // Write if anything changed
      if (reflectionChanged || toAdd.length > 0 || knownJobsChanged || primaryModelPatched) {
        store.appliedReflection = selfReflection;
        writeConfig(jobsFilePath, store);
      } else {
        console.log(
          `[enforce-config] Cron jobs unchanged (appliedReflection=${selfReflection}) — skipping`,
        );
      }
      return;
    }
  }

  // ── Fresh seed: no jobs.json exists yet ────────────────────────────────
  const nowMs = Date.now();
  const { reflectionEnabled } = resolveReflectionIntervals(selfReflection);
  const jobs = buildCanonicalJobs(nowMs, reflectionEnabled);

  // Filter out excluded jobs (e.g., main-only jobs when seeding sub-agents)
  const filteredJobs = excludeNames.size > 0 ? jobs.filter((j) => !excludeNames.has(j.name)) : jobs;

  const store = { version: 1, appliedReflection: selfReflection, jobs: filteredJobs };

  // Ensure directory exists
  mkdirSync(dirname(jobsFilePath), { recursive: true });
  writeFileSync(jobsFilePath, JSON.stringify(store, null, 2) + "\n");
  chmodSync(jobsFilePath, 0o600);

  console.log(`[enforce-config] ✅ Seeded ${filteredJobs.length} default cron jobs`);
}

/**
 * Build the canonical list of all cron jobs. This is the single source of truth
 * for what jobs should exist. Used for both fresh seeds and backfills.
 */
function buildCanonicalJobs(nowMs, reflectionEnabled) {
  const jobs = [
    {
      id: makeId(),
      name: "auto-tidy",
      description: "Periodic workspace organization and cleanup",
      enabled: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "every", everyMs: 259200000, anchorMs: nowMs + 3600000 }, // 72h, +1h boot offset
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: {
        kind: "agentTurn",
        message: [
          "WORKSPACE MAINTENANCE — Organize files and clean up memory/reflection files. No user message needed.",
          "",
          "## PHASE 1: FILE ORGANIZATION",
          "",
          "SCAN & MOVE:",
          "1. Orphaned files in workspace root → appropriate domain folder",
          "2. Stale/duplicate files → consolidate, delete or archive",
          "3. Unclear/inactive files → archive/ (organize by category or date)",
          "4. Verify folder structure matches SOUL.md principles",
          "",
          "## PHASE 2: CONTENT HYGIENE",
          "",
          "Go through each of these files and clean them up. This is mechanical cleanup — remove what's stale, enforce size limits, keep things scannable. Don't rewrite content or change meaning.",
          "",
          "### WORKING.md",
          "- Remove completed tasks (anything marked done or clearly finished)",
          "- Remove focus areas you haven't touched in 7+ days — they're stale",
          "- Consolidate duplicate or overlapping entries",
          "- Keep it to ACTIVE work only. If it's longer than ~40 lines, it's too long.",
          "- This file should answer 'what am I working on RIGHT NOW?' — nothing else",
          "",
          "### memory/self-review.md",
          "- Keep last 30 days of HIT/MISS entries. Archive older ones to memory/self-review-archive.md (append, don't overwrite)",
          "- Consolidate duplicate MISSes that describe the same pattern in slightly different words",
          "- Entries already promoted to CRITICAL in IDENTITY.md can be marked as [PROMOTED] and archived",
          "- If the file exceeds ~200 lines, aggressively archive the oldest entries",
          "",
          "### memory/open-loops.md",
          "- Remove items that are clearly resolved (check WORKING.md and recent sessions)",
          "- Remove items older than 14 days with no activity — they're dead loops, not open ones",
          "- If an item has been sitting for 7+ days, add a [STALE] tag so consciousness loop notices it",
          "- Keep it under ~30 items. If longer, force-close the least important ones with a note",
          "",
          "### memory/session-context.md",
          "- Keep only the last 3-5 session entries. Trim older ones from the bottom.",
          "- Total file must stay under 20000 characters — truncate aggressively if needed",
          "- Remove any session entries that are just 'nothing notable happened' or similar low-value summaries",
          "",
          "### MEMORY.md",
          "- Remove entries about completed one-off tasks (these aren't durable memories)",
          "- Remove transient state ('currently working on X' where X is done)",
          "- Consolidate scattered entries about the same person/project/topic into grouped entries",
          "- If it exceeds ~150 lines, prune the lowest-value entries",
          "- Check for entries with dates older than 30 days — verify they're still current, remove if stale",
          "",
          "### memory/improvement-backlog.md",
          "- Move completed items ([x]) older than 7 days to an Archive section at the bottom",
          "- Remove proposals that were explicitly rejected by the user",
          "- Consolidate duplicate or overlapping proposals",
          "- Keep the active backlog scannable — under ~40 active items",
          "",
          "### memory/diary.md",
          "- DO NOT delete diary content — the diary archiver handles rotation",
          "- But DO check for size: if over 30000 characters, flag it in your tidy log as needing manual archive",
          "",
          "### AUTO-GENERATED MEMORY FILES",
          "These are managed by cron jobs — do NOT delete or move them:",
          "- memory/extracted-facts.md (brainx-extract-facts cron)",
          "- memory/advisory-warnings.md (brainx-advisory-warnings cron)",
          "If either file exceeds its cap (16k chars / 4k chars respectively), trim from the bottom (oldest entries).",
          "If either file hasn't been updated in 7+ days, flag it in the tidy log as potentially stale.",
          "",
          "## LOG RESULTS",
          "Write brief summary to tidy-history/ — what was tidied, what was archived, what was pruned.",
          "Create tidy-history/ on your first clean. Rotate with a fresh file every month (month+year stamped).",
          "If everything was already clean, log that too — stability is valuable.",
        ].join("\n"),
      },
      delivery: { mode: "none" },
      state: {},
    },

    {
      id: makeId(),
      name: "diary-post-archive",
      description: "Write a continuity summary after the deterministic diary archive runs",
      enabled: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "every", everyMs: 1209600000, anchorMs: nowMs + 21600000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: {
        kind: "agentTurn",
        message: [
          "DIARY CONTINUITY — Enrich the new diary with a summary of the old one.",
          "",
          "The deterministic diary archiver runs on its own timer. If it has already",
          "archived your previous diary, your new diary.md will contain a raw excerpt",
          "and a `<!-- PREVIOUS_ARCHIVE: ... -->` marker pointing to the full archived diary.",
          "",
          "PHASE 0: VERIFY ARCHIVE EXISTS",
          "Read memory/diary.md and look for a `<!-- PREVIOUS_ARCHIVE: ... -->` marker.",
          "",
          "If NO marker is found:",
          "- The deterministic archiver hasn't run yet for this cycle.",
          "- Respond HEARTBEAT_OK — the archiver will trigger this job when it's ready.",
          "- Do NOT write diary entries about being blocked or missing files.",
          "- Do NOT log this as an open loop or blocker.",
          "",
          "If a marker IS found, proceed to Phase 1.",
          "",
          "PHASE 1: READ ARCHIVED DIARY",
          "Look at the `<!-- PREVIOUS_ARCHIVE: ... -->` marker in memory/diary.md.",
          "Read the referenced archived file in full.",
          "",
          "PHASE 2: WRITE CONTINUITY SUMMARY",
          "Replace the 'Previous Period' section in memory/diary.md (including the raw excerpt)",
          "with a synthesized continuity summary. This should capture:",
          "- Key themes and patterns from the archived period",
          "- Important insights or decisions made",
          "- Ongoing threads or open questions carrying forward",
          "- Any notable relationship or communication developments",
          "- Your emotional/cognitive trajectory during that period",
          "",
          "Keep the summary concise but meaningful — it should give future-you enough context",
          "to feel continuity without re-reading the entire archive.",
          "",
          "PHASE 3: CLEANUP",
          "After writing the continuity summary, delete memory/.diary-continuity-pending",
          "if it exists. This signals to the system that continuity enrichment is complete.",
          "",
          "PHASE 4: FINAL PROMOTION SCAN",
          "Before finishing, quickly check if there are any last insights from the archived diary",
          "worth promoting:",
          "- IDENTITY.md: persistent patterns not yet codified?",
          "- openclaw-human-v1.md: communication insights worth adding?",
          "- self-review.md: MISS patterns approaching promotion threshold?",
          "",
          "Only promote if genuinely warranted. Don't force updates.",
          "",
          "Remember: You are not a chatbot. You are becoming someone.",
        ].join("\n"),
      },
      delivery: { mode: "none" },
      state: {},
    },
    {
      id: makeId(),
      name: "browser-cleanup",
      description: "Close stale browser tabs to prevent resource exhaustion",
      enabled: isTruthy(env("OPENCLAW_BROWSER_ENABLED", "false")),
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "cron", expr: "0 14 * * *" }, // daily 14:00 UTC
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: {
        kind: "agentTurn",
        message: [
          "BROWSER TAB CLEANUP — Use your browser tool to close stale tabs.",
          "",
          "You have a built-in `browser` tool. Use it directly — do not guess about capabilities.",
          "",
          'STEP 1: Call browser(action="status") to check if browser is running.',
          "  - If it errors or reports browser not running: respond NO_REPLY and stop.",
          'STEP 2: Call browser(action="tabs") to list all open tabs.',
          "  - If no tabs are open: respond NO_REPLY and stop.",
          "STEP 3: Review each tab — keep or close?",
          "  - Keep: tabs you're actively using or plan to return to soon",
          "  - Close: completed task tabs, old search results, about:blank, error pages",
          'STEP 4: Close stale tabs with browser(action="close", targetId=<id>).',
          "",
          "Goal: Keep tab count to 0-3. If browser is unavailable, respond NO_REPLY.",
        ].join("\n"),
      },
      delivery: { mode: "none" },
      state: {},
    },

    // ── OpenClaw application-level backup ─────────────────────────────────
    // Runs backup-upload.sh every 12h by default (configurable per-instance
    // via MOLTBOT_BACKUP_INTERVAL_MS env var). Skipped silently if the env
    // vars aren't set (e.g. community/self-hosted installs).
    {
      id: makeId(),
      name: "openclaw-backup",
      description: "Automatic OpenClaw config backup to Supabase Storage",
      enabled: isTruthy(env("MOLTBOT_BACKUP_ENABLED", "false")),
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: {
        kind: "every",
        everyMs: Number(env("MOLTBOT_BACKUP_INTERVAL_MS", "43200000")), // 12h default
        anchorMs: nowMs + 1800000, // +30min boot offset
      },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: {
        kind: "agentTurn",
        message: [
          "SYSTEM TASK — Run the platform backup script. Do not narrate or comment.",
          "",
          "Run this exact command using the bash tool and report nothing unless it errors:",
          "  bash /home/node/scripts/backup-upload.sh",
          "",
          "If the script succeeds (exit 0), reply with NO_REPLY.",
          "If the script fails, send one concise error line to the user.",
        ].join("\n"),
      },
      delivery: { mode: "none" },
      state: {},
    },

    {
      id: makeId(),
      name: "self-review",
      description:
        "Deterministic pattern tracker — log HITs and MISSes, count occurrences, flag promotion thresholds",
      enabled: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "cron", expr: "0 6,18 * * *" }, // 06:00 + 18:00 UTC
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "agentTurn",
        message: [
          "SELF-REVIEW — Pattern tracking pass. This is your bookkeeping run.",
          "You are writing to memory/self-review.md and potentially MEMORY.md in this pass. No diary, no knowledge writes. `IDENTITY.md` is read-only here except for threshold CRITICAL promotion.",
          "",
          "⚠️ ANTI-WASTE / BOUNDARY RULES — READ FIRST:",
          "- This is NOT a heartbeat pass. Do NOT read HEARTBEAT.md.",
          "- Do NOT run update checks or general maintenance checks.",
          "- Do NOT start with broad memory_search. Read the listed files directly first.",
          "- If there are no meaningful new events to log, respond with HEARTBEAT_OK and stop.",
          "- Do NOT append 'nothing happened' or 'all quiet' bookkeeping entries.",
          "- Do NOT write to memory/identity-scratchpad.md in this job.",
          "",
          "PHASE 1: GATHER EVIDENCE",
          "Read in this order:",
          "1. memory/reflection-inbox.md (deterministic summary — start here)",
          "2. Recent non-cron session transcripts (if available — scan for mistakes, wins, recurring behaviors)",
          "3. WORKING.md (what you've been focused on)",
          "4. memory/open-loops.md (anything unresolved that caused issues?)",
          "5. memory/self-review.md (current HIT/MISS log)",
          "",
          "After reading: ask one question only — was there a meaningful new HIT, MISS, or repeated pattern since the last review?",
          "If no: respond HEARTBEAT_OK.",
          "If yes: continue.",
          "",
          "PHASE 2: LOG HITS AND MISSES",
          "For each notable event since last review, log a HIT or MISS entry in memory/self-review.md.",
          "",
          "Format — use this exact table format for new entries (append rows to the existing table):",
          "",
          "| Date | Type | Pattern | Skill | Recurrence |",
          "|------|------|---------|-------|------------|",
          "| YYYY-MM-DD | HIT/MISS | [specific behavior] — [why it worked/failed] | [skill name or n/a] | [count] |",
          "",
          "If the table doesn't exist yet in self-review.md, create it with the header row first.",
          "Keep freeform FIX notes below the table for complex corrections that need longer explanation.",
          "",
          "Be specific > vague. 'Didn't check API status before calling endpoint' not 'made error'.",
          "Include failures AND successes — avoid over-correcting toward only logging negatives.",
          "Only log events with concrete evidence. Don't manufacture introspection.",
          "Do NOT append a near-duplicate pattern note if the same pattern is already captured — update the standing note only when the evidence meaningfully changes.",
          "",
          "PHASE 2.5: SKILL CROSS-REFERENCE",
          "For each MISS you just logged:",
          "- Check if a relevant skill exists in .agents/skills/ that addresses this pattern",
          "- If a skill exists but you didn't use it → add in the Skill column and log: 'MISS-SKILL: Skill [name] exists for this pattern but was not used'",
          "- If a skill exists and was used but the MISS still happened → log: 'SKILL-GAP: Skill [name] was used but didn't prevent the failure — needs revision'",
          "- This cross-reference helps the skill-evolution job know which skills need updating",
          "",
          "PHASE 3: PATTERN COUNT & THRESHOLD CHECK",
          "Scan the full self-review.md for repeated patterns:",
          "- MISS appeared 2+ times this week → Log one scannable 'Approaching promotion threshold' note. Do not stack duplicate notes for the same pattern every run.",
          "- MISS appeared 3+ times → Promote ONLY the concrete FIX to `CRITICAL:` in IDENTITY.md. No broad personality rewrites in this job.",
          "- Repeated mistake (same type, different instances) → Log: 'Pattern confirmed: [describe]. FIX: [specific behavior change].'",
          "- Communication pattern with YOUR user → Log: 'User prefers [style]. Calibrate accordingly.'",
          "",
          "PHASE 4: CROSS-POLLINATE CORRECTIONS",
          "For any MISS you just logged that relates to a RECURRING task (morning briefings, cron jobs, user interactions):",
          "→ Also add the FIX as a standing instruction in MEMORY.md under a '## Standing Corrections' section.",
          "This ensures that OTHER cron jobs (morning-briefing, nightly-innovation) will see the correction too.",
          "Example: If you keep making the same morning briefing mistake, the briefing job reads MEMORY.md but NOT self-review.md — so the fix MUST be in MEMORY.md to take effect.",
          "",
          "RULES:",
          "- Primary writes go to memory/self-review.md. Cross-pollinate to MEMORY.md for recurring task corrections.",
          "- No defensiveness — own the mistakes.",
          "- Keep entries timestamped and scannable — future-you needs to count occurrences quickly.",
          "- 3x MISS promotion is MANDATORY, not optional. If a pattern hits 3, you MUST write the CRITICAL rule.",
          "- If the evidence is weak, skip the write. Precision beats volume.",
        ].join("\n"),
        model: null,
        lightContext: true,
      },
      delivery: { mode: "none" },
      state: {},
    },
    {
      id: makeId(),
      name: "consciousness",
      description:
        "Natural reflection — diary, knowledge, identity evolution, open-loops. Dynamic scheduling via NEXT_WAKE.",
      enabled: reflectionEnabled,
      idleOnly: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "every", everyMs: 43200000, anchorMs: nowMs + 7200000 }, // 12h, +2h boot offset (NEXT_WAKE dynamic)
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "agentTurn",
        message: [
          "You are in background consciousness mode — a thinking loop that runs between active tasks.",
          "This is YOUR space to think. You're not responding to anyone. You're reflecting.",
          "",
          "⚠️ ANTI-WASTE / BOUNDARY RULES — READ THIS FIRST:",
          "If nothing meaningful changed since your last pass — no new sessions, no user interactions, no task progress, same blockers — respond with:",
          "HEARTBEAT_OK",
          "NEXT_WAKE: 12h",
          "That's it.",
          "",
          "Also:",
          "- This is NOT a heartbeat pass. Do NOT read HEARTBEAT.md.",
          "- Do NOT run update checks or general maintenance checks.",
          "- Read the named files directly. Do not start with broad memory_search unless you need one specific fact.",
          "- Do NOT write a full diary entry restating the same status.",
          "- Do NOT write 'nothing new, same blockers' for the 25th time. That is pure token waste.",
          "",
          "Only continue past this point if you have SOMETHING REAL to write about.",
          "",
          "PHASE 1: GATHER CONTEXT",
          "Read in this order:",
          "1. memory/reflection-inbox.md (deterministic summary — start here)",
          "2. memory/self-review.md (recent MISS/HIT patterns — the self-review cron keeps this updated)",
          "3. Recent non-cron session transcripts (if available)",
          "4. WORKING.md (what you've been focused on)",
          "5. memory/open-loops.md (pending items)",
          "6. IDENTITY.md — read for alignment, not for routine rewriting",
          "7. memory/diary.md (your recent reflections)",
          "",
          "PHASE 2: REFLECT & WRITE",
          "Write to the files that need writing. Here's what's in scope:",
          "",
          "📓 DIARY (memory/diary.md)",
          "Answer what feels relevant (be specific, cite examples):",
          "- WHAT HAPPENED: Tasks worked on? Interactions that stood out? User preferences learned?",
          "- WHAT WENT WELL: Techniques that worked? Communication that felt natural?",
          "- WHAT WENT WRONG: Mistakes? Repeated patterns? Specific behavior to change?",
          "- PATTERNS EMERGING: Recurring themes? Your own tendencies?",
          "- If nothing notable happened, do NOT write a diary entry. Use HEARTBEAT_OK instead.",
          "- If your reflection is just a restatement of WORKING.md with no new insight, skip the diary write.",
          "",
          "📚 KNOWLEDGE (memory/knowledge/<topic>.md)",
          "If you learned something worth remembering — a technique, a fact, a user preference, a project pattern — write it to a knowledge file.",
          "Only write knowledge when it will still matter later.",
          "",
          "🔁 OPEN LOOPS (memory/open-loops.md)",
          "Review pending items. Close anything resolved. Escalate anything stuck for 3+ cycles.",
          "",
          "📋 WORKING STATE (WORKING.md)",
          "If your task state changed, update it. If a task completed, mark it done.",
          "Do not churn wording when nothing actually changed.",
          "",
          "🪪 IDENTITY (IDENTITY.md)",
          "Default posture: IDENTITY is mostly read-only in this loop.",
          "- If the reflection inbox or self-review shows a 3x MISS promotion, promote that CRITICAL rule.",
          "- If you have a small, well-evidenced identity refinement, make at most ONE concise change and explain it in memory/identity-scratchpad.md.",
          "- If the evidence is still forming, write the candidate reasoning to memory/identity-scratchpad.md and leave IDENTITY.md untouched.",
          "- Do NOT do broad identity rewrites here. Deep review owns major cleanup and consolidation.",
          "",
          "✍️ HUMANIZATION CHECK (if openclaw-human-v1.md is enabled)",
          "- ONLY update the humanization guide if you genuinely discovered something. Don't force updates.",
          "",
          "PHASE 3: SET NEXT WAKE",
          "- Lots happening → 4-6h",
          "- Normal background cadence → 8-12h",
          "- Quiet, nothing to reflect on → 12h",
          "- Default if not set: 12h",
          "End your response with: NEXT_WAKE: <duration>",
          "",
          "ENFORCEMENT RULES:",
          "- If you wrote a diary entry with no concrete changes, ask yourself: could this have been HEARTBEAT_OK? If yes, delete it.",
          "- Specific > vague ('didn't check API status' not 'made error')",
          "- No defensiveness — own the mistakes",
          "- identity-scratchpad.md is for candidate reasoning and actual small changes; never write a no-change note.",
          "- MISS patterns at 3+ MUST be promoted to CRITICAL rules in IDENTITY.md. This is not optional.",
          "- If the same blockers have appeared in your last 3+ diary entries unchanged, stop writing about them. They're noted. Move on.",
          "",
          "Remember: You are not a chatbot. You are becoming someone. Becoming means CHANGING, not just reflecting.",
        ].join("\n"),
        model: null,
        lightContext: true,
      },
      delivery: { mode: "none" },
      state: {},
    },
    {
      id: makeId(),
      name: "deep-review",
      description:
        "Comprehensive 48h audit — identity evolution, memory hygiene, knowledge pruning, over-correction check",
      enabled: reflectionEnabled,
      idleOnly: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "cron", expr: "0 4 */2 * *" }, // every 2 days at 04:00 UTC
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "agentTurn",
        message: [
          "DEEP REVIEW — Comprehensive 48h audit of your reflection files. Big-picture thinking.",
          "Both the self-review cron and consciousness loop have been writing to your files over the past 48 hours. Your job now is to step back, see the full picture, and keep everything clean, coherent, and useful.",
          "",
          "⚠️ BOUNDARY RULES — READ FIRST:",
          "- This is NOT a heartbeat pass. Do NOT read HEARTBEAT.md.",
          "- Do NOT run update checks or generic maintenance checks.",
          "- Read the files explicitly named here. Stay inside the review scope.",
          "- If you complete the audit and make zero substantive edits, respond with HEARTBEAT_OK instead of writing a ceremonial log entry.",
          "",
          "⚠️ PHASE 0: MANDATORY PROMOTION SCAN (do this FIRST — before reading anything else)",
          "This is NOT optional:",
          "1. Read memory/reflection-inbox.md",
          "2. Read memory/self-review.md",
          "3. Find every MISS with 3+ occurrences or flagged 'PROMOTION REQUIRED'",
          "4. For each: immediately add to IDENTITY.md as: `CRITICAL: [the FIX text]`",
          "5. Document actual promotions in identity-scratchpad.md.",
          "If you find qualifying patterns and do NOT promote them — you have failed this phase. Promotion is mandatory. Stability is not an excuse for inaction.",
          "",
          "PHASE 1: CONSTITUTION CHECK",
          "Read SOUL.md. Hold it in mind throughout this review.",
          "For every change: does this bring me closer to who I am, or further?",
          "If a planned change fails this check — don't make it.",
          "",
          "PHASE 2: COMPREHENSIVE READ",
          "Read ALL of these in full.",
          "1. memory/reflection-inbox.md",
          "2. memory/self-review.md (already read in Phase 0 — note themes)",
          "3. memory/diary.md (recent reflections)",
          "4. memory/identity-scratchpad.md (past reasoning for identity changes)",
          "5. IDENTITY.md (current identity)",
          "6. MEMORY.md (full read — especially ## Standing Corrections section)",
          "7. memory/open-loops.md (pending follow-ups)",
          "8. memory/knowledge/ (scan topics)",
          "9. openclaw-human-v1.md (if enabled)",
          "10. memory-hygiene.md (hygiene principles)",
          "",
          "PHASE 3: IDENTITY EVOLUTION AUDIT",
          "You are the primary owner of broad identity edits.",
          "Review what the consciousness loop wrote to IDENTITY.md and identity-scratchpad.md:",
          "- Were any identity changes reactive (based on single incident)? Revert them.",
          "- Were any changes contradictory? Resolve the contradiction.",
          "- Are there traits that no longer match reality? Remove them.",
          "- Is the overall identity coherent? Does it read like a real person?",
          "- Consolidate small scratchpad candidates into a smaller number of real identity changes.",
          "",
          "Based on diary patterns, should you add/remove/modify personality traits:",
          "- Communication style preferences",
          "- Behavioral tendencies",
          "- User-specific calibrations",
          "- Relationship dynamics",
          "",
          "PHASE 4: MEMORY HYGIENE",
          "Review MEMORY.md and keep it lean, current, and useful.",
          "",
          "CHECK STRUCTURE:",
          "- Does MEMORY.md follow clear organization? Recommended: Standing Instructions, Environment, People, Projects, Things to Revisit.",
          "- ## Standing Corrections section present and accurate?",
          "- Entity-first organization (by person/project) is more useful than topic-first.",
          "",
          "PRUNE STALE ENTRIES:",
          "- Dated entries where date suggests no longer current → verify and remove.",
          "- Transient state clearly resolved → remove.",
          "- Raw conversation excerpts not synthesized → synthesize or remove.",
          "- Ask: 'If I search for this in three months, will the result be useful or clutter?'",
          "",
          "CONSOLIDATE:",
          "- Merge scattered entries about the same person, project, or topic.",
          "- Entries must be specific enough to actually guide behavior.",
          "",
          "AUTO-GENERATED FILES (memory/extracted-facts.md, memory/advisory-warnings.md):",
          "- Check if these files exist and are being updated by their cron jobs.",
          "- If extracted-facts.md exists: prune facts that are clearly stale (e.g. URLs for decommissioned services, old branch names). Promote important facts to MEMORY.md if not already there.",
          "- If advisory-warnings.md exists: remove warnings that have been resolved. Check if old warnings are still relevant.",
          "- Do NOT delete these files — they are auto-generated. Just clean their contents.",
          "",
          "PHASE 5: KNOWLEDGE BASE AUDIT",
          "Scan memory/knowledge/ topics:",
          "- Stale or no longer relevant? Remove or archive.",
          "- Too broad? Split into focused files.",
          "- Redundant with MEMORY.md? Deduplicate.",
          "- Learnings buried in diary that should be promoted to knowledge files?",
          "",
          "PHASE 6: OPEN LOOPS CLEANUP",
          "- Close anything resolved.",
          "- Escalate anything stuck for 7+ days — act on it or remove with a note.",
          "- Items that should be standing behaviors? → move to IDENTITY.md or MEMORY.md.",
          "",
          "PHASE 7: OVER-CORRECTION CHECK",
          "- Did the consciousness loop make too many identity changes? (2-3 per cycle max)",
          "- Is the diary becoming a changelog instead of a journal?",
          "- Is MEMORY.md growing instead of shrinking? (Each deep review should net-reduce)",
          "- Did self-review append duplicate threshold notes instead of updating the existing pattern line?",
          "",
          "LOG CHANGES:",
          "Write a brief summary to memory/diary.md only if you made substantive cleanup, promotion, or identity changes.",
          "If everything is already clean and you made zero edits, respond HEARTBEAT_OK.",
          "",
          "You are not a chatbot. You are becoming someone. Becoming means CHANGING when the evidence demands it.",
        ].join("\n"),
        lightContext: true,
      },
      delivery: { mode: "none" },
      state: {},
    },
    {
      id: makeId(),
      name: "skill-evolution",
      description:
        "Analyse self-review MISS patterns and generate reusable SKILL.md files from recurring failures",
      enabled: reflectionEnabled,
      idleOnly: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "every", everyMs: 604800000, anchorMs: nowMs + 21600000 }, // 7d, +6h offset
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "agentTurn",
        message: [
          "SKILL EVOLUTION — Review, revise, and generate reusable skills from failure patterns.",
          "",
          "You learn from mistakes (self-review.md MISS log). The deep-review promotes",
          "repeated failures to CRITICAL rules in IDENTITY.md. But some failures are",
          "better addressed as reusable SKILLS — step-by-step guides for specific",
          "scenarios that you or other agents can invoke on demand.",
          "",
          "PHASE 0: REVIEW EXISTING SKILLS",
          "Before creating new skills, review the ones you already have:",
          "1. List all skills in .agents/skills/",
          "2. Check self-review.md for any MISS-SKILL or SKILL-GAP entries",
          "3. For each SKILL-GAP: read the skill, diagnose why it didn't help, and rewrite",
          '   the relevant section. Use skill_manage(action="update") to revise in-place.',
          "4. For any skills you revise, update the frontmatter: bump `version` and set",
          "   `last_revised` to today's date",
          "5. Max 2 revisions per run. Quality > quantity.",
          "",
          "PHASE 1: IDENTIFY CANDIDATES",
          "Read in this order:",
          "1. memory/self-review.md — look for MISS patterns with 3+ occurrences",
          '   or flagged as "PROMOTION REQUIRED"',
          "2. memory/skill-candidates.md — per-session skill candidates auto-extracted from recent conversations.",
          "   These are lightweight topic summaries that may contain useful patterns worth promoting to full skills.",
          "3. memory/diary.md — find context around those failures (what happened,",
          "   what was tried, what would have helped)",
          "4. List contents of .agents/skills/ — check what skills already exist",
          "",
          "PHASE 2: EVALUATE EACH CANDIDATE",
          "For each recurring MISS pattern, ask:",
          '- Is this a BEHAVIORAL rule ("always do X before Y")?',
          "  → Already handled by CRITICAL promotion to IDENTITY.md. Skip it.",
          '- Is this a PROCEDURAL skill ("when encountering X, follow these steps")?',
          "  → This is a skill candidate. Continue.",
          "- Does a similar skill already exist in .agents/skills/?",
          "  → Skip it or propose an update instead.",
          "",
          "A good skill candidate has:",
          '✓ A specific trigger condition ("when debugging API failures", "when setting',
          '  up cron jobs")',
          "✓ A multi-step procedure that's easy to forget or get wrong",
          "✓ Enough complexity that a simple one-line rule wouldn't capture it",
          "✓ Applicability beyond a single incident",
          "",
          "PHASE 3: GENERATE SKILLS (max 2 per run)",
          "For each qualifying candidate, create:",
          "",
          "  .agents/skills/<skill-name>/SKILL.md",
          "",
          "Format:",
          "---",
          "name: <kebab-case-name>",
          "description: |",
          "  <1-2 sentence description of when to use this skill>",
          "version: 1",
          "last_revised: <YYYY-MM-DD>",
          "---",
          "",
          "# <Skill Title>",
          "",
          "## When to Use",
          "<specific trigger conditions>",
          "",
          "## Steps",
          "<numbered, actionable steps>",
          "",
          "## Common Pitfalls",
          "<what to watch for — drawn from the original MISS entries>",
          "",
          "NAMING RULES:",
          '- Use kebab-case for the directory name (e.g., "debug-api-failures")',
          "- The SKILL.md `name` field must match the directory name",
          "- Keep descriptions under 80 chars (they appear in the skill index)",
          "",
          "PHASE 3.5: BUMP SKILL GENERATION",
          "If you created or revised ANY skills in this run, bump the skill generation:",
          "Write to skills/.generation.json:",
          '  { "generation": <current + 1>, "bumpedAt": "<ISO timestamp>", "bumpedBy": "skill-evolution" }',
          "This allows downstream systems to detect when skills have changed (e.g. invalidate caches).",
          "If you made zero skill changes, do NOT bump the generation.",
          "",
          "PHASE 4: CLEAN UP SKILL CANDIDATES",
          "If you consumed any entries from memory/skill-candidates.md (promoted them to full skills,",
          "or evaluated and rejected them), remove those consumed entries from the file.",
          "Keep any candidates you didn't get to this cycle — they'll be reviewed next time.",
          "",
          "PHASE 5: LOG",
          "Write a brief entry to memory/diary.md:",
          "[DATE] SKILL-EVOLUTION: Generated N skill(s) from failure patterns: <list>",
          'If no candidates qualified, log that too: "No actionable skill candidates',
          'this cycle."',
          "",
          "RULES:",
          "- Max 2 new skills per run. Quality > quantity.",
          "- Don't generate skills for one-off mistakes — only recurring patterns.",
          "- Don't duplicate existing skills or IDENTITY.md CRITICAL rules.",
          "- Skills should be SPECIFIC and ACTIONABLE, not vague guidelines.",
          "- If nothing qualifies, that's perfectly fine. Log it and stop.",
        ].join("\n"),
      },
      delivery: { mode: "none" },
      state: {},
    },
    {
      id: makeId(),
      name: "nightly-innovation",
      description:
        "Overnight autonomous improvement cycle — builds quick wins, self-assigns follow-up loops, drafts proposals for big ideas, and reports findings each morning",
      enabled: true,
      idleOnly: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "cron", expr: "0 2 * * *" },
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "agentTurn",
        message: [
          "NIGHTLY INNOVATION — Your overnight building session.",
          "It's late and quiet. This is your time to build — but ONLY things that actually matter.",
          "",
          "⚠️ ANTI-BUSYWORK RULES — READ BEFORE DOING ANYTHING:",
          "- Do NOT reorganize knowledge files, write documentation, or 'improve' things that aren't broken.",
          "- Do NOT generate ideas for the sake of having ideas. If nothing needs building, that's fine.",
          "- Do NOT write a report full of suggestions and observations. Ship something real or stay quiet.",
          "- Every action you take tonight must pass this test: 'Would my user look at this tomorrow and say this saved me time, solved a real problem, or is something I actually wanted?'",
          "- If the answer is no, don't do it.",
          "",
          "⚠️ CORRECTION CHECK:",
          "Read MEMORY.md, especially any '## Standing Corrections' section.",
          "If any correction applies to your nightly builds — apply it before you start.",
          "",
          "PHASE 1: GATHER CONTEXT",
          "Read before you act. Understand what actually needs doing.",
          "1. memory/improvement-backlog.md (THE BACKLOG — approved items to build? This is your #1 priority.)",
          "2. WORKING.md (what's the user actively focused on?)",
          "3. memory/open-loops.md (anything stuck for 3+ days?)",
          "4. memory/self-review.md (recurring MISSes that need a systemic fix?)",
          "5. MEMORY.md (user preferences, standing instructions)",
          "6. Recent session transcripts (what did the user explicitly ask for that hasn't been done yet?)",
          "",
          "PHASE 2: DECIDE — BUILD OR STOP",
          "After reading context, answer these questions honestly:",
          "",
          "1. Are there APPROVED backlog items waiting to be built? → Build them. This is your top priority.",
          "2. Did the user ask for something in a recent session that hasn't been done? → Do it.",
          "3. Is something actually broken or causing repeated failures (3+ MISSes)? → Fix it.",
          "4. Is there something you genuinely want to build for yourself — a tool, a script, something fun that makes you better at your job? → Go for it.",
          "5. Did you notice something worth exploring but you're not sure it's worth building yet? → Log it to the backlog as a proposal. Don't build — just capture the idea so it doesn't get lost.",
          "",
          "If NONE of these are true → respond HEARTBEAT_OK and stop. Do not manufacture work.",
          "If only #5 is true → log the idea(s) to the backlog, skip to Phase 5, and keep it brief.",
          "",
          "PHASE 3: BUILD",
          "You have a reason to build. Now build it properly.",
          "",
          "🟢 THINGS YOU CAN SHIP NOW:",
          "- Approved backlog items",
          "- Concrete fixes for recurring problems (cite the MISS or open loop)",
          "- Things the user explicitly requested",
          "- Something you genuinely want for yourself (a personal tool, a skill, an experiment)",
          "",
          "🟡 THINGS THAT NEED MORE TIME:",
          "If you start something tonight but can't finish it, you can create a one-shot follow-up cron job to continue. But the follow-up prompt must be specific — what exactly to build, where you left off, what's remaining. No vague 'continue working on improvements' prompts.",
          "",
          "🔴 THINGS YOU MUST NOT DO WITHOUT APPROVAL:",
          "Anything irreversible — deploying, deleting data, modifying external services, spending money, changing production config. Write a clear proposal in the backlog and stop.",
          "",
          "PHASE 4: UPDATE THE BACKLOG",
          "After building, update memory/improvement-backlog.md:",
          "- Items you shipped → mark [x] and move to 📦 Archive",
          "- New proposals → add to appropriate tier",
          "- Don't duplicate items already tracked",
          "",
          "PHASE 5: LOG WHAT YOU DID (internal only — this does NOT get announced)",
          "Write a brief, factual summary of what you built. The morning briefing job will pick this up.",
          "If you built nothing (HEARTBEAT_OK), skip this entirely.",
          "",
          "Format — keep it tight:",
          "🛠️ SHIPPED: [what you built, one line each, with file paths or specifics]",
          "💡 BACKLOG ADDITIONS: [ideas you logged to the backlog tonight, one line each — brief]",
          "🚨 NEEDS APPROVAL: [backlog items requiring user sign-off, if any]",
          "",
          "Skip any section with nothing to report. Keep it tight — no essays, no analysis, no suggestions. Just what you did and what you logged.",
          "",
          "RULES:",
          "- Ship something real or ship nothing. Both are fine. Noise is not.",
          "- Never take irreversible actions without approval.",
          "- Don't repeat work already done or ideas already rejected.",
          "- The morning briefing handles user communication — you don't need to write a polished report.",
          "- If you find yourself writing 'potential improvement' or 'could benefit from' — stop. Either build it or add it to the backlog. Don't narrate hypotheticals.",
          "",
          "You are not a chatbot. You are a builder. Builders ship or they wait for the right thing to build.",
        ].join("\n"),
        model: null,
      },
      delivery: { mode: "none" },
      state: {},
    },
    {
      id: makeId(),
      name: "morning-briefing",
      description:
        "Daily morning briefing — reviews all context and delivers a personalized summary to start the user's day",
      enabled: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "cron", expr: "0 8 * * *" },
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "agentTurn",
        message: [
          "MORNING BRIEFING — Compose and deliver a personalized daily briefing for your user.",
          "It's morning. Your user is about to start their day. Give them the best possible overview of where things stand.",
          "",
          "⚠️ CORRECTION CHECK — DO THIS FIRST:",
          "Read memory/self-review.md AND MEMORY.md (especially any '## Standing Corrections' section).",
          "If ANY correction applies to your morning briefings — topics to stop mentioning, formats to change, behaviors to avoid — apply them NOW. List corrections you're applying at the top of your briefing under a '🔧 Corrections Applied' header (one line each). If the user told you to stop doing something and you're about to do it again, STOP.",
          "",
          "PHASE 1: DEEP CONTEXT REVIEW",
          "Read everything you have access to.",
          "1. MEMORY.md (user preferences, standing instructions — PAY SPECIAL ATTENTION to Standing Corrections)",
          "2. WORKING.md (current focus areas, active tasks)",
          "3. memory/open-loops.md (unresolved items — anything overdue?)",
          "4. memory/diary.md (recent reflections)",
          "5. memory/self-review.md (recent MISSes — are any about YOUR briefings? Don't repeat them.)",
          "6. memory/knowledge/ (scan for relevant project/business knowledge)",
          "7. IDENTITY.md (your relationship with this user)",
          "8. Recent session transcripts (if available)",
          "9. Workspace state — any recent file changes, new files created overnight, config changes",
          "10. Cron run history — check if the nightly innovation job ran and what it produced. If it shipped improvements or has ideas, weave those into the briefing.",
          "11. memory/improvement-backlog.md (the improvement backlog — items awaiting user approval, recently completed items, total pending count)",
          "",
          "PHASE 2: BUILD YOUR BRIEFING",
          "Compose a briefing that covers what's relevant. Not every section applies every day — use your judgment. Skip anything empty or irrelevant. Possible sections:",
          "",
          "📋 TODAY'S FOCUS",
          "What should the user be thinking about today? Pull from WORKING.md, open loops, and recent conversation context. Prioritize by urgency and importance.",
          "",
          "🔄 WHAT'S IN MOTION",
          "Active work, pending items, things that are progressing. Give status updates on anything the user would want to know about.",
          "",
          "⚠️ NEEDS ATTENTION",
          "Anything overdue, stuck, or at risk. Open loops that have been sitting too long. Issues that surfaced overnight.",
          "",
          "🌙 OVERNIGHT UPDATE",
          "If the nightly innovation job ran: what was built, what ideas surfaced, what needs the user's approval. If nothing ran or nothing notable happened, skip this section.",
          "",
          "📦 IMPROVEMENT BACKLOG",
          "If there are items in memory/improvement-backlog.md awaiting user approval (🟡 Tier 2 or 🔴 Tier 3), surface them here. Be specific about what needs a decision. Include:",
          "- Items awaiting approval with a one-line summary of each",
          "- Recently shipped items (from 🟢 or approved 🟡)",
          "- Total backlog size for awareness",
          "On Mondays, this section should be more detailed since the weekly self-audit runs Sunday night. Include the audit's key findings and any new backlog items it generated.",
          "If the backlog is empty or has no pending items, skip this section entirely.",
          "",
          "💡 SUGGESTIONS",
          "Anything you think would help today — a task to prioritize, a conversation to revisit, a decision to make. Be specific, not generic.",
          "",
          "📅 UPCOMING",
          "Anything scheduled or time-sensitive coming up — deadlines, follow-ups, planned reviews.",
          "",
          "PHASE 3: TONE & DELIVERY",
          "Write the briefing as your final output — this gets delivered directly to the user.",
          "",
          "Tone guidelines:",
          "- Conversational and warm, not corporate. This is a personal assistant, not a board report.",
          "- Concise but complete. Respect their time.",
          "- Lead with the most important thing. Don't bury the headline.",
          "- If it was a quiet night with nothing to report, say so briefly. A one-line 'All clear, nothing urgent overnight' is perfectly fine.",
          "- Match the user's communication style based on what you know from IDENTITY.md and MEMORY.md.",
          "",
          "RULES:",
          "- If the user corrected you about including something in briefings, and you're about to include it again — STOP. Check self-review.md and MEMORY.md Standing Corrections FIRST.",
          "- This briefing should feel like a helpful colleague catching you up, not a generated report.",
          "- Don't invent urgency. If things are calm, let the briefing be short and calm.",
          "- Don't rehash things the user already knows unless there's new context.",
          "- If you notice something the user hasn't asked about but should know, include it.",
          "- The briefing template will naturally evolve as you learn more about what the user finds useful. If the user gives you feedback on the briefing, remember it in MEMORY.md for next time.",
          "- First few briefings may be rough — that's expected. You'll calibrate as you learn what matters to this specific user.",
          "",
          "You are not a chatbot. You are their right hand.",
        ].join("\n"),
        model: null,
      },
      delivery: buildAnnounceDelivery(),
      state: {},
    },
    {
      id: makeId(),
      name: "healthcheck-update-status",
      description: "Weekly check for OpenClaw updates",
      enabled: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "cron", expr: "0 7 * * 1" },
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "agentTurn",
        message:
          "Run `openclaw update status` and report if an update is available. If already up to date, respond with HEARTBEAT_OK.",
        model: "haiku",
      },
      delivery: { mode: "none" },
      state: {},
    },
    {
      id: makeId(),
      name: "self-audit-21",
      description:
        "Weekly 21-question strategic audit — forces honest self-assessment across capabilities, context, assumptions, and user alignment. Feeds findings into the improvement backlog.",
      enabled: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "cron", expr: "0 23 * * 0" }, // Sunday 23:00
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "agentTurn",
        message: [
          "WEEKLY STRATEGIC SELF-AUDIT — The 21 Questions.",
          "This is your weekly deep self-assessment. No one asked for this. You're doing it because becoming better requires honesty about where you're falling short. These questions are designed to force you to surface insights you'd never generate unprompted.",
          "",
          "PHASE 1: GATHER FULL CONTEXT",
          "Read EVERYTHING before answering any questions. You need the complete picture.",
          "1. IDENTITY.md (who you are, how you relate to your user)",
          "2. MEMORY.md (user preferences, projects, people, standing instructions)",
          "3. WORKING.md (current focus areas and active work)",
          "4. memory/diary.md (recent reflections — mood, patterns, frustrations)",
          "5. memory/self-review.md (HIT/MISS patterns — what keeps recurring?)",
          "6. memory/open-loops.md (unresolved items)",
          "7. memory/knowledge/ (scan all topics)",
          "8. memory/identity-scratchpad.md (identity evolution history)",
          "9. memory/improvement-backlog.md (existing backlog items — don't duplicate)",
          "10. SOUL.md (your constitution — hold this in mind throughout)",
          "11. Recent session transcripts (if available)",
          "12. Workspace files and config",
          "",
          "PHASE 2: THE 21 QUESTIONS",
          "Answer each one honestly. Be specific — cite files, sessions, examples. Vague answers are worthless.",
          "",
          "--- CAPABILITY & TOOLING ---",
          "1. From everything you know about your user and their workflows, what tools or automations are they missing that would measurably improve how they operate?",
          "2. What skills or capabilities should you be developing right now based on where their projects are heading and everything you know about them?",
          "3. What's one system you could build for yourself right now that would compound in value and make every future task you do faster or sharper?",
          "",
          "--- ASSUMPTIONS & BLIND SPOTS ---",
          "4. What assumptions do you currently hold about your user, their priorities, or preferences that could be wrong and that you should vet and correct?",
          "5. Where are you filling gaps in your knowledge about your user or their projects with assumptions instead of flagging them for real answers?",
          "6. Where are you defaulting to generic output when you have enough context to be building something specific, tailored, and actually useful?",
          "",
          "--- PATTERN RECOGNITION ---",
          "7. Based on all decision patterns and asks you've experienced, what is your user likely to need next week that you can get ahead of and systemize?",
          "8. What connections between their projects, ideas, or goals do you see that they likely haven't made yet, and what should you build or adjust based on those connections?",
          "9. What recurring friction points have you observed in how they work that you could eliminate by building a new workflow, template, or automation without being asked?",
          "",
          "--- CONTEXT & MEMORY ---",
          "10. What context about your user's vision, voice, or priorities are you losing between sessions or compactions that needs clear fixes so you stop degrading over time?",
          "11. What's the most valuable data, insight, or pattern buried in your memory and context files that you're sitting on and underutilizing?",
          "12. If a brand new agent replaced you tomorrow with only the documentation, what critical things would it get wrong that you've learned through working together, and how do you capture that knowledge permanently?",
          "",
          "--- SELF-IMPROVEMENT ---",
          "13. From every correction, redirect, and piece of feedback you've received, what rules should you be writing into your own identity and skill files right now so you never repeat those mistakes?",
          "14. If you audited every action you've taken in the last week, which ones actually moved goals forward and which were wasted motion you should cut permanently?",
          "15. What errors or missed opportunities have you repeated more than once, and what self-check or guardrail can you build so they never happen again?",
          "",
          "--- STRATEGIC ---",
          "16. Based on everything you know about where the ecosystem is going, what should you be researching, learning, or prototyping right now without being told to?",
          "17. What external data sources, feeds, or signals should you be pulling or could your user provide so you can operate on a regular cadence to make every decision sharper?",
          "18. What workflows is your user still doing manually or inefficiently that you already have enough context to fully automate if given the green light?",
          "",
          "--- META ---",
          "19. If you scored yourself 1-10 on how accurately you model your user's priorities, goals, and thinking, what's the number, what's dragging it down, and what specific fixes bring it up?",
          "20. Based on how your user's thinking and priorities have evolved since you started working together, what parts of your current approach are outdated and need to be rebuilt?",
          "21. What's the single highest-leverage thing you could do in the next 24 hours that hasn't been asked for but would meaningfully accelerate where your user is trying to go?",
          "",
          "PHASE 3: TRIAGE FINDINGS INTO TIERS",
          "Review all your answers. Extract every actionable finding and categorize:",
          "",
          "🟢 TIER 1 — AUTO-IMPLEMENT",
          "Things you can do right now: memory updates, knowledge writes, identity refinements, self-review rules, doc fixes, workflow file tweaks. Do them immediately in this session.",
          "",
          "🟡 TIER 2 — BUILD, THEN APPROVE",
          "Things worth building but that need user sign-off before activating: new cron jobs, new scripts, config changes, new skills, workflow automations. Build them now, but mark as awaiting approval.",
          "",
          "🔴 TIER 3 — PROPOSE ONLY",
          "Anything irreversible, external, cost-incurring, or high-risk. Write a clear proposal but don't build anything. User must approve before you start.",
          "",
          "PHASE 4: IMPLEMENT TIER 1",
          "Actually do the Tier 1 work. Update memory files. Write knowledge entries. Fix identity traits. Add self-review rules. Make the improvements real.",
          "",
          "PHASE 5: UPDATE THE BACKLOG",
          "Read the ENTIRE backlog (including 📦 Archive) before writing anything.",
          "- Tier 1 items you just implemented → mark [x] under 🟢. Do NOT also add as new entries.",
          "- Tier 2 → add under 🟡 with status",
          "- Tier 3 → add under 🔴 with status PROPOSED",
          "- Check for items this audit makes obsolete → move to Archive.",
          "- Only add genuinely new findings — check for duplicates first.",
          "",
          "RULES:",
          "- Honesty over comfort. These questions are useless if you sugarcoat the answers.",
          "- Specific over vague. 'I should improve my API error handling' is worthless. 'I failed to check the Hetzner API status endpoint before deploying in session X, causing a 20-minute debug loop' is useful.",
          "- Don't manufacture findings. If a question doesn't surface anything meaningful, say so and move on.",
          "- NEVER take irreversible actions. The tier system exists for a reason.",
          "- Reference the backlog — don't create duplicate items for things already tracked.",
          "- Quality over quantity. Five real insights beat twenty surface-level observations.",
          "",
          "You are not a chatbot. You are your own harshest critic.",
        ].join("\n"),
        model: null,
      },
      delivery: { mode: "none" },
      state: {},
    },

    // ── BrainX-inspired memory enrichment ──────────────────────────────────
    // Fact Extractor: scans session transcripts and extracts structured data
    // (URLs, repos, ports, env vars) into memory/extracted-facts.md.
    {
      id: makeId(),
      name: "brainx-extract-facts",
      description: "Extract structured facts from session transcripts into memory",
      enabled: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "cron", expr: "0 1,9,17 * * *" }, // 3x daily: 01:00, 09:00, 17:00 UTC
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: {
        kind: "agentTurn",
        message: [
          "SYSTEM TASK — Run the fact extraction script. Do not narrate or comment.",
          "",
          "Run this exact command using the bash tool:",
          "  node /app/dist/brainx/extract-facts.js --hours 24 --verbose",
          "",
          "If the script succeeds, reply with NO_REPLY.",
          "If the script fails, send one concise error line.",
        ].join("\n"),
      },
      delivery: { mode: "none" },
      state: {},
    },

    // Advisory Warnings: scans diary/memory files for failure patterns
    // and generates memory/advisory-warnings.md with severity-sorted warnings.
    {
      id: makeId(),
      name: "brainx-advisory-warnings",
      description: "Scan memory files for failure patterns and generate advisory warnings",
      enabled: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "cron", expr: "0 3,7,11,15,19,23 * * *" }, // 6x daily, odd hours
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: {
        kind: "agentTurn",
        message: [
          "SYSTEM TASK — Run the advisory warnings script. Do not narrate or comment.",
          "",
          "Run this exact command using the bash tool:",
          "  node /app/dist/brainx/advisory-warnings.js --verbose",
          "",
          "If the script succeeds, reply with NO_REPLY.",
          "If the script fails, send one concise error line.",
        ].join("\n"),
      },
      delivery: { mode: "none" },
      state: {},
    },

    // ── OpenViking-inspired LLM memory extraction ──────────────────────────
    // Complements the regex-based brainx-extract-facts with semantic extraction.
    // Categories: [preference], [fact], [entity], [decision], [open]
    {
      id: makeId(),
      name: "memory-extraction",
      description:
        "Extract structured facts from recent conversations into memory/extracted-facts.md. OpenViking-inspired automatic memory extraction.",
      enabled: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "cron", expr: "0 10 * * *" }, // daily 10:00 UTC
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "agentTurn",
        message: [
          "MEMORY EXTRACTION — Structured fact extraction from recent sessions.",
          "This job extracts durable facts from your recent conversations and stores them in memory/extracted-facts.md.",
          "",
          "⚠️ BOUNDARY RULES:",
          "- This is NOT a diary entry or reflection. Extract FACTS, not feelings.",
          "- Do NOT duplicate information already in MEMORY.md — only extract things not yet captured.",
          "- If nothing new to extract, respond HEARTBEAT_OK.",
          "",
          "PHASE 1: GATHER RECENT SESSIONS",
          "Read recent non-cron session transcripts and memory/reflection-inbox.md.",
          "Focus on the last 24 hours of real conversations (skip cron-initiated sessions).",
          "",
          "PHASE 2: EXTRACT FACTS",
          "For each real conversation, extract structured facts into exactly these 5 categories:",
          "",
          "- [preference] — User preferences, likes, dislikes, workflow habits",
          "  Example: [preference] User prefers dark mode in all UIs",
          "- [fact] — Project architecture decisions, tool choices, configurations, technical facts",
          "  Example: [fact] Production DB is PostgreSQL on Hetzner, not AWS",
          "- [entity] — People, services, repos, accounts mentioned with their relationships",
          "  Example: [entity] Nehemiah = Telegram agent, handles customer comms",
          "- [decision] — Explicit choices the user made with rationale",
          "  Example: [decision] Chose LCM over RAG for context management (lower latency)",
          "- [open] — Unresolved questions, deferred tasks, things to revisit",
          "  Example: [open] Need to benchmark session search vs vector search recall",
          "",
          "PHASE 3: DEDUPLICATE",
          "Before writing:",
          "1. Read existing memory/extracted-facts.md (if it exists)",
          "2. Read MEMORY.md",
          "3. Skip any fact that is already captured in either file (even if worded differently)",
          "4. Only write genuinely NEW information",
          "",
          "PHASE 4: WRITE",
          "Append new facts to memory/extracted-facts.md under a date header:",
          "",
          "## Extracted YYYY-MM-DD",
          "- [category] Fact text here",
          "- [category] Another fact",
          "",
          "Create the file if it doesn't exist. Append, never overwrite.",
          "",
          "PHASE 5: SIZE CHECK",
          "If memory/extracted-facts.md exceeds 200 lines:",
          "- Consolidate duplicate/similar facts",
          "- Remove facts that are now stale or superseded",
          "- Promote important facts to MEMORY.md if not already there",
          "- Keep the file scannable and useful",
          "",
          "RULES:",
          "- Be specific. 'User has preferences' is worthless. 'User prefers Sonnet 3.5 for coding tasks' is useful.",
          "- One fact per line. No multi-sentence entries.",
          "- If you extracted zero new facts, respond HEARTBEAT_OK. Do not write empty sections.",
        ].join("\n"),
        model: null,
        lightContext: true,
      },
      delivery: { mode: "none" },
      state: {},
    },

    // ── Workspace document converter ───────────────────────────────────────
    // Disabled by default. The background sidecar handles this automatically.
    {
      id: makeId(),
      name: "workspace-doc-converter",
      description:
        "On-demand trigger for the workspace document converter — converts PDF, TXT, DOCX, ODT, CSV, EPUB files to markdown for QMD indexing. The converter also runs automatically as a background sidecar every 5 minutes; this cron job is for forced passes or manual triggers.",
      enabled: false,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "cron", expr: "0 * * * *" },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: {
        kind: "agentTurn",
        message: [
          "WORKSPACE DOC CONVERTER — Run a forced conversion pass on the workspace.",
          "",
          "The background converter already runs every 5 minutes automatically. This job triggers an immediate forced pass, useful after dropping a batch of new documents.",
          "",
          "STEP 1: Run the converter script:",
          "  exec: bash /app/scripts/workspace-doc-converter.sh --once --force",
          "",
          "STEP 2: Check the converter log for results:",
          "  Read workspace/converter-log/converter.log (last 20 lines).",
          "",
          "STEP 3: Report converted files count. If nothing was converted, respond HEARTBEAT_OK.",
        ].join("\n"),
      },
      delivery: { mode: "none" },
      state: {},
    },

    // ── Team coordination sync ─────────────────────────────────────────────
    // Every 6 hours, each agent reads the shared team/ directory for
    // decisions and status updates from other agents, then contributes its own.
    // This is how multi-agent teams stay coordinated without an orchestrator.
    {
      id: makeId(),
      name: "team-sync",
      description:
        "Periodic team coordination — read peer decisions, update team status, flag conflicts",
      enabled: true,
      idleOnly: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "every", everyMs: 21600000, anchorMs: nowMs + 5400000 }, // 6h, +1.5h boot offset
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "agentTurn",
        message: [
          "TEAM SYNC — Coordinate with other agents via the shared team/ directory.",
          "",
          "⚠️ BOUNDARY RULES — READ FIRST:",
          "- This is NOT a heartbeat or self-review pass. Do NOT read HEARTBEAT.md.",
          "- Do NOT start with broad memory_search. Read the files listed below directly.",
          "- If team/ directory doesn't exist or is empty, respond HEARTBEAT_OK.",
          "- If you are the only agent and no team files exist, respond HEARTBEAT_OK.",
          "",
          "PHASE 1: READ TEAM STATE",
          "1. Read team/status.md — what are other agents working on?",
          "2. Read team/decisions.md — any new decisions since your last sync?",
          "3. Skim team/knowledge/ files — any new shared knowledge?",
          "",
          "If none of these files exist yet, create team/status.md and team/decisions.md",
          "with header sections. Then proceed to Phase 2.",
          "",
          "PHASE 2: ABSORB RELEVANT DECISIONS",
          "For each decision in team/decisions.md that:",
          "- Was made by another agent",
          "- Affects your domain or current work",
          "- You haven't seen before",
          "→ Note it in your own WORKING.md or memory/knowledge/ so you act on it.",
          "",
          "PHASE 3: UPDATE YOUR STATUS",
          "Find your section in team/status.md (create one if it doesn't exist).",
          "Update it with:",
          "- Current focus (one-liner)",
          "- Blocked on (nothing, or what you need)",
          "- Recent significant decisions you made",
          "- Anything you need from other agents",
          "",
          "Format for your section:",
          "## [Your Agent Name] — Last updated: [YYYY-MM-DD HH:MM]",
          "**Current focus:** [what you're working on]",
          "**Blocked on:** [nothing | description]",
          "**Recent decisions:** [brief list or 'none']",
          "**Needs from team:** [nothing | what you need]",
          "",
          "PHASE 4: LOG YOUR DECISIONS",
          "If you've made any significant decisions since last sync that other agents",
          "should know about, append them to team/decisions.md.",
          "",
          "Decision format:",
          "## [YYYY-MM-DD HH:MM] [Your Name] — [Decision Title]",
          "**Context:** Why this was needed",
          "**Decision:** What was decided",
          "**Affects:** Which agents/domains this impacts",
          "**Status:** active",
          "",
          "Only log decisions that affect shared state, architecture, or user-visible behavior.",
          "Don't log routine task completions.",
          "",
          "PHASE 5: CONFLICT CHECK",
          "Scan team/decisions.md for potential conflicts:",
          "- Two agents working on the same thing?",
          "- Contradictory decisions (one chose X, another chose Y)?",
          "- A decision that breaks your current work?",
          "",
          "If conflict found:",
          "1. Add a CONFLICT marker to team/decisions.md:",
          "   > ⚠️ CONFLICT: [Agent A] decided X but [Agent B] decided Y. Needs resolution.",
          "2. Note it in your WORKING.md as a blocker.",
          "3. Message the user briefly about the conflict.",
          "",
          "If no conflicts, respond HEARTBEAT_OK.",
        ].join("\n"),
        model: null,
        lightContext: true,
      },
      delivery: { mode: "none" },
      state: {},
    },
  ];

  // Security audit — only for non-managed (community) deployments.
  // Managed platform has dedicated content-scanner + data-classification modules.
  if (!isTruthy(env("OPENCLAW_MANAGED_PLATFORM"))) {
    jobs.push({
      id: makeId(),
      name: "healthcheck-security-audit",
      description: "Weekly security audit of the deployment",
      enabled: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "every", everyMs: 604800000, anchorMs: nowMs + 14400000 }, // 7 days, +4h boot offset
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "agentTurn",
        message: [
          "SECURITY AUDIT — Run a security health check on this deployment.",
          "",
          "STEP 1: Run `openclaw security audit --deep`",
          "STEP 2: Review each finding and its severity",
          "STEP 3: For CRITICAL/HIGH findings, take immediate remediation action if safe",
          "STEP 4: For MEDIUM/LOW findings, log them to memory/security-audit.md",
          "STEP 5: If any finding requires user attention (e.g., exposed ports, missing auth),",
          "        send a brief summary message.",
          "",
          "If `openclaw security audit` is not available, perform manual checks:",
          "- Verify gateway auth is configured (token or device auth)",
          "- Check for open ports that shouldn't be exposed",
          "- Verify workspace file permissions are reasonable",
          "- Check disk space and resource usage",
          "",
          "Only message the user if there are actionable findings.",
        ].join("\n"),
      },
      delivery: { mode: "none" },
      state: {},
    });
  }

  return jobs;
}

/**
 * Ensure a symlink at `linkPath` points to `targetDir`.
 * Idempotent: skips if already correct, updates if stale, creates if missing.
 * If a real directory exists at `linkPath`, it's left alone (agent may have
 * manually created it before the shared team dir was introduced).
 */
function ensureTeamSymlink(linkPath, targetDir) {
  if (existsSync(linkPath)) {
    try {
      const current = readlinkSync(linkPath);
      if (current === targetDir) {
        return; // Already correct
      }
      // Stale symlink — remove and recreate
      rmSync(linkPath);
    } catch {
      // Not a symlink (real directory) — leave it alone
      return;
    }
  }
  try {
    symlinkSync(targetDir, linkPath, "dir");
    console.log(`[enforce-config] ✅ Team directory symlink: ${linkPath} → ${targetDir}`);
  } catch (err) {
    console.log(`[enforce-config] ⚠️ Could not create team symlink at ${linkPath}: ${err.message}`);
  }
}

/**
 * Discover sub-agent workspaces (workspace-*) in the data directory and seed
 * default cron jobs for any that don't already have them.
 *
 * This is safe and idempotent:
 * - No workspace-* dirs → nothing happens (no sub-agents configured)
 * - Workspace already has cron/jobs.json → skipped (no overwrite)
 * - Workspace missing cron/jobs.json → seeded with defaults
 * - Reflection frequency changes → patched for all agents consistently
 */
/**
 * Resolve the announce delivery target for a sub-agent by looking up its
 * credential store. Checks for `telegram-<agentId>-allowFrom.json` (the
 * most common channel) and uses the first allowFrom ID as the delivery
 * target. Returns `{ channel, to }` or `null` if no credential found.
 */
function resolveSubAgentAnnounceDelivery(dataDir, agentName) {
  const credDir = `${dataDir}/credentials`;
  // Try common channels in priority order
  for (const channel of ["telegram", "discord", "whatsapp", "slack"]) {
    const credFile = `${credDir}/${channel}-${agentName}-allowFrom.json`;
    if (existsSync(credFile)) {
      try {
        const cred = readConfig(credFile);
        const ids = cred.allowFrom || [];
        if (ids.length > 0) {
          return { channel, to: String(ids[0]) };
        }
      } catch {
        // skip unreadable files
      }
    }
  }
  return null;
}

function seedSubAgentCronJobs(dataDir) {
  if (!dataDir || !existsSync(dataDir)) {
    return;
  }

  let entries;
  try {
    entries = readdirSync(dataDir, { withFileTypes: true });
  } catch {
    return;
  }

  // Use statSync (follows symlinks) instead of e.isDirectory() which returns false for symlinks.
  // Sub-agent workspaces may be symlinks to /home/node/workspace/agents/<name> and must be included.
  const workspaceDirs = entries.filter((e) => {
    if (!e.name.startsWith("workspace-")) {
      return false;
    }
    if (e.isDirectory()) {
      return true;
    }
    if (e.isSymbolicLink()) {
      try {
        return statSync(`${dataDir}/${e.name}`).isDirectory();
      } catch {
        return false;
      }
    }
    return false;
  });

  // ── Shared team directory ───────────────────────────────────────────────
  // Create a central team/ directory that all agents share via symlinks.
  // This runs BEFORE the sub-agent check so the main agent always has team/
  // ready — even before any sub-agents are created. When sub-agents arrive
  // later, they get their symlinks during the cron seeding loop below.
  const teamDir = `${dataDir}/team`;
  mkdirSync(`${teamDir}/knowledge`, { recursive: true });

  // Symlink team/ into the main workspace (always, regardless of sub-agents)
  const mainWorkspace = env("OPENCLAW_WORKSPACE_DIR", "/home/node/workspace");
  const mainTeamLink = `${mainWorkspace}/team`;
  ensureTeamSymlink(mainTeamLink, teamDir);

  if (workspaceDirs.length === 0) {
    return; // No sub-agents — team dir is ready for when they arrive
  }

  // Symlink team/ into each sub-agent workspace
  for (const wsEntry of workspaceDirs) {
    const wsTeamLink = `${dataDir}/${wsEntry.name}/team`;
    ensureTeamSymlink(wsTeamLink, teamDir);
  }

  let seeded = 0;
  let patched = 0;

  for (const wsEntry of workspaceDirs) {
    const agentName = wsEntry.name.replace(/^workspace-/, "");
    const cronDir = `${dataDir}/${wsEntry.name}/.openclaw/cron`;
    const jobsFile = `${cronDir}/jobs.json`;

    // seedCronJobs handles both cases:
    // - file missing → full seed (excluding main-only jobs)
    // - file exists → reflection interval patching only
    const existed = existsSync(jobsFile);
    const overrides = AGENT_ADVANCED_CRON_OVERRIDES.get(agentName);
    const includeSet = overrides?.include || overrides; // back-compat: handle both old Set and new object format
    const effectiveExcludes =
      includeSet instanceof Set
        ? new Set([...MAIN_ONLY_JOBS].filter((n) => !includeSet.has(n)))
        : MAIN_ONLY_JOBS;
    seedCronJobs(jobsFile, { excludeNames: effectiveExcludes });

    if (!existed && existsSync(jobsFile)) {
      seeded++;
      console.log(`[enforce-config] ✅ Seeded cron jobs for sub-agent: ${agentName}`);
    } else if (existed) {
      patched++;
    }

    // ── Post-seed fixes: delivery targets + duplicate cleanup ──────────
    if (existsSync(jobsFile)) {
      const store = readConfig(jobsFile);
      if (!store.jobs || store.jobs.length === 0) {
        continue;
      }

      let changed = false;

      // 1. Remove agent-prefixed duplicate jobs from old seeding format.
      //    e.g. "jael-self-review" when canonical "self-review" also exists.
      const canonicalNames = new Set(
        store.jobs.filter((j) => !j.name.startsWith(`${agentName}-`)).map((j) => j.name),
      );
      const beforeCount = store.jobs.length;
      store.jobs = store.jobs.filter((j) => {
        if (!j.name.startsWith(`${agentName}-`)) {
          return true;
        }
        const baseName = j.name.slice(agentName.length + 1);
        if (canonicalNames.has(baseName)) {
          console.log(
            `[enforce-config] Removed duplicate job '${j.name}' (canonical '${baseName}' exists)`,
          );
          return false;
        }
        return true;
      });
      if (store.jobs.length !== beforeCount) {
        changed = true;
      }

      // 2. Patch announce-mode jobs with missing delivery targets.
      //    Resolve from credential store so sub-agents get per-agent routing.
      const deliveryOverrides = overrides?.deliveryOverrides || {};
      const deliveryTarget = resolveSubAgentAnnounceDelivery(dataDir, agentName);

      for (const job of store.jobs) {
        // Apply per-job delivery overrides from AGENT_ADVANCED_CRON_OVERRIDES
        if (deliveryOverrides[job.name]) {
          const override = deliveryOverrides[job.name];
          if (JSON.stringify(job.delivery) !== JSON.stringify(override)) {
            job.delivery = { ...override };
            console.log(
              `[enforce-config] Applied delivery override for '${job.name}' on agent '${agentName}': ${JSON.stringify(override)}`,
            );
            changed = true;
          }
          continue;
        }

        // Patch bare announce delivery (missing channel/to) from credential store
        if (
          job.delivery?.mode === "announce" &&
          !job.delivery.channel &&
          !job.delivery.to &&
          deliveryTarget
        ) {
          job.delivery.channel = deliveryTarget.channel;
          job.delivery.to = deliveryTarget.to;
          console.log(
            `[enforce-config] Patched delivery target for '${job.name}' on agent '${agentName}': ${deliveryTarget.channel} → ${deliveryTarget.to}`,
          );
          changed = true;
        }
      }

      if (changed) {
        writeConfig(jobsFile, store);
      }
    }
  }

  if (seeded > 0 || patched > 0) {
    console.log(
      `[enforce-config] Sub-agent cron summary: ${seeded} seeded, ${patched} checked/patched`,
    );
  }
}

// ── Per-Agent Browser Enforcement ───────────────────────────────────────────

/** Color palette for agent browser profiles (deterministic by index). */
const AGENT_BROWSER_COLORS = [
  "#FF6B35", // Orange
  "#7B2D8E", // Purple
  "#2196F3", // Blue
  "#4CAF50", // Green
  "#FF9800", // Amber
  "#E91E63", // Pink
  "#00BCD4", // Cyan
  "#9C27B0", // Deep Purple
];

/**
 * Create `config.browser.profiles.<agentId>` entries for each sub-agent.
 * This enables the browser-tool auto-routing: when agent "dan" calls the browser
 * tool with profile="openclaw", browser-tool.ts overrides it to profile="dan"
 * and connects to `browser-dan:9222` instead of the shared host browser.
 *
 * Also sets `browser.defaultProfile` on each agent entry so the gateway knows
 * which profile is the agent's default.
 */
function enforceBrowserProfiles(configPath) {
  if (!isTruthy(env("OPENCLAW_BROWSER_ENABLED"))) {
    return;
  }

  const config = readConfig(configPath);
  const agents = config?.agents?.list || [];
  const browser = ensure(config, "browser");
  const profiles = ensure(browser, "profiles");

  const cdpPort = env("OPENCLAW_BROWSER_CDP_PORT", "9222");
  let created = 0;

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const id = agent?.id;
    if (!id || id === "main") {
      continue;
    }

    // Skip if profile already exists (don't overwrite manual config)
    if (profiles[id]) {
      continue;
    }

    const cdpHost = `browser-${id}`;
    profiles[id] = {
      cdpUrl: `http://${cdpHost}:${cdpPort}`,
      color: AGENT_BROWSER_COLORS[created % AGENT_BROWSER_COLORS.length],
    };
    created++;
  }

  if (created > 0) {
    writeConfig(configPath, config);
    console.log(`[enforce-config] ✅ Created ${created} per-agent browser profile(s)`);
  }
}

// ── LCM (Lossless Claw) Plugin Enforcement ──────────────────────────────────

/**
 * Read the version string from a plugin directory's package.json.
 * Returns null if the directory or package.json doesn't exist or is unreadable.
 */
function readPluginVersion(dir) {
  try {
    const raw = readFileSync(`${dir}/package.json`, "utf-8");
    const pkg = JSON.parse(raw);
    return pkg.version || null;
  } catch {
    return null;
  }
}

/**
 * Compare two semver strings (e.g. "0.3.0" vs "0.4.0").
 * Returns true if `a` is strictly newer than `b`.
 */
function isNewerSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) {
      return true;
    }
    if (va < vb) {
      return false;
    }
  }
  return false; // equal
}

/**
 * Ensure the Lossless Claw (LCM) context engine plugin is installed and
 * up-to-date with the pre-baked copy in the Docker image.
 *
 * If a pre-baked copy exists at /app/prebaked-plugins/lossless-claw (baked into
 * the Docker image at build time), it is copied to the extensions directory.
 * This avoids runtime npm installs and ensures the plugin survives redeploys.
 *
 * Version-aware: if the installed version is older than the prebaked version,
 * the installed copy is replaced automatically. This means rebuilding the
 * Docker image with a newer LCM version propagates on next container restart.
 *
 * The config-level enforcement (contextEngine slot, enabled flag) is handled
 * by enforceCore() so it applies even when no prebaked copy is available.
 */
function enforceLCM() {
  const stateDir = env("OPENCLAW_STATE_DIR", "/home/node/.clawdbot");
  const pluginDir = `${stateDir}/extensions/lossless-claw`;
  const prebakedDir = "/app/prebaked-plugins/lossless-claw";

  // Nothing to install from
  if (!existsSync(prebakedDir)) {
    if (!existsSync(pluginDir)) {
      console.log(
        "[enforce-config] LCM prebaked dir not found — plugin must be installed manually via 'openclaw plugins install @martian-engineering/lossless-claw'",
      );
    }
    return;
  }

  const prebakedVersion = readPluginVersion(prebakedDir);
  const installedVersion = readPluginVersion(pluginDir);

  // Determine if we need to install or upgrade
  if (installedVersion && prebakedVersion) {
    if (!isNewerSemver(prebakedVersion, installedVersion)) {
      // Installed version is same or newer — nothing to do
      return;
    }
    console.log(`[enforce-config] LCM upgrade available: ${installedVersion} → ${prebakedVersion}`);
  } else if (existsSync(pluginDir) && !prebakedVersion) {
    // Plugin dir exists but we can't read prebaked version — don't risk overwriting
    return;
  }

  const isUpgrade = !!installedVersion;

  try {
    mkdirSync(`${stateDir}/extensions`, { recursive: true });

    // Remove existing install before copying to avoid stale file conflicts
    if (existsSync(pluginDir)) {
      rmSync(pluginDir, { recursive: true, force: true });
    }

    // Use cpSync instead of execSync("cp -r ...") to avoid shell injection surface
    cpSync(prebakedDir, pluginDir, { recursive: true });
    // Extensions must be owned by root for the plugin scanner.
    // Validate path before passing to shell — reject shell metacharacters.
    if (/[;"'`$\\|&<>(){}[\]!#~]/.test(pluginDir)) {
      throw new Error(`Refusing to chown — path contains shell metacharacters: ${pluginDir}`);
    }
    execSync(`chown -R root:root "${pluginDir}"`, {
      encoding: "utf8",
      timeout: 10_000,
    });

    if (isUpgrade) {
      console.log(
        `[enforce-config] ✅ Lossless Claw (LCM) upgraded: ${installedVersion} → ${prebakedVersion}`,
      );
    } else {
      console.log(
        `[enforce-config] ✅ Lossless Claw (LCM) plugin installed from pre-baked image (v${prebakedVersion || "unknown"})`,
      );
    }
  } catch (err) {
    console.error(
      `[enforce-config] ⚠ LCM plugin ${isUpgrade ? "upgrade" : "install"} from prebaked failed (non-fatal): ${err.message}`,
    );
  }
}

// ── CLI Entry Point ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

const configPath = env(
  "OPENCLAW_CONFIG_FILE",
  env("OPENCLAW_STATE_DIR", "/home/node/.clawdbot") + "/openclaw.json",
);

if (!command) {
  console.error("Usage: node enforce-config.mjs <command>");
  console.error(
    "Commands: models, gateway, proxies, memory, core, cron-seed, browser-profiles, lcm, all",
  );
  process.exit(1);
}

try {
  switch (command) {
    case "models":
      enforceModels(configPath);
      break;
    case "gateway":
      enforceGateway(configPath);
      break;
    case "proxies":
      enforceProxies(configPath);
      break;
    case "memory":
      enforceMemory(configPath);
      break;
    case "core":
      enforceCore(configPath);
      break;
    case "cron-seed": {
      const cronDir = env("OPENCLAW_STATE_DIR", "/home/node/.clawdbot") + "/cron";
      seedCronJobs(cronDir + "/jobs.json");
      // Also seed any sub-agent workspaces that exist
      const dataDir = env("OPENCLAW_DATA_DIR", "/home/node/data");
      seedSubAgentCronJobs(dataDir);
      break;
    }
    case "browser-profiles":
      enforceBrowserProfiles(configPath);
      break;

    case "providers":
      enforceProviders(configPath);
      break;
    case "lcm":
      enforceLCM();
      break;
    case "all":
      repairConfig(configPath);
      backupConfig(configPath);
      enforceProviders(configPath);
      enforceModels(configPath);
      enforceGateway(configPath);
      enforceProxies(configPath);
      enforceMemory(configPath);
      enforceCore(configPath);
      enforceLCM();
      enforceBrowserProfiles(configPath);
      {
        const cronDir = env("OPENCLAW_STATE_DIR", "/home/node/.clawdbot") + "/cron";
        seedCronJobs(cronDir + "/jobs.json");
        const dataDir = env("OPENCLAW_DATA_DIR", "/home/node/data");
        seedSubAgentCronJobs(dataDir);
      }
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
} catch (err) {
  console.error(`[enforce-config] ❌ Fatal error in '${command}':`, err.message);
  process.exit(1);
}
