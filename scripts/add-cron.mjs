#!/usr/bin/env node
// add-cron.mjs — Deterministic cron job management
//
// Builds and adds a custom cron job to an agent's jobs.json without the AI
// needing to hand-craft JSON or guess paths. Validates all inputs before
// writing. Checks for duplicates. Prints exactly what was written.
//
// DELIVERY:
//   --delivery none          Silent. Job runs, no message sent. (default)
//   --delivery announce --auto-to
//                            Deliver to user. Reads the credential store to
//                            find the right channel and ID automatically.
//   --delivery announce --channel telegram --to 5614099189
//                            Explicit target (only if auto-to doesn't work).
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
//   --auto-to            Resolve delivery target from credential store (recommended)
//   --channel <name>     Channel name when delivery=announce (e.g. telegram)
//   --to <id>            Recipient ID when delivery=announce (numeric/internal)
//   --wake <mode>        Wake mode: now | next-heartbeat (default: next-heartbeat)
//   --idle-only          Only run when agent is idle
//   --one-shot           Delete after running once
//   --data-dir <path>    Data directory (default: /home/node/data)
//   --dry-run            Show the job that would be added without writing
//   --list               List all current jobs for this agent
//   --check-delivery     Show what delivery target would be resolved (no job created)
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
//   # Silent job (no delivery needed)
//   node add-cron.mjs --agent main --name price-check \
//     --schedule "every:30m" --prompt "Check prices and write to WORKING.md."
//
//   # Alert the user — auto-resolves channel and ID from credential store
//   node add-cron.mjs --agent main --name price-alert \
//     --schedule "every:30m" \
//     --prompt "Check prices. If BTC drops below 80k, alert the user immediately." \
//     --delivery announce --auto-to
//
//   # Check what delivery target would be used
//   node add-cron.mjs --agent main --check-delivery
//
//   # List all jobs for an agent
//   node add-cron.mjs --agent main --list

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";

// ── Helpers ──────────────────────────────────────────────────────────────────
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

// ── Credential-based delivery resolution ─────────────────────────────────────
//
// Reads allowFrom.json files from the credential store to resolve which
// channel and recipient ID to use. Same approach as enforce-config.mjs.
//
// With --auto-to alone:       tries telegram → discord → whatsapp → slack
// With --auto-to --channel X: looks only at the specified channel
function resolveDeliveryFromCredentials(dataDir, agentId, preferChannel) {
  const credDir = `${dataDir}/credentials`;
  if (!existsSync(credDir)) {
    return null;
  }

  // If user specified a channel, try only that one
  const CHANNELS = preferChannel ? [preferChannel] : ["telegram", "discord", "whatsapp", "slack"];

  // Try exact agent match first, then fall back to "main"
  const agentsToTry = agentId === "main" ? ["main"] : [agentId, "main"];

  for (const channel of CHANNELS) {
    for (const agent of agentsToTry) {
      const credFile = `${credDir}/${channel}-${agent}-allowFrom.json`;
      if (existsSync(credFile)) {
        try {
          const cred = JSON.parse(readFileSync(credFile, "utf8"));
          const ids = cred.allowFrom || [];
          if (ids.length > 0) {
            return { channel, to: String(ids[0]), source: credFile };
          }
        } catch {
          /* skip unreadable */
        }
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

if (hasFlag("--help") || hasFlag("-h") || args.length === 0) {
  console.log(`Usage: node add-cron.mjs --agent <id> --name <name> --schedule <schedule> --prompt <text> [options]

Delivery (the most important choice):
  --delivery none                        Silent — job runs, no message sent (default)
  --delivery announce --auto-to          Alert the user — resolves channel/ID automatically
  --delivery announce --channel X --to Y Explicit target (fallback if auto-to fails)

Schedule formats:
  cron:0 8 * * *       cron expression (daily 08:00 UTC)
  every:6h             every 6 hours
  every:30m            every 30 minutes
  every:7d             every 7 days
  every:86400000       every N milliseconds
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

const AGENT_ID = getArg("--agent");
const JOB_NAME = getArg("--name");
const SCHEDULE_RAW = getArg("--schedule");
const PROMPT = getArg("--prompt");
const DELIVERY_MODE = getArg("--delivery") ?? "none";
const DELIVERY_CHANNEL = getArg("--channel");
const DELIVERY_TO = getArg("--to");
const AUTO_TO = hasFlag("--auto-to");
const CHECK_DELIVERY = hasFlag("--check-delivery");
const WAKE_MODE = getArg("--wake") ?? "next-heartbeat";
const DATA_DIR = getArg("--data-dir") ?? "/home/node/data";
const IDLE_ONLY = hasFlag("--idle-only");
const ONE_SHOT = hasFlag("--one-shot");
const DRY_RUN = hasFlag("--dry-run");
const LIST_ONLY = hasFlag("--list");

// ── Resolve jobs.json path ────────────────────────────────────────────────────
if (!AGENT_ID) {
  die("Missing --agent");
}

const WORKSPACE =
  AGENT_ID === "main" ? `${DATA_DIR}/workspace-main` : `${DATA_DIR}/workspace-${AGENT_ID}`;

const JOBS_FILE = `${WORKSPACE}/.openclaw/cron/jobs.json`;

// ── --check-delivery mode ─────────────────────────────────────────────────────
if (CHECK_DELIVERY) {
  console.log(`\nDelivery targets available for agent "${AGENT_ID}":\n`);
  const CHANNELS = ["telegram", "discord", "whatsapp", "slack"];
  const agentsToTry = AGENT_ID === "main" ? ["main"] : [AGENT_ID, "main"];
  let found = 0;
  for (const channel of CHANNELS) {
    for (const agent of agentsToTry) {
      const credFile = `${DATA_DIR}/credentials/${channel}-${agent}-allowFrom.json`;
      if (existsSync(credFile)) {
        try {
          const cred = JSON.parse(readFileSync(credFile, "utf8"));
          const ids = cred.allowFrom || [];
          if (ids.length > 0) {
            ok(`${channel.padEnd(10)} → ID: ${ids[0]}  (from ${credFile.split("/").pop()})`);
            found++;
          }
        } catch {
          /* skip */
        }
      }
    }
  }
  if (found === 0) {
    fail("No delivery targets found in credential store.");
    info(`Checked: ${DATA_DIR}/credentials/<channel>-${AGENT_ID}-allowFrom.json`);
    process.exit(1);
  }
  console.log();
  console.log("Use --delivery announce --auto-to to use the first available channel.");
  console.log("Use --delivery announce --auto-to --channel telegram to pick a specific one.");
  console.log();
  process.exit(0);
}

// ── List mode ─────────────────────────────────────────────────────────────────
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
          ? `every ${job.schedule.everyMs / 1000}s`
          : job.schedule?.kind === "at"
            ? `at: ${job.schedule.at}`
            : "unknown";
    const delivery =
      job.delivery?.mode === "announce"
        ? `→ ${job.delivery.channel}:${job.delivery.to}`
        : (job.delivery?.mode ?? "none");
    console.log(`  ${enabled} ${job.name.padEnd(30)} ${schedule.padEnd(25)} ${delivery}`);
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

if (DELIVERY_MODE === "announce") {
  if (!AUTO_TO && !DELIVERY_CHANNEL) {
    fail("--delivery announce requires either --auto-to or --channel + --to");
    info("Recommended: --auto-to (resolves from credential store)");
    info(
      "Check available channels: node add-cron.mjs --agent " +
        (AGENT_ID ?? "<id>") +
        " --check-delivery",
    );
    errors++;
  }
  if (!AUTO_TO && !DELIVERY_TO) {
    fail("--delivery announce requires either --auto-to or --channel + --to");
    errors++;
  }
  if (DELIVERY_TO && !/^\d+$/.test(DELIVERY_TO)) {
    warn(`Delivery --to value "${DELIVERY_TO}" doesn't look like a numeric ID.`);
    warn("Telegram/Discord IDs are numeric. Using usernames/handles will cause delivery failures.");
  }
}

if (!["now", "next-heartbeat"].includes(WAKE_MODE)) {
  fail(`Invalid wake mode: "${WAKE_MODE}" — must be now or next-heartbeat`);
  errors++;
}

if (errors > 0) {
  process.exit(1);
}

// ── Resolve --auto-to delivery ────────────────────────────────────────────────
// --auto-to alone: picks first available channel (telegram → discord → ...)
// --auto-to --channel telegram: picks telegram specifically
// --auto-to --channel discord: picks discord specifically
let resolvedChannel = DELIVERY_CHANNEL;
let resolvedTo = DELIVERY_TO;

if (AUTO_TO && DELIVERY_MODE === "announce") {
  const resolved = resolveDeliveryFromCredentials(DATA_DIR, AGENT_ID, DELIVERY_CHANNEL ?? null);
  if (!resolved) {
    const hint = DELIVERY_CHANNEL
      ? `No ${DELIVERY_CHANNEL} credentials found for agent "${AGENT_ID}".`
      : `No delivery credentials found for agent "${AGENT_ID}".`;
    die(
      `${hint}\n` +
        `Run: node /app/scripts/add-cron.mjs --agent ${AGENT_ID} --check-delivery\n` +
        `Or set --channel and --to manually.`,
    );
  }
  resolvedChannel = resolved.channel;
  resolvedTo = resolved.to;
  info(
    `auto-to resolved: ${resolvedChannel} → ${resolvedTo}  (from ${resolved.source.split("/").pop()})`,
  );
}

// ── Parse schedule ────────────────────────────────────────────────────────────
function parseSchedule(raw) {
  const [kind, ...rest] = raw.split(":");
  const value = rest.join(":"); // re-join for "at:2026-..." which contains colons

  if (kind === "cron") {
    if (!value) {
      die("cron schedule requires an expression, e.g. cron:0 8 * * *");
    }
    // Validate cron expression (5 or 6 fields)
    const fields = value.trim().split(/\s+/);
    if (fields.length < 5 || fields.length > 6) {
      die(`Invalid cron expression "${value}" — must have 5 or 6 space-separated fields`);
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
      ms = parseInt(value, 10) * 3600000;
    } else if (/^\d+m$/.test(value)) {
      ms = parseInt(value, 10) * 60000;
    } else if (/^\d+d$/.test(value)) {
      ms = parseInt(value, 10) * 86400000;
    } else {
      die(`Invalid interval "${value}" — use Nh, Nm, Nd, or milliseconds`);
    }
    if (ms < 60000) {
      warn(`Interval of ${ms}ms is very short (< 1 minute). Are you sure?`);
    }
    return { kind: "every", everyMs: ms, anchorMs: Date.now() + 60000 };
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
      warn(`Schedule time "${value}" is in the past. The job will run immediately at next check.`);
    }
    return { kind: "at", at: value };
  }

  die(`Unknown schedule kind "${kind}" — use cron:, every:, or at:`);
}

const schedule = parseSchedule(SCHEDULE_RAW);

// ── Build delivery config ─────────────────────────────────────────────────────
function buildDelivery() {
  if (DELIVERY_MODE === "none") {
    return { mode: "none" };
  }
  if (DELIVERY_MODE === "announce") {
    return { mode: "announce", channel: resolvedChannel, to: resolvedTo };
  }
  return { mode: DELIVERY_MODE };
}

// ── Build the job object ──────────────────────────────────────────────────────
const nowMs = Date.now();
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
  payload: {
    kind: "agentTurn",
    message: PROMPT,
  },
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
  warn(`No jobs.json found — creating a new one (default jobs not present).`);
  warn(`Consider running: node /app/enforce-config.mjs cron-seed`);
  store = { version: 1, jobs: [], knownJobs: [] };
}

// ── Duplicate check ───────────────────────────────────────────────────────────
const existing = store.jobs.find((j) => j.name === JOB_NAME);
if (existing) {
  fail(`A job named "${JOB_NAME}" already exists for agent "${AGENT_ID}"`);
  info(`Existing job ID: ${existing.id}`);
  info(`To update it, use the cron tool with action:"update" and jobId:"${existing.id}"`);
  info(`To replace it, delete it first: node add-cron.mjs --agent ${AGENT_ID} --list`);
  process.exit(1);
}

// ── Write ─────────────────────────────────────────────────────────────────────
store.jobs.push(job);
writeJson(JOBS_FILE, store);

// ── Success output ────────────────────────────────────────────────────────────
console.log();
ok(`Cron job "${JOB_NAME}" added for agent "${AGENT_ID}"`);
console.log();
info(`Job ID:     ${job.id}`);
info(`Schedule:   ${SCHEDULE_RAW}`);
info(
  `Delivery:   ${DELIVERY_MODE}${DELIVERY_MODE === "announce" ? ` → ${resolvedChannel}:${resolvedTo}${AUTO_TO ? " (auto-resolved)" : ""}` : ""}`,
);
info(`Wake mode:  ${WAKE_MODE}`);
if (IDLE_ONLY) {
  info(`Idle only:  yes`);
}
if (ONE_SHOT) {
  info(`One-shot:   yes (will delete after first run)`);
}
console.log();
warn(`Gateway restart required for the new job to be picked up:`);
console.log(`  openclaw gateway restart`);
console.log();
info(`Verify after restart:`);
console.log(`  node /app/scripts/add-cron.mjs --agent ${AGENT_ID} --list`);
console.log();
