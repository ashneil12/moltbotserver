// =============================================================================
// enforce-config-models.mjs — Model ID normalization for enforce-config
//
// Extracted from enforce-config.mjs. Handles case-sensitivity correction for
// model IDs that arrive via env vars with incorrect casing (e.g. "minimax-m2.5"
// instead of "MiniMax-M2.5").
// =============================================================================

/**
 * Canonical model IDs keyed by their lowercase equivalents.
 * When an env var provides a model ID with wrong casing (e.g. "minimax-m2.5"
 * instead of "MiniMax-M2.5"), this map corrects it before it reaches the
 * config file and the model registry (which does case-sensitive matching).
 *
 * Format: { "lowercased-model-id": "Canonical-Model-ID" }
 * Only the model portion (after the provider/ prefix) is matched.
 */
export const CANONICAL_MODEL_IDS = {
  // MiniMax (only entries where casing actually differs)
  "minimax-m2.5": "MiniMax-M2.5",
  "minimax-m2.5-lightning": "MiniMax-M2.5-Lightning",
  "minimax-m1": "MiniMax-M1",
};

/**
 * Normalize a full model reference (e.g. "minimax/minimax-m2.5") to use
 * canonical casing. If the model ID isn't in the known map, returns as-is.
 */
export function normalizeModelId(modelRef) {
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
