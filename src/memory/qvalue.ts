/**
 * Q-value reinforcement learning for memory search results.
 *
 * Tracks which retrieved chunks agents actually use (cited in responses,
 * followed up with memory_get, etc.) and adjusts chunk scores over time.
 * Useful chunks get boosted; ignored chunks get suppressed.
 *
 * Follows the same pure-function, immutable-return pattern as source-boost.ts
 * and gravity-dampening.ts.
 */

import type { DatabaseSync } from "node:sqlite";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QValueRecord = {
  chunkId: string;
  qValue: number;
  retrievalCount: number;
  rewardSum: number;
  lastRetrievedAt: number | null;
  lastRewardedAt: number | null;
  updatedAt: number;
};

export type QValueConfig = {
  /** Enable/disable Q-value boosting. Default: true. */
  enabled: boolean;
  /** EMA learning rate for Q-value updates. Default: 0.15. */
  learningRate: number;
  /** Half-life in days for Q-value decay toward 1.0. Default: 60. */
  decayHalfLifeDays: number;
};

export const DEFAULT_QVALUE_CONFIG: QValueConfig = {
  enabled: true,
  learningRate: 0.15,
  decayHalfLifeDays: 60,
};

/** Minimum Q-value (prevents extreme suppression). */
const QVALUE_MIN = 0.5;
/** Maximum Q-value (prevents extreme boosting). */
const QVALUE_MAX = 2.0;
/** Default Q-value for chunks without retrieval history. */
const QVALUE_DEFAULT = 1.0;
/** Exploration bonus multiplier for cold chunks (0 retrievals). */
const EXPLORATION_BONUS_BASE = 1.05;
/** Number of retrievals before exploration bonus fully decays. */
const EXPLORATION_BONUS_DECAY_RETRIEVALS = 5;

// ---------------------------------------------------------------------------
// Reward signal constants
// ---------------------------------------------------------------------------

/** Minimum consecutive words from snippet that must appear in response for citation signal. */
const CITATION_MIN_CONSECUTIVE_WORDS = 3;

export const REWARD_TEXT_CITATION = 0.3;
export const REWARD_PATH_REFERENCE = 0.2;
export const REWARD_MEMORY_GET_FOLLOWUP = 0.4;
export const REWARD_IGNORED_PENALTY = -0.1;
/** Number of top-ranked results eligible for the ignored penalty. */
const IGNORED_TOP_N = 3;

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Read Q-value records for a batch of chunk IDs.
 * Returns a Map keyed by chunk ID; missing chunks get default values.
 */
export function readQValues(db: DatabaseSync, chunkIds: string[]): Map<string, QValueRecord> {
  const result = new Map<string, QValueRecord>();
  if (chunkIds.length === 0) {
    return result;
  }

  // Process in batches to avoid excessively large IN clauses (SQLite limit is ~999 params)
  const BATCH_SIZE = 500;
  for (let offset = 0; offset < chunkIds.length; offset += BATCH_SIZE) {
    const batch = chunkIds.slice(offset, offset + BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT chunk_id, q_value, retrieval_count, reward_sum, last_retrieved_at, last_rewarded_at, updated_at
         FROM chunk_qvalues WHERE chunk_id IN (${placeholders})`,
      )
      .all(...batch) as Array<{
      chunk_id: string;
      q_value: number;
      retrieval_count: number;
      reward_sum: number;
      last_retrieved_at: number | null;
      last_rewarded_at: number | null;
      updated_at: number;
    }>;

    for (const row of rows) {
      result.set(row.chunk_id, {
        chunkId: row.chunk_id,
        qValue: row.q_value,
        retrievalCount: row.retrieval_count,
        rewardSum: row.reward_sum,
        lastRetrievedAt: row.last_retrieved_at,
        lastRewardedAt: row.last_rewarded_at,
        updatedAt: row.updated_at,
      });
    }
  }

  return result;
}

/**
 * Apply Q-value boost to search results.
 *
 * effectiveScore = baseScore × clamp(qValue, 0.5, 2.0) × explorationBonus
 *
 * Does not mutate the input — returns a new array with adjusted scores.
 */
export function applyQValueBoost<T extends { score: number; id?: string }>(
  results: T[],
  qValues: Map<string, QValueRecord>,
  config: Partial<QValueConfig> = {},
): T[] {
  const { enabled } = { ...DEFAULT_QVALUE_CONFIG, ...config };

  if (!enabled || results.length === 0) {
    return [...results];
  }

  return results.map((result) => {
    const id = result.id;
    if (!id) {
      return result;
    }

    const record = qValues.get(id);
    const qValue = record?.qValue ?? QVALUE_DEFAULT;
    const retrievalCount = record?.retrievalCount ?? 0;

    // Clamp Q-value to prevent extreme swings
    const clampedQ = Math.max(QVALUE_MIN, Math.min(QVALUE_MAX, qValue));

    // Exploration bonus for cold chunks (decays from 1.05 to 1.0 over 5 retrievals)
    let explorationBonus = 1.0;
    if (retrievalCount < EXPLORATION_BONUS_DECAY_RETRIEVALS) {
      const decay = 1 - retrievalCount / EXPLORATION_BONUS_DECAY_RETRIEVALS;
      explorationBonus = 1.0 + (EXPLORATION_BONUS_BASE - 1.0) * decay;
    }

    return {
      ...result,
      score: result.score * clampedQ * explorationBonus,
    };
  });
}

/**
 * Log retrieved chunks for a session.
 * Called after memory_search returns results.
 */
export function logRetrieval(
  db: DatabaseSync,
  sessionKey: string,
  results: Array<{ id: string; path: string; snippet: string; score: number }>,
  query: string,
): void {
  if (!sessionKey || results.length === 0) {
    return;
  }

  const nowMs = Date.now();
  const insert = db.prepare(
    `INSERT INTO retrieval_log (session_key, chunk_id, chunk_path, chunk_snippet, score, query, retrieved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const upsert = db.prepare(
    `INSERT INTO chunk_qvalues (chunk_id, retrieval_count, last_retrieved_at, updated_at)
     VALUES (?, 1, ?, ?)
     ON CONFLICT(chunk_id) DO UPDATE SET
       retrieval_count = retrieval_count + 1,
       last_retrieved_at = excluded.last_retrieved_at,
       updated_at = excluded.updated_at`,
  );

  db.exec("BEGIN");
  try {
    for (const r of results) {
      insert.run(sessionKey, r.id, r.path, r.snippet, r.score, query, nowMs);
      upsert.run(r.id, nowMs, nowMs);
    }

    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw err;
  }
}

/**
 * Log a memory_get access for reward signal detection.
 * Called when memory_get successfully retrieves a file.
 */
export function logMemoryGetAccess(db: DatabaseSync, sessionKey: string, path: string): void {
  if (!sessionKey || !path) {
    return;
  }

  const nowMs = Date.now();
  // Store as a special retrieval_log entry with a sentinel chunk_id
  db.prepare(
    `INSERT INTO retrieval_log (session_key, chunk_id, chunk_path, chunk_snippet, score, query, retrieved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(sessionKey, `__memory_get__`, path, "", 0, "__memory_get__", nowMs);
}

// ---------------------------------------------------------------------------
// Reward computation
// ---------------------------------------------------------------------------

/**
 * Check if ≥N consecutive words from a snippet appear in the response text.
 * Used as a lightweight citation signal (no LLM calls needed).
 */
export function hasTextCitation(
  snippet: string,
  responseText: string,
  minConsecutiveWords: number = CITATION_MIN_CONSECUTIVE_WORDS,
): boolean {
  if (!snippet || !responseText) {
    return false;
  }

  // Cap snippet analysis to prevent O(n²) on very long snippets
  const maxSnippetChars = 1000;
  const clippedSnippet =
    snippet.length > maxSnippetChars ? snippet.slice(0, maxSnippetChars) : snippet;

  const snippetWords = clippedSnippet
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
  const responseLower = responseText.toLowerCase();

  if (snippetWords.length < minConsecutiveWords) {
    return false;
  }

  for (let i = 0; i <= snippetWords.length - minConsecutiveWords; i++) {
    const phrase = snippetWords.slice(i, i + minConsecutiveWords).join(" ");
    if (responseLower.includes(phrase)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a chunk's file path appears in the response text.
 */
export function hasPathReference(chunkPath: string, responseText: string): boolean {
  if (!chunkPath || !responseText) {
    return false;
  }
  return responseText.includes(chunkPath);
}

/**
 * Compute reward for a single chunk based on usage signals.
 */
export function computeChunkReward(params: {
  chunkPath: string;
  chunkSnippet: string;
  responseText: string;
  rank: number;
  totalResults: number;
  memoryGetPaths: Set<string>;
}): number {
  let reward = 0;

  // +0.4 for memory_get follow-up
  if (params.memoryGetPaths.has(params.chunkPath)) {
    reward += REWARD_MEMORY_GET_FOLLOWUP;
  }

  // +0.3 for text citation
  if (hasTextCitation(params.chunkSnippet, params.responseText)) {
    reward += REWARD_TEXT_CITATION;
  }

  // +0.2 for path reference
  if (hasPathReference(params.chunkPath, params.responseText)) {
    reward += REWARD_PATH_REFERENCE;
  }

  // -0.1 for ignored top-N results
  if (reward === 0 && params.rank < IGNORED_TOP_N) {
    reward += REWARD_IGNORED_PENALTY;
  }

  return reward;
}

/**
 * Update a Q-value using exponential moving average.
 *
 * new_q = old_q × (1 - α) + (1.0 + reward) × α
 *
 * Clamped to [QVALUE_MIN, QVALUE_MAX].
 */
export function updateQValueEMA(
  oldQ: number,
  reward: number,
  learningRate: number = DEFAULT_QVALUE_CONFIG.learningRate,
): number {
  const newQ = oldQ * (1 - learningRate) + (1.0 + reward) * learningRate;
  return Math.max(QVALUE_MIN, Math.min(QVALUE_MAX, newQ));
}

/**
 * Compute rewards for all chunks retrieved in a session, update Q-values,
 * and clear the retrieval log for that session.
 *
 * This is the main post-turn hook. Fire-and-forget — should not block the response.
 */
export function computeAndApplyRewards(
  db: DatabaseSync,
  sessionKey: string,
  responseText: string,
  config: Partial<QValueConfig> = {},
): void {
  if (!sessionKey || !responseText) {
    return;
  }

  const { learningRate } = { ...DEFAULT_QVALUE_CONFIG, ...config };

  // Read retrieval log for this session
  const logRows = db
    .prepare(
      `SELECT chunk_id, chunk_path, chunk_snippet, score
       FROM retrieval_log
       WHERE session_key = ?
       ORDER BY score DESC`,
    )
    .all(sessionKey) as Array<{
    chunk_id: string;
    chunk_path: string;
    chunk_snippet: string;
    score: number;
  }>;

  if (logRows.length === 0) {
    return;
  }

  // Identify memory_get follow-up paths
  const memoryGetPaths = new Set<string>();
  const searchResults: typeof logRows = [];
  for (const row of logRows) {
    if (row.chunk_id === "__memory_get__") {
      memoryGetPaths.add(row.chunk_path);
    } else {
      searchResults.push(row);
    }
  }

  if (searchResults.length === 0) {
    // Clean up log even if only memory_get entries
    db.prepare(`DELETE FROM retrieval_log WHERE session_key = ?`).run(sessionKey);
    return;
  }

  // Deduplicate by chunk_id (keep highest score per chunk)
  const uniqueChunks = new Map<
    string,
    { chunkId: string; chunkPath: string; chunkSnippet: string; score: number }
  >();
  for (const row of searchResults) {
    const existing = uniqueChunks.get(row.chunk_id);
    if (!existing || row.score > existing.score) {
      uniqueChunks.set(row.chunk_id, {
        chunkId: row.chunk_id,
        chunkPath: row.chunk_path,
        chunkSnippet: row.chunk_snippet,
        score: row.score,
      });
    }
  }

  // Sort by score descending for rank-based signals
  const ranked = Array.from(uniqueChunks.values()).toSorted((a, b) => b.score - a.score);

  // Read existing Q-values
  const chunkIds = ranked.map((c) => c.chunkId);
  const existingQValues = readQValues(db, chunkIds);

  const nowMs = Date.now();

  db.exec("BEGIN");
  try {
    const upsert = db.prepare(
      `INSERT INTO chunk_qvalues (chunk_id, q_value, reward_sum, last_rewarded_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(chunk_id) DO UPDATE SET
         q_value = excluded.q_value,
         reward_sum = reward_sum + excluded.reward_sum,
         last_rewarded_at = excluded.last_rewarded_at,
         updated_at = excluded.updated_at`,
    );

    for (let i = 0; i < ranked.length; i++) {
      const chunk = ranked[i];
      const reward = computeChunkReward({
        chunkPath: chunk.chunkPath,
        chunkSnippet: chunk.chunkSnippet,
        responseText,
        rank: i,
        totalResults: ranked.length,
        memoryGetPaths,
      });

      if (reward === 0) {
        continue;
      }

      const existing = existingQValues.get(chunk.chunkId);
      const oldQ = existing?.qValue ?? QVALUE_DEFAULT;
      const newQ = updateQValueEMA(oldQ, reward, learningRate);

      upsert.run(chunk.chunkId, newQ, reward, nowMs, nowMs);
    }

    // Clear the retrieval log for this session
    db.prepare(`DELETE FROM retrieval_log WHERE session_key = ?`).run(sessionKey);

    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw err;
  }
}

/**
 * Decay all Q-values toward 1.0 over time.
 *
 * Uses exponential decay with configurable half-life:
 *   decayed_q = 1.0 + (q - 1.0) × 0.5^(daysSinceUpdate / halfLifeDays)
 *
 * Only updates values that have meaningfully changed (|q - 1.0| > 0.001).
 */
export function decayQValues(
  db: DatabaseSync,
  halfLifeDays: number = DEFAULT_QVALUE_CONFIG.decayHalfLifeDays,
): void {
  const nowMs = Date.now();
  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;

  // Read all non-neutral Q-values
  const rows = db
    .prepare(
      `SELECT chunk_id, q_value, updated_at FROM chunk_qvalues
       WHERE ABS(q_value - 1.0) > 0.001`,
    )
    .all() as Array<{ chunk_id: string; q_value: number; updated_at: number }>;

  if (rows.length === 0) {
    return;
  }

  const update = db.prepare(
    `UPDATE chunk_qvalues SET q_value = ?, updated_at = ? WHERE chunk_id = ?`,
  );

  db.exec("BEGIN");
  try {
    for (const row of rows) {
      const elapsed = Math.max(0, nowMs - row.updated_at);
      const decayFactor = Math.pow(0.5, elapsed / halfLifeMs);
      const decayed = 1.0 + (row.q_value - 1.0) * decayFactor;

      // If effectively back to neutral, set exactly 1.0
      const final = Math.abs(decayed - 1.0) < 0.001 ? 1.0 : decayed;
      if (final !== row.q_value) {
        update.run(final, nowMs, row.chunk_id);
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw err;
  }
}
