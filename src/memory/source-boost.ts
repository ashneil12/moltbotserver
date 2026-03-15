/**
 * Source-aware ranking for memory search results.
 *
 * Applies a post-merge score multiplier based on the source file path,
 * boosting results from agent-specific knowledge files (MEMORY.md, diary,
 * identity, working notes) so they rank higher than generic workspace content.
 */

/** Boost multiplier applied to agent knowledge file scores. */
const KNOWLEDGE_BOOST = 1.15;

/**
 * Path patterns that qualify for the knowledge-file boost.
 * Regex objects are precompiled at module load for hot-path performance.
 * Ordered from most specific to least; first match wins.
 */
const BOOST_RULES: ReadonlyArray<{ re: RegExp; boost: number }> = [
  // Root memory file
  { re: /(?:^|\/)MEMORY\.md$/i, boost: KNOWLEDGE_BOOST },
  // Diary files (including date-named entries)
  { re: /(?:^|\/)memory\/diary(?:[/.]|$)/i, boost: KNOWLEDGE_BOOST },
  // Any file under memory/ (topic files, etc.)
  { re: /(?:^|\/)memory\/[^/]+\.md$/i, boost: KNOWLEDGE_BOOST },
  // Identity and working notes at any depth
  { re: /(?:^|\/)IDENTITY\.md$/i, boost: KNOWLEDGE_BOOST },
  { re: /(?:^|\/)identity-scratchpad\.md$/i, boost: KNOWLEDGE_BOOST },
  { re: /(?:^|\/)WORKING\.md$/i, boost: KNOWLEDGE_BOOST },
];

/**
 * Returns the source-boost multiplier for a given relative path.
 * Returns `1.0` for paths that do not match any knowledge pattern.
 */
export function getSourceBoostMultiplier(relativePath: string): number {
  for (const rule of BOOST_RULES) {
    if (rule.re.test(relativePath)) {
      return rule.boost;
    }
  }
  return 1.0;
}

/**
 * Result shape expected by the boost pipeline.
 * Matches the output of the hybrid merge step.
 */
export type BoostableResult = {
  path: string;
  score: number;
};

/**
 * Applies source-aware score boosting to an array of hybrid search results.
 * Mutates nothing — returns a new array with adjusted scores.
 */
export function applySourceBoostToResults<T extends BoostableResult>(results: T[]): T[] {
  return results.map((r) => ({
    ...r,
    score: r.score * getSourceBoostMultiplier(r.path),
  }));
}
