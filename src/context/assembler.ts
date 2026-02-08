/**
 * Context Assembler Service
 *
 * Coordinates Memory Manager and History Manager to assemble context
 * before the orchestrator processes each message. Runs both managers
 * in parallel and enforces token budgets.
 */

import path from "node:path";
import type {
  AssembleContextParams,
  AssembledContext,
  ContextAssemblerConfig,
  MemoryManagerInput,
  HistoryManagerInput,
} from "./assembler-types.js";
import {
  DEFAULT_ASSEMBLER_CONFIG,
  estimateTokenCount,
  formatAssembledContext,
} from "./assembler-types.js";
import { runMemoryManager, type QmdSearchFunction } from "./memory-manager-agent.js";
import { runHistoryManager } from "./history-manager-agent.js";
import { resolveRotationPaths } from "./rotation-service.js";

/**
 * Empty context result for when assembly is disabled or fails.
 */
const EMPTY_CONTEXT: AssembledContext = {
  memories: null,
  historySummary: null,
  specificMessages: null,
  totalTokens: 0,
  hasContent: false,
  assemblyTimeMs: 0,
  errors: [],
};

/**
 * Create a promise that rejects after a timeout.
 */
function timeoutPromise<T>(ms: number, label: string): Promise<T> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
  );
}

/**
 * Merge partial config with defaults.
 */
export function mergeAssemblerConfig(
  partial?: Partial<ContextAssemblerConfig>,
): ContextAssemblerConfig {
  if (!partial) return { ...DEFAULT_ASSEMBLER_CONFIG };

  return {
    enabled: partial.enabled ?? DEFAULT_ASSEMBLER_CONFIG.enabled,
    model: partial.model,
    provider: partial.provider,
    memoryManager: {
      ...DEFAULT_ASSEMBLER_CONFIG.memoryManager,
      ...partial.memoryManager,
    },
    historyManager: {
      ...DEFAULT_ASSEMBLER_CONFIG.historyManager,
      ...partial.historyManager,
    },
    totalBudget: partial.totalBudget ?? DEFAULT_ASSEMBLER_CONFIG.totalBudget,
    timeoutMs: partial.timeoutMs ?? DEFAULT_ASSEMBLER_CONFIG.timeoutMs,
  };
}

/**
 * Assemble context for the orchestrator.
 *
 * Runs Memory Manager and History Manager in parallel, merges their results,
 * and enforces token budgets.
 *
 * @param params - Assembly parameters
 * @param searchFn - QMD search function for memory lookup
 * @returns AssembledContext to inject into the system prompt
 */
export async function assembleContext(
  params: AssembleContextParams,
  searchFn?: QmdSearchFunction,
): Promise<AssembledContext> {
  const started = Date.now();
  const config = params.config;
  const errors: string[] = [];

  // Fast path: disabled
  if (!config.enabled) {
    return EMPTY_CONTEXT;
  }

  // Prepare inputs for both managers
  const recentMessages = params.recentMessages.slice(-3);

  const memoryInput: MemoryManagerInput = {
    currentMessage: params.currentMessage,
    recentMessages,
    workspaceDir: params.workspaceDir,
  };

  const historyInput: HistoryManagerInput = {
    currentMessage: params.currentMessage,
    recentMessages,
    historyFilePath: params.historyFilePath,
    workspaceDir: params.workspaceDir,
  };

  // Run both managers in parallel with timeout
  const timeoutMs = config.timeoutMs;

  // Build promises for each enabled manager
  const promises: Promise<unknown>[] = [];
  let memoryPromiseIdx = -1;
  let historyPromiseIdx = -1;

  if (config.memoryManager.enabled && searchFn) {
    memoryPromiseIdx = promises.length;
    promises.push(
      Promise.race([
        runMemoryManager(memoryInput, searchFn, config.memoryManager.maxTokens),
        timeoutPromise(timeoutMs, "Memory Manager"),
      ]).catch((err) => {
        errors.push(`Memory Manager: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }),
    );
  }

  if (config.historyManager.enabled) {
    historyPromiseIdx = promises.length;
    promises.push(
      Promise.race([
        runHistoryManager(
          historyInput,
          config.historyManager.summaryMaxTokens,
          config.historyManager.specificMaxTokens,
          config.historyManager.maxSpecificMessages,
        ),
        timeoutPromise(timeoutMs, "History Manager"),
      ]).catch((err) => {
        errors.push(`History Manager: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }),
    );
  }

  // If nothing to run, return empty
  if (promises.length === 0) {
    return {
      ...EMPTY_CONTEXT,
      assemblyTimeMs: Date.now() - started,
    };
  }

  // Wait for all managers
  const results = await Promise.all(promises);

  // Extract results
  const memoryResult =
    memoryPromiseIdx >= 0 ? (results[memoryPromiseIdx] as Awaited<ReturnType<typeof runMemoryManager>> | null) : null;
  const historyResult =
    historyPromiseIdx >= 0 ? (results[historyPromiseIdx] as Awaited<ReturnType<typeof runHistoryManager>> | null) : null;

  // Merge and enforce budget
  let memories = memoryResult?.memories ?? null;
  let historySummary = historyResult?.summary ?? null;
  let specificMessages = historyResult?.specificMessages ?? null;

  let totalTokens =
    (memoryResult?.tokenCount ?? 0) + (historyResult?.tokenCount ?? 0);

  // Enforce budget by trimming (priority: summary > memories > specific)
  if (totalTokens > config.totalBudget) {
    // First, trim specific messages
    if (specificMessages && specificMessages.length > 0) {
      const specificTokens = specificMessages.reduce(
        (acc, m) => acc + estimateTokenCount(m.content),
        0,
      );
      const summaryTokens = historySummary ? estimateTokenCount(historySummary) : 0;
      const memoryTokens = memories
        ? memories.reduce((acc, m) => acc + estimateTokenCount(m), 0)
        : 0;

      const available = config.totalBudget - summaryTokens - memoryTokens;
      if (available <= 0) {
        specificMessages = null;
        totalTokens = summaryTokens + memoryTokens;
      } else if (specificTokens > available) {
        // Trim specific messages to fit
        let kept = 0;
        let keptTokens = 0;
        for (const msg of specificMessages) {
          const msgTokens = estimateTokenCount(msg.content);
          if (keptTokens + msgTokens <= available) {
            kept++;
            keptTokens += msgTokens;
          } else {
            break;
          }
        }
        specificMessages = specificMessages.slice(0, kept) || null;
        totalTokens = summaryTokens + memoryTokens + keptTokens;
      }
    }

    // If still over, trim memories
    if (totalTokens > config.totalBudget && memories && memories.length > 0) {
      const summaryTokens = historySummary ? estimateTokenCount(historySummary) : 0;
      const available = config.totalBudget - summaryTokens;
      if (available <= 0) {
        memories = null;
        totalTokens = summaryTokens;
      } else {
        let kept = 0;
        let keptTokens = 0;
        for (const mem of memories) {
          const memTokens = estimateTokenCount(mem);
          if (keptTokens + memTokens <= available) {
            kept++;
            keptTokens += memTokens;
          } else {
            break;
          }
        }
        memories = memories.slice(0, kept) || null;
        totalTokens = summaryTokens + keptTokens;
      }
    }
  }

  const hasContent = !!(memories?.length || historySummary || specificMessages?.length);

  return {
    memories,
    historySummary,
    specificMessages,
    totalTokens,
    hasContent,
    assemblyTimeMs: Date.now() - started,
    errors,
  };
}

/**
 * High-level function for integrating with the orchestrator.
 *
 * @param params - Core parameters needed for assembly
 * @returns Formatted context string for injection, or empty string
 */
export async function getAssembledContextString(params: {
  currentMessage: string;
  recentMessages: { role: "user" | "assistant"; content: string }[];
  workspaceDir: string;
  config?: Partial<ContextAssemblerConfig>;
  searchFn?: QmdSearchFunction;
}): Promise<string> {
  const config = mergeAssemblerConfig(params.config);

  if (!config.enabled) {
    return "";
  }

  // Resolve history file path
  const rotationPaths = resolveRotationPaths(params.workspaceDir);
  const historyFilePath = rotationPaths.historyFile;

  const assembled = await assembleContext(
    {
      currentMessage: params.currentMessage,
      recentMessages: params.recentMessages,
      workspaceDir: params.workspaceDir,
      historyFilePath,
      config,
    },
    params.searchFn,
  );

  if (assembled.errors.length > 0) {
    console.warn("[context-assembler] Errors during assembly:", assembled.errors);
  }

  return formatAssembledContext(assembled);
}

// Re-export types and utilities
export { formatAssembledContext } from "./assembler-types.js";
export type { AssembledContext, ContextAssemblerConfig } from "./assembler-types.js";
