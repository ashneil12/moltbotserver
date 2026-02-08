import type { NormalizedChatType } from "../channels/chat-type.js";

export type ReplyMode = "text" | "command";
export type TypingMode = "never" | "instant" | "thinking" | "message";
export type SessionScope = "per-sender" | "global";
export type DmScope = "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";
export type ReplyToMode = "off" | "first" | "all";
export type GroupPolicy = "open" | "disabled" | "allowlist";
export type DmPolicy = "pairing" | "allowlist" | "open" | "disabled";

export type OutboundRetryConfig = {
  /** Max retry attempts for outbound requests (default: 3). */
  attempts?: number;
  /** Minimum retry delay in ms (default: 300-500ms depending on provider). */
  minDelayMs?: number;
  /** Maximum retry delay cap in ms (default: 30000). */
  maxDelayMs?: number;
  /** Jitter factor (0-1) applied to delays (default: 0.1). */
  jitter?: number;
};

export type BlockStreamingCoalesceConfig = {
  minChars?: number;
  maxChars?: number;
  idleMs?: number;
};

export type BlockStreamingChunkConfig = {
  minChars?: number;
  maxChars?: number;
  breakPreference?: "paragraph" | "newline" | "sentence";
};

export type MarkdownTableMode = "off" | "bullets" | "code";

export type MarkdownConfig = {
  /** Table rendering mode (off|bullets|code). */
  tables?: MarkdownTableMode;
};

export type HumanDelayConfig = {
  /** Delay style for block replies (off|natural|custom). */
  mode?: "off" | "natural" | "custom";
  /** Minimum delay in milliseconds (default: 800). */
  minMs?: number;
  /** Maximum delay in milliseconds (default: 2500). */
  maxMs?: number;
};

export type SessionSendPolicyAction = "allow" | "deny";
export type SessionSendPolicyMatch = {
  channel?: string;
  chatType?: NormalizedChatType;
  keyPrefix?: string;
};
export type SessionSendPolicyRule = {
  action: SessionSendPolicyAction;
  match?: SessionSendPolicyMatch;
};
export type SessionSendPolicyConfig = {
  default?: SessionSendPolicyAction;
  rules?: SessionSendPolicyRule[];
};

export type SessionResetMode = "daily" | "idle";
export type SessionResetConfig = {
  mode?: SessionResetMode;
  /** Local hour (0-23) for the daily reset boundary. */
  atHour?: number;
  /** Sliding idle window (minutes). When set with daily mode, whichever expires first wins. */
  idleMinutes?: number;
};
export type SessionResetByTypeConfig = {
  dm?: SessionResetConfig;
  group?: SessionResetConfig;
  thread?: SessionResetConfig;
};

/**
 * Context rotation configuration for tiered message storage.
 * Messages rotate: active context (1-N) -> history (N+1 to M) -> archive (M+1+)
 */
export type ContextRotationConfig = {
  /** Enable context rotation (default: true). */
  enabled?: boolean;
  /** Messages kept in active context (default: 20). */
  windowSize?: number;
  /** Messages in history before archiving (default: 80). */
  historySize?: number;
  /** Whether to maintain archive for messages beyond history (default: true). */
  archiveEnabled?: boolean;
  /** Debounce interval in ms before rotation runs (default: 1000). */
  debounceMs?: number;
  /** Context assembler configuration for pre-orchestrator context injection. */
  assembler?: {
    /** Enable context assembly (default: true). */
    enabled?: boolean;
    /** Model to use for sub-agents. If not specified, uses primary model. */
    model?: string;
    /** Provider for sub-agents. If not specified, uses primary provider. */
    provider?: string;
    /** Memory Manager configuration. */
    memoryManager?: {
      enabled?: boolean;
      maxTokens?: number;
      maxResults?: number;
      minScore?: number;
    };
    /** History Manager configuration. */
    historyManager?: {
      enabled?: boolean;
      summaryMaxTokens?: number;
      specificMaxTokens?: number;
      maxSpecificMessages?: number;
    };
    /** Total token budget for all injections (default: 4000). */
    totalBudget?: number;
    /** Maximum time to wait for assembly in ms (default: 2000). */
    timeoutMs?: number;
  };
  /** Memory Maker configuration for async memory extraction. */
  memoryMaker?: {
    /** Enable memory maker (default: true). */
    enabled?: boolean;
    /** Number of messages between triggers (default: 10). */
    triggerEveryNMessages?: number;
    /** Hours of activity between triggers (default: 6). */
    triggerEveryNHours?: number;
    /** Model to use for extraction. */
    model?: string;
    /** Provider for extraction. */
    provider?: string;
    /** Number of messages per batch (default: 30). */
    batchSize?: number;
  };
};

export type SessionConfig = {
  scope?: SessionScope;
  /** DM session scoping (default: "main"). */
  dmScope?: DmScope;
  /** Map platform-prefixed identities (e.g. "telegram:123") to canonical DM peers. */
  identityLinks?: Record<string, string[]>;
  resetTriggers?: string[];
  idleMinutes?: number;
  reset?: SessionResetConfig;
  resetByType?: SessionResetByTypeConfig;
  /** Channel-specific reset overrides (e.g. { discord: { mode: "idle", idleMinutes: 10080 } }). */
  resetByChannel?: Record<string, SessionResetConfig>;
  store?: string;
  typingIntervalSeconds?: number;
  typingMode?: TypingMode;
  mainKey?: string;
  sendPolicy?: SessionSendPolicyConfig;
  agentToAgent?: {
    /** Max ping-pong turns between requester/target (0–5). Default: 5. */
    maxPingPongTurns?: number;
  };
  /** Context rotation for tiered message storage (active/history/archive). */
  context?: ContextRotationConfig;
};

export type LoggingConfig = {
  level?: "silent" | "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  file?: string;
  consoleLevel?: "silent" | "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  consoleStyle?: "pretty" | "compact" | "json";
  /** Redact sensitive tokens in tool summaries. Default: "tools". */
  redactSensitive?: "off" | "tools";
  /** Regex patterns used to redact sensitive tokens (defaults apply when unset). */
  redactPatterns?: string[];
};

export type DiagnosticsOtelConfig = {
  enabled?: boolean;
  endpoint?: string;
  protocol?: "http/protobuf" | "grpc";
  headers?: Record<string, string>;
  serviceName?: string;
  traces?: boolean;
  metrics?: boolean;
  logs?: boolean;
  /** Trace sample rate (0.0 - 1.0). */
  sampleRate?: number;
  /** Metric export interval (ms). */
  flushIntervalMs?: number;
};

export type DiagnosticsCacheTraceConfig = {
  enabled?: boolean;
  filePath?: string;
  includeMessages?: boolean;
  includePrompt?: boolean;
  includeSystem?: boolean;
};

export type DiagnosticsConfig = {
  enabled?: boolean;
  /** Optional ad-hoc diagnostics flags (e.g. "telegram.http"). */
  flags?: string[];
  otel?: DiagnosticsOtelConfig;
  cacheTrace?: DiagnosticsCacheTraceConfig;
};

export type WebReconnectConfig = {
  initialMs?: number;
  maxMs?: number;
  factor?: number;
  jitter?: number;
  maxAttempts?: number; // 0 = unlimited
};

export type WebConfig = {
  /** If false, do not start the WhatsApp web provider. Default: true. */
  enabled?: boolean;
  heartbeatSeconds?: number;
  reconnect?: WebReconnectConfig;
};

// Provider docking: allowlists keyed by provider id (and internal "webchat").
export type AgentElevatedAllowFromConfig = Partial<Record<string, Array<string | number>>>;

export type IdentityConfig = {
  name?: string;
  theme?: string;
  emoji?: string;
  /** Avatar image: workspace-relative path, http(s) URL, or data URI. */
  avatar?: string;
};
