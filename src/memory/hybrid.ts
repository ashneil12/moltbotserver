import {
  applyGravityDampening,
  type GravityDampeningConfig,
  DEFAULT_GRAVITY_DAMPENING_CONFIG,
} from "./gravity-dampening.js";
import {
  applyHubDampening,
  type HubDampeningConfig,
  DEFAULT_HUB_DAMPENING_CONFIG,
} from "./hub-dampening.js";
import { applyMMRToHybridResults, type MMRConfig, DEFAULT_MMR_CONFIG } from "./mmr.js";
import {
  applyQValueBoost,
  type QValueConfig,
  type QValueRecord,
  DEFAULT_QVALUE_CONFIG,
} from "./qvalue.js";
import { applySourceBoostToResults } from "./source-boost.js";
import {
  applyTemporalDecayToHybridResults,
  type TemporalDecayConfig,
  DEFAULT_TEMPORAL_DECAY_CONFIG,
} from "./temporal-decay.js";

export type HybridSource = string;

export { type GravityDampeningConfig, DEFAULT_GRAVITY_DAMPENING_CONFIG };
export { type HubDampeningConfig, DEFAULT_HUB_DAMPENING_CONFIG };
export { type MMRConfig, DEFAULT_MMR_CONFIG };
export { type TemporalDecayConfig, DEFAULT_TEMPORAL_DECAY_CONFIG };
export { type QValueConfig, type QValueRecord, DEFAULT_QVALUE_CONFIG };

export type HybridVectorResult = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  source: HybridSource;
  snippet: string;
  vectorScore: number;
};

export type HybridKeywordResult = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  source: HybridSource;
  snippet: string;
  textScore: number;
};

export function buildFtsQuery(raw: string): string | null {
  const tokens =
    raw
      .match(/[\p{L}\p{N}_]+/gu)
      ?.map((t) => t.trim())
      .filter(Boolean) ?? [];
  if (tokens.length === 0) {
    return null;
  }
  const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`);
  return quoted.join(" AND ");
}

export function bm25RankToScore(rank: number): number {
  if (!Number.isFinite(rank)) {
    return 1 / (1 + 999);
  }
  if (rank < 0) {
    const relevance = -rank;
    return relevance / (1 + relevance);
  }
  return 1 / (1 + rank);
}

export async function mergeHybridResults(params: {
  vector: HybridVectorResult[];
  keyword: HybridKeywordResult[];
  vectorWeight: number;
  textWeight: number;
  /** Original query text (used for gravity dampening term-overlap check) */
  query?: string;
  workspaceDir?: string;
  /** MMR configuration for diversity-aware re-ranking */
  mmr?: Partial<MMRConfig>;
  /** Temporal decay configuration for recency-aware scoring */
  temporalDecay?: Partial<TemporalDecayConfig>;
  /** Gravity dampening configuration */
  gravityDampening?: Partial<GravityDampeningConfig>;
  /** Hub dampening configuration */
  hubDampening?: Partial<HubDampeningConfig>;
  /** Q-value boosts keyed by chunk ID (from retrieval RL) */
  qValueBoosts?: Map<string, QValueRecord>;
  /** Q-value configuration */
  qValueConfig?: Partial<QValueConfig>;
  /** Test seam for deterministic time-dependent behavior */
  nowMs?: number;
}): Promise<
  Array<{
    path: string;
    startLine: number;
    endLine: number;
    score: number;
    snippet: string;
    source: HybridSource;
  }>
> {
  const byId = new Map<
    string,
    {
      id: string;
      path: string;
      startLine: number;
      endLine: number;
      source: HybridSource;
      snippet: string;
      vectorScore: number;
      textScore: number;
    }
  >();

  for (const r of params.vector) {
    byId.set(r.id, {
      id: r.id,
      path: r.path,
      startLine: r.startLine,
      endLine: r.endLine,
      source: r.source,
      snippet: r.snippet,
      vectorScore: r.vectorScore,
      textScore: 0,
    });
  }

  for (const r of params.keyword) {
    const existing = byId.get(r.id);
    if (existing) {
      existing.textScore = r.textScore;
      if (r.snippet && r.snippet.length > 0) {
        existing.snippet = r.snippet;
      }
    } else {
      byId.set(r.id, {
        id: r.id,
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        source: r.source,
        snippet: r.snippet,
        vectorScore: 0,
        textScore: r.textScore,
      });
    }
  }

  const merged = Array.from(byId.values()).map((entry) => {
    const score = params.vectorWeight * entry.vectorScore + params.textWeight * entry.textScore;
    return {
      id: entry.id,
      path: entry.path,
      startLine: entry.startLine,
      endLine: entry.endLine,
      score,
      snippet: entry.snippet,
      source: entry.source,
    };
  });

  // Apply source-aware ranking (boost agent knowledge files)
  const boosted = applySourceBoostToResults(merged);

  const temporalDecayConfig = { ...DEFAULT_TEMPORAL_DECAY_CONFIG, ...params.temporalDecay };
  const decayed = await applyTemporalDecayToHybridResults({
    results: boosted,
    temporalDecay: temporalDecayConfig,
    workspaceDir: params.workspaceDir,
    nowMs: params.nowMs,
  });
  // Apply gravity dampening: penalize high-similarity results with no query-term overlap
  const gravityConfig = { ...DEFAULT_GRAVITY_DAMPENING_CONFIG, ...params.gravityDampening };
  const gravityDampened =
    gravityConfig.enabled && params.query
      ? applyGravityDampening(decayed, params.query, gravityConfig)
      : decayed;

  // Apply hub dampening: penalize files that dominate the result set
  const hubConfig = { ...DEFAULT_HUB_DAMPENING_CONFIG, ...params.hubDampening };
  const hubDampened = hubConfig.enabled
    ? applyHubDampening(gravityDampened, hubConfig)
    : gravityDampened;

  // Apply Q-value reinforcement learning boost
  const qvConfig = { ...DEFAULT_QVALUE_CONFIG, ...params.qValueConfig };
  const qBoosted =
    qvConfig.enabled && params.qValueBoosts && params.qValueBoosts.size > 0
      ? applyQValueBoost(hubDampened, params.qValueBoosts, qvConfig)
      : hubDampened;

  const sorted = qBoosted.toSorted((a, b) => b.score - a.score);

  // Apply MMR re-ranking if enabled
  const mmrConfig = { ...DEFAULT_MMR_CONFIG, ...params.mmr };
  if (mmrConfig.enabled) {
    return applyMMRToHybridResults(sorted, mmrConfig);
  }

  return sorted;
}
