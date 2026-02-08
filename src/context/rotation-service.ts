/**
 * Context Rotation Service
 *
 * Maintains tiered message storage:
 * - Active context: Last N messages (default 20) stay in session
 * - History: Messages 21-100 stored in conversation_history.md
 * - Archive: Messages 101+ stored in conversation_archive.md
 *
 * Rotation is triggered by session transcript updates and runs asynchronously
 * to avoid blocking response delivery.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { onSessionTranscriptUpdate } from "../sessions/transcript-events.js";
import { readSessionMessages } from "../gateway/session-utils.fs.js";
import type {
  ContextRotationConfig,
  ContextRotationPaths,
  RotatableMessage,
  RotationResult,
  RotationState,
} from "./rotation-types.js";
import { DEFAULT_CONTEXT_ROTATION_CONFIG } from "./rotation-types.js";

// Track rotation state per session
const rotationStates = new Map<string, RotationState>();

// Debounce timers per session file
const debounceTimers = new Map<string, NodeJS.Timeout>();

// Global config (can be overridden)
let globalConfig: ContextRotationConfig = { ...DEFAULT_CONTEXT_ROTATION_CONFIG };

/**
 * Initialize the context rotation service.
 * Call this at startup to begin listening for transcript updates.
 */
export function initContextRotation(config?: Partial<ContextRotationConfig>): () => void {
  if (config) {
    globalConfig = { ...DEFAULT_CONTEXT_ROTATION_CONFIG, ...config };
  }

  if (!globalConfig.enabled) {
    return () => undefined;
  }

  const unsubscribe = onSessionTranscriptUpdate(({ sessionFile }) => {
    // Debounce rotation to avoid running on every single message append
    const existing = debounceTimers.get(sessionFile);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      debounceTimers.delete(sessionFile);
      void runRotation(sessionFile).catch((err) => {
        console.error(`[context-rotation] Error rotating ${sessionFile}:`, err);
      });
    }, globalConfig.debounceMs);

    debounceTimers.set(sessionFile, timer);
  });

  return () => {
    unsubscribe();
    for (const timer of debounceTimers.values()) {
      clearTimeout(timer);
    }
    debounceTimers.clear();
  };
}

/**
 * Get rotation config.
 */
export function getRotationConfig(): ContextRotationConfig {
  return { ...globalConfig };
}

/**
 * Update rotation config at runtime.
 */
export function updateRotationConfig(config: Partial<ContextRotationConfig>): void {
  globalConfig = { ...globalConfig, ...config };
}

/**
 * Resolve paths for context rotation files relative to a workspace.
 */
export function resolveRotationPaths(workspaceDir: string): ContextRotationPaths {
  return {
    historyFile: path.join(workspaceDir, "conversation_history.md"),
    archiveFile: path.join(workspaceDir, "conversation_archive.md"),
    workspaceDir,
  };
}

/**
 * Extract workspace directory from session file path.
 * Session files are typically at: <workspace>/state/agents/<agent>/sessions/<session>.jsonl
 * We need to navigate up to the workspace root.
 */
function resolveWorkspaceFromSessionFile(sessionFile: string): string {
  // Look for /state/agents/ pattern and extract workspace from there
  const stateIndex = sessionFile.indexOf("/state/agents/");
  if (stateIndex !== -1) {
    return sessionFile.slice(0, stateIndex);
  }

  // Fallback: go up 4 directories from session file
  // <file> -> sessions -> <agent> -> agents -> state -> <workspace>
  return path.resolve(path.dirname(sessionFile), "..", "..", "..", "..");
}

/**
 * Extract session ID from session file path.
 */
function extractSessionId(sessionFile: string): string {
  const base = path.basename(sessionFile, ".jsonl");
  return base;
}

/**
 * Run rotation for a specific session file.
 */
async function runRotation(sessionFile: string): Promise<RotationResult> {
  const config = globalConfig;
  const result: RotationResult = {
    rotated: false,
    movedToHistory: 0,
    movedToArchive: 0,
    activeCount: 0,
    historyCount: 0,
    archiveCount: 0,
  };

  if (!config.enabled) {
    return result;
  }

  try {
    const sessionId = extractSessionId(sessionFile);
    const workspaceDir = resolveWorkspaceFromSessionFile(sessionFile);
    const paths = resolveRotationPaths(workspaceDir);

    // Read current messages from session
    const messages = readSessionMessages(sessionId, path.dirname(sessionFile));
    if (!Array.isArray(messages) || messages.length === 0) {
      return result;
    }

    // Convert to rotatable format
    const rotatableMessages = extractRotatableMessages(messages);
    result.activeCount = rotatableMessages.length;

    // Check if rotation is needed
    if (rotatableMessages.length <= config.windowSize) {
      return result;
    }

    // Calculate how many to rotate
    const toRotate = rotatableMessages.slice(0, rotatableMessages.length - config.windowSize);
    if (toRotate.length === 0) {
      return result;
    }

    // Read existing history to check if we need to archive
    const existingHistory = await readHistoryFile(paths.historyFile);
    const totalHistoryAfterRotation = existingHistory.length + toRotate.length;

    // Determine what goes to archive vs history
    let toArchive: RotatableMessage[] = [];
    let toHistory = toRotate;

    if (totalHistoryAfterRotation > config.historySize && config.archiveEnabled) {
      // Need to move oldest from history to archive
      const overflow = totalHistoryAfterRotation - config.historySize;
      toArchive = existingHistory.slice(0, overflow);
      // Update existing history to remove archived items
      const remainingHistory = existingHistory.slice(overflow);
      toHistory = [...remainingHistory, ...toRotate].slice(-config.historySize);
    }

    // Perform the rotation
    if (toArchive.length > 0) {
      await appendToArchive(paths.archiveFile, toArchive);
      result.movedToArchive = toArchive.length;
    }

    if (toRotate.length > 0) {
      await writeHistoryFile(
        paths.historyFile,
        config.archiveEnabled ? toHistory : [...existingHistory, ...toRotate],
      );
      result.movedToHistory = toRotate.length;
    }

    result.rotated = true;

    // Update state tracking
    const state: RotationState = rotationStates.get(sessionFile) ?? {
      sessionId,
      sessionFile,
      lastMessageCount: 0,
      lastRotationAt: 0,
      totalRotatedToHistory: 0,
      totalRotatedToArchive: 0,
    };
    state.lastMessageCount = rotatableMessages.length;
    state.lastRotationAt = Date.now();
    state.totalRotatedToHistory += result.movedToHistory;
    state.totalRotatedToArchive += result.movedToArchive;
    rotationStates.set(sessionFile, state);

    // Count final state
    const finalHistory = await readHistoryFile(paths.historyFile);
    result.historyCount = finalHistory.length;
    if (config.archiveEnabled) {
      const archiveContent = await readArchiveFile(paths.archiveFile);
      result.archiveCount = archiveContent.length;
    }

    return result;
  } catch (err) {
    console.error(`[context-rotation] Rotation failed for ${sessionFile}:`, err);
    return result;
  }
}

/**
 * Extract user/assistant messages from raw session messages.
 */
function extractRotatableMessages(messages: unknown[]): RotatableMessage[] {
  const result: RotatableMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as Record<string, unknown>;
    if (!msg || typeof msg !== "object") continue;

    const role = String(msg.role ?? "");
    if (role !== "user" && role !== "assistant") continue;

    const content = extractTextContent(msg.content);
    const timestamp = typeof msg.timestamp === "number" ? msg.timestamp : Date.now();

    result.push({
      role,
      content,
      timestamp,
      index: i,
    });
  }

  return result;
}

/**
 * Extract text from various content formats.
 */
function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          return String((item as { text: unknown }).text ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/**
 * Format a message for markdown storage.
 */
function formatMessageForMarkdown(msg: RotatableMessage): string {
  const date = new Date(msg.timestamp);
  const dateStr = date.toISOString().replace("T", " ").slice(0, 19);
  const roleLabel = msg.role === "user" ? "**User**" : "**Assistant**";
  return `---\n## [${dateStr}]\n${roleLabel}: ${msg.content}\n`;
}

/**
 * Read and parse the history file.
 */
async function readHistoryFile(filePath: string): Promise<RotatableMessage[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return parseMarkdownMessages(content);
  } catch {
    return [];
  }
}

/**
 * Read and parse the archive file.
 */
async function readArchiveFile(filePath: string): Promise<RotatableMessage[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return parseMarkdownMessages(content);
  } catch {
    return [];
  }
}

/**
 * Parse markdown format back to messages.
 */
function parseMarkdownMessages(content: string): RotatableMessage[] {
  const messages: RotatableMessage[] = [];
  const sections = content.split(/^---$/m).filter((s) => s.trim());

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i].trim();
    if (!section) continue;

    // Extract timestamp from ## [YYYY-MM-DD HH:MM:SS]
    const timestampMatch = section.match(/## \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
    const timestamp = timestampMatch ? new Date(timestampMatch[1]).getTime() : Date.now();

    // Extract role and content
    const userMatch = section.match(/\*\*User\*\*:\s*([\s\S]*)/);
    const assistantMatch = section.match(/\*\*Assistant\*\*:\s*([\s\S]*)/);

    if (userMatch) {
      messages.push({
        role: "user",
        content: userMatch[1].trim(),
        timestamp,
        index: i,
      });
    } else if (assistantMatch) {
      messages.push({
        role: "assistant",
        content: assistantMatch[1].trim(),
        timestamp,
        index: i,
      });
    }
  }

  return messages;
}

/**
 * Write the history file (overwrites existing).
 */
async function writeHistoryFile(filePath: string, messages: RotatableMessage[]): Promise<void> {
  const header = `# Conversation History\n> Messages from recent conversation (rotated from active context)\n\n`;
  const content =
    header + messages.map((msg) => formatMessageForMarkdown(msg)).join("\n") + "\n";

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

/**
 * Append messages to the archive file.
 */
async function appendToArchive(filePath: string, messages: RotatableMessage[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Check if file exists; if not, add header
  let content = "";
  try {
    await fs.access(filePath);
  } catch {
    content = `# Conversation Archive\n> Long-term message storage (oldest messages)\n\n`;
  }

  content += messages.map((msg) => formatMessageForMarkdown(msg)).join("\n") + "\n";
  await fs.appendFile(filePath, content, "utf-8");
}

/**
 * Force rotation for a session (for testing or manual trigger).
 */
export async function forceRotation(sessionFile: string): Promise<RotationResult> {
  return runRotation(sessionFile);
}

/**
 * Get rotation state for a session.
 */
export function getRotationState(sessionFile: string): RotationState | undefined {
  return rotationStates.get(sessionFile);
}

/**
 * Clear all rotation state (for testing).
 */
export function clearRotationState(): void {
  rotationStates.clear();
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
}
