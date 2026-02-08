/**
 * Memory Maker Service
 *
 * Manages the async memory creation process. Triggers memory extraction
 * based on message count and time thresholds. Writes extracted memories
 * to daily files.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { onSessionTranscriptUpdate } from "../sessions/transcript-events.js";
import type {
  MemoryMakerConfig,
  MemoryMakerState,
  MemoryBatchMessage,
  ExtractedMemory,
} from "./memory-maker-types.js";
import {
  DEFAULT_MEMORY_MAKER_CONFIG,
  formatMemoriesForFile,
  getMemoryFilePath,
  createMemoryFileHeader,
} from "./memory-maker-types.js";
import { runMemoryMaker, type LLMCallFn } from "./memory-maker-agent.js";

const log = {
  info: (msg: string) => console.log(`[memory-maker] ${msg}`),
  warn: (msg: string) => console.warn(`[memory-maker] ${msg}`),
  error: (msg: string, ...args: unknown[]) => console.error(`[memory-maker] ${msg}`, ...args),
};

/**
 * Per-session state tracking.
 */
const sessionStates = new Map<string, MemoryMakerState>();

/**
 * Get or create state for a session.
 */
function getState(sessionId: string): MemoryMakerState {
  let state = sessionStates.get(sessionId);
  if (!state) {
    state = {
      messageCount: 0,
      lastTriggerTime: Date.now(),
      isRunning: false,
    };
    sessionStates.set(sessionId, state);
  }
  return state;
}

/**
 * Clear state for a session.
 */
export function clearMemoryMakerState(sessionId?: string): void {
  if (sessionId) {
    sessionStates.delete(sessionId);
  } else {
    sessionStates.clear();
  }
}

/**
 * Global config storage.
 */
let globalConfig: MemoryMakerConfig = { ...DEFAULT_MEMORY_MAKER_CONFIG };
let llmCallFn: LLMCallFn | null = null;
let unsubscribe: (() => void) | null = null;

/**
 * Update the Memory Maker configuration.
 */
export function updateMemoryMakerConfig(config: Partial<MemoryMakerConfig>): void {
  globalConfig = { ...globalConfig, ...config };
}

/**
 * Get the current configuration.
 */
export function getMemoryMakerConfig(): MemoryMakerConfig {
  return { ...globalConfig };
}

/**
 * Check if the trigger conditions are met.
 */
function shouldTrigger(state: MemoryMakerState, config: MemoryMakerConfig): boolean {
  if (state.isRunning) return false;

  // Message count trigger
  const countTrigger = state.messageCount >= config.triggerEveryNMessages;

  // Time-based trigger (activity-based hours)
  const hourMs = config.triggerEveryNHours * 60 * 60 * 1000;
  const timeTrigger = Date.now() - state.lastTriggerTime > hourMs;

  return countTrigger || timeTrigger;
}

/**
 * Load existing memories for deduplication.
 */
async function loadExistingMemories(workspaceDir: string): Promise<string[]> {
  const memoryDir = path.join(workspaceDir, "memory");
  const memories: string[] = [];

  try {
    const files = await fs.readdir(memoryDir);
    const mdFiles = files.filter((f) => f.endsWith(".md")).sort().slice(-7); // Last 7 days

    for (const file of mdFiles) {
      const content = await fs.readFile(path.join(memoryDir, file), "utf-8");
      // Extract memory lines (lines starting with -)
      const lines = content.split("\n").filter((l) => l.trim().startsWith("-"));
      memories.push(...lines.map((l) => l.slice(1).trim()));
    }
  } catch {
    // Directory doesn't exist yet - that's fine
  }

  return memories;
}

/**
 * Get message batch from session transcript.
 */
async function getMessageBatch(
  sessionFile: string,
  startOffset: number,
  batchSize: number,
): Promise<MemoryBatchMessage[]> {
  try {
    const content = await fs.readFile(sessionFile, "utf-8");
    const data = JSON.parse(content);

    if (!data.messages || !Array.isArray(data.messages)) {
      return [];
    }

    // Get messages in range
    const messages = data.messages
      .slice(startOffset, startOffset + batchSize)
      .filter((m: unknown): m is { role: string; content: unknown } => {
        if (!m || typeof m !== "object") return false;
        const msg = m as Record<string, unknown>;
        return typeof msg.role === "string" && msg.content != null;
      })
      .map((m: { role: string; content: unknown; timestamp?: number }) => ({
        role: (m.role === "user" || m.role === "assistant" ? m.role : "user") as "user" | "assistant",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        timestamp: m.timestamp,
      }));

    return messages;
  } catch (err) {
    log.warn(`Failed to read session file: ${err}`);
    return [];
  }
}

/**
 * Write memories to the daily file.
 */
async function writeMemories(
  workspaceDir: string,
  memories: ExtractedMemory[],
): Promise<void> {
  const memoryDir = path.join(workspaceDir, "memory");
  const filePath = getMemoryFilePath(workspaceDir);

  try {
    // Ensure directory exists
    await fs.mkdir(memoryDir, { recursive: true });

    // Check if file exists
    let exists = false;
    try {
      await fs.access(filePath);
      exists = true;
    } catch {
      exists = false;
    }

    // Create or append
    const entry = formatMemoriesForFile(memories);
    if (exists) {
      await fs.appendFile(filePath, entry);
    } else {
      const header = createMemoryFileHeader();
      await fs.writeFile(filePath, header + entry);
    }

    log.info(`Wrote ${memories.length} memories to ${filePath}`);
  } catch (err) {
    log.error("Failed to write memories:", err);
  }
}

/**
 * Run the memory maker for a session.
 */
async function runMemoryMakerForSession(
  sessionId: string,
  sessionFile: string,
  workspaceDir: string,
): Promise<void> {
  const state = getState(sessionId);

  if (state.isRunning) {
    log.warn(`Already running for session ${sessionId}`);
    return;
  }

  if (!llmCallFn) {
    log.warn("No LLM call function configured");
    return;
  }

  state.isRunning = true;

  try {
    // Get message batch
    const batch = await getMessageBatch(
      sessionFile,
      globalConfig.batchStartOffset,
      globalConfig.batchSize,
    );

    if (batch.length < 3) {
      log.info("Not enough messages in batch, skipping");
      return;
    }

    // Load existing memories
    const existingMemories = await loadExistingMemories(workspaceDir);

    // Run the memory maker agent
    const result = await runMemoryMaker(
      {
        messageBatch: batch,
        existingMemories,
      },
      llmCallFn,
    );

    if (result.hasMemories && result.memories) {
      await writeMemories(workspaceDir, result.memories);
      log.info(`Extracted ${result.memories.length} new memories`);
    } else {
      log.info("No new memories to save");
    }

    // Reset counters
    state.messageCount = 0;
    state.lastTriggerTime = Date.now();
  } catch (err) {
    log.error("Memory maker failed:", err);
  } finally {
    state.isRunning = false;
  }
}

/**
 * Extract workspace dir from session file path.
 */
function getWorkspaceDirFromSessionFile(sessionFile: string): string {
  // Session files are typically in workspace/.session/file.json
  // Go up two levels to get workspace
  return path.dirname(path.dirname(sessionFile));
}

/**
 * Initialize the Memory Maker service.
 *
 * @param config - Configuration options
 * @param callFn - Function to call the LLM
 * @returns Cleanup function
 */
export function initMemoryMaker(
  config: Partial<MemoryMakerConfig> = {},
  callFn?: LLMCallFn,
): () => void {
  globalConfig = { ...DEFAULT_MEMORY_MAKER_CONFIG, ...config };

  if (callFn) {
    llmCallFn = callFn;
  }

  if (!globalConfig.enabled) {
    log.info("Memory Maker disabled");
    return () => {};
  }

  log.info(
    `Memory Maker enabled: trigger every ${globalConfig.triggerEveryNMessages} msgs or ${globalConfig.triggerEveryNHours}h`,
  );

  // Subscribe to transcript updates
  unsubscribe = onSessionTranscriptUpdate(({ sessionFile, sessionKey }) => {
    const sessionId = sessionKey || sessionFile;
    const state = getState(sessionId);

    // Increment message count
    state.messageCount++;

    // Check trigger
    if (shouldTrigger(state, globalConfig)) {
      const workspaceDir = getWorkspaceDirFromSessionFile(sessionFile);

      // Fire and forget - don't block the response
      runMemoryMakerForSession(sessionId, sessionFile, workspaceDir).catch((err) => {
        log.error("Memory maker async run failed:", err);
      });
    }
  });

  return () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    sessionStates.clear();
    log.info("Memory Maker stopped");
  };
}

/**
 * Set the LLM call function for memory extraction.
 */
export function setMemoryMakerLLMCall(callFn: LLMCallFn): void {
  llmCallFn = callFn;
}

/**
 * Force trigger memory maker for a session.
 * Useful for testing or manual triggers.
 */
export async function forceMemoryMaker(
  sessionId: string,
  sessionFile: string,
  workspaceDir: string,
): Promise<void> {
  await runMemoryMakerForSession(sessionId, sessionFile, workspaceDir);
}

/**
 * Get the state for a session (for testing/debugging).
 */
export function getMemoryMakerState(sessionId: string): MemoryMakerState | undefined {
  return sessionStates.get(sessionId);
}
