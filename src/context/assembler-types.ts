/**
 * Context Assembler Types
 *
 * Configuration and types for the context assembly layer that prepares
 * context before the orchestrator processes each message.
 */

/**
 * Message format for context assembly input.
 */
export interface ContextMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

/**
 * Configuration for the Memory Manager sub-agent.
 */
export interface MemoryManagerConfig {
  /** Enable memory manager (default: true) */
  enabled: boolean;

  /** Maximum tokens for memory injection (default: 1500) */
  maxTokens: number;

  /** Maximum number of memories to inject (default: 6) */
  maxResults: number;

  /** Minimum relevance score for memory inclusion (default: 0.3) */
  minScore: number;
}

/**
 * Configuration for the History Manager sub-agent.
 */
export interface HistoryManagerConfig {
  /** Enable history manager (default: true) */
  enabled: boolean;

  /** Maximum tokens for history summary (default: 500) */
  summaryMaxTokens: number;

  /** Maximum tokens for specific message injection (default: 1000) */
  specificMaxTokens: number;

  /** Maximum number of specific messages to inject (default: 5) */
  maxSpecificMessages: number;
}

/**
 * Configuration for the Context Assembler service.
 */
export interface ContextAssemblerConfig {
  /** Enable context assembly (default: true) */
  enabled: boolean;

  /** Model to use for sub-agents. If not specified, uses primary model. */
  model?: string;

  /** Provider for sub-agents. If not specified, uses primary provider. */
  provider?: string;

  /** Memory Manager configuration */
  memoryManager: MemoryManagerConfig;

  /** History Manager configuration */
  historyManager: HistoryManagerConfig;

  /** Total token budget for all injections (default: 4000) */
  totalBudget: number;

  /** Maximum time to wait for assembly in ms (default: 2000) */
  timeoutMs: number;
}

/**
 * Default configuration values.
 */
export const DEFAULT_ASSEMBLER_CONFIG: ContextAssemblerConfig = {
  enabled: true,
  memoryManager: {
    enabled: true,
    maxTokens: 1500,
    maxResults: 6,
    minScore: 0.3,
  },
  historyManager: {
    enabled: true,
    summaryMaxTokens: 500,
    specificMaxTokens: 1000,
    maxSpecificMessages: 5,
  },
  totalBudget: 4000,
  timeoutMs: 2000,
};

/**
 * Input for the Memory Manager agent.
 */
export interface MemoryManagerInput {
  /** The current user message */
  currentMessage: string;

  /** Last 3 messages for context */
  recentMessages: ContextMessage[];

  /** Path to workspace directory (for QMD search) */
  workspaceDir: string;
}

/**
 * Output from the Memory Manager agent.
 */
export interface MemoryManagerOutput {
  /** Relevant memories (null if N/A) */
  memories: string[] | null;

  /** Approximate token count of the output */
  tokenCount: number;

  /** Whether the agent decided injection was needed */
  injected: boolean;
}

/**
 * Input for the History Manager agent.
 */
export interface HistoryManagerInput {
  /** The current user message */
  currentMessage: string;

  /** Last 3 messages for context */
  recentMessages: ContextMessage[];

  /** Path to conversation_history.md */
  historyFilePath: string;

  /** Path to workspace directory */
  workspaceDir: string;
}

/**
 * A specific message selected for injection.
 */
export interface SpecificMessage {
  /** Timestamp or index reference */
  reference: string;

  /** Message content */
  content: string;

  /** Role of the message sender */
  role: "user" | "assistant";
}

/**
 * Output from the History Manager agent.
 */
export interface HistoryManagerOutput {
  /** Summary of recent conversation (null if N/A) */
  summary: string | null;

  /** Specific messages to inject (null if none) */
  specificMessages: SpecificMessage[] | null;

  /** Approximate token count of the output */
  tokenCount: number;

  /** Whether the agent decided injection was needed */
  injected: boolean;
}

/**
 * Result of context assembly.
 */
export interface AssembledContext {
  /** Memories from Memory Manager */
  memories: string[] | null;

  /** History summary from History Manager */
  historySummary: string | null;

  /** Specific messages from History Manager */
  specificMessages: SpecificMessage[] | null;

  /** Total token count of assembled context */
  totalTokens: number;

  /** Whether any context was injected */
  hasContent: boolean;

  /** Time taken for assembly in ms */
  assemblyTimeMs: number;

  /** Any errors that occurred during assembly */
  errors: string[];
}

/**
 * Parameters for the assembleContext function.
 */
export interface AssembleContextParams {
  /** Current user message */
  currentMessage: string;

  /** Recent messages from session (will take last 3) */
  recentMessages: ContextMessage[];

  /** Path to workspace directory */
  workspaceDir: string;

  /** Path to conversation_history.md */
  historyFilePath: string;

  /** Configuration for the assembler */
  config: ContextAssemblerConfig;

  /** Optional abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Estimate token count for a string (rough approximation: ~4 chars per token).
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Format assembled context for injection into system prompt.
 */
export function formatAssembledContext(ctx: AssembledContext): string {
  if (!ctx.hasContent) {
    return "";
  }

  const sections: string[] = [];

  if (ctx.historySummary) {
    sections.push(`## Recent Conversation Context\n${ctx.historySummary}`);
  }

  if (ctx.memories && ctx.memories.length > 0) {
    const memoryList = ctx.memories.map((m) => `- ${m}`).join("\n");
    sections.push(`## Relevant Memories\n${memoryList}`);
  }

  if (ctx.specificMessages && ctx.specificMessages.length > 0) {
    const msgList = ctx.specificMessages
      .map((m) => `- [${m.reference}] ${m.role}: ${m.content}`)
      .join("\n");
    sections.push(`## Specific Past Messages\n${msgList}`);
  }

  if (sections.length === 0) {
    return "";
  }

  return `---\n# Injected Context\n${sections.join("\n\n")}\n---`;
}
