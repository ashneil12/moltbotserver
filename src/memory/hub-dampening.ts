/**
 * Hub dampening — post-fusion filter that penalizes results from files that
 * appear disproportionately often in the result set.
 *
 * Prevents a single large file (e.g. MEMORY.md, README.md) from monopolizing
 * the top-N results. This is complementary to, not conflicting with,
 * source-boost — source-boost rewards knowledge files slightly, hub dampening
 * prevents any single file from dominating the result set.
 *
 * Inspired by Ori-Mnemos hub dampening (P90 degree penalty). Adapted from
 * degree-based to concentration-based for OpenClaw's flat-chunk model.
 */

export type HubDampeningConfig = {
  /** Enable/disable hub dampening. Default: true. */
  enabled: boolean;
  /**
   * If a file accounts for more than this fraction of result chunks, it is
   * considered a hub. Must be in (0, 1]. Default: 0.4 (40%).
   */
  concentrationThreshold: number;
  /**
   * Base penalty multiplier applied to hub file scores. The actual penalty
   * increases with concentration — the farther above the threshold, the
   * stronger the dampening. Must be in (0, 1]. Default: 0.7.
   */
  penalty: number;
};

export const DEFAULT_HUB_DAMPENING_CONFIG: HubDampeningConfig = {
  enabled: true,
  concentrationThreshold: 0.4,
  penalty: 0.7,
};

/**
 * Apply hub dampening to hybrid search results.
 *
 * Counts how many result chunks come from each file path. If a file exceeds
 * the concentration threshold, all its results have their scores dampened
 * proportionally to how far above the threshold the file is.
 *
 * Does not mutate the input array — returns a new array with adjusted scores.
 */
export function applyHubDampening<T extends { score: number; path: string }>(
  results: T[],
  config: Partial<HubDampeningConfig> = {},
): T[] {
  const { enabled, concentrationThreshold, penalty } = {
    ...DEFAULT_HUB_DAMPENING_CONFIG,
    ...config,
  };

  if (!enabled || results.length <= 1) {
    return [...results];
  }

  const clampedThreshold = Math.max(0.01, Math.min(1, concentrationThreshold));
  const clampedPenalty = Math.max(0.01, Math.min(1, penalty));
  const totalResults = results.length;

  // Count chunks per file
  const fileCounts = new Map<string, number>();
  for (const result of results) {
    fileCounts.set(result.path, (fileCounts.get(result.path) ?? 0) + 1);
  }

  // Identify hub files (above concentration threshold)
  const hubPenalties = new Map<string, number>();
  for (const [filePath, count] of fileCounts) {
    const concentration = count / totalResults;
    if (concentration > clampedThreshold) {
      // Scale penalty: the farther above threshold, the stronger the dampening
      // At threshold: penalty = 1.0 (no dampening)
      // At 100% concentration: penalty = clampedPenalty
      const excess = Math.min(1, (concentration - clampedThreshold) / (1 - clampedThreshold));
      const effectivePenalty = 1 - excess * (1 - clampedPenalty);
      hubPenalties.set(filePath, effectivePenalty);
    }
  }

  if (hubPenalties.size === 0) {
    return [...results];
  }

  return results.map((result) => {
    const penaltyMultiplier = hubPenalties.get(result.path);
    if (penaltyMultiplier === undefined) {
      return result;
    }
    return { ...result, score: result.score * penaltyMultiplier };
  });
}
