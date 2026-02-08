/**
 * Context Management Module
 *
 * Provides tiered message storage and context management for AI conversations.
 * Exports rotation service for maintaining active/history/archive layers.
 */

export {
  initContextRotation,
  getRotationConfig,
  updateRotationConfig,
  resolveRotationPaths,
  forceRotation,
  getRotationState,
  clearRotationState,
} from "./rotation-service.js";

export {
  type ContextRotationConfig,
  type ContextRotationPaths,
  type RotatableMessage,
  type RotationResult,
  type RotationState,
  DEFAULT_CONTEXT_ROTATION_CONFIG,
} from "./rotation-types.js";

// Context Assembler (Phase 1)
export {
  assembleContext,
  getAssembledContextString,
  mergeAssemblerConfig,
  formatAssembledContext,
  type AssembledContext,
  type ContextAssemblerConfig,
} from "./assembler.js";

export {
  runMemoryManager,
  createMemoryManager,
  type QmdSearchFunction,
} from "./memory-manager-agent.js";

export {
  runHistoryManager,
  createHistoryManager,
} from "./history-manager-agent.js";

export {
  type ContextMessage,
  type MemoryManagerInput,
  type MemoryManagerOutput,
  type HistoryManagerInput,
  type HistoryManagerOutput,
  type SpecificMessage,
  type AssembleContextParams,
  DEFAULT_ASSEMBLER_CONFIG,
  estimateTokenCount,
} from "./assembler-types.js";

// Memory Maker (Phase 2)
export {
  initMemoryMaker,
  setMemoryMakerLLMCall,
  forceMemoryMaker,
  updateMemoryMakerConfig,
  getMemoryMakerConfig,
  getMemoryMakerState,
  clearMemoryMakerState,
} from "./memory-maker-service.js";

export {
  runMemoryMaker,
  parseMemoryOutput,
  deduplicateMemories,
  type LLMCallFn,
} from "./memory-maker-agent.js";

export {
  type MemoryMakerConfig,
  type MemoryMakerState,
  type MemoryMakerInput,
  type MemoryMakerOutput,
  type MemoryBatchMessage,
  type ExtractedMemory,
  DEFAULT_MEMORY_MAKER_CONFIG,
  formatMemoriesForFile,
  getMemoryFilePath,
  createMemoryFileHeader,
} from "./memory-maker-types.js";
