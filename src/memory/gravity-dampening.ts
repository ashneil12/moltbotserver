/**
 * Gravity dampening — post-fusion filter that suppresses "cosine similarity
 * ghosts": results that score high on embedding similarity but have zero
 * meaningful term overlap with the query.
 *
 * Inspired by Drift-Memory's ablation-validated gravity stage. Adapted for
 * OpenClaw's hybrid search pipeline.
 */

import { isQueryStopWordToken } from "./query-expansion.js";

export type GravityDampeningConfig = {
  /** Enable/disable gravity dampening. Default: true. */
  enabled: boolean;
  /**
   * Penalty multiplier applied to ghost results. 0.5 = halve the score.
   * Must be in (0, 1]. Default: 0.5.
   */
  penalty: number;
  /**
   * Only apply gravity dampening to results above this score threshold.
   * Low-scoring results are already low-ranked and not worth penalizing.
   * Default: 0.2.
   */
  scoreThreshold: number;
};

export const DEFAULT_GRAVITY_DAMPENING_CONFIG: GravityDampeningConfig = {
  enabled: true,
  penalty: 0.5,
  scoreThreshold: 0.2,
};

/**
 * Extract meaningful (non-stopword) terms from text.
 * Normalizes to lowercase, strips punctuation, filters short tokens.
 */
export function extractKeyTerms(text: string): Set<string> {
  const words =
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s\p{L}-]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !isQueryStopWordToken(w)) ?? [];
  return new Set(words);
}

/**
 * Check if there is any meaningful term overlap between query terms and
 * a snippet's terms.
 */
function hasTermOverlap(queryTerms: Set<string>, snippetTerms: Set<string>): boolean {
  for (const term of queryTerms) {
    if (snippetTerms.has(term)) {
      return true;
    }
  }
  return false;
}

/**
 * Apply gravity dampening to hybrid search results.
 *
 * Results that score above the threshold but share zero meaningful terms with
 * the query have their scores penalized. This catches embedding-similarity
 * "ghosts" — results that are semantically adjacent but topically wrong.
 *
 * Does not mutate the input array — returns a new array with adjusted scores.
 */
export function applyGravityDampening<T extends { score: number; snippet: string }>(
  results: T[],
  query: string,
  config: Partial<GravityDampeningConfig> = {},
): T[] {
  const { enabled, penalty, scoreThreshold } = {
    ...DEFAULT_GRAVITY_DAMPENING_CONFIG,
    ...config,
  };

  if (!enabled || results.length === 0) {
    return [...results];
  }

  const queryTerms = extractKeyTerms(query);
  if (queryTerms.size === 0) {
    // Query is all stopwords or empty — can't determine overlap,
    // so skip dampening to avoid penalizing everything.
    return [...results];
  }

  const clampedPenalty = Math.max(0.01, Math.min(1, penalty));

  return results.map((result) => {
    if (result.score <= scoreThreshold) {
      return result;
    }

    const snippetTerms = extractKeyTerms(result.snippet);
    if (hasTermOverlap(queryTerms, snippetTerms)) {
      return result;
    }

    // No term overlap — this is likely a cosine similarity ghost
    return { ...result, score: result.score * clampedPenalty };
  });
}
