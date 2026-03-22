/**
 * Query intent classification for memory search.
 *
 * Classifies queries into four intent types (episodic, procedural, decision,
 * semantic) and returns adjusted signal weights for the hybrid scoring
 * pipeline. When enabled, the caller blends the returned weights with user
 * config so that manual overrides always take priority.
 *
 * Inspired by Ori-Mnemos intent classification but adapted to OpenClaw's
 * two-signal (vector + text) pipeline with temporal decay.
 */

export type QueryIntent = "episodic" | "procedural" | "semantic" | "decision";

export type IntentWeightProfile = {
  /** Adjusted vector (embedding) weight. */
  vectorWeight: number;
  /** Adjusted text (FTS keyword) weight. */
  textWeight: number;
  /**
   * Multiplier applied to the configured half-life.
   * >1 means "care more about recency", <1 means "relax temporal bias".
   * A value of 1 leaves the configured half-life untouched.
   */
  temporalDecayMultiplier: number;
};

export type ClassifiedQuery = {
  intent: QueryIntent;
  confidence: number;
  profile: IntentWeightProfile;
};

// ---------------------------------------------------------------------------
// Intent patterns
// ---------------------------------------------------------------------------

const INTENT_PATTERNS: ReadonlyArray<{ intent: QueryIntent; patterns: RegExp[] }> = [
  {
    intent: "episodic",
    patterns: [
      /\bwhen\s+did\b/i,
      /\blast\s+time\b/i,
      /\bwhat\s+happened\b/i,
      /\brecently\b/i,
      /\bhistory\s+of\b/i,
      /\btimeline\b/i,
      /\bwhen\s+was\b/i,
      /\bremember\s+when\b/i,
      /\byesterday\b/i,
      /\blast\s+week\b/i,
      /\blast\s+month\b/i,
    ],
  },
  {
    intent: "procedural",
    patterns: [
      /\bhow\s+to\b/i,
      /\bsteps?\s+(for|to)\b/i,
      /\bprocess\b/i,
      /\bprocedure\b/i,
      /\binstructions?\b/i,
      /\bworkflow\b/i,
      /\bhow\s+do\b/i,
      /\bhow\s+can\b/i,
      /\bhow\s+should\b/i,
      /\bguide\b/i,
      /\btutorial\b/i,
      /\bsetup\b/i,
    ],
  },
  {
    intent: "decision",
    patterns: [
      /\bwhy\s+did\s+we\b/i,
      /\bwhat\s+did\s+we\s+decide\b/i,
      /\bdecision\b/i,
      /\bdecide[ds]?\b/i,
      /\bchose\b/i,
      /\bchoose\b/i,
      /\balternatives?\b/i,
      /\btrade-?off\b/i,
      /\brationale\b/i,
      /\bshould\s+we\b/i,
      /\bpros?\s+and\s+cons?\b/i,
    ],
  },
  // semantic is the default — no specific patterns needed
];

// ---------------------------------------------------------------------------
// Weight profiles
// ---------------------------------------------------------------------------

/**
 * Weight profiles per intent. Values are normalizable pairs — the caller is
 * responsible for normalizing them to sum to 1.0 before use.
 *
 * Design rationale:
 * - Episodic: less vector (time context matters more than semantic match),
 *   more temporal recency weighting
 * - Procedural: slight text boost (keywords like function names matter)
 * - Decision: text boost (exact terms like "chose", "decision" are valuable),
 *   moderate temporal recency
 * - Semantic: default weights unchanged
 */
const INTENT_PROFILES: Readonly<Record<QueryIntent, IntentWeightProfile>> = {
  episodic: { vectorWeight: 0.5, textWeight: 0.5, temporalDecayMultiplier: 0.5 },
  procedural: { vectorWeight: 0.6, textWeight: 0.4, temporalDecayMultiplier: 1.0 },
  decision: { vectorWeight: 0.55, textWeight: 0.45, temporalDecayMultiplier: 0.7 },
  semantic: { vectorWeight: 0.7, textWeight: 0.3, temporalDecayMultiplier: 1.0 },
};

const DEFAULT_PROFILE = INTENT_PROFILES.semantic;

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify a query's intent using heuristic pattern matching.
 *
 * Returns the classified intent, a confidence score (0–1), and a weight
 * profile for the hybrid search pipeline. The confidence reflects how many
 * patterns matched: 0 matches → 0.5, 1 match → 0.7, 2+ matches → 1.0.
 */
export function classifyIntent(query: string): ClassifiedQuery {
  const trimmed = query.trim();
  if (!trimmed) {
    return { intent: "semantic", confidence: 0.5, profile: DEFAULT_PROFILE };
  }

  let bestIntent: QueryIntent = "semantic";
  let bestScore = 0;

  for (const { intent, patterns } of INTENT_PATTERNS) {
    const matchCount = patterns.filter((p) => p.test(trimmed)).length;
    if (matchCount > bestScore) {
      bestScore = matchCount;
      bestIntent = intent;
    }
  }

  const confidence = bestScore >= 2 ? 1.0 : bestScore === 1 ? 0.7 : 0.5;

  return {
    intent: bestIntent,
    confidence,
    profile: INTENT_PROFILES[bestIntent],
  };
}

/**
 * Blend intent-classified weights with user-configured weights.
 *
 * If intent classification is enabled, the final weights are a weighted
 * average of the user config and the intent profile, based on confidence.
 * If the user has set explicit weights, they retain dominant influence.
 *
 * @param classified - Result from classifyIntent()
 * @param configVectorWeight - User-configured vectorWeight (already normalized)
 * @param configTextWeight - User-configured textWeight (already normalized)
 * @returns Blended, normalized weights
 */
export function blendIntentWeights(
  classified: ClassifiedQuery,
  configVectorWeight: number,
  configTextWeight: number,
): { vectorWeight: number; textWeight: number } {
  const { profile, confidence } = classified;

  // Normalize intent profile weights
  const profileSum = profile.vectorWeight + profile.textWeight;
  const normVec = profileSum > 0 ? profile.vectorWeight / profileSum : 0.5;
  const normText = profileSum > 0 ? profile.textWeight / profileSum : 0.5;

  // Blend: lower confidence = more deference to user config
  const blendFactor = confidence * 0.4; // max 40% influence from intent
  const blendedVec = configVectorWeight * (1 - blendFactor) + normVec * blendFactor;
  const blendedText = configTextWeight * (1 - blendFactor) + normText * blendFactor;

  // Renormalize
  const sum = blendedVec + blendedText;
  if (sum <= 0) {
    return { vectorWeight: 0.5, textWeight: 0.5 };
  }
  return {
    vectorWeight: blendedVec / sum,
    textWeight: blendedText / sum,
  };
}

/**
 * Adjust a temporal decay half-life based on intent classification.
 *
 * Episodic queries get a shorter effective half-life (stronger recency bias).
 * Decision queries get a moderately shorter half-life.
 */
export function adjustTemporalDecayHalfLife(
  classified: ClassifiedQuery,
  configHalfLifeDays: number,
): number {
  const multiplier = classified.profile.temporalDecayMultiplier;
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    return configHalfLifeDays;
  }
  return Math.max(1, Math.round(configHalfLifeDays * multiplier));
}
