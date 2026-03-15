import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONSCIOUSNESS_IDENTITY_COOLDOWN_MS,
  appendReflectionChangeLog,
  applyReflectionRunPostflight,
  captureReflectionFileSnapshot,
  dedupeSelfReviewFile,
  pruneReflectionChangeLog,
  updateReflectionInbox,
} from "./reflection-artifacts.js";

let rootDir = "";
let workspaceDir = "";
let sessionStorePath = "";

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-reflection-artifacts-"));
  workspaceDir = path.join(rootDir, "workspace");
  sessionStorePath = path.join(rootDir, "sessions.json");
  await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
  await fs.writeFile(path.join(workspaceDir, "WORKING.md"), "working\n", "utf-8");
  await fs.writeFile(
    path.join(workspaceDir, "IDENTITY.md"),
    "# IDENTITY\n\n## CRITICAL Rules\n",
    "utf-8",
  );
  await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "# MEMORY\n", "utf-8");
  await fs.writeFile(path.join(workspaceDir, "memory", "diary.md"), "# Diary\n", "utf-8");
  await fs.writeFile(
    path.join(workspaceDir, "memory", "identity-scratchpad.md"),
    "# Scratchpad\n",
    "utf-8",
  );
  await fs.writeFile(path.join(workspaceDir, "memory", "open-loops.md"), "# Loops\n", "utf-8");
  await fs.writeFile(
    path.join(workspaceDir, "memory", "self-review.md"),
    "# Self-Review Log\n\n[2026-03-07 10:00 UTC]\n\nTAG: [scope] MISS: missed the check. FIX: verify the result first.\n",
    "utf-8",
  );
  await fs.writeFile(
    sessionStorePath,
    JSON.stringify({
      "agent:main:main": { sessionId: "main", updatedAt: Date.parse("2026-03-07T11:00:00Z") },
    }),
    "utf-8",
  );
});

afterEach(async () => {
  await fs.rm(rootDir, { recursive: true, force: true });
});

describe("updateReflectionInbox", () => {
  it("writes a deterministic inbox with activity, file changes, and promotion watchlist", async () => {
    const lastRunAtMs = Date.parse("2026-03-07T10:30:00Z");
    const touchedAt = new Date(Date.parse("2026-03-07T10:45:00Z"));
    await fs.utimes(path.join(workspaceDir, "WORKING.md"), touchedAt, touchedAt);
    await fs.writeFile(
      path.join(workspaceDir, "memory", "self-review.md"),
      "# Self-Review Log\n\n[2026-03-06 10:00 UTC]\n\nTAG: [scope] MISS: one. FIX: verify the result first.\n\n[2026-03-07 10:00 UTC]\n\nTAG: [scope] MISS: two. FIX: verify the result first.\n",
      "utf-8",
    );

    const summary = await updateReflectionInbox({
      cfg: { session: { store: sessionStorePath } } as never,
      agentId: "main",
      workspaceDir,
      lastRunAtMs,
    });

    expect(summary.sessionActivity.countSinceLastRun).toBe(1);
    expect(summary.changedFiles).toContain("WORKING.md");
    expect(summary.watchFixes).toEqual(["verify the result first. (2x)"]);

    const inbox = await fs.readFile(
      path.join(workspaceDir, "memory", "reflection-inbox.md"),
      "utf-8",
    );
    expect(inbox).toContain("Non-cron session activity: 1 updated session(s).");
    expect(inbox).toContain("Changed reflection files: WORKING.md");
    expect(inbox).toContain("verify the result first. (2x)");
  });
});

describe("applyReflectionRunPostflight", () => {
  it("reverts self-review identity edits and reapplies only deterministic promotions", async () => {
    await fs.writeFile(
      path.join(workspaceDir, "memory", "self-review.md"),
      "# Self-Review Log\n\n[2026-03-05 10:00 UTC]\n\nTAG: [scope] MISS: one. FIX: verify the result first.\n\n[2026-03-06 10:00 UTC]\n\nTAG: [scope] MISS: two. FIX: verify the result first.\n\n[2026-03-07 10:00 UTC]\n\nTAG: [scope] MISS: three. FIX: verify the result first.\n",
      "utf-8",
    );
    const before = await captureReflectionFileSnapshot({
      jobId: "self-review",
      workspaceDir,
    });
    await fs.writeFile(
      path.join(workspaceDir, "IDENTITY.md"),
      "# IDENTITY\n\n## CRITICAL Rules\n\n- **CRITICAL:** invented broad rewrite\n",
      "utf-8",
    );
    await fs.writeFile(
      path.join(workspaceDir, "memory", "identity-scratchpad.md"),
      "# Scratchpad\n\nmade a bookkeeping-only change\n",
      "utf-8",
    );

    await applyReflectionRunPostflight({
      jobId: "self-review",
      workspaceDir,
      before,
      nowMs: Date.parse("2026-03-07T12:00:00Z"),
    });

    const identity = await fs.readFile(path.join(workspaceDir, "IDENTITY.md"), "utf-8");
    expect(identity).not.toContain("invented broad rewrite");
    expect(identity).toContain("CRITICAL");
    expect(identity).toContain("Verify the result first.");

    const scratchpad = await fs.readFile(
      path.join(workspaceDir, "memory", "identity-scratchpad.md"),
      "utf-8",
    );
    expect(scratchpad).toBe("# Scratchpad\n");
  });

  it("reverts consciousness identity churn when the cooldown is active", async () => {
    await fs.writeFile(
      path.join(workspaceDir, "memory", ".reflection-state.json"),
      `${JSON.stringify(
        {
          lastIdentityWriteAtMs: Date.parse("2026-03-07T11:30:00Z"),
          lastIdentityWriteByJobId: "deep-review",
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    const before = await captureReflectionFileSnapshot({
      jobId: "consciousness",
      workspaceDir,
    });

    await fs.writeFile(
      path.join(workspaceDir, "IDENTITY.md"),
      "# IDENTITY\n\n## CRITICAL Rules\n\n- changed too soon\n",
      "utf-8",
    );
    await fs.writeFile(
      path.join(workspaceDir, "memory", "identity-scratchpad.md"),
      "# Scratchpad\n\ncandidate identity edit\n",
      "utf-8",
    );

    await applyReflectionRunPostflight({
      jobId: "consciousness",
      workspaceDir,
      before,
      nowMs: Date.parse("2026-03-07T12:00:00Z"),
    });

    const identity = await fs.readFile(path.join(workspaceDir, "IDENTITY.md"), "utf-8");
    const scratchpad = await fs.readFile(
      path.join(workspaceDir, "memory", "identity-scratchpad.md"),
      "utf-8",
    );
    expect(identity).not.toContain("changed too soon");
    expect(scratchpad).toBe("# Scratchpad\n");

    const state = JSON.parse(
      await fs.readFile(path.join(workspaceDir, "memory", ".reflection-state.json"), "utf-8"),
    ) as { lastIdentityWriteAtMs: number; lastIdentityWriteByJobId: string };
    expect(state.lastIdentityWriteAtMs).toBe(Date.parse("2026-03-07T11:30:00Z"));
    expect(state.lastIdentityWriteByJobId).toBe("deep-review");
    expect(Date.parse("2026-03-07T12:00:00Z") - state.lastIdentityWriteAtMs).toBeLessThan(
      CONSCIOUSNESS_IDENTITY_COOLDOWN_MS,
    );
  });
});

describe("dedupeSelfReviewFile", () => {
  it("keeps the newest copy of repeated meta-pattern entries", async () => {
    await fs.writeFile(
      path.join(workspaceDir, "memory", "self-review.md"),
      "# Self-Review Log\n\n[2026-03-06 10:00 UTC]\n\nPattern check: same-cycle closure discipline is holding.\n\n[2026-03-07 10:00 UTC]\n\nPattern check: same-cycle closure discipline is holding.\n",
      "utf-8",
    );

    const result = await dedupeSelfReviewFile(workspaceDir);

    expect(result.removedEntries).toBe(1);
    const selfReview = await fs.readFile(
      path.join(workspaceDir, "memory", "self-review.md"),
      "utf-8",
    );
    expect(selfReview.match(/Pattern check:/g)).toHaveLength(1);
    expect(selfReview).toContain("[2026-03-07 10:00 UTC]");
  });
});

// ---------------------------------------------------------------------------
// Reflection change-log tests
// ---------------------------------------------------------------------------

describe("appendReflectionChangeLog", () => {
  it("writes a valid JSONL entry", async () => {
    await appendReflectionChangeLog(workspaceDir, {
      ts: "2026-03-15T19:00:00.000Z",
      jobId: "self-review",
      file: "IDENTITY.md",
      linesChanged: 2,
      reverted: false,
      promotions: 1,
    });

    const logPath = path.join(workspaceDir, "memory", "reflection-change-log.jsonl");
    const content = await fs.readFile(logPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);
    expect(entry.jobId).toBe("self-review");
    expect(entry.file).toBe("IDENTITY.md");
    expect(entry.linesChanged).toBe(2);
    expect(entry.promotions).toBe(1);
  });

  it("appends to existing log", async () => {
    const logPath = path.join(workspaceDir, "memory", "reflection-change-log.jsonl");
    await fs.writeFile(
      logPath,
      '{"ts":"2026-03-14","jobId":"deep-review","file":"IDENTITY.md","linesChanged":0,"reverted":false,"promotions":0}\n',
      "utf-8",
    );

    await appendReflectionChangeLog(workspaceDir, {
      ts: "2026-03-15T19:00:00.000Z",
      jobId: "consciousness",
      file: "IDENTITY.md",
      linesChanged: 3,
      reverted: true,
      promotions: 0,
    });

    const content = await fs.readFile(logPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).jobId).toBe("deep-review");
    expect(JSON.parse(lines[1]).jobId).toBe("consciousness");
  });
});

describe("pruneReflectionChangeLog", () => {
  it("keeps only the last N entries", async () => {
    const logPath = path.join(workspaceDir, "memory", "reflection-change-log.jsonl");
    const entries = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({
        ts: `2026-03-${(i + 1).toString().padStart(2, "0")}`,
        jobId: `job-${i}`,
        file: "IDENTITY.md",
        linesChanged: 1,
        reverted: false,
        promotions: 0,
      }),
    );
    await fs.writeFile(logPath, entries.join("\n") + "\n", "utf-8");

    await pruneReflectionChangeLog(logPath, 3);

    const content = await fs.readFile(logPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).jobId).toBe("job-7");
    expect(JSON.parse(lines[2]).jobId).toBe("job-9");
  });

  it("no-ops when under the limit", async () => {
    const logPath = path.join(workspaceDir, "memory", "reflection-change-log.jsonl");
    const content = '{"ts":"2026-03-15","jobId":"test"}\n';
    await fs.writeFile(logPath, content, "utf-8");

    await pruneReflectionChangeLog(logPath, 200);

    const after = await fs.readFile(logPath, "utf-8");
    expect(after).toBe(content);
  });
});

describe("updateReflectionInbox with problematic rules", () => {
  it("includes problematic rules in the inbox markdown", async () => {
    await fs.writeFile(
      path.join(workspaceDir, "IDENTITY.md"),
      "# IDENTITY\n\n## CRITICAL Rules\n\n- **CRITICAL [1H/3M]:** Always verify API health before calling\n- **CRITICAL [5H/1M]:** Check file existence before reading\n",
      "utf-8",
    );

    const summary = await updateReflectionInbox({
      cfg: { session: { store: sessionStorePath } } as never,
      agentId: "main",
      workspaceDir,
      lastRunAtMs: Date.parse("2026-03-07T10:30:00Z"),
    });

    expect(summary.problematicRules).toHaveLength(1);
    expect(summary.problematicRules[0].text).toContain("verify API health");

    const inbox = await fs.readFile(
      path.join(workspaceDir, "memory", "reflection-inbox.md"),
      "utf-8",
    );
    expect(inbox).toContain("## Problematic Rules");
    expect(inbox).toContain("[1H/3M]");
    expect(inbox).toContain("verify API health");
  });
});
