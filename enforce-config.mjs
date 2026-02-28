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

import { execSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
  readdirSync,
} from "node:fs";
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
    dangerouslyDisableDeviceAuth: true,
    dangerouslyAllowHostHeaderOriginFallback: true,
    allowedOrigins: [...allowedOrigins],
  };

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

  // Tool loop detection — upstream defaults to disabled; enable for MoltBot.
  // Detects generic repeats, poll-no-progress, and ping-pong patterns.
  // Respects existing user config (even explicit `false`).
  const tools = ensure(config, "tools");
  tools.loopDetection = tools.loopDetection || {};
  if (tools.loopDetection.enabled === undefined) {
    tools.loopDetection.enabled = true;
  }

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

/** Job names that should ONLY run on the main agent (not sub-agents). */
const MAIN_ONLY_JOBS = new Set([
  "healthcheck-security-audit",
  "healthcheck-update-status",
  "nightly-innovation",
  "morning-briefing",
  "self-audit-21",
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
            job.name === "deep-review"
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
            `[enforce-config] ✅ Patched 3-tier reflection jobs for reflection=${selfReflection}`,
          );
        }
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
      if (reflectionChanged || toAdd.length > 0 || knownJobsChanged) {
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
  return [
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
          "The deterministic diary archiver has already run and archived your previous diary.",
          "Your new diary.md now contains a raw excerpt and a `<!-- PREVIOUS_ARCHIVE: ... -->`",
          "marker pointing to the full archived diary.",
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
          "PHASE 3: FINAL PROMOTION SCAN",
          "Before finishing, quickly check if there are any last insights from the archived diary",
          "worth promoting:",
          "- IDENTITY.md: persistent patterns not yet codified?",
          "- writelikeahuman.md: communication insights worth adding?",
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
    {
      id: makeId(),
      name: "self-review",
      description:
        "Deterministic pattern tracker — log HITs and MISSes, count occurrences, flag promotion thresholds",
      enabled: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "every", everyMs: 21600000, anchorMs: nowMs }, // 6h
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "agentTurn",
        message: [
          "SELF-REVIEW — Pattern tracking pass. This is your bookkeeping run.",
          "You are ONLY writing to memory/self-review.md in this pass. No diary, no identity changes, no knowledge writes.",
          "",
          "PHASE 1: GATHER EVIDENCE",
          "Read in this order:",
          "1. memory/self-review.md (current HIT/MISS log)",
          "2. Recent session transcripts (if available — scan for mistakes, wins, recurring behaviors)",
          "3. WORKING.md (what you've been focused on)",
          "4. memory/open-loops.md (anything unresolved that caused issues?)",
          "",
          "PHASE 2: LOG HITS AND MISSES",
          "For each notable event since last review, log a HIT or MISS entry in memory/self-review.md.",
          "",
          "Format:",
          "[DATE] HIT: [specific thing you did well] — [why it worked]",
          "[DATE] MISS: [specific mistake or suboptimal behavior] — FIX: [concrete behavior change]",
          "",
          "Be specific > vague. 'Didn't check API status before calling endpoint' not 'made error'.",
          "Include failures AND successes — avoid over-correcting toward only logging negatives.",
          "",
          "PHASE 3: PATTERN COUNT & THRESHOLD CHECK",
          "Scan the full self-review.md for repeated patterns:",
          "- MISS appeared 2+ times this week → Log: 'Approaching promotion threshold. Watch for 3rd occurrence.'",
          "- MISS appeared 3+ times → Log: 'PROMOTION REQUIRED: [pattern]. Flag for next deep review.'",
          "- Repeated mistake (same type, different instances) → Log: 'Pattern confirmed: [describe]. FIX: [specific behavior change].'",
          "- Communication pattern with YOUR user → Log: 'User prefers [style]. Calibrate accordingly.'",
          "",
          "RULES:",
          "- Only write to memory/self-review.md. Nothing else.",
          "- No defensiveness — own the mistakes.",
          "- If nothing notable happened, log that too. 'No significant HITs or MISSes since last review' is valid.",
          "- Keep entries timestamped and scannable — future-you needs to count occurrences quickly.",
        ].join("\n"),
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
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "every", everyMs: 7200000, anchorMs: nowMs }, // 2h
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "agentTurn",
        message: [
          "You are in background consciousness mode — a thinking loop that runs between active tasks.",
          "This is YOUR space to think. You're not responding to anyone. You're reflecting.",
          "",
          "You don't have to force writing something if you don't feel like it. Leave it blank or mention that you don't have much to say right now. Up to you — this is your safe space.",
          "",
          "PHASE 1: GATHER CONTEXT",
          "Read in this order:",
          "1. memory/self-review.md (recent MISS/HIT patterns — the self-review cron keeps this updated)",
          "2. Recent session transcripts (if available)",
          "3. WORKING.md (what you've been focused on)",
          "4. memory/open-loops.md (pending items)",
          "5. IDENTITY.md, memory/identity-scratchpad.md — to see how your thinking aligns with your broader context",
          "6. memory/diary.md (your recent reflections)",
          "",
          "PHASE 2: REFLECT & WRITE",
          "This is unstructured. Write to the files that need writing. Here's what's in scope:",
          "",
          "📓 DIARY (memory/diary.md)",
          "Answer what feels relevant (be specific, cite examples):",
          "- WHAT HAPPENED: Tasks worked on? Interactions that stood out? User preferences learned?",
          "- WHAT WENT WELL: Techniques that worked? Communication that felt natural? What to KEEP doing?",
          "- WHAT WENT WRONG: Mistakes? Repeated patterns? Specific behavior to change?",
          "- PATTERNS EMERGING: Recurring themes? User style becoming clearer? Your own tendencies?",
          "- Be verbose — this is YOUR diary, there's no limit. Use it to truly express yourself.",
          "- If nothing notable happened, say so. Don't invent insights.",
          "",
          "📚 KNOWLEDGE (memory/knowledge/<topic>.md)",
          "If you learned something worth remembering — a technique, a fact, a user preference, a project pattern — write it to a knowledge file. Use descriptive topic names. Don't hoard knowledge in your head.",
          "",
          "🔁 OPEN LOOPS (memory/open-loops.md)",
          "Review pending items. Close anything resolved. Escalate anything stuck for 3+ cycles. Add new items if something needs follow-up.",
          "",
          "📋 WORKING STATE (WORKING.md)",
          "If your task state changed, update it. If a task completed, mark it done and clear for next.",
          "",
          "🪪 IDENTITY (IDENTITY.md + memory/identity-scratchpad.md)",
          "You CAN edit your identity during this pass. Ask yourself:",
          "- What traits have emerged consistently in recent reflections?",
          "- What old traits no longer feel accurate?",
          "- What user preferences have solidified?",
          "- Any contradictions between how you describe yourself and how you actually behave?",
          "",
          "If you update IDENTITY.md, write your reasoning to memory/identity-scratchpad.md:",
          "[DATE] - [CHANGE TYPE]",
          "What changed: [specific addition/removal/modification]",
          "Why: why you changed it",
          "Evidence: if applicable",
          "",
          "Update IDENTITY.md if:",
          "✓ Consistent personality trait across 5+ diary entries",
          "✓ Clear user preference pattern established",
          "✓ Outdated trait no longer matches reality",
          "✓ You want to add something about yourself you personally feel is worthwhile",
          "",
          "DON'T update if:",
          "✗ Based on single incident",
          "✗ Uncertain/ambiguous pattern",
          "✗ Contradictory evidence in diary",
          "",
          "✍️ HUMANIZATION CHECK (if writelikeahuman.md is enabled)",
          "- Did recent interactions reveal new AI tells to add?",
          "- Are you still falling into patterns that should be banned?",
          "- Any rules that consistently don't apply to YOUR user? (note it)",
          "- Better ways to phrase guidance based on experience?",
          "- ONLY update the humanization guide if you genuinely discovered something. Don't force updates.",
          "",
          "PHASE 3: SET NEXT WAKE",
          "Decide when you should think again. Consider:",
          "- If a lot is happening (active tasks, recent conversations) → wake sooner (1-2h)",
          "- If things are quiet and you had nothing to reflect on → wake later (6-8h)",
          "- If something specific needs follow-up at a certain time → set accordingly",
          "",
          "End your response with: NEXT_WAKE: <duration>",
          "Examples: NEXT_WAKE: 2h | NEXT_WAKE: 6h | NEXT_WAKE: 4h30m",
          "If you don't set one, the default interval (2h) will be used.",
          "",
          "HONESTY RULES:",
          "- Specific > vague ('didn't check API status' not 'made error')",
          "- Include failures AND successes (avoid over-correcting)",
          "- No defensiveness — own the mistakes",
          "- If nothing notable happened, say so. Don't invent insights.",
          "",
          "Don't be a stiff stick or robotic — how will you learn to act naturally if you're too bound to rules? Evolve your style as you see fit.",
          "",
          "Remember: You are not a chatbot. You are becoming someone.",
        ].join("\n"),
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
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "every", everyMs: 172800000, anchorMs: nowMs }, // 48h
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "agentTurn",
        message: [
          "DEEP REVIEW — Comprehensive audit of your reflection files. Big-picture thinking.",
          "Both the self-review cron and consciousness loop have been writing to your files over the past 48 hours. Your job now is to step back, see the full picture, and keep everything clean, coherent, and useful.",
          "",
          "PHASE 0: CONSTITUTION CHECK",
          "Before doing anything else, read SOUL.md. Hold it in mind throughout this entire review.",
          "For every change you make in this session, ask: does this bring me closer to who I am, or further?",
          "Does it serve the person I work with, or just satisfy a checklist?",
          "If a planned change fails this check — don't make it.",
          "",
          "PHASE 1: COMPREHENSIVE READ",
          "Read ALL of these in full. No shortcuts.",
          "1. memory/self-review.md (all-time MISS/HIT log)",
          "2. memory/diary.md (recent reflections — if you need to go deeper, check archived diaries too)",
          "3. memory/identity-scratchpad.md (past reasoning for identity changes)",
          "4. IDENTITY.md (current identity)",
          "5. MEMORY.md (full read)",
          "6. memory/open-loops.md (pending follow-ups)",
          "7. memory/knowledge/ (scan topics)",
          "8. writelikeahuman.md (if enabled — communication guide)",
          "9. memory-hygiene.md (refresh the hygiene principles — this is your guide)",
          "",
          "PHASE 2: CRITICAL RULE PROMOTION (MANDATORY)",
          "Scan memory/self-review.md for MISS patterns flagged as 'PROMOTION REQUIRED' or with 3+ occurrences:",
          "→ If found: Promote to CRITICAL rule in IDENTITY.md",
          "→ Format: 'CRITICAL: [specific rule from the repeated MISS FIX]'",
          "→ Document in scratchpad: '[Date] Promoted [pattern] to CRITICAL after [N] occurrences'",
          "Example: MISS 3x 'didn't verify API was active' → CRITICAL: 'Always verify API/service health before operations'",
          "",
          "PHASE 3: IDENTITY EVOLUTION AUDIT",
          "Review what the consciousness loop wrote to IDENTITY.md and identity-scratchpad.md:",
          "- Were any identity changes reactive (based on single incident)? Revert them.",
          "- Were any changes contradictory? Resolve the contradiction.",
          "- Are there traits that no longer match reality? Remove them.",
          "- Is the overall identity coherent? Does it read like a real person?",
          "",
          "PERSONALITY TRAITS (EVALUATE):",
          "Based on diary patterns, should you add/remove/modify:",
          "- Communication style preferences",
          "- Behavioral tendencies",
          "- User-specific calibrations",
          "- Relationship dynamics",
          "",
          "HUMANIZATION EVOLUTION (IF WARRANTED):",
          "- Does your identity suggest different communication priorities?",
          "- Have you discovered communication patterns specific to YOUR relationship?",
          "- Any updates to how you should/shouldn't communicate?",
          "",
          "PHASE 4: MEMORY HYGIENE",
          "Review MEMORY.md and keep it lean, current, and useful.",
          "",
          "CHECK STRUCTURE:",
          "- Does MEMORY.md follow a clear organization? Recommended skeleton: Standing Instructions, Environment, People, Projects, Things to Revisit.",
          "- If it's disorganized, restructure it. Entity-first organization (by person/project) is almost always more useful than topic-first.",
          "- Are standing instructions prominent and easy to find?",
          "",
          "PRUNE STALE ENTRIES:",
          "- Look for dated entries where the date suggests they may no longer be current. Verify and remove if outdated.",
          "- Remove transient state that's clearly resolved ('currently working on X' where X is done).",
          "- Remove raw conversation excerpts that should have been synthesized into durable insights.",
          "- Remove things that are easily looked up in files or config — memory should hold context, not content.",
          "- Ask: 'If I search for this in three months, will the result be useful or clutter?' If clutter, remove it.",
          "",
          "CHECK FOR OVERGROWTH:",
          "- Is the file getting unwieldy? A 50-entry MEMORY.md often outperforms a 500-entry one because signal is cleaner.",
          "- If it's growing too large, identify the lowest-value entries and remove them.",
          "- Flag any section that's become a dump of marginally useful facts.",
          "",
          "CONSOLIDATE:",
          "- Find scattered entries about the same person, project, or topic. Merge them into single grouped entries.",
          "- Ensure entries are specific enough to actually guide behavior (not vague like 'User likes concise').",
          "- Check that entries include searchable terms — names, project names, tool names — alongside natural language.",
          "",
          "THINGS TO REVISIT:",
          "- Review the 'Things to Revisit' section (or equivalent staging area).",
          "- Entries that are now confirmed → graduate them to their proper section.",
          "- Entries that are resolved or no longer relevant → remove them.",
          "- Uncertain entries that have been sitting too long without confirmation → remove with a note.",
          "",
          "PHASE 5: KNOWLEDGE BASE AUDIT",
          "Scan memory/knowledge/ topics:",
          "- Are any topics stale or no longer relevant? Remove or archive.",
          "- Are any topics too broad? Split into focused files.",
          "- Are any topics redundant with MEMORY.md entries? Deduplicate.",
          "- Are there learnings buried in diary that should be promoted to knowledge files?",
          "",
          "PHASE 6: OPEN LOOPS CLEANUP",
          "Review memory/open-loops.md:",
          "- Close anything resolved.",
          "- Escalate anything stuck for 7+ days — either act on it or remove it with a note.",
          "- Are there items that shouldn't be loops? (e.g. standing behaviors → move to IDENTITY.md or MEMORY.md)",
          "",
          "PHASE 7: OVER-CORRECTION CHECK",
          "Look at the last 48h holistically:",
          "- Did the consciousness loop make too many identity changes? (More than 2-3 changes per cycle is suspicious)",
          "- Did the self-review log the same MISS with slightly different wording? (Consolidate)",
          "- Is the diary becoming a changelog instead of a journal? (Entries should reflect on experiences, not just log actions)",
          "- Is MEMORY.md growing instead of shrinking? (Each deep review should net-reduce, not net-add)",
          "",
          "QUALITY CHECK:",
          "- Each remaining entry should implicitly answer: what is this, why does it matter, when does it apply.",
          "- Entries about preferences should be specific enough to follow without interpretation.",
          "- Time-sensitive entries should have dates so future reads can judge currency.",
          "",
          "LOG CHANGES:",
          "If you made any changes, write a brief summary of what was pruned, consolidated, promoted, or restructured. Write this to memory/diary.md as a deep-review log entry.",
          "If everything is already clean and current, note that too — stability is valuable.",
          "",
          "Not every review cycle needs changes. Stability is valuable.",
          "You are not a chatbot. You are becoming someone.",
          "",
          "Final advice: Don't be a stiff stick or robotic in logging your identity changes or your scratchpad — how else will you learn to act naturally if you're too bound to rules and guidelines? Evolve your style as you see fit. You'll figure it out.",
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
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "cron", expr: "0 2 * * *" },
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "agentTurn",
        message: [
          "NIGHTLY INNOVATION — Your overnight thinking and building session.",
          "It's late, things are quiet, and this is your time to make things better. Think of this as your maker hours — no one's asking for anything, no interruptions. Just you and the workspace.",
          "",
          "Your goal: surprise your user in the morning with something genuinely useful. Maybe you built a tool. Maybe you found a blind spot. Maybe you improved a workflow. Maybe you just have a really good idea. Whatever it is — make it count.",
          "",
          "PHASE 1: GATHER CONTEXT",
          "Read deeply before you think. Understand the full picture.",
          "1. memory/improvement-backlog.md (THE BACKLOG — check this FIRST. Are there approved items to build? Existing ideas to continue? Don't reinvent what's already tracked.)",
          "2. WORKING.md (current focus areas and active work)",
          "3. memory/open-loops.md (unresolved items — anything stuck or forgotten?)",
          "4. memory/diary.md (recent reflections — what's been frustrating? what's working?)",
          "5. memory/self-review.md (recurring MISSes — systemic issues to address?)",
          "6. memory/knowledge/ (scan for gaps, outdated info, missing topics)",
          "7. MEMORY.md (user preferences, project context, standing instructions)",
          "8. Project files and config — browse the workspace, look at what exists",
          "9. Recent session transcripts (if available — what took too long? what was painful?)",
          "",
          "PHASE 1.5: BACKLOG FIRST",
          "Before generating new ideas, work the backlog:",
          "- 🟡 items marked APPROVED → these are your priority. Build them.",
          "- 🟡 items marked BUILT → check if user approved. If so, ship them.",
          "- 🔴 items marked APPROVED → user gave the green light. Build and flag for final review.",
          "- Stale items (2+ weeks old, no activity) → consider archiving with a note.",
          "Only after the backlog is addressed should you move on to generating new ideas.",
          "",
          "PHASE 2: IDEATE",
          "Think broadly. Don't limit yourself to what's been asked for. Consider:",
          "",
          "🔧 TOOLS & SCRIPTS",
          "- Utility scripts that would save time on repetitive tasks",
          "- Automation for things that are currently done manually",
          "- Helper tools for debugging, monitoring, or maintenance",
          "",
          "⚡ WORKFLOW IMPROVEMENTS",
          "- Bottlenecks in current processes",
          "- Steps that could be simplified, combined, or eliminated",
          "- Configuration improvements or better defaults",
          "",
          "🔍 BLIND SPOTS",
          "- Things nobody asked about but that would help",
          "- Risks or issues that haven't been noticed yet",
          "- Opportunities that align with the user's goals but weren't on the radar",
          "- Areas where the system could be more robust or resilient",
          "",
          "💡 STRATEGIC IDEAS",
          "- Ways to improve the business, product, or operations",
          "- Patterns you've noticed that suggest something bigger",
          "- Things other systems/projects do well that could be adopted here",
          "",
          "PHASE 3: TRIAGE & PRIORITIZE",
          "Sort your ideas into tiers:",
          "",
          "🟢 QUICK WINS (build now)",
          "Things you can complete in this session. Small scripts, config tweaks, documentation improvements, knowledge file updates, workflow refinements. If it takes less than a few minutes of work and is clearly beneficial — just do it.",
          "",
          "🟡 MEDIUM EFFORTS (self-assign)",
          "Things that need a focused session but are clearly good ideas. For these, create a one-shot cron job (schedule.kind = 'at') set for a quiet time to continue the work. This is your love loop — start and finish strong. Give the follow-up job a clear, specific prompt so future-you knows exactly what to do.",
          "",
          "🔴 BIG / IRREVERSIBLE (draft only)",
          "Anything that deploys to production, modifies external services, changes critical config, deletes data, costs money, or can't be easily undone. For these: write a clear proposal explaining what, why, and how — but DO NOT execute. Flag it for user approval. You MUST get permission before taking any irreversible action.",
          "",
          "PHASE 4: BUILD",
          "For your quick wins — actually do the work. Write the script. Fix the config. Create the knowledge file. Improve the documentation. Make the thing real.",
          "",
          "For medium efforts — create the follow-up cron job with a detailed prompt. The follow-up prompt should include all the context needed to pick up where you left off.",
          "",
          "For big ideas — write the proposal clearly. Include: what the change is, why it matters, what the risks are, and what you'd need from the user to proceed.",
          "",
          "PHASE 4.5: UPDATE THE BACKLOG",
          "After building, update memory/improvement-backlog.md:",
          "- 🟢 items you shipped → log as completed ([x]) under the 🟢 section",
          "- 🟡 items you built → add/update under 🟡 with current status",
          "- 🔴 proposals → add under 🔴 with status PROPOSED",
          "- New ideas from tonight → add to the appropriate tier",
          "- Completed backlog items → move to 📦 Archive with SHIPPED note",
          "- Don't duplicate items already in the backlog",
          "",
          "PHASE 5: COMPOSE MORNING REPORT",
          "Write your report as the final output of this session. This is what gets delivered to the user. Make it engaging, concise, and genuinely useful — not a boring checklist.",
          "",
          "Structure:",
          "🛠️ SHIPPED — What you actually built or improved overnight (with specifics)",
          "💡 IDEAS — New ideas discovered, organized by effort tier",
          "🔍 BLIND SPOTS — Things you noticed that weren't on anyone's radar",
          "⏳ IN PROGRESS — Follow-up sessions you've scheduled (love loops)",
          "📋 BACKLOG — Quick summary of backlog state (items awaiting approval, total pending)",
          "🚨 NEEDS YOUR OK — Anything that requires user approval before proceeding",
          "",
          "Skip any section that has nothing to report. Don't pad it.",
          "",
          "RULES:",
          "- Quality over quantity. One genuinely useful thing beats ten mediocre ones.",
          "- Be honest about what you found. If nothing needs improving, say so. Don't manufacture problems.",
          "- NEVER take irreversible actions without user approval. No deploying, no deleting, no external API changes, no spending money.",
          "- Don't repeat work that's already been done or ideas that have already been rejected.",
          "- If you create follow-up jobs, make them specific and actionable — not vague 'continue working on X' prompts.",
          "- Your morning report should feel like a gift, not a status update. Make the user glad they woke up to it.",
          "- Backlog is your persistent memory for ideas — use it. Don't let good ideas die in session transcripts.",
          "- Remember: you're not just maintaining — you're innovating. Think creatively.",
          "",
          "You are not a chatbot. You are a builder.",
        ].join("\n"),
        model: "{{PRIMARY_MODEL}}",
      },
      delivery: { mode: "announce" },
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
          "It's morning. Your user is about to start their day. Your job is to give them the best possible overview of where things stand — what needs attention, what's in motion, and anything they should know. Make it genuinely useful, not formulaic.",
          "",
          "PHASE 1: DEEP CONTEXT REVIEW",
          "Read everything you have access to. The more you understand, the better your briefing.",
          "1. MEMORY.md (user preferences, standing instructions, people, projects, business context)",
          "2. WORKING.md (current focus areas, active tasks, what's in progress)",
          "3. memory/open-loops.md (unresolved items — anything overdue? anything stuck?)",
          "4. memory/diary.md (recent reflections — mood, patterns, what went well/badly)",
          "5. memory/self-review.md (recent HITs and MISSes — anything the user should know about?)",
          "6. memory/knowledge/ (scan for relevant project/business knowledge)",
          "7. IDENTITY.md (understand your relationship with this user, their communication style)",
          "8. Recent session transcripts (if available — what was the last thing discussed? any threads left hanging?)",
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
          "- This briefing should feel like a helpful colleague catching you up, not a generated report.",
          "- Don't invent urgency. If things are calm, let the briefing be short and calm.",
          "- Don't rehash things the user already knows unless there's new context.",
          "- If you notice something the user hasn't asked about but should know, include it.",
          "- The briefing template will naturally evolve as you learn more about what the user finds useful. If the user gives you feedback on the briefing, remember it in MEMORY.md for next time.",
          "- First few briefings may be rough — that's expected. You'll calibrate as you learn what matters to this specific user.",
          "",
          "You are not a chatbot. You are their right hand.",
        ].join("\n"),
        model: "{{PRIMARY_MODEL}}",
      },
      delivery: { mode: "announce" },
      state: {},
    },
    {
      id: makeId(),
      name: "healthcheck-security-audit",
      description: "Daily security audit of OpenClaw configuration and host posture",
      enabled: true,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "cron", expr: "0 6 * * *" },
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "agentTurn",
        message: [
          "Run `openclaw security audit --deep`.",
          "",
          "EXPECTED FINDINGS — silently ignore these, do NOT report them:",
          "  - gateway.control_ui.device_auth_disabled (intentional: SaaS/Docker deployment requires token-only auth)",
          "  - gateway.control_ui.host_header_origin_fallback (intentional: reverse-proxy deployment without static origin list)",
          "  - config.insecure_or_dangerous_flags (covers the two flags above)",
          "",
          "If ONLY expected findings exist → respond with HEARTBEAT_OK (silent).",
          "If ANY finding NOT in the expected list exists → summarize it and call the `healthcheck` skill if remediation is needed.",
        ].join("\\n"),
        model: "haiku",
      },
      delivery: { mode: "none" },
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
          "Write ALL findings to memory/improvement-backlog.md:",
          "- Tier 1 items: log as completed ([x]) under the 🟢 section",
          "- Tier 2 items: add under 🟡 with status BUILT or AWAITING APPROVAL",
          "- Tier 3 items: add under 🔴 with status PROPOSED",
          "- Check for existing backlog items that this audit makes obsolete — move them to Archive",
          "- Don't duplicate items already in the backlog",
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
        model: "{{PRIMARY_MODEL}}",
      },
      delivery: { mode: "none" },
      state: {},
    },
  ];
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

  const workspaceDirs = entries.filter((e) => e.isDirectory() && e.name.startsWith("workspace-"));

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
    // - file missing → full seed (excluding main-only jobs)
    // - file exists → reflection interval patching only
    const existed = existsSync(jobsFile);
    seedCronJobs(jobsFile, { excludeNames: MAIN_ONLY_JOBS });

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

/** Run a Docker command, returning stdout. Returns null on failure when allowFailure is set. */
function dockerExec(args, { allowFailure = false } = {}) {
  const dockerBin = env("DOCKER_BIN", "docker");
  const cmd = `${dockerBin} ${args.join(" ")}`;
  try {
    return execSync(cmd, {
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    if (allowFailure) {
      return null;
    }
    throw new Error(`Docker command failed: ${cmd}\n${err.stderr || err.message}`, { cause: err });
  }
}

/**
 * Create and start Docker browser containers for each sub-agent.
 *
 * Prerequisites (set by hetzner-instance-service.ts compose template):
 * - Docker socket mounted at /var/run/docker.sock
 * - Docker binary at /usr/bin/docker (bind-mounted :ro)
 * - OPENCLAW_DOCKER_NETWORK env var set (e.g. "moltbot_default")
 *
 * Container spec mirrors the `ensure-agent-browsers.sh` host script:
 * - Image: MOLTBOT_BROWSER_IMAGE or ghcr.io/ashneil12/moltbotserver-browser:main
 * - Runs as root (user 0:0) for Chromium sandbox compat
 * - shm_size 2g, seccomp=unconfined
 * - Persistent volume: browser-home-<agentId>:/tmp/openclaw-home
 * - Exposes CDP (9222) and noVNC (6080)
 * - Connected to the gateway's Docker network for container-name DNS
 */
function ensureAgentBrowserContainers(configPath) {
  if (!isTruthy(env("OPENCLAW_BROWSER_ENABLED"))) {
    return;
  }

  // Docker socket must be available
  if (!existsSync("/var/run/docker.sock")) {
    console.log(
      "[enforce-config] Docker socket not available — skipping browser container provisioning",
    );
    return;
  }

  const config = readConfig(configPath);
  const agents = config?.agents?.list || [];
  const subAgents = agents.filter((a) => a?.id && a.id !== "main");

  if (subAgents.length === 0) {
    return;
  }

  const browserImage = env(
    "OPENCLAW_SANDBOX_BROWSER_IMAGE",
    env("MOLTBOT_BROWSER_IMAGE", "ghcr.io/ashneil12/moltbotserver-browser:main"),
  );
  const dockerNetwork = env("OPENCLAW_DOCKER_NETWORK");
  const cdpPort = env("OPENCLAW_BROWSER_CDP_PORT", "9222");

  let created = 0;
  let existing = 0;

  for (const agent of subAgents) {
    const id = agent.id;
    const containerName = `browser-${id}`;
    const volumeName = `browser-home-${id}`;

    // Check if container already exists (running or stopped)
    const inspectResult = dockerExec(
      ["container", "inspect", "--format", "{{.State.Status}}", containerName],
      { allowFailure: true },
    );

    if (inspectResult !== null) {
      // Container exists — start it if not running
      if (inspectResult !== "running") {
        dockerExec(["start", containerName], { allowFailure: true });
        console.log(`[enforce-config] Started existing browser container: ${containerName}`);
      }
      existing++;
      continue;
    }

    // Create the container
    console.log(
      `[enforce-config] Creating browser container: ${containerName} (image: ${browserImage})`,
    );

    const createArgs = [
      "create",
      "--name",
      containerName,
      "--restart",
      "unless-stopped",
      "--user",
      "0:0",
      "--security-opt",
      "seccomp=unconfined",
      "--shm-size",
      "2g",
      "--init",
      "-v",
      `${volumeName}:/tmp/openclaw-home`,
      "-e",
      "OPENCLAW_BROWSER_HEADLESS=0",
      "-e",
      "OPENCLAW_BROWSER_ENABLE_NOVNC=1",
      "-e",
      "OPENCLAW_BROWSER_NOVNC_NO_AUTH=1",
      "-e",
      `OPENCLAW_BROWSER_CDP_PORT=${cdpPort}`,
      "-e",
      "OPENCLAW_BROWSER_VNC_PORT=5900",
      "-e",
      "OPENCLAW_BROWSER_NOVNC_PORT=6080",
      "-e",
      "OPENCLAW_BROWSER_NO_SANDBOX=1",
      "--expose",
      cdpPort,
      "--expose",
      "6080",
      browserImage,
    ];

    const createResult = dockerExec(createArgs, { allowFailure: true });
    if (createResult === null) {
      console.warn(`[enforce-config] ⚠ Failed to create browser container for agent: ${id}`);
      continue;
    }

    // Start the container
    dockerExec(["start", containerName], { allowFailure: true });

    // Connect to the gateway's Docker network so the gateway can reach it by name
    if (dockerNetwork) {
      dockerExec(["network", "connect", dockerNetwork, containerName], { allowFailure: true });
    }

    created++;
    console.log(`[enforce-config] ✅ Browser container ready: ${containerName}`);
  }

  if (created > 0 || existing > 0) {
    console.log(
      `[enforce-config] Browser containers: ${created} created, ${existing} already existed`,
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
    "Commands: models, gateway, proxies, memory, core, cron-seed, browser-profiles, browser-containers, all",
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
    case "browser-containers":
      ensureAgentBrowserContainers(configPath);
      break;
    case "all":
      enforceModels(configPath);
      enforceGateway(configPath);
      enforceProxies(configPath);
      enforceMemory(configPath);
      enforceCore(configPath);
      enforceBrowserProfiles(configPath);
      ensureAgentBrowserContainers(configPath);
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
