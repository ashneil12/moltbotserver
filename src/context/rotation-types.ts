/**
 * Context Rotation Types
 *
 * Configuration and types for the context management system that maintains
 * a tiered message storage: active context (1-20), history (21-100), archive (101+).
 */

/**
 * Configuration for context window management.
 */
export interface ContextRotationConfig {
  /** Enable context rotation (default: true) */
  enabled: boolean;

  /** Messages kept in active context (default: 20) */
  windowSize: number;

  /** Messages in history before archiving (default: 80) */
  historySize: number;

  /** Whether to maintain archive for messages beyond history (default: true) */
  archiveEnabled: boolean;

  /** Debounce interval in ms before rotation runs after last message (default: 1000) */
  debounceMs: number;
}

/**
 * Default configuration values.
 */
export const DEFAULT_CONTEXT_ROTATION_CONFIG: ContextRotationConfig = {
  enabled: true,
  windowSize: 20,
  historySize: 80,
  archiveEnabled: true,
  debounceMs: 1000,
};

/**
 * Resolved paths for context rotation files.
 */
export interface ContextRotationPaths {
  /** Path to conversation_history.md */
  historyFile: string;

  /** Path to conversation_archive.md */
  archiveFile: string;

  /** Workspace directory */
  workspaceDir: string;
}

/**
 * A message extracted from the session transcript for rotation.
 */
export interface RotatableMessage {
  /** Role: user, assistant, tool, etc. */
  role: string;

  /** Message content (text or structured) */
  content: string;

  /** Original timestamp from transcript */
  timestamp: number;

  /** Original index in transcript */
  index: number;
}

/**
 * Result of a rotation operation.
 */
export interface RotationResult {
  /** Whether rotation was performed */
  rotated: boolean;

  /** Number of messages moved to history */
  movedToHistory: number;

  /** Number of messages moved to archive */
  movedToArchive: number;

  /** Current message count in active context */
  activeCount: number;

  /** Current message count in history */
  historyCount: number;

  /** Current message count in archive */
  archiveCount: number;
}

/**
 * State tracked for rotation across sessions.
 */
export interface RotationState {
  /** Session ID being tracked */
  sessionId: string;

  /** Session file path */
  sessionFile: string;

  /** Last known message count in session */
  lastMessageCount: number;

  /** Timestamp of last rotation */
  lastRotationAt: number;

  /** Total messages ever rotated to history */
  totalRotatedToHistory: number;

  /** Total messages ever rotated to archive */
  totalRotatedToArchive: number;
}
