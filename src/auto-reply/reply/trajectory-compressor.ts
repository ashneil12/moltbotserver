/**
 * Trajectory Compressor
 *
 * Produces structured session summaries from conversation transcripts, inspired
 * by NousResearch/hermes-agent's trajectory compression approach.
 *
 * Two compression modes:
 * 1. **Mechanical** (default, no external deps): Extracts key decisions, tools used,
 *    user intent, and outcomes from the raw transcript JSONL. Much richer than the
 *    simple message-list the old `extractSessionContextFromTranscript` produced.
 * 2. **LLM-assisted** (optional): When a `summarize` callback is provided, sends
 *    the protected + compressed context to an LLM for a narrative summary.
 *
 * Usage:
 *   import { compressTrajectory, type CompressionConfig } from "./trajectory-compressor.js";
 *   const summary = compressTrajectory({ transcriptPath, config });
 */

import fs from "node:fs";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  cleanUserContent,
  isCronPromptMessage,
  isMeaningfulUserContent,
} from "./noise-patterns.js";

const log = createSubsystemLogger("trajectory-compressor");

// ---------------------------------------------------------------------------
// Noise filtering — strip system-injected lines from user message content
// ---------------------------------------------------------------------------

/**
 * Returns true if the parsed turns contain at least one user turn with real
 * human-written content (after noise stripping).
 *
 * This is a signal-based check: heartbeat sessions, cron jobs, and consciousness
 * loops produce turns where every user message is either empty, a system
 * injection, or a bare `HEARTBEAT_OK`. Those sessions should not be recorded
 * in session-context.md at all.
 *
 * Cron prompts are checked against the raw (pre-clean) content because
 * `cleanUserContent` strips the identifying first line, leaving the body
 * of the cron prompt which may look like meaningful text.
 */
function hasRealHumanInteraction(turns: ParsedTurn[]): boolean {
  return turns.some(
    (turn) =>
      turn.role === "user" &&
      !isCronPromptMessage(turn.rawContent ?? turn.content) &&
      isMeaningfulUserContent(turn.content),
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompressionConfig = {
  /** Max characters for the compressed output. Default: 8000 */
  maxOutputChars: number;
  /** Number of initial turns to protect (always include in summary). Default: 3 */
  protectFirstTurns: number;
  /** Number of final turns to protect (always include in summary). Default: 4 */
  protectLastTurns: number;
  /** Max characters per individual message in the summary. Default: 400 */
  maxMessageChars: number;
  /**
   * Optional async callback to produce an LLM-assisted summary.
   * Receives the protected turns (first + last) and the full middle-region text.
   * Returns a narrative summary string, or undefined to fall through to mechanical.
   */
  summarize?: (params: {
    protectedFirst: ParsedTurn[];
    protectedLast: ParsedTurn[];
    middleRegion: ParsedTurn[];
    fullTranscriptText: string;
  }) => Promise<string | undefined>;
};

export type ParsedTurn = {
  role: string;
  content: string;
  /** Raw content before noise stripping (user turns only). */
  rawContent?: string;
  timestamp?: string;
  toolName?: string;
  toolCallId?: string;
  /** Whether this turn contains a tool call (assistant requesting tool use) */
  isToolCall: boolean;
  /** Whether this turn is a tool result */
  isToolResult: boolean;
};

export type CompressionResult = {
  summary: string;
  metrics: {
    totalTurns: number;
    protectedTurns: number;
    compressedTurns: number;
    inputChars: number;
    outputChars: number;
    usedLlm: boolean;
  };
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: CompressionConfig = {
  maxOutputChars: 8000,
  protectFirstTurns: 3,
  protectLastTurns: 4,
  maxMessageChars: 400,
};

// ---------------------------------------------------------------------------
// Internal: transcript parsing
// ---------------------------------------------------------------------------

type TranscriptEntry = {
  type: string;
  timestamp?: string;
  message?: {
    role: string;
    content?: string | Array<{ type: string; text?: string; name?: string; id?: string }>;
    tool_call_id?: string;
    name?: string;
  };
};

function extractText(content: string | Array<{ type: string; text?: string }> | undefined): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text ?? "")
      .join("\n");
  }
  return "";
}

function extractToolCall(content: unknown): { name: string; id?: string } | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }
  for (const block of content) {
    const b = block as Record<string, unknown>;
    if (
      (b.type === "toolCall" || b.type === "tool_use" || b.type === "function") &&
      typeof b.name === "string"
    ) {
      return { name: b.name, id: typeof b.id === "string" ? b.id : undefined };
    }
  }
  return undefined;
}

function parseTranscript(transcriptPath: string): ParsedTurn[] {
  let content: string;
  try {
    content = fs.readFileSync(transcriptPath, "utf-8");
  } catch {
    log.debug(`cannot read transcript: ${transcriptPath}`);
    return [];
  }

  const turns: ParsedTurn[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line) as TranscriptEntry;
    } catch {
      continue;
    }

    if (entry.type !== "message" || !entry.message) {
      continue;
    }

    const msg = entry.message;
    let text = extractText(msg.content).trim();

    // Strip known system-injected noise from user messages at parse time.
    // This keeps all downstream consumers (intents, protected turns, etc.) clean.
    // Preserve the raw content so cron prompt detection can check the original.
    let rawContent: string | undefined;
    if (msg.role === "user") {
      rawContent = text;
      text = cleanUserContent(text);
    }

    const toolCall = msg.role === "assistant" ? extractToolCall(msg.content) : undefined;
    const isToolResult = msg.role === "tool" || Boolean(msg.tool_call_id);

    turns.push({
      role: msg.role,
      content: text,
      rawContent,
      timestamp: entry.timestamp,
      toolName: toolCall?.name ?? msg.name,
      toolCallId: msg.tool_call_id ?? toolCall?.id,
      isToolCall: Boolean(toolCall),
      isToolResult,
    });
  }

  return turns;
}

// ---------------------------------------------------------------------------
// Internal: mechanical compression
// ---------------------------------------------------------------------------

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars) + "…";
}

function extractToolUsageSummary(turns: ParsedTurn[]): string[] {
  const toolCounts = new Map<string, number>();
  for (const turn of turns) {
    if (turn.toolName) {
      toolCounts.set(turn.toolName, (toolCounts.get(turn.toolName) ?? 0) + 1);
    }
  }
  return [...toolCounts.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => `${name} (${count}×)`);
}

function extractKeyDecisions(turns: ParsedTurn[], maxChars: number): string[] {
  const decisions: string[] = [];
  for (const turn of turns) {
    if (turn.role !== "assistant" || !turn.content || turn.isToolCall) {
      continue;
    }
    // Look for decision markers: lines starting with action verbs or containing key indicators
    const lines = turn.content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 15 || trimmed.length > 300) {
        continue;
      }
      // Decision indicators: starts with "I'll", "Let me", "We should", "Fixed", "Created",
      // "Updated", "Changed", contains "because", "decided", "instead of", etc.
      if (
        /^(I'll|I will|Let me|We should|Going to|Need to|Fixed|Created|Updated|Changed|Added|Removed|Replaced|Installed|Configured|The solution|The fix|The issue)/i.test(
          trimmed,
        ) ||
        /\b(because|decided|instead of|chosen|opted for|switched to|replaced with)\b/i.test(trimmed)
      ) {
        decisions.push(truncate(trimmed, maxChars));
      }
    }
  }
  return decisions.slice(0, 10);
}

function extractUserIntents(turns: ParsedTurn[], maxChars: number): string[] {
  const intents: string[] = [];
  for (const turn of turns) {
    if (turn.role !== "user" || !turn.content) {
      continue;
    }
    // Take the first line of each user message as an intent summary
    const firstLine = turn.content.split("\n").filter(Boolean)[0]?.trim();
    if (firstLine && firstLine.length > 5) {
      intents.push(truncate(firstLine, maxChars));
    }
  }
  return intents;
}

function buildMechanicalSummary(turns: ParsedTurn[], config: CompressionConfig): string {
  const { maxOutputChars, protectFirstTurns, protectLastTurns, maxMessageChars } = config;

  if (turns.length === 0) {
    return "";
  }

  // Skip sessions that contain no real human interaction — heartbeats, cron
  // runs, consciousness loops, etc. These should never appear in session-context.md.
  if (!hasRealHumanInteraction(turns)) {
    log.debug("skipping session summary: no real human interaction detected");
    return "";
  }

  // Split into protected regions
  const firstProtected = turns.slice(0, Math.min(protectFirstTurns, turns.length));
  const lastProtected =
    turns.length > protectFirstTurns
      ? turns.slice(Math.max(protectFirstTurns, turns.length - protectLastTurns))
      : [];
  const middleStart = protectFirstTurns;
  const middleEnd = Math.max(protectFirstTurns, turns.length - protectLastTurns);
  const middleTurns = middleStart < middleEnd ? turns.slice(middleStart, middleEnd) : [];

  // Metadata
  const firstTimestamp = turns[0]?.timestamp;
  const lastTimestamp = turns[turns.length - 1]?.timestamp;
  const startTime = firstTimestamp
    ? new Date(firstTimestamp)
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d+Z$/, " UTC")
    : "unknown";
  const endTime = lastTimestamp
    ? new Date(lastTimestamp)
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d+Z$/, " UTC")
    : "unknown";

  const parts: string[] = [];
  parts.push(`## Session Summary`);
  parts.push(`Started: ${startTime} | Ended: ${endTime} | ${turns.length} turns`);

  // Tools used
  const toolUsage = extractToolUsageSummary(turns);
  if (toolUsage.length > 0) {
    parts.push(`Tools used: ${toolUsage.join(", ")}`);
  }

  // Key decisions from the middle region (the compressed part)
  if (middleTurns.length > 0) {
    const decisions = extractKeyDecisions(middleTurns, maxMessageChars);
    if (decisions.length > 0) {
      parts.push("");
      parts.push("### Key decisions & actions:");
      for (const d of decisions) {
        parts.push(`- ${d}`);
      }
    }
  }

  // User intents (what the user asked for)
  const intents = extractUserIntents(turns, maxMessageChars);
  if (intents.length > 0) {
    parts.push("");
    parts.push("### User requests:");
    for (const intent of intents.slice(0, 15)) {
      parts.push(`- ${intent}`);
    }
  }

  // Protected first turns — the opening context
  if (firstProtected.length > 0) {
    parts.push("");
    parts.push("### Opening context:");
    for (const turn of firstProtected) {
      if (!turn.content) {
        continue;
      }
      const label = turn.role === "user" ? "User" : turn.role === "assistant" ? "Agent" : turn.role;
      parts.push(`**${label}:** ${truncate(turn.content, maxMessageChars)}`);
    }
  }

  // Protected last turns — the final state
  if (lastProtected.length > 0) {
    parts.push("");
    parts.push("### Final context:");
    for (const turn of lastProtected) {
      if (!turn.content) {
        continue;
      }
      const label = turn.role === "user" ? "User" : turn.role === "assistant" ? "Agent" : turn.role;
      if (turn.isToolResult) {
        // Tool results can be very long — summarize more aggressively
        parts.push(`**Tool (${turn.toolName ?? "unknown"}):** ${truncate(turn.content, 200)}`);
      } else {
        parts.push(`**${label}:** ${truncate(turn.content, maxMessageChars)}`);
      }
    }
  }

  // Truncate the entire summary if needed
  let result = parts.join("\n");
  if (result.length > maxOutputChars) {
    // Find a clean break
    const cutPoint = result.lastIndexOf("\n### ", maxOutputChars);
    if (cutPoint > maxOutputChars * 0.5) {
      result = result.slice(0, cutPoint).trimEnd() + "\n";
    } else {
      result = result.slice(0, maxOutputChars).trimEnd() + "\n";
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compress a session transcript into a structured summary.
 *
 * Applies the Hermes-inspired trajectory compression strategy:
 * 1. Protect first N turns (opening context)
 * 2. Protect last N turns (final state)
 * 3. Compress middle turns — extract key decisions, tool usage, user intents
 * 4. Optionally enhance with LLM summarization via the `config.summarize` callback
 */
export async function compressTrajectory(params: {
  transcriptPath: string;
  config?: Partial<CompressionConfig>;
}): Promise<CompressionResult> {
  const config: CompressionConfig = { ...DEFAULT_CONFIG, ...params.config };
  const turns = parseTranscript(params.transcriptPath);

  if (turns.length === 0) {
    return {
      summary: "",
      metrics: {
        totalTurns: 0,
        protectedTurns: 0,
        compressedTurns: 0,
        inputChars: 0,
        outputChars: 0,
        usedLlm: false,
      },
    };
  }

  const totalInputChars = turns.reduce((sum, t) => sum + (t.content?.length ?? 0), 0);
  const protectedCount = Math.min(config.protectFirstTurns + config.protectLastTurns, turns.length);
  const compressedCount = Math.max(0, turns.length - protectedCount);

  // Try LLM summarization if callback provided
  if (config.summarize) {
    try {
      const firstProtected = turns.slice(0, Math.min(config.protectFirstTurns, turns.length));
      const lastProtected =
        turns.length > config.protectFirstTurns
          ? turns.slice(Math.max(config.protectFirstTurns, turns.length - config.protectLastTurns))
          : [];
      const middleStart = config.protectFirstTurns;
      const middleEnd = Math.max(config.protectFirstTurns, turns.length - config.protectLastTurns);
      const middleRegion = middleStart < middleEnd ? turns.slice(middleStart, middleEnd) : [];

      const fullText = turns.map((t) => `[${t.role}] ${t.content || "(no content)"}`).join("\n");

      const llmSummary = await config.summarize({
        protectedFirst: firstProtected,
        protectedLast: lastProtected,
        middleRegion,
        fullTranscriptText: fullText,
      });

      if (llmSummary) {
        const truncated = llmSummary.slice(0, config.maxOutputChars);
        return {
          summary: truncated,
          metrics: {
            totalTurns: turns.length,
            protectedTurns: protectedCount,
            compressedTurns: compressedCount,
            inputChars: totalInputChars,
            outputChars: truncated.length,
            usedLlm: true,
          },
        };
      }
    } catch (err) {
      log.warn(`LLM summarization failed, falling back to mechanical: ${String(err)}`);
    }
  }

  // Mechanical compression (default/fallback)
  const summary = buildMechanicalSummary(turns, config);

  return {
    summary,
    metrics: {
      totalTurns: turns.length,
      protectedTurns: protectedCount,
      compressedTurns: compressedCount,
      inputChars: totalInputChars,
      outputChars: summary.length,
      usedLlm: false,
    },
  };
}

/**
 * Parse a transcript file into structured turns.
 * Exported for testing and external consumers.
 */
export function parseTranscriptTurns(transcriptPath: string): ParsedTurn[] {
  return parseTranscript(transcriptPath);
}

/**
 * Synchronous variant of `compressTrajectory` that uses only the mechanical
 * compression path (no LLM callback). Suitable for callers that cannot be async,
 * like `persistSessionContextOnReset`.
 */
export function compressTrajectorySync(params: {
  transcriptPath: string;
  config?: Partial<Omit<CompressionConfig, "summarize">>;
}): Omit<CompressionResult, "metrics"> & {
  metrics: Omit<CompressionResult["metrics"], "usedLlm">;
} {
  const config: CompressionConfig = { ...DEFAULT_CONFIG, ...params.config };
  const turns = parseTranscript(params.transcriptPath);

  if (turns.length === 0) {
    return {
      summary: "",
      metrics: {
        totalTurns: 0,
        protectedTurns: 0,
        compressedTurns: 0,
        inputChars: 0,
        outputChars: 0,
      },
    };
  }

  const totalInputChars = turns.reduce((sum, t) => sum + (t.content?.length ?? 0), 0);
  const protectedCount = Math.min(config.protectFirstTurns + config.protectLastTurns, turns.length);
  const compressedCount = Math.max(0, turns.length - protectedCount);
  const summary = buildMechanicalSummary(turns, config);

  return {
    summary,
    metrics: {
      totalTurns: turns.length,
      protectedTurns: protectedCount,
      compressedTurns: compressedCount,
      inputChars: totalInputChars,
      outputChars: summary.length,
    },
  };
}
