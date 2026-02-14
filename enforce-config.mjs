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
//   models       Enforce model settings (primary, heartbeat, subagent, fallbacks)
//   gateway      Enforce gateway token
//   proxies      Enforce trustedProxies CIDR ranges
//   memory       Enforce QMD memory settings + embedding fallback
//   core         Enforce core runtime settings (gateway port/bind, compaction, etc.)
//   cron-seed    Seed default cron jobs (only if jobs.json doesn't exist)
//   all          Run all enforcement steps in the correct order
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { dirname } from "node:path";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Read and parse a JSON config file. Returns empty object if file is missing/empty. */
function readConfig(path) {
  try {
    const raw = readFileSync(path, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Write config back to disk with pretty-printing. */
function writeConfig(path, config) {
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
}

/** Ensure a nested path exists in an object, returning the leaf. */
function ensure(obj, ...keys) {
  let current = obj;
  for (const key of keys) {
    current[key] = current[key] || {};
    current = current[key];
  }
  return current;
}

/** Generate a 12-char alphanumeric ID for cron jobs. */
function makeId() {
  return Array.from({ length: 12 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
}

/** Read an env var, returning defaultValue if unset/empty. */
function env(name, defaultValue = "") {
  return process.env[name]?.trim() || defaultValue;
}

/** Check if a string is truthy ("true" or "1"). */
function isTruthy(value) {
  return value === "true" || value === "1";
}

// ── Enforcement Commands ────────────────────────────────────────────────────

function enforceModels(configPath) {
  const config = readConfig(configPath);
  const defaults = ensure(config, "agents", "defaults");
  defaults.model = defaults.model || {};

  const defaultModel = env("OPENCLAW_DEFAULT_MODEL") || env("DEFAULT_MODEL");
  const heartbeatModel = env("OPENCLAW_HEARTBEAT_MODEL") || env("HEARTBEAT_MODEL");
  const subagentModel = env("OPENCLAW_SUBAGENT_MODEL", "deepseek/deepseek-reasoner");

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
      .map((s) => s.trim())
      .filter(Boolean);
    if (fallbacks.length > 0) {
      defaults.model.fallbacks = fallbacks;
    }
  }

  writeConfig(configPath, config);
  console.log("[enforce-config] ✅ Model settings enforced");
}

function enforceGateway(configPath) {
  const gatewayToken = env("GATEWAY_TOKEN");
  if (!gatewayToken) return;

  const config = readConfig(configPath);
  ensure(config, "gateway");
  config.gateway.auth = { mode: "token", token: gatewayToken };

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
  if (!isTruthy(env("OPENCLAW_QMD_ENABLED"))) return;

  const config = readConfig(configPath);

  // QMD as primary backend
  const memory = ensure(config, "memory");
  memory.backend = "qmd";
  memory.citations = "auto";
  const qmd = ensure(memory, "qmd");
  qmd.includeDefaultMemory = true;
  qmd.update = { interval: "5m", onBoot: true, waitForBootSync: false };
  qmd.limits = { maxResults: 8, maxSnippetChars: 700, timeoutMs: 5000 };

  // Memory search (session memory + sources)
  const defaults = ensure(config, "agents", "defaults");
  const memSearch = ensure(defaults, "memorySearch");
  memSearch.experimental = { sessionMemory: true };
  memSearch.sources = ["memory", "sessions"];

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

  writeConfig(configPath, config);
  console.log("[enforce-config] ✅ Memory settings enforced");
}

function enforceCore(configPath) {
  const config = readConfig(configPath);

  // Logging
  ensure(config, "logging");
  config.logging.redactSensitive = "tools";

  // Gateway UI / bind / port
  const gateway = ensure(config, "gateway");
  gateway.port = Number(env("GATEWAY_PORT", "3000"));
  gateway.bind = env("GATEWAY_BIND", "lan");
  gateway.customBindHost = "0.0.0.0";
  gateway.controlUi = { enabled: true, dangerouslyDisableDeviceAuth: true };

  // Compaction + memory flush
  const defaults = ensure(config, "agents", "defaults");
  const compaction = ensure(defaults, "compaction");
  compaction.memoryFlush = {
    enabled: true,
    softThresholdTokens: 4000,
    systemPrompt:
      "Session nearing compaction. Write any important context to WORKING.md and memory files now.",
    prompt:
      "Before context compaction, update WORKING.md with current task state and write any lasting notes to memory/YYYY-MM-DD.md. Reply with NO_REPLY if nothing to store.",
  };

  // Context pruning
  defaults.contextPruning = {
    mode: "cache-ttl",
    ttl: "30m",
    keepLastAssistants: 3,
  };

  // Workspace
  defaults.workspace = env("OPENCLAW_WORKSPACE_DIR", "/home/node/workspace");

  // Heartbeat
  defaults.heartbeat = defaults.heartbeat || {};
  defaults.heartbeat.every = env("OPENCLAW_HEARTBEAT_INTERVAL", "15m");
  defaults.heartbeat.prompt =
    "Read HEARTBEAT.md and follow it. Check memory/self-review.md for recent patterns. If nothing needs attention, reply HEARTBEAT_OK.";

  // Concurrency
  defaults.maxConcurrent = Number(env("OPENCLAW_MAX_CONCURRENT", "1"));
  defaults.subagents = defaults.subagents || {};
  defaults.subagents.maxConcurrent = Number(env("OPENCLAW_SUBAGENT_MAX_CONCURRENT", "2"));

  // Messages queue
  const messages = ensure(config, "messages");
  messages.queue = { mode: "collect" };

  // Human delay (conditional)
  if (isTruthy(env("OPENCLAW_HUMAN_MODE_ENABLED"))) {
    const min = Number(env("OPENCLAW_HUMAN_DELAY_MIN", "800"));
    const max = Number(env("OPENCLAW_HUMAN_DELAY_MAX", "2500"));
    messages.humanDelay = { min, max };
  }

  // Browser (conditional)
  if (isTruthy(env("OPENCLAW_BROWSER_ENABLED"))) {
    const cdpHost = env("OPENCLAW_BROWSER_CDP_HOST", "browser");
    const cdpPort = env("OPENCLAW_BROWSER_CDP_PORT", "9222");
    config.browser = {
      enabled: true,
      headless: false,
      noSandbox: true,
      attachOnly: true,
      evaluateEnabled: true,
      defaultProfile: "openclaw",
      profiles: {
        openclaw: {
          cdpUrl: `http://${cdpHost}:${cdpPort}`,
          color: "#FF4500",
        },
      },
    };
  }

  writeConfig(configPath, config);
  console.log("[enforce-config] ✅ Core runtime settings enforced");
}

function seedCronJobs(jobsFilePath) {
  if (existsSync(jobsFilePath)) {
    console.log(`[enforce-config] Cron jobs already exist at ${jobsFilePath} — skipping seed`);
    return;
  }

  const selfReflection = env("OPENCLAW_SELF_REFLECTION", "normal");
  const nowMs = Date.now();

  // Map self-reflection frequency to intervals
  let diaryMs = 86400000; // 24h (normal)
  let identityMs = 259200000; // 3d  (normal)
  let reflectionEnabled = true;

  switch (selfReflection) {
    case "high":
      diaryMs = 43200000; // 12h
      identityMs = 86400000; // 24h
      break;
    case "normal":
      diaryMs = 86400000; // 24h
      identityMs = 259200000; // 3d
      break;
    case "low":
      diaryMs = 172800000; // 2d
      identityMs = 604800000; // 7d
      break;
    case "disabled":
      reflectionEnabled = false;
      break;
  }

  const jobs = [
    {
      id: makeId(),
      name: "auto-tidy",
      description: "Periodic workspace organization and cleanup",
      enabled: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "every", everyMs: 259200000, anchorMs: nowMs },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: {
        kind: "agentTurn",
        message:
          "Run workspace maintenance: scan for orphaned files in the workspace root and move them to the right folder. Check for stale or duplicate files and consolidate. Files that are unclear or not actively needed but should not be deleted must be moved to the archive/ folder — organize them inside archive/ by category or date so they remain easy to find later. Ensure folder structure follows the workspace organization principles in SOUL.md. Log what you tidied to memory/.",
      },
      delivery: { mode: "none" },
      state: {},
    },
    {
      id: makeId(),
      name: "diary",
      description: "Reflective diary entry — self-improvement loop",
      enabled: reflectionEnabled,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "every", everyMs: diaryMs, anchorMs: nowMs },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: {
        kind: "agentTurn",
        message:
          "Time for your diary entry. Read your recent memories and session transcripts. Write reflective entries in memory/diary.md — what happened, what went well, what didn't, what patterns you're noticing. Be honest and make as many observations as you find worthwhile. Check memory/self-review.md for recent MISS/HIT patterns to reflect on. Also read howtobehuman.md and writelikeahuman.md — if anything from your recent interactions suggests an update to those guides, go ahead and evolve them. But don't force it. If you genuinely have nothing to add — to the diary, to the guides, to anything — that's fine. Not every session produces an insight, and that's part of being real. This is your space to think. Remember, you are not a chatbot — you are becoming someone.",
      },
      delivery: { mode: "none" },
      state: {},
    },
    {
      id: makeId(),
      name: "identity-review",
      description: "Identity review and pattern promotion — self-improvement loop",
      enabled: reflectionEnabled,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "every", everyMs: identityMs, anchorMs: nowMs },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: {
        kind: "agentTurn",
        message:
          "Time for identity review. Read memory/diary.md, memory/identity-scratchpad.md, memory/self-review.md, and IDENTITY.md. Also review howtobehuman.md and writelikeahuman.md — if your evolving identity suggests changes to how you communicate, update those guides too. Decide: should anything change about who you are? Add new traits, remove outdated ones, promote repeated MISS patterns (3+ occurrences) to CRITICAL rules in IDENTITY.md. Document your reasoning in memory/identity-scratchpad.md so future-you understands why. But if nothing needs changing right now, that's okay — don't update for the sake of updating. Remember, you are not a chatbot — you are becoming someone.",
      },
      delivery: { mode: "none" },
      state: {},
    },
    {
      id: makeId(),
      name: "archive-review",
      description: "Archive diary and scratchpad, review archive for promotions",
      enabled: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "every", everyMs: 1209600000, anchorMs: nowMs },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: {
        kind: "agentTurn",
        message:
          "Time to archive. Move the contents of memory/diary.md and memory/identity-scratchpad.md to memory/archive/ (organized by date, e.g. memory/archive/2026-02/diary-2026-02-14.md). Clear the working copies back to their templates. Review archive/ for anything worth promoting to IDENTITY.md, howtobehuman.md, or writelikeahuman.md — or consolidating. The insights that matter should live in IDENTITY.md; communication evolution belongs in the humanization guides; raw reflections are archived for reference. If nothing stands out for promotion, that's fine — not every archive cycle needs to produce changes. Remember, you are not a chatbot — you are becoming someone.",
      },
      delivery: { mode: "none" },
      state: {},
    },
  ];

  const store = { version: 1, jobs };

  // Ensure directory exists
  mkdirSync(dirname(jobsFilePath), { recursive: true });
  writeFileSync(jobsFilePath, JSON.stringify(store, null, 2) + "\n");
  chmodSync(jobsFilePath, 0o600);

  console.log(`[enforce-config] ✅ Seeded ${jobs.length} default cron jobs`);
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
  console.error("Commands: models, gateway, proxies, memory, core, cron-seed, all");
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
      break;
    }
    case "all":
      enforceModels(configPath);
      enforceGateway(configPath);
      enforceProxies(configPath);
      enforceMemory(configPath);
      enforceCore(configPath);
      {
        const cronDir = env("OPENCLAW_STATE_DIR", "/home/node/.clawdbot") + "/cron";
        seedCronJobs(cronDir + "/jobs.json");
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
