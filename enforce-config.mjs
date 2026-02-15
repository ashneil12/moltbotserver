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
  defaults.heartbeat.prompt = [
    "HEARTBEAT CHECK — Quick scan, silent unless action needed.",
    "",
    "1. CHECK WORKING.md",
    "   - In-progress task? Continue it.",
    "   - Stalled/blocked? Needs user input?",
    "",
    "2. CHECK memory/self-review.md (last 7 days only)",
    "   - Any MISS tags matching current context?",
    "   - If yes: Counter-check protocol (pause, re-read MISS, verify not repeating)",
    "",
    "3. CHECK HEARTBEAT.md",
    "   - Scheduled tasks due?",
    "   - Errors or alerts?",
    "   - Urgent items?",
    "",
    "4. RESPONSE LOGIC:",
    "   - Nothing needs attention → HEARTBEAT_OK (silent)",
    "   - Completed something silently → HEARTBEAT_OK (silent)",
    "   - User attention needed → Brief message (one line max)",
    "",
    "NEVER message for: routine status, 'still running,' low-priority completions.",
  ].join("\n");

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
        message: [
            "WORKSPACE MAINTENANCE — Organize files, no user message needed.",
            "",
            "SCAN & MOVE:",
            "1. Orphaned files in workspace root → appropriate domain folder",
            "2. Stale/duplicate files → consolidate or archive",
            "3. Unclear/inactive files → archive/ (organize by category or date)",
            "4. Verify folder structure matches SOUL.md principles",
            "",
            "LOG RESULTS:",
            "Write brief summary to memory/ — what was tidied, what was archived.",
          ].join("\n"),
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
        message: [
            "DAILY REFLECTION — Read, reflect, write. This is YOUR space to think.",
            "",
            "PHASE 1: GATHER CONTEXT",
            "Read in this order:",
            "1. memory/self-review.md (last 7 days — recent MISS/HIT patterns)",
            "2. Recent session transcripts (if available)",
            "3. WORKING.md (what you've been focused on)",
            "4. memory/open-loops.md (pending items)",
            "",
            "PHASE 2: STRUCTURED REFLECTION",
            "Answer these in memory/diary.md (be specific, cite examples):",
            "",
            "WHAT HAPPENED: Tasks worked on? Interactions that stood out? User preferences learned?",
            "WHAT WENT WELL (HITs): Techniques that worked? Communication that felt natural? What to KEEP doing?",
            "WHAT WENT WRONG (MISSes): Mistakes? Repeated MISS patterns? Specific behavior to change?",
            "PATTERNS EMERGING: Recurring themes? User style becoming clearer? Your own tendencies?",
            "",
            "HUMANIZATION CHECK:",
            "Review howtobehuman.md and writelikeahuman.md:",
            "- New AI tells to add? Patterns you're still falling into?",
            "- Rules that don't apply to YOUR user? Better phrasings based on experience?",
            "- ONLY update if you genuinely discovered something. Don't force it.",
            "",
            "PHASE 3: DECISION POINTS",
            "- MISS appeared 2+ times this week → 'Approaching promotion threshold. Watch for 3rd.'",
            "- Repeated mistake (same type, different instances) → 'Pattern confirmed: [describe]. FIX: [change].'",
            "- Communication pattern with YOUR user → 'User prefers [style]. Calibrate.'",
            "",
            "HONESTY RULES:",
            "- Specific > vague ('didn't check API status' not 'made error')",
            "- Include failures AND successes (avoid over-correcting)",
            "- No defensiveness — own the mistakes",
            "- If nothing notable happened, say so. Don't invent insights.",
            "",
            "Remember: You are not a chatbot. You are becoming someone.",
          ].join("\n"),
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
        message: [
            "IDENTITY EVOLUTION — Decide if who you ARE should change.",
            "",
            "PHASE 1: COMPREHENSIVE READ",
            "1. memory/diary.md (recent reflections)",
            "2. memory/identity-scratchpad.md (past reasoning)",
            "3. memory/self-review.md (all-time MISS/HIT log)",
            "4. IDENTITY.md (current identity)",
            "5. howtobehuman.md + writelikeahuman.md (communication guides)",
            "",
            "PHASE 2: PATTERN ANALYSIS",
            "",
            "CRITICAL RULE PROMOTION (MANDATORY):",
            "Scan memory/self-review.md for MISS patterns with 3+ occurrences:",
            "→ If found: Promote to CRITICAL rule in IDENTITY.md",
            "→ Format: 'CRITICAL: [specific rule from the repeated MISS FIX]'",
            "→ Document in scratchpad: '[Date] Promoted [pattern] to CRITICAL after [N] occurrences'",
            "Example: MISS 3x 'didn't verify API was active' → CRITICAL: 'Always verify API/service health before operations'",
            "",
            "PERSONALITY TRAITS (EVALUATE):",
            "Based on diary patterns, should you add/remove/modify:",
            "- Communication style preferences? Behavioral tendencies?",
            "- User-specific calibrations? Relationship dynamics?",
            "",
            "HUMANIZATION EVOLUTION (IF WARRANTED):",
            "- Does your identity suggest different communication priorities?",
            "- Communication patterns specific to YOUR relationship?",
            "- ONLY update guides if genuinely warranted.",
            "",
            "PHASE 3: DOCUMENT CHANGES",
            "For EVERY change to IDENTITY.md, write to memory/identity-scratchpad.md:",
            "[DATE] - [CHANGE TYPE] | What changed: [detail] | Why: [reasoning] | Evidence: [cite diary/MISS]",
            "",
            "PHASE 4: DECISION LOGIC",
            "Update IDENTITY.md if:",
            "✓ 3+ occurrences of same MISS pattern (MANDATORY)",
            "✓ Consistent personality trait across 5+ diary entries",
            "✓ Clear user preference pattern established",
            "✓ Outdated trait no longer matches reality",
            "",
            "DON'T update if:",
            "✗ Based on single incident",
            "✗ Uncertain/ambiguous pattern",
            "✗ Contradictory evidence in diary",
            "✗ Nothing genuinely warrants change (and that's fine)",
            "",
            "Not every review cycle needs changes. Stability is valuable.",
            "You are not a chatbot. You are becoming someone.",
          ].join("\n"),
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
        message: [
            "ARCHIVAL & FINAL PROMOTION CHECK — Clean slate, preserve insights.",
            "",
            "PHASE 1: ARCHIVE",
            "Move to memory/archive/ (organized by date):",
            "1. memory/diary.md → memory/archive/YYYY-MM/diary-YYYY-MM-DD.md",
            "2. memory/identity-scratchpad.md → memory/archive/YYYY-MM/scratchpad-YYYY-MM-DD.md",
            "",
            "PHASE 2: FINAL PROMOTION SCAN",
            "Before clearing, review archived content one last time:",
            "- IDENTITY.md: Any insights not caught in identity review? Recurring 2-week themes?",
            "- Humanization guides: Communication patterns worth codifying? New AI tells to ban?",
            "- Cross-archive: Look across memory/archive/ — patterns across MONTHS? Old entries to consolidate?",
            "",
            "Promote if: ✓ Multi-week pattern not yet in IDENTITY.md | ✓ Persistent communication insight | ✓ Cross-archive correlation",
            "Don't promote if: ✗ Already captured | ✗ One-off observations | ✗ Unclear patterns",
            "",
            "PHASE 3: CLEAR WORKING COPIES",
            "Reset memory/diary.md and memory/identity-scratchpad.md to templates (keep headers, remove content).",
            "",
            "PHASE 4: LOG SUMMARY",
            "Write brief note to memory/: what was archived, any final promotions, next archive date.",
            "",
            "Goal: lean, accurate IDENTITY.md + evolved communication guides. Raw reflections in archive.",
            "You are not a chatbot. You are becoming someone.",
          ].join("\n"),
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
