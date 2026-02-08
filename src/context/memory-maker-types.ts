/**
 * Memory Maker Types
 *
 * Configuration and types for the Memory Maker agent that extracts
 * durable facts from conversations asynchronously.
 */

/**
 * Configuration for the Memory Maker service.
 */
export interface MemoryMakerConfig {
  /** Enable memory maker (default: true) */
  enabled: boolean;

  /** Number of messages between triggers (default: 10) */
  triggerEveryNMessages: number;

  /** Hours of activity between triggers (default: 6) */
  triggerEveryNHours: number;

  /** Model to use for extraction (default: configured cheap model) */
  model?: string;

  /** Provider for extraction */
  provider?: string;

  /** Number of messages to process per batch (default: 30) */
  batchSize: number;

  /** Start offset for batch (grab messages N through N+batchSize) */
  batchStartOffset: number;
}

/**
 * Default configuration values.
 */
export const DEFAULT_MEMORY_MAKER_CONFIG: MemoryMakerConfig = {
  enabled: true,
  triggerEveryNMessages: 10,
  triggerEveryNHours: 6,
  batchSize: 30,
  batchStartOffset: 20, // Messages 20-50 by default
  model: process.env.OPENCLAW_MEMORY_MODEL || 'deepseek/deepseek-v3.2',
};

/**
 * A message in the batch to process.
 */
export interface MemoryBatchMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

/**
 * Input for the Memory Maker agent.
 */
export interface MemoryMakerInput {
  /** Batch of messages to analyze */
  messageBatch: MemoryBatchMessage[];

  /** Existing memories for deduplication */
  existingMemories: string[];

  /** Context from the assembler (for understanding) */
  assemblerContext?: string;
}

/**
 * A single extracted memory.
 */
export interface ExtractedMemory {
  /** The memory content */
  content: string;

  /** Tags for categorization */
  tags: string[];
}

/**
 * Output from the Memory Maker agent.
 */
export interface MemoryMakerOutput {
  /** Extracted memories (null if N/A) */
  memories: ExtractedMemory[] | null;

  /** Whether memories were extracted */
  hasMemories: boolean;

  /** Error if extraction failed */
  error?: string;
}

/**
 * State for the Memory Maker service (per session).
 */
export interface MemoryMakerState {
  /** Message count since last trigger */
  messageCount: number;

  /** Timestamp of last trigger */
  lastTriggerTime: number;

  /** Whether a run is currently in progress */
  isRunning: boolean;
}

/**
 * Estimate token count (rough: ~4 chars per token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Format extracted memories for writing to file.
 */
export function formatMemoriesForFile(
  memories: ExtractedMemory[],
  timestamp: Date = new Date(),
): string {
  const time = timestamp.toISOString().split("T")[1].split(".")[0];
  const lines = memories.map(
    (m) => `- ${m.content} ${m.tags.map((t) => `#${t}`).join(" ")}`.trim(),
  );

  return `\n## ${time}\n${lines.join("\n")}\n`;
}

/**
 * Get the memory file path for a given date.
 */
export function getMemoryFilePath(workspaceDir: string, date: Date = new Date()): string {
  const dateStr = date.toISOString().split("T")[0];
  return `${workspaceDir}/memory/${dateStr}.md`;
}

/**
 * Create the header for a new memory file.
 */
export function createMemoryFileHeader(date: Date = new Date()): string {
  const dateStr = date.toISOString().split("T")[0];
  return `# Memories - ${dateStr}\n`;
}
