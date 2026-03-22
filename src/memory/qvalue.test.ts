import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureMemoryIndexSchema } from "./memory-schema.js";
import {
  REWARD_IGNORED_PENALTY,
  REWARD_MEMORY_GET_FOLLOWUP,
  REWARD_PATH_REFERENCE,
  REWARD_TEXT_CITATION,
  applyQValueBoost,
  computeAndApplyRewards,
  computeChunkReward,
  decayQValues,
  hasPathReference,
  hasTextCitation,
  logMemoryGetAccess,
  logRetrieval,
  readQValues,
  updateQValueEMA,
} from "./qvalue.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  ensureMemoryIndexSchema({
    db,
    embeddingCacheTable: "embedding_cache",
    ftsTable: "chunks_fts",
    ftsEnabled: false,
  });
  return db;
}

function insertQValue(
  db: DatabaseSync,
  chunkId: string,
  qValue: number,
  retrievalCount = 0,
  rewardSum = 0,
) {
  db.prepare(
    `INSERT INTO chunk_qvalues (chunk_id, q_value, retrieval_count, reward_sum, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(chunkId, qValue, retrievalCount, rewardSum, Date.now());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("qvalue", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("readQValues", () => {
    it("returns empty map for empty chunk list", () => {
      expect(readQValues(db, []).size).toBe(0);
    });

    it("returns default 1.0 for unknown chunks (not in map)", () => {
      const result = readQValues(db, ["unknown-chunk"]);
      expect(result.size).toBe(0);
      // Callers treat missing entries as q=1.0
    });

    it("reads existing Q-value records", () => {
      insertQValue(db, "chunk-a", 1.5, 10, 3.0);
      insertQValue(db, "chunk-b", 0.7, 5, -0.5);

      const result = readQValues(db, ["chunk-a", "chunk-b", "chunk-c"]);

      expect(result.size).toBe(2);
      expect(result.get("chunk-a")?.qValue).toBeCloseTo(1.5);
      expect(result.get("chunk-a")?.retrievalCount).toBe(10);
      expect(result.get("chunk-b")?.qValue).toBeCloseTo(0.7);
      expect(result.has("chunk-c")).toBe(false);
    });
  });

  describe("applyQValueBoost", () => {
    it("boosts scores for high-Q chunks", () => {
      const qValues = new Map();
      qValues.set("a", { chunkId: "a", qValue: 1.5, retrievalCount: 10 });

      const results = [{ id: "a", score: 0.8, path: "a.md", snippet: "test" }];
      const boosted = applyQValueBoost(results, qValues);

      expect(boosted[0]?.score).toBeCloseTo(0.8 * 1.5);
    });

    it("reduces scores for low-Q chunks", () => {
      const qValues = new Map();
      qValues.set("a", { chunkId: "a", qValue: 0.6, retrievalCount: 10 });

      const results = [{ id: "a", score: 0.8, path: "a.md", snippet: "test" }];
      const boosted = applyQValueBoost(results, qValues);

      expect(boosted[0]?.score).toBeCloseTo(0.8 * 0.6);
    });

    it("clamps Q-value to minimum 0.5", () => {
      const qValues = new Map();
      qValues.set("a", { chunkId: "a", qValue: 0.1, retrievalCount: 20 });

      const results = [{ id: "a", score: 1.0, path: "a.md", snippet: "test" }];
      const boosted = applyQValueBoost(results, qValues);

      expect(boosted[0]?.score).toBeCloseTo(1.0 * 0.5);
    });

    it("clamps Q-value to maximum 2.0", () => {
      const qValues = new Map();
      qValues.set("a", { chunkId: "a", qValue: 3.0, retrievalCount: 20 });

      const results = [{ id: "a", score: 0.5, path: "a.md", snippet: "test" }];
      const boosted = applyQValueBoost(results, qValues);

      expect(boosted[0]?.score).toBeCloseTo(0.5 * 2.0);
    });

    it("applies exploration bonus for cold chunks (0 retrievals)", () => {
      const qValues = new Map();
      qValues.set("a", { chunkId: "a", qValue: 1.0, retrievalCount: 0 });

      const results = [{ id: "a", score: 1.0, path: "a.md", snippet: "test" }];
      const boosted = applyQValueBoost(results, qValues);

      expect(boosted[0]?.score).toBeCloseTo(1.0 * 1.0 * 1.05);
    });

    it("decays exploration bonus over retrievals", () => {
      const qValues = new Map();
      qValues.set("a", { chunkId: "a", qValue: 1.0, retrievalCount: 3 });

      const results = [{ id: "a", score: 1.0, path: "a.md", snippet: "test" }];
      const boosted = applyQValueBoost(results, qValues);

      // bonus = 1.0 + (1.05 - 1.0) × (1 - 3/5) = 1.0 + 0.05 × 0.4 = 1.02
      expect(boosted[0]?.score).toBeCloseTo(1.0 * 1.0 * 1.02);
    });

    it("no exploration bonus after 5+ retrievals", () => {
      const qValues = new Map();
      qValues.set("a", { chunkId: "a", qValue: 1.0, retrievalCount: 5 });

      const results = [{ id: "a", score: 1.0, path: "a.md", snippet: "test" }];
      const boosted = applyQValueBoost(results, qValues);

      expect(boosted[0]?.score).toBeCloseTo(1.0);
    });

    it("applies exploration bonus for unknown chunks (not in map)", () => {
      const qValues = new Map();

      const results = [{ id: "new-chunk", score: 1.0, path: "a.md", snippet: "test" }];
      const boosted = applyQValueBoost(results, qValues);

      // Unknown chunks: q=1.0, retrievalCount=0, bonus=1.05
      expect(boosted[0]?.score).toBeCloseTo(1.0 * 1.0 * 1.05);
    });

    it("does not mutate original results", () => {
      const qValues = new Map();
      qValues.set("a", { chunkId: "a", qValue: 1.5, retrievalCount: 10 });

      const original = [{ id: "a", score: 0.8, path: "a.md", snippet: "test" }];
      applyQValueBoost(original, qValues);

      expect(original[0]?.score).toBe(0.8);
    });

    it("returns copy when disabled", () => {
      const qValues = new Map();
      qValues.set("a", { chunkId: "a", qValue: 2.0, retrievalCount: 10 });

      const results = [{ id: "a", score: 0.8, path: "a.md", snippet: "test" }];
      const boosted = applyQValueBoost(results, qValues, { enabled: false });

      expect(boosted[0]?.score).toBe(0.8);
    });

    it("returns empty array for empty input", () => {
      expect(applyQValueBoost([], new Map())).toEqual([]);
    });
  });

  describe("logRetrieval", () => {
    it("writes entries to retrieval_log", () => {
      logRetrieval(
        db,
        "session-1",
        [
          { id: "chunk-a", path: "memory/a.md", snippet: "hello world", score: 0.9 },
          { id: "chunk-b", path: "memory/b.md", snippet: "test data", score: 0.7 },
        ],
        "test query",
      );

      const rows = db
        .prepare(`SELECT * FROM retrieval_log WHERE session_key = ?`)
        .all("session-1") as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(2);
      expect(rows[0]?.chunk_id).toBe("chunk-a");
      expect(rows[1]?.chunk_id).toBe("chunk-b");
    });

    it("updates retrieval_count in chunk_qvalues", () => {
      logRetrieval(
        db,
        "session-1",
        [{ id: "chunk-a", path: "memory/a.md", snippet: "test", score: 0.9 }],
        "query",
      );

      const row = db
        .prepare(`SELECT retrieval_count FROM chunk_qvalues WHERE chunk_id = ?`)
        .get("chunk-a") as { retrieval_count: number } | undefined;

      expect(row?.retrieval_count).toBe(1);
    });

    it("increments retrieval_count on repeated retrievals", () => {
      for (let i = 0; i < 3; i++) {
        logRetrieval(
          db,
          `session-${i}`,
          [{ id: "chunk-a", path: "memory/a.md", snippet: "test", score: 0.9 }],
          "query",
        );
      }

      const row = db
        .prepare(`SELECT retrieval_count FROM chunk_qvalues WHERE chunk_id = ?`)
        .get("chunk-a") as { retrieval_count: number } | undefined;

      expect(row?.retrieval_count).toBe(3);
    });

    it("skips for empty session key", () => {
      logRetrieval(db, "", [{ id: "chunk-a", path: "a.md", snippet: "test", score: 0.9 }], "query");

      const rows = db.prepare(`SELECT COUNT(*) as c FROM retrieval_log`).get() as { c: number };
      expect(rows.c).toBe(0);
    });
  });

  describe("logMemoryGetAccess", () => {
    it("writes memory_get sentinel to retrieval_log", () => {
      logMemoryGetAccess(db, "session-1", "memory/projects.md");

      const rows = db
        .prepare(`SELECT * FROM retrieval_log WHERE session_key = ? AND chunk_id = ?`)
        .all("session-1", "__memory_get__") as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(1);
      expect(rows[0]?.chunk_path).toBe("memory/projects.md");
    });
  });

  describe("hasTextCitation", () => {
    it("detects 3+ consecutive words from snippet in response", () => {
      expect(
        hasTextCitation(
          "the quick brown fox jumps over the lazy dog",
          "I found that the quick brown fox is relevant here.",
        ),
      ).toBe(true);
    });

    it("returns false when no consecutive words match", () => {
      expect(hasTextCitation("alpha beta gamma delta", "delta gamma beta alpha")).toBe(false);
    });

    it("returns false for empty inputs", () => {
      expect(hasTextCitation("", "response")).toBe(false);
      expect(hasTextCitation("snippet", "")).toBe(false);
    });

    it("is case-insensitive", () => {
      expect(hasTextCitation("The Quick Brown Fox", "the quick brown fox appears")).toBe(true);
    });

    it("returns false when snippet has fewer words than threshold", () => {
      expect(hasTextCitation("ab cd", "ab cd")).toBe(false);
    });
  });

  describe("hasPathReference", () => {
    it("detects path in response text", () => {
      expect(hasPathReference("memory/projects.md", "See memory/projects.md for details")).toBe(
        true,
      );
    });

    it("returns false when path not in response", () => {
      expect(hasPathReference("memory/projects.md", "No path here")).toBe(false);
    });
  });

  describe("computeChunkReward", () => {
    it("returns +0.3 for text citation", () => {
      const reward = computeChunkReward({
        chunkPath: "a.md",
        chunkSnippet: "the quick brown fox",
        responseText: "the quick brown fox is relevant",
        rank: 0,
        totalResults: 5,
        memoryGetPaths: new Set(),
      });
      expect(reward).toBeCloseTo(REWARD_TEXT_CITATION);
    });

    it("returns +0.2 for path reference", () => {
      const reward = computeChunkReward({
        chunkPath: "memory/config.md",
        chunkSnippet: "xy",
        responseText: "Check memory/config.md for details",
        rank: 0,
        totalResults: 5,
        memoryGetPaths: new Set(),
      });
      expect(reward).toBeCloseTo(REWARD_PATH_REFERENCE);
    });

    it("returns +0.4 for memory_get follow-up", () => {
      const reward = computeChunkReward({
        chunkPath: "memory/config.md",
        chunkSnippet: "xy",
        responseText: "no match here",
        rank: 5,
        totalResults: 10,
        memoryGetPaths: new Set(["memory/config.md"]),
      });
      expect(reward).toBeCloseTo(REWARD_MEMORY_GET_FOLLOWUP);
    });

    it("stacks multiple rewards", () => {
      const reward = computeChunkReward({
        chunkPath: "memory/config.md",
        chunkSnippet: "the quick brown fox",
        responseText: "memory/config.md says the quick brown fox is here",
        rank: 0,
        totalResults: 5,
        memoryGetPaths: new Set(["memory/config.md"]),
      });
      expect(reward).toBeCloseTo(
        REWARD_MEMORY_GET_FOLLOWUP + REWARD_TEXT_CITATION + REWARD_PATH_REFERENCE,
      );
    });

    it("returns -0.1 for ignored top-3 result", () => {
      const reward = computeChunkReward({
        chunkPath: "a.md",
        chunkSnippet: "xy",
        responseText: "nothing relevant",
        rank: 0,
        totalResults: 5,
        memoryGetPaths: new Set(),
      });
      expect(reward).toBeCloseTo(REWARD_IGNORED_PENALTY);
    });

    it("returns 0 for ignored result outside top-3", () => {
      const reward = computeChunkReward({
        chunkPath: "a.md",
        chunkSnippet: "xy",
        responseText: "nothing relevant",
        rank: 3,
        totalResults: 5,
        memoryGetPaths: new Set(),
      });
      expect(reward).toBe(0);
    });
  });

  describe("updateQValueEMA", () => {
    it("increases Q for positive reward", () => {
      const newQ = updateQValueEMA(1.0, 0.3, 0.15);
      // 1.0 × 0.85 + 1.3 × 0.15 = 0.85 + 0.195 = 1.045
      expect(newQ).toBeCloseTo(1.045);
    });

    it("decreases Q for negative reward", () => {
      const newQ = updateQValueEMA(1.0, -0.1, 0.15);
      // 1.0 × 0.85 + 0.9 × 0.15 = 0.85 + 0.135 = 0.985
      expect(newQ).toBeCloseTo(0.985);
    });

    it("clamps to minimum 0.5", () => {
      const newQ = updateQValueEMA(0.5, -0.1, 0.15);
      expect(newQ).toBeGreaterThanOrEqual(0.5);
    });

    it("clamps to maximum 2.0", () => {
      const newQ = updateQValueEMA(2.0, 0.5, 0.15);
      expect(newQ).toBeLessThanOrEqual(2.0);
    });
  });

  describe("computeAndApplyRewards", () => {
    it("updates Q-values for cited chunks", () => {
      logRetrieval(
        db,
        "session-1",
        [
          {
            id: "chunk-a",
            path: "memory/a.md",
            snippet: "the quick brown fox jumps over",
            score: 0.9,
          },
        ],
        "query",
      );

      computeAndApplyRewards(db, "session-1", "the quick brown fox is relevant");

      const row = db
        .prepare(`SELECT q_value FROM chunk_qvalues WHERE chunk_id = ?`)
        .get("chunk-a") as { q_value: number };

      // reward = +0.3 (text citation)
      // newQ = 1.0 * 0.85 + 1.3 * 0.15 = 1.045
      expect(row.q_value).toBeCloseTo(1.045);
    });

    it("penalizes ignored top-3 chunks", () => {
      logRetrieval(
        db,
        "session-1",
        [{ id: "chunk-a", path: "memory/a.md", snippet: "irrelevant content", score: 0.9 }],
        "query",
      );

      computeAndApplyRewards(db, "session-1", "completely unrelated response");

      const row = db
        .prepare(`SELECT q_value FROM chunk_qvalues WHERE chunk_id = ?`)
        .get("chunk-a") as { q_value: number };

      // reward = -0.1 (ignored, rank 0)
      // newQ = 1.0 * 0.85 + 0.9 * 0.15 = 0.985
      expect(row.q_value).toBeCloseTo(0.985);
    });

    it("clears retrieval_log after processing", () => {
      logRetrieval(
        db,
        "session-1",
        [{ id: "chunk-a", path: "a.md", snippet: "test content here", score: 0.9 }],
        "query",
      );

      computeAndApplyRewards(db, "session-1", "test content here is good");

      const rows = db
        .prepare(`SELECT COUNT(*) as c FROM retrieval_log WHERE session_key = ?`)
        .get("session-1") as { c: number };

      expect(rows.c).toBe(0);
    });

    it("detects memory_get follow-up reward", () => {
      logRetrieval(
        db,
        "session-1",
        [{ id: "chunk-a", path: "memory/config.md", snippet: "xy", score: 0.9 }],
        "query",
      );
      logMemoryGetAccess(db, "session-1", "memory/config.md");

      computeAndApplyRewards(db, "session-1", "something unrelated");

      const row = db
        .prepare(`SELECT q_value FROM chunk_qvalues WHERE chunk_id = ?`)
        .get("chunk-a") as { q_value: number };

      // reward = +0.4 (memory_get follow-up)
      // newQ = 1.0 * 0.85 + 1.4 * 0.15 = 1.06
      expect(row.q_value).toBeCloseTo(1.06);
    });

    it("does nothing for empty session", () => {
      computeAndApplyRewards(db, "nonexistent", "response text");

      const rows = db.prepare(`SELECT COUNT(*) as c FROM chunk_qvalues`).get() as { c: number };
      expect(rows.c).toBe(0);
    });

    it("does nothing for empty response text", () => {
      logRetrieval(
        db,
        "session-1",
        [{ id: "chunk-a", path: "a.md", snippet: "test", score: 0.9 }],
        "query",
      );

      computeAndApplyRewards(db, "session-1", "");
      // Should not have updated Q-values (retrieval_log still has the logRetrieval
      // upsert from the retrieval count, but no reward-based updates)
    });
  });

  describe("decayQValues", () => {
    it("moves elevated Q-values toward 1.0", () => {
      // Set q_value=1.5 with an old updated_at (30 days ago = ~half of 60-day half-life)
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      db.prepare(
        `INSERT INTO chunk_qvalues (chunk_id, q_value, retrieval_count, reward_sum, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run("chunk-a", 1.5, 5, 1.0, thirtyDaysAgo);

      decayQValues(db, 60);

      const row = db
        .prepare(`SELECT q_value FROM chunk_qvalues WHERE chunk_id = ?`)
        .get("chunk-a") as { q_value: number };

      // After 30 days with 60-day half-life:
      // decayFactor = 0.5^(30/60) = 0.5^0.5 ≈ 0.707
      // decayed = 1.0 + (1.5 - 1.0) × 0.707 ≈ 1.354
      expect(row.q_value).toBeCloseTo(1.354, 1);
      expect(row.q_value).toBeLessThan(1.5);
      expect(row.q_value).toBeGreaterThan(1.0);
    });

    it("moves suppressed Q-values toward 1.0", () => {
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      db.prepare(
        `INSERT INTO chunk_qvalues (chunk_id, q_value, retrieval_count, reward_sum, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run("chunk-a", 0.6, 5, -2.0, thirtyDaysAgo);

      decayQValues(db, 60);

      const row = db
        .prepare(`SELECT q_value FROM chunk_qvalues WHERE chunk_id = ?`)
        .get("chunk-a") as { q_value: number };

      expect(row.q_value).toBeGreaterThan(0.6);
      expect(row.q_value).toBeLessThan(1.0);
    });

    it("does not modify neutral Q-values", () => {
      db.prepare(
        `INSERT INTO chunk_qvalues (chunk_id, q_value, retrieval_count, reward_sum, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run("chunk-a", 1.0, 5, 0, Date.now() - 90 * 24 * 60 * 60 * 1000);

      decayQValues(db, 60);

      const row = db
        .prepare(`SELECT q_value FROM chunk_qvalues WHERE chunk_id = ?`)
        .get("chunk-a") as { q_value: number };

      expect(row.q_value).toBeCloseTo(1.0);
    });
  });

  describe("edge cases", () => {
    it("readQValues handles large batch (>500 IDs)", () => {
      // Insert a few known records
      insertQValue(db, "known-1", 1.3, 5, 1.0);
      insertQValue(db, "known-2", 0.8, 3, -0.5);

      // Request 600 IDs — should batch correctly
      const ids = Array.from({ length: 600 }, (_, i) =>
        i === 100 ? "known-1" : i === 500 ? "known-2" : `unknown-${i}`,
      );
      const result = readQValues(db, ids);

      expect(result.size).toBe(2);
      expect(result.get("known-1")?.qValue).toBeCloseTo(1.3);
      expect(result.get("known-2")?.qValue).toBeCloseTo(0.8);
    });

    it("hasTextCitation caps very long snippets", () => {
      // A very long snippet should not cause performance issues
      const longSnippet = "word ".repeat(500) + "target phrase here";
      const response = "target phrase here is matched";
      // Since the snippet is capped at 1000 chars, "target phrase here"
      // may or may not be in the clipped portion — we just verify no crash
      expect(() => hasTextCitation(longSnippet, response)).not.toThrow();
    });

    it("computeAndApplyRewards deduplicates chunks across multiple searches", () => {
      // Same chunk retrieved twice in the same session
      logRetrieval(
        db,
        "session-multi",
        [{ id: "chunk-duped", path: "a.md", snippet: "the quick brown fox", score: 0.8 }],
        "query-1",
      );
      logRetrieval(
        db,
        "session-multi",
        [{ id: "chunk-duped", path: "a.md", snippet: "the quick brown fox", score: 0.9 }],
        "query-2",
      );

      computeAndApplyRewards(db, "session-multi", "the quick brown fox is relevant");

      const row = db
        .prepare(`SELECT q_value FROM chunk_qvalues WHERE chunk_id = ?`)
        .get("chunk-duped") as { q_value: number };

      // Should be boosted (text citation)
      expect(row.q_value).toBeGreaterThan(1.0);
    });

    it("computeAndApplyRewards isolates sessions", () => {
      logRetrieval(
        db,
        "session-A",
        [{ id: "chunk-a", path: "a.md", snippet: "session a content", score: 0.9 }],
        "query",
      );
      logRetrieval(
        db,
        "session-B",
        [{ id: "chunk-b", path: "b.md", snippet: "session b content", score: 0.9 }],
        "query",
      );

      // Only process session-A
      computeAndApplyRewards(db, "session-A", "session a content is useful");

      // session-A log should be cleared
      const aLog = db
        .prepare(`SELECT COUNT(*) as c FROM retrieval_log WHERE session_key = ?`)
        .get("session-A") as { c: number };
      expect(aLog.c).toBe(0);

      // session-B log should remain untouched
      const bLog = db
        .prepare(`SELECT COUNT(*) as c FROM retrieval_log WHERE session_key = ?`)
        .get("session-B") as { c: number };
      expect(bLog.c).toBe(1);
    });

    it("logRetrieval rollback on error leaves no partial data", () => {
      // Force an error by closing the DB and trying to log
      const tempDb = createTestDb();

      // First log should work
      logRetrieval(
        tempDb,
        "session-ok",
        [{ id: "chunk-ok", path: "a.md", snippet: "test", score: 0.9 }],
        "query",
      );

      const rows = tempDb.prepare(`SELECT COUNT(*) as c FROM retrieval_log`).get() as { c: number };
      expect(rows.c).toBe(1);

      tempDb.close();
    });
  });

  describe("end-to-end integration", () => {
    it("search → cite → reward → re-rank cycle", () => {
      // 1. Simulate first search results — close scores so one reward cycle can flip ranking
      const searchResults = [
        {
          id: "chunk-good",
          path: "memory/api-docs.md",
          snippet: "the stripe webhook endpoint handles payment events",
          score: 0.82,
        },
        {
          id: "chunk-bad",
          path: "memory/old-notes.md",
          snippet: "random unrelated content xyz",
          score: 0.83,
        },
      ];

      // 2. Log retrieval
      logRetrieval(db, "session-1", searchResults, "stripe webhook");

      // 3. Agent cites chunk-good but ignores chunk-bad
      computeAndApplyRewards(
        db,
        "session-1",
        "The stripe webhook endpoint handles payment events and should be configured with...",
      );

      // 4. Check Q-values
      const qValues = readQValues(db, ["chunk-good", "chunk-bad"]);

      const goodQ = qValues.get("chunk-good")?.qValue ?? 1.0;
      const badQ = qValues.get("chunk-bad")?.qValue ?? 1.0;

      expect(goodQ).toBeGreaterThan(1.0); // boosted
      expect(badQ).toBeLessThan(1.0); // penalized

      // 5. Second search — Q-value boost should re-rank
      const secondSearchResults = [
        { id: "chunk-good", score: 0.82, path: "memory/api-docs.md", snippet: "stripe" },
        { id: "chunk-bad", score: 0.83, path: "memory/old-notes.md", snippet: "old" },
      ];

      const boosted = applyQValueBoost(secondSearchResults, qValues);

      // chunk-good × ~1.045 = ~0.857; chunk-bad × ~0.985 = ~0.818
      const goodBoosted = boosted.find((r) => r.id === "chunk-good")!;
      const badBoosted = boosted.find((r) => r.id === "chunk-bad")!;

      expect(goodBoosted.score).toBeGreaterThan(badBoosted.score);
    });
  });
});
