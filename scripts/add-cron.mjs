#!/usr/bin/env node
// add-cron.mjs — Deterministic cron job management
//
// Builds and adds a custom cron job to an agent's jobs.json without the AI
// needing to hand-craft JSON or guess paths. Validates all inputs before
// writing. Checks for duplicates. Prints exactly what was written.
//
// DELIVERY:
//   --delivery none               Silent. Job runs, no message sent. (default)
//   --delivery announce --auto-to Deliver to user. Reads credential store to
//                                 resolve channel + ID automatically. (recommended)
//   --delivery announce --channel X --to Y
//                                 Explicit target (fallback if auto-to fails).
//
// Usage:
//   node /app/scripts/add-cron.mjs --agent <id> --name <name> --schedule <schedule> --prompt <prompt> [options]
//
// Options:
//   --agent <id>         Agent ID (required, e.g. "jael" or "main")
//   --name <name>        Job name — kebab-case, unique (required)
//   --schedule <expr>    Schedule — see formats below (required)
//   --prompt <text>      The message/prompt the agent will receive (required)
//   --delivery <mode>    Delivery mode: none | announce (default: none)
//   --auto-to               Resolve delivery target from credential store (recommended)
//   --prefer-channel <name> With --auto-to, only look in this channel's credentials
//                           e.g. --auto-to --prefer-channel telegram (Telegram only)
//                                --auto-to --prefer-channel discord  (Discord only)
//   --channel <name>        Channel name for explicit delivery (no --auto-to)
//   --to <id>               Recipient ID for explicit delivery (no --auto-to)
//   --wake <mode>        Wake mode: now | next-heartbeat (default: next-heartbeat)
//   --idle-only          Only run when agent is idle
//   --one-shot           Delete after running once
//   --data-dir <path>    Data directory (default: /home/node/data)
//   --dry-run            Show the job that would be added without writing
//   --list               List all current jobs for this agent
//   --check-delivery     Show what delivery target would be auto-resolved (no job created)
//
// Schedule formats:
//   cron:0 8 * * *       cron expression (daily 08:00 UTC)
//   every:6h             every 6 hours
//   every:30m            every 30 minutes
//   every:7d             every 7 days
//   every:86400000       every N milliseconds
//   at:2026-03-21T14:00Z one-shot at UTC time
//
// Examples:
//   # Silent job — runs and writes to workspace, no alert
//   node add-cron.mjs --agent main --name price-check \
//     --schedule "every:30m" --prompt "Check prices. Write to WORKING.md."
//
//   # Alert the user — auto-resolves channel and ID from credential store
//   node add-cron.mjs --agent main --name price-alert \
//     --schedule "every:30m" \
//     --prompt "Check BTC. If below 80k, alert the user immediately." \
//     --delivery announce --auto-to
//
//   # Check what delivery target would be resolved
//   node add-cron.mjs --agent main --check-delivery
//
//   # List all jobs for an agent
//   node add-cron.mjs --agent main --list

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";

// ── Helpers ───────────────────────────────────────────────────────────────────
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const RESET = "\x1b[0m";

const ok = (msg) => console.log(`${GREEN}✅ ${msg}${RESET}`);
const warn = (msg) => console.log(`${YELLOW}⚠️  ${msg}${RESET}`);
const fail = (msg) => console.log(`${RED}❌ ${msg}${RESET}`);
const info = (msg) => console.log(`${BLUE}ℹ️  ${msg}${RESET}`);

function die(msg) {
  fail(msg);
  process.exit(1);
}
function makeId() {
  return randomBytes(8).toString("hex");
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    die(`Failed to read ${path}: ${e.message}`);
  }
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  try {
    chmodSync(path, 0o600);
  } catch {
    /* non-fatal */
  }
}

// ── Credential-based delivery resolution ──────────────────────────────────────
//
// Reads <channel>-<agentId>-allowFrom.json from the credential store to
// determine the delivery target. This is the same source used by enforce-config
// when patching sub-agent cron delivery — so it's always correct.
//
// Priority: telegram > discord > whatsapp > slack  (unless --prefer-channel overrides)
// For sub-agents, also tries "main" as a fallback (user likely chatted with main).
function resolveDelivery(dataDir, agentId, preferChannel = null) {
  const credDir = `${dataDir}/credentials`;
  if (!existsSync(credDir)) {
    return null;
  }

  // If a channel is preferred, only search that one; otherwise use priority order
  const channels = preferChannel ? [preferChannel] : ["telegram", "discord", "whatsapp", "slack"];

  // Try exact agent match first, then "main" as fallback
  const agentsToTry = agentId === "main" ? ["main"] : [agentId, "main"];

  for (const channel of channels) {
    for (const agent of agentsToTry) {
      const credFile = `${credDir}/${channel}-${agent}-allowFrom.json`;
      if (!existsSync(credFile)) {
        continue;
      }
      try {
        const cred = JSON.parse(readFileSync(credFile, "utf8"));
        const ids = cred.allowFrom || [];
        if (ids.length > 0) {
          return { channel, to: String(ids[0]), source: credFile, agentMatch: agent };
        }
      } catch {
        /* skip */
      }
    }
  }
  return null;
}

// ── Parse arguments ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(flag) {
  const i = args.indexOf(flag);
  if (i === -1) {
    return undefined;
  }
  if (i + 1 >= args.length) {
    die(`Flag ${flag} requires a value`);
  }
  return args[i + 1];
}
function hasFlag(flag) {
  return args.includes(flag);
}

// ── Help ──────────────────────────────────────────────────────────────────────
if (hasFlag("--help") || hasFlag("-h") || args.length === 0) {
  console.log(`Usage: node add-cron.mjs --agent <id> --name <name> --schedule <schedule> --prompt <text> [options]

Delivery (most important):
  --delivery none                                    Silent — no message (default)
  --delivery announce --auto-to                      Alert user — auto picks best channel
  --delivery announce --auto-to --prefer-channel telegram  Telegram only
  --delivery announce --auto-to --prefer-channel discord   Discord only
  --delivery announce --channel X --to Y             Explicit target (fallback only)

Schedule formats:
  cron:0 8 * * *       cron expression (daily 08:00 UTC)
  every:6h / every:30m / every:7d        human-friendly interval
  every:86400000       interval in milliseconds
  at:2026-03-21T14:00Z one-shot at UTC time

Other options:
  --wake now            run immediately when triggered
  --wake next-heartbeat wait for next heartbeat slot (default)
  --idle-only           only run when agent has no active tasks
  --one-shot            delete after first run
  --dry-run             preview without writing
  --list                list current jobs for the agent
  --check-delivery      show what delivery target would be auto-resolved
  --data-dir <path>     override data directory (default: /home/node/data)
`);
  process.exit(0);
}

// ── Parse flags ───────────────────────────────────────────────────────────────
const AGENT_ID = getArg("--agent");
const JOB_NAME = getArg("--name");
const SCHEDULE_RAW = getArg("--schedule");
const PROMPT = getArg("--prompt");
const DELIVERY_MODE = getArg("--delivery") ?? "none";
const DELIVERY_CHAN = getArg("--channel");
const DELIVERY_TO = getArg("--to");
const AUTO_TO = hasFlag("--auto-to");
const PREFER_CHANNEL = getArg("--prefer-channel"); // e.g. telegram, discord
const CHECK_DELIVERY = hasFlag("--check-delivery");
const WAKE_MODE = getArg("--wake") ?? "next-heartbeat";
const DATA_DIR = getArg("--data-dir") ?? "/home/node/data";
const IDLE_ONLY = hasFlag("--idle-only");
const ONE_SHOT = hasFlag("--one-shot");
const DRY_RUN = hasFlag("--dry-run");
const LIST_ONLY = hasFlag("--list");

if (!AGENT_ID) {
  die("Missing --agent");
}

const WORKSPACE =
  AGENT_ID === "main" ? `${DATA_DIR}/workspace-main` : `${DATA_DIR}/workspace-${AGENT_ID}`;
const JOBS_FILE = `${WORKSPACE}/.openclaw/cron/jobs.json`;

// ── --check-delivery mode ─────────────────────────────────────────────────────
if (CHECK_DELIVERY) {
  const scopeMsg = PREFER_CHANNEL ? ` (scoped to: ${PREFER_CHANNEL})` : "";
  console.log(`\nDelivery target resolution for agent "${AGENT_ID}"${scopeMsg}:\n`);
  const resolved = resolveDelivery(DATA_DIR, AGENT_ID, PREFER_CHANNEL);
  if (resolved) {
    ok("Found delivery target:");
    info(`  Channel: ${resolved.channel}`);
    info(`  To (ID): ${resolved.to}`);
    info(`  Source:  ${resolved.source}`);
    if (resolved.agentMatch !== AGENT_ID) {
      warn(`  Matched via "main" fallback (no credentials for agent "${AGENT_ID}")`);
    }
    const preferFlag = PREFER_CHANNEL ? ` --prefer-channel ${PREFER_CHANNEL}` : "";
    console.log(`\nUse --delivery announce --auto-to${preferFlag} to apply this automatically.`);
  } else {
    fail(`No delivery target found${PREFER_CHANNEL ? ` for channel "${PREFER_CHANNEL}"` : ""}.`);
    info(
      `Checked: ${DATA_DIR}/credentials/${PREFER_CHANNEL ?? "<channel>"}-${AGENT_ID}-allowFrom.json`,
    );
    info("Ensure at least one channel is authenticated for this agent (or main).");
    process.exit(1);
  }
  console.log();
  process.exit(0);
}

// ── --list mode ───────────────────────────────────────────────────────────────
if (LIST_ONLY) {
  if (!existsSync(JOBS_FILE)) {
    warn(`No jobs.json found at: ${JOBS_FILE}`);
    warn(`Agent "${AGENT_ID}" has no seeded cron jobs yet.`);
    process.exit(0);
  }
  const store = readJson(JOBS_FILE);
  const jobs = store.jobs || [];
  if (jobs.length === 0) {
    info(`No cron jobs for agent "${AGENT_ID}"`);
    process.exit(0);
  }
  console.log(`\nCron jobs for agent "${AGENT_ID}" (${jobs.length} total):\n`);
  for (const job of jobs) {
    const enabled = job.enabled ? "✅" : "⏸️ ";
    const schedule =
      job.schedule?.kind === "cron"
        ? `cron: ${job.schedule.expr}`
        : job.schedule?.kind === "every"
          ? `every ${(job.schedule.everyMs / 3600000).toFixed(1)}h`
          : job.schedule?.kind === "at"
            ? `at: ${job.schedule.at}`
            : "unknown";
    const delivery =
      job.delivery?.mode === "announce"
        ? `→ ${job.delivery.channel}:${job.delivery.to}`
        : (job.delivery?.mode ?? "none");
    console.log(`  ${enabled} ${job.name.padEnd(30)} ${schedule.padEnd(22)} ${delivery}`);
  }
  console.log();
  process.exit(0);
}

// ── Validate required args ────────────────────────────────────────────────────
let errors = 0;

if (!JOB_NAME) {
  fail("Missing --name");
  errors++;
}
if (!SCHEDULE_RAW) {
  fail("Missing --schedule");
  errors++;
}
if (!PROMPT) {
  fail("Missing --prompt");
  errors++;
}

if (JOB_NAME && !/^[a-z][a-z0-9-]*$/.test(JOB_NAME)) {
  fail(`Job name must be lowercase kebab-case, got: "${JOB_NAME}"`);
  errors++;
}

if (!["none", "announce", "webhook"].includes(DELIVERY_MODE)) {
  fail(`Invalid delivery mode: "${DELIVERY_MODE}" — must be none, announce, or webhook`);
  errors++;
}

if (DELIVERY_MODE === "announce" && !AUTO_TO) {
  if (!DELIVERY_CHAN) {
    fail("--delivery announce requires --auto-to or --channel");
    errors++;
  }
  if (!DELIVERY_TO) {
    fail("--delivery announce requires --auto-to or --to");
    errors++;
  }
  if (DELIVERY_TO && !/^\d+$/.test(DELIVERY_TO)) {
    warn(`--to value "${DELIVERY_TO}" doesn't look like a numeric ID.`);
    warn("Telegram/Discord/WhatsApp IDs are numeric. Usernames = delivery failures.");
  }
}

if (!["now", "next-heartbeat"].includes(WAKE_MODE)) {
  fail(`Invalid wake mode: "${WAKE_MODE}" — must be now or next-heartbeat`);
  errors++;
}

if (errors > 0) {
  process.exit(1);
}

// ── Resolve delivery target ───────────────────────────────────────────────────
let finalChannel = DELIVERY_CHAN;
let finalTo = DELIVERY_TO;

if (AUTO_TO && DELIVERY_MODE === "announce") {
  const resolved = resolveDelivery(DATA_DIR, AGENT_ID, PREFER_CHANNEL);
  if (!resolved) {
    const scope = PREFER_CHANNEL ? ` for channel "${PREFER_CHANNEL}"` : "";
    fail(`--auto-to could not find a delivery target${scope} in the credential store.`);
    const preferFlag = PREFER_CHANNEL ? ` --prefer-channel ${PREFER_CHANNEL}` : "";
    info(`Run: node /app/scripts/add-cron.mjs --agent ${AGENT_ID} --check-delivery${preferFlag}`);
    info("Or use --channel and --to to set the target manually.");
    process.exit(1);
  }
  finalChannel = resolved.channel;
  finalTo = resolved.to;
  const scopeNote = PREFER_CHANNEL ? ` [${PREFER_CHANNEL} only]` : "";
  info(`auto-to resolved: ${finalChannel} → ${finalTo} (from ${resolved.source})${scopeNote}`);
  if (resolved.agentMatch !== AGENT_ID) {
    warn(`Resolved via "main" fallback — no credentials for agent "${AGENT_ID}"`);
  }
}

// ── Parse schedule ────────────────────────────────────────────────────────────
function parseSchedule(raw) {
  const colonIdx = raw.indexOf(":");
  if (colonIdx === -1) {
    die(`Unknown schedule format "${raw}" — use cron:, every:, or at:`);
  }
  const kind = raw.slice(0, colonIdx);
  const value = raw.slice(colonIdx + 1);

  if (kind === "cron") {
    if (!value) {
      die("cron schedule requires an expression, e.g. cron:0 8 * * *");
    }
    const fields = value.trim().split(/\s+/);
    if (fields.length < 5 || fields.length > 6) {
      die(`Invalid cron expression "${value}" — must have 5 or 6 fields`);
    }
    return { kind: "cron", expr: value.trim() };
  }

  if (kind === "every") {
    if (!value) {
      die("every schedule requires a duration, e.g. every:6h or every:86400000");
    }
    let ms;
    if (/^\d+$/.test(value)) {
      ms = parseInt(value, 10);
    } else if (/^\d+h$/.test(value)) {
      ms = parseInt(value, 10) * 3_600_000;
    } else if (/^\d+m$/.test(value)) {
      ms = parseInt(value, 10) * 60_000;
    } else if (/^\d+d$/.test(value)) {
      ms = parseInt(value, 10) * 86_400_000;
    } else {
      die(`Invalid interval "${value}" — use Nh, Nm, Nd, or milliseconds`);
    }
    if (ms < 60_000) {
      warn(`Interval ${ms}ms is very short (< 1 min). Are you sure?`);
    }
    return { kind: "every", everyMs: ms, anchorMs: Date.now() + 60_000 };
  }

  if (kind === "at") {
    if (!value) {
      die("at schedule requires a UTC datetime, e.g. at:2026-03-21T14:00Z");
    }
    const d = new Date(value);
    if (isNaN(d.getTime())) {
      die(`Invalid datetime "${value}" — use ISO 8601 UTC format`);
    }
    if (d.getTime() < Date.now()) {
      warn(`Schedule time "${value}" is in the past.`);
    }
    return { kind: "at", at: value };
  }

  die(`Unknown schedule kind "${kind}" — use cron:, every:, or at:`);
}

const schedule = parseSchedule(SCHEDULE_RAW);

// ── Build job ─────────────────────────────────────────────────────────────────
const nowMs = Date.now();

function buildDelivery() {
  if (DELIVERY_MODE === "none") {
    return { mode: "none" };
  }
  if (DELIVERY_MODE === "announce") {
    return { mode: "announce", channel: finalChannel, to: finalTo };
  }
  return { mode: DELIVERY_MODE };
}

const job = {
  id: makeId(),
  name: JOB_NAME,
  description: `Custom: ${JOB_NAME}`,
  enabled: true,
  createdAtMs: nowMs,
  updatedAtMs: nowMs,
  schedule,
  sessionTarget: "isolated",
  wakeMode: WAKE_MODE,
  payload: { kind: "agentTurn", message: PROMPT },
  delivery: buildDelivery(),
  state: {},
};

if (IDLE_ONLY) {
  job.idleOnly = true;
}
if (ONE_SHOT) {
  job.deleteAfterRun = true;
}

// ── Dry-run output ────────────────────────────────────────────────────────────
if (DRY_RUN) {
  console.log("\n─── Dry Run — Job that would be added ───────────────────────────\n");
  console.log(JSON.stringify(job, null, 2));
  console.log("\n─────────────────────────────────────────────────────────────────\n");
  info(`Would write to: ${JOBS_FILE}`);
  console.log("\nRe-run without --dry-run to apply.");
  process.exit(0);
}

// ── Read or create jobs.json ──────────────────────────────────────────────────
if (!existsSync(WORKSPACE)) {
  die(`Workspace does not exist: ${WORKSPACE}\nRun provision-agent.sh first.`);
}

const CRON_DIR = `${WORKSPACE}/.openclaw/cron`;
mkdirSync(CRON_DIR, { recursive: true });

let store;
if (existsSync(JOBS_FILE)) {
  store = readJson(JOBS_FILE);
  store.jobs = store.jobs || [];
} else {
  warn("No jobs.json found — creating a new one (default seeded jobs not present).");
  warn("Consider running: node /app/enforce-config.mjs cron-seed");
  store = { version: 1, jobs: [], knownJobs: [] };
}

// ── Duplicate check ───────────────────────────────────────────────────────────
const existing = store.jobs.find((j) => j.name === JOB_NAME);
if (existing) {
  fail(`A job named "${JOB_NAME}" already exists for agent "${AGENT_ID}"`);
  info(`Existing job ID: ${existing.id}`);
  info(`To update it: cron tool → action:"update", jobId:"${existing.id}"`);
  info(`To replace it: delete it first, then re-run this script`);
  process.exit(1);
}

// ── Write ─────────────────────────────────────────────────────────────────────
store.jobs.push(job);
writeJson(JOBS_FILE, store);

// ── Success ───────────────────────────────────────────────────────────────────
console.log();
ok(`Cron job "${JOB_NAME}" added for agent "${AGENT_ID}"`);
console.log();
info(`Job ID:    ${job.id}`);
info(`Schedule:  ${SCHEDULE_RAW}`);
if (DELIVERY_MODE === "announce") {
  info(`Delivery:  announce → ${finalChannel}:${finalTo}${AUTO_TO ? " (auto-resolved)" : ""}`);
} else {
  info(`Delivery:  silent (none)`);
}
info(`Wake mode: ${WAKE_MODE}`);
if (IDLE_ONLY) {
  info("Idle only: yes");
}
if (ONE_SHOT) {
  info("One-shot:  yes (auto-deletes after first run)");
}
console.log();
warn("Gateway restart required for the job to be picked up:");
console.log(`  openclaw gateway restart`);
console.log();
info("Verify after restart:");
console.log(`  node /app/scripts/add-cron.mjs --agent ${AGENT_ID} --list`);
console.log();
