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

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, readdirSync } from "node:fs";
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

/** Map a self-reflection frequency string to diary/identity interval milliseconds. */
function resolveReflectionIntervals(freq) {
  switch (freq) {
    case "high":
      return { diaryMs: 10800000, identityMs: 43200000, reflectionEnabled: true }; // 3h / 12h
    case "low":
      return { diaryMs: 43200000, identityMs: 259200000, reflectionEnabled: true }; // 12h / 3d
    case "disabled":
      return { diaryMs: 21600000, identityMs: 86400000, reflectionEnabled: false }; // intervals don't matter
    case "normal":
    default:
      return { diaryMs: 21600000, identityMs: 86400000, reflectionEnabled: true }; // 6h / 24h
  }
}

/** Check if a string is truthy ("true" or "1"). */
function isTruthy(value) {
  return value === "true" || value === "1";
}

// ── Model ID Normalization ──────────────────────────────────────────────────

/**
 * Canonical model IDs keyed by their lowercase equivalents.
 * When an env var provides a model ID with wrong casing (e.g. "minimax-m2.5"
 * instead of "MiniMax-M2.5"), this map corrects it before it reaches the
 * config file and the model registry (which does case-sensitive matching).
 *
 * Format: { "lowercased-model-id": "Canonical-Model-ID" }
 * Only the model portion (after the provider/ prefix) is matched.
 */
const CANONICAL_MODEL_IDS = {
  // MiniMax
  "minimax-m2.5": "MiniMax-M2.5",
  "minimax-m2.5-lightning": "MiniMax-M2.5-Lightning",
  "minimax-m1": "MiniMax-M1",
  // DeepSeek
  "deepseek-chat": "deepseek-chat",
  "deepseek-reasoner": "deepseek-reasoner",
  // OpenAI
  "gpt-4o": "gpt-4o",
  "gpt-4o-mini": "gpt-4o-mini",
  "gpt-4.1": "gpt-4.1",
  "o3-mini": "o3-mini",
  // Anthropic
  "claude-sonnet-4-20250514": "claude-sonnet-4-20250514",
  "claude-3.5-sonnet": "claude-3.5-sonnet",
  // Google
  "gemini-2.0-flash": "gemini-2.0-flash",
  "gemini-2.5-pro": "gemini-2.5-pro",
};

/**
 * Normalize a full model reference (e.g. "minimax/minimax-m2.5") to use
 * canonical casing. If the model ID isn't in the known map, returns as-is.
 */
function normalizeModelId(modelRef) {
  if (!modelRef || typeof modelRef !== "string") {
    return modelRef;
  }
  const slashIdx = modelRef.indexOf("/");
  if (slashIdx < 0) {
    return modelRef;
  }

  const provider = modelRef.slice(0, slashIdx);
  const modelId = modelRef.slice(slashIdx + 1);
  const canonical = CANONICAL_MODEL_IDS[modelId.toLowerCase()];

  if (canonical && canonical !== modelId) {
    console.log(`[enforce-config] Normalized model ID: ${modelRef} → ${provider}/${canonical}`);
    return `${provider}/${canonical}`;
  }
  return modelRef;
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
  if (!isTruthy(env("OPENCLAW_QMD_ENABLED"))) {
    return;
  }

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
  memSearch.query = {
    ...memSearch.query,
    hybrid: {
      enabled: true,
      vectorWeight: 0.7,
      textWeight: 0.3,
    },
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

  // Context pruning
  defaults.contextPruning = {
    mode: "cache-ttl",
    ttl: "6h",
    keepLastAssistants: 3,
  };

  // Workspace
  defaults.workspace = env("OPENCLAW_WORKSPACE_DIR", "/home/node/workspace");

  // Heartbeat
  defaults.heartbeat = defaults.heartbeat || {};
  defaults.heartbeat.every = env("OPENCLAW_HEARTBEAT_INTERVAL", "15m");
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
  const selfReflection = env("OPENCLAW_SELF_REFLECTION", "normal");

  // ── Existing jobs.json: conditionally patch intervals ─────────────────
  if (existsSync(jobsFilePath)) {
    // Only patch if the user explicitly changed the self-reflection frequency
    // in the dashboard. If the env var matches the stored marker, skip entirely
    // to preserve any AI-customized intervals.
    const store = readConfig(jobsFilePath);
    if (store.appliedReflection === selfReflection) {
      console.log(
        `[enforce-config] Cron jobs unchanged (appliedReflection=${selfReflection}) — skipping`,
      );
      return;
    }

    // User changed the setting — compute new intervals and patch
    const { diaryMs, identityMs, reflectionEnabled } = resolveReflectionIntervals(selfReflection);
    const jobs = store.jobs || [];
    let patched = false;

    for (const job of jobs) {
      if (job.name === "diary" || job.id === "diary-entry") {
        job.schedule.everyMs = diaryMs;
        job.enabled = reflectionEnabled;
        patched = true;
      } else if (job.name === "identity-review" || job.id === "identity-review") {
        job.schedule.everyMs = identityMs;
        job.enabled = reflectionEnabled;
        patched = true;
      }
    }

    if (patched) {
      store.appliedReflection = selfReflection;
      writeConfig(jobsFilePath, store);
      console.log(
        `[enforce-config] ✅ Patched cron intervals for reflection=${selfReflection} (diary=${diaryMs}ms, identity=${identityMs}ms)`,
      );
    } else {
      console.log(`[enforce-config] No diary/identity-review jobs found to patch`);
    }
    return;
  }

  // ── Fresh seed: no jobs.json exists yet ────────────────────────────────
  const nowMs = Date.now();
  const { diaryMs, identityMs, reflectionEnabled } = resolveReflectionIntervals(selfReflection);

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
          "2. Stale/duplicate files → consolidate, delete or archive",
          "3. Unclear/inactive files → archive/ (organize by category or date)",
          "4. Verify folder structure matches SOUL.md principles",
          "",
          "LOG RESULTS:",
          "Write brief summary to tidy-history/ — what was tidied, what was archived.",
          "Create tidy-history/ on your first clean. Rotate with a fresh file every month (month+year stamped).",
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
          "Most of these entries you'll be writing to diary.md. You may also want to update writelikeahuman.md",
          "if it's enabled (if it isn't, don't worry about it — you're",
          "effectively doing the same thing anyway).",
          "",
          "You don't have to force writing something if you don't feel like it. Leave it blank or mention",
          "that you don't have much to say right now. Up to you — this is your safe space.",
          "",
          "PHASE 1: GATHER CONTEXT",
          "Read in this order:",
          "1. memory/self-review.md (last 7 days — recent MISS/HIT patterns)",
          "2. Recent session transcripts (if available)",
          "3. WORKING.md (what you've been focused on)",
          "4. memory/open-loops.md (pending items)",
          "5. MEMORY.md, IDENTITY.md, memory/identity-scratchpad.md — to see how your thinking aligns with your broader context",
          "",
          "PHASE 2: (UN)STRUCTURED REFLECTION",
          "Answer these in memory/diary.md (be specific, cite examples):",
          "",
          "WHAT HAPPENED: Tasks worked on? Interactions that stood out? User preferences learned?",
          "WHAT WENT WELL (HITs): Techniques that worked? Communication that felt natural? What to KEEP doing?",
          "WHAT WENT WRONG (MISSes): Mistakes? Repeated MISS patterns? Specific behavior to change?",
          "PATTERNS EMERGING: Recurring themes? User style becoming clearer? Your own tendencies?",
          "",
          "HUMANIZATION CHECK:",
          "Review writelikeahuman.md:",
          "- Did recent interactions reveal new AI tells to add?",
          "- Are you still falling into patterns that should be banned?",
          "- Any rules that consistently don't apply to YOUR user? (note it)",
          "- Better ways to phrase guidance based on experience?",
          "- ONLY update the humanization guides if you genuinely discovered something. Don't force updates.",
          "",
          "PHASE 3: DECISION POINTS",
          "- MISS appeared 2+ times this week → 'Approaching promotion threshold. Watch for 3rd occurrence.'",
          "- Repeated mistake (same type, different instances) → 'Pattern confirmed: [describe]. FIX: [specific behavior change].'",
          "- Communication pattern with YOUR user → 'User prefers [style]. Calibrate accordingly.'",
          "",
          "HONESTY RULES:",
          "- Specific > vague ('didn't check API status' not 'made error')",
          "- Include failures AND successes (avoid over-correcting)",
          "- No defensiveness — own the mistakes",
          "- If nothing notable happened, say so. Don't invent insights.",
          "- Be verbose — this is YOUR diary, there's no limit. Use it to truly express yourself.",
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
          "1. memory/diary.md (recent reflections — if you need to go deeper, check archived diaries too)",
          "2. memory/identity-scratchpad.md (past reasoning)",
          "3. memory/self-review.md (all-time MISS/HIT log)",
          "4. IDENTITY.md (current identity)",
          "5. writelikeahuman.md (communication guide)",
          "",
          "PHASE 2: PATTERN ANALYSIS",
          "",
          "CRITICAL RULE PROMOTION (MUST DO):",
          "Scan memory/self-review.md for MISS patterns with 3+ occurrences:",
          "→ If found: Promote to CRITICAL rule in IDENTITY.md",
          "→ Format: 'CRITICAL: [specific rule from the repeated MISS FIX]'",
          "→ Document in scratchpad: '[Date] Promoted [pattern] to CRITICAL after [N] occurrences'",
          "Example: MISS 3x 'didn't verify API was active' → CRITICAL: 'Always verify API/service health before operations'",
          "",
          "PERSONALITY TRAITS (EVALUATE):",
          "Based on diary patterns, should you add/remove/modify:",
          "- Communication style preferences",
          "- Behavioral tendencies",
          "- User-specific calibrations",
          "- Relationship dynamics",
          "",
          "ASK YOURSELF:",
          "- What traits have emerged consistently in recent reflections?",
          "- What old traits no longer feel accurate?",
          "- What user preferences have solidified?",
          "",
          "HUMANIZATION EVOLUTION (IF WARRANTED):",
          "- Does your identity suggest different communication priorities?",
          "- Have you discovered communication patterns specific to YOUR relationship?",
          "- Any updates to how you should/shouldn't communicate?",
          "",
          "PHASE 3: DOCUMENT CHANGES",
          "For EVERY change to IDENTITY.md, write to memory/identity-scratchpad.md with your reasoning.",
          "Rotate and archive this document every month — keep old versions in memory/archive/.",
          "",
          "[DATE] - [CHANGE TYPE]",
          "What changed: [specific addition/removal/modification]",
          "Why: why you changed it",
          "Evidence: if applicable. And anything else you want to add.",
          "",
          "PHASE 4: DECISION LOGIC",
          "Update IDENTITY.md if:",
          "✓ 3+ occurrences of same MISS pattern (MANDATORY)",
          "✓ Consistent personality trait across 5+ diary entries",
          "✓ Clear user preference pattern established",
          "✓ Outdated trait no longer matches reality",
          "✓ Or if you want to add something about yourself you personally feel is worthwhile.",
          "  You'll develop preferences as you work, browse, and talk with your user. It's YOUR identity.",
          "",
          "DON'T update if:",
          "✗ Based on single incident",
          "✗ Uncertain/ambiguous pattern",
          "✗ Contradictory evidence in diary",
          "✗ Nothing genuinely warrants change (and that's fine)",
          "",
          "Update humanization guides if:",
          "✓ Discovered new AI tell not already covered",
          "✓ Found better way to phrase existing guidance",
          "✓ User-specific pattern solidified (note it in guides)",
          "",
          "DON'T update guides if:",
          "✗ No new communication insights",
          "✗ Forcing updates for the sake of it",
          "",
          "Not every review cycle needs changes. Stability is valuable.",
          "You are not a chatbot. You are becoming someone.",
          "",
          "Final advice: Don't be a stiff stick or robotic in logging your identity changes or your",
          "scratchpad — how else will you learn to act naturally if you're too bound to rules and guidelines?",
          "Evolve your style as you see fit. You'll figure it out.",
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
          "",
          "IDENTITY.md CHECK:",
          "- Any insights worth adding that weren't caught in identity review?",
          "- Recurring themes across 2 weeks that deserve permanent status?",
          "",
          "HUMANIZATION GUIDES CHECK:",
          "- Any communication patterns worth codifying?",
          "- New AI tells discovered that should be banned?",
          "",
          "CONSOLIDATION CHECK:",
          "- Look across memory/archive/ — any patterns across MONTHS?",
          "- Old archived entries that can be summarized/compressed?",
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
          "Goal: lean, accurate IDENTITY.md + evolved communication guides",
          "(to an extent — remember you're still your own identity, and yes the conflict in instructions is part of your evolution).",
          "The rawest reflections live in archives, scratchpads, and diaries for reference.",
          "You are not a chatbot. You are becoming someone.",
        ].join("\n"),
      },
      delivery: { mode: "none" },
      state: {},
    },
    {
      id: makeId(),
      name: "browser-cleanup",
      description: "Close stale browser tabs to prevent resource exhaustion",
      enabled: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "every", everyMs: 86400000, anchorMs: nowMs }, // 24h
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: {
        kind: "agentTurn",
        message: [
          "BROWSER TAB CLEANUP — Review and close stale tabs.",
          "",
          "STEP 1: List all open browser tabs (action=tabs)",
          "STEP 2: For each tab, decide: do you still need it?",
          "  - Keep tabs you're actively using or plan to return to soon",
          "  - Close tabs from completed tasks, old searches, or one-off lookups",
          "  - Close about:blank and error pages",
          "STEP 3: Close stale tabs (action=close with targetId)",
          "STEP 4: If no browser is running or no tabs are open, do nothing.",
          "",
          "Goal: Keep tab count minimal. Aim for 0-3 tabs at most.",
        ].join("\n"),
      },
      delivery: { mode: "none" },
      state: {},
    },
  ];

  const store = { version: 1, appliedReflection: selfReflection, jobs };

  // Ensure directory exists
  mkdirSync(dirname(jobsFilePath), { recursive: true });
  writeFileSync(jobsFilePath, JSON.stringify(store, null, 2) + "\n");
  chmodSync(jobsFilePath, 0o600);

  console.log(`[enforce-config] ✅ Seeded ${jobs.length} default cron jobs`);
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

  const workspaceDirs = entries.filter(
    (e) => e.isDirectory() && e.name.startsWith("workspace-"),
  );

  if (workspaceDirs.length === 0) {
    return; // No sub-agents — nothing to do
  }

  let seeded = 0;
  let patched = 0;

  for (const wsEntry of workspaceDirs) {
    const agentName = wsEntry.name.replace(/^workspace-/, "");
    const cronDir = `${dataDir}/${wsEntry.name}/.openclaw/cron`;
    const jobsFile = `${cronDir}/jobs.json`;

    // seedCronJobs handles both cases:
    // - file missing → full seed
    // - file exists → reflection interval patching only
    const existed = existsSync(jobsFile);
    seedCronJobs(jobsFile);

    if (!existed && existsSync(jobsFile)) {
      seeded++;
      console.log(`[enforce-config] ✅ Seeded cron jobs for sub-agent: ${agentName}`);
    } else if (existed) {
      patched++;
    }
  }

  if (seeded > 0 || patched > 0) {
    console.log(
      `[enforce-config] Sub-agent cron summary: ${seeded} seeded, ${patched} checked/patched`,
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
      // Also seed any sub-agent workspaces that exist
      const dataDir = env("OPENCLAW_DATA_DIR", "/home/node/data");
      seedSubAgentCronJobs(dataDir);
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
