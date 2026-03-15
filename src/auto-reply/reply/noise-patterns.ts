/**
 * Shared noise-filtering primitives for session transcript processing.
 *
 * These patterns identify lines injected by the OpenClaw runtime into the
 * "user" role of a conversation transcript that are NOT typed by a human.
 * Both the trajectory compressor and the legacy session-context extractor
 * import from here to guarantee they stay in sync.
 *
 * Patterns covered:
 *  - `Sender (untrusted metadata):` — channel/sender metadata injections
 *  - `[SYSTEM: ...]` — system prompt injections (BOOTSTRAP.md, heartbeat triggers, etc.)
 *  - Bare `HEARTBEAT_OK` / `HEARTBEAT` — cron-driven heartbeat acknowledgements
 *  - JSON blobs with a `"label"` or `"openclaw-control-ui"` key — UI control metadata
 */
export const NOISE_LINE_PATTERNS: readonly RegExp[] = [
  /^Sender\s*\(untrusted metadata\)\s*:?\s*$/i,
  /^\s*\[SYSTEM:/i,
  /^\s*HEARTBEAT_OK\s*$/i,
  /^\s*HEARTBEAT\s*$/i,
  // JSON blobs that are metadata payloads (start with { and have a "label" or "id" key)
  /^\s*\{[^}]*"label"\s*:/i,
  /^\s*\{[^}]*"openclaw-control-ui"/i,
];

/**
 * Cron job prompt patterns — match the FIRST line of a cron-injected user
 * message. Unlike NOISE_LINE_PATTERNS (which strip individual noisy lines),
 * these classify the ENTIRE message as non-human. The rest of the message
 * may contain perfectly readable English instructions to the agent, but
 * those instructions are system-generated, not typed by a user.
 */
export const CRON_PROMPT_PATTERNS: readonly RegExp[] = [
  /^Pre-reset memory flush\b/i,
  /^WORKSPACE MAINTENANCE\s*[—–-]/i,
  /^SELF-REVIEW\s*[—–-]/i,
  /^You are in background consciousness mode\b/i,
  /^DEEP REVIEW\s*[—–-]/i,
  /^MORNING BRIEFING\s*[—–-]/i,
  /^NIGHTLY INNOVATION\s*[—–-]/i,
  /^WEEKLY STRATEGIC SELF-AUDIT\s*[—–-]/i,
  /^DIARY CONTINUITY\s*[—–-]/i,
  /^BROWSER TAB CLEANUP\s*[—–-]/i,
  /^WORKSPACE DOC CONVERTER\s*[—–-]/i,
  /^MEMORY EXTRACTION\s*[—–-]/i,
  /^SYSTEM TASK\s*[—–-]/i,
  /^SKILL EVOLUTION\s*[—–-]/i,
  /^SECURITY AUDIT\s*[—–-]/i,
  /^Run\s+`?openclaw\s+(?:update|backup)\b/i,
];

/**
 * Minimum character count for cleaned user content to be considered a real
 * human message (not just noise residue).
 */
export const MEANINGFUL_CONTENT_MIN_CHARS = 4;

/**
 * Strip known system-injected noise patterns from the text of a user message.
 * Drops lines that match any noise pattern and trims the result.
 * Returns an empty string if the entire message was noise.
 */
export function cleanUserContent(text: string): string {
  const lines = text.split("\n");
  const cleaned = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return false;
    }
    return !NOISE_LINE_PATTERNS.some((pattern) => pattern.test(trimmed));
  });
  return cleaned.join("\n").trim();
}

/**
 * Returns true if the raw user content is a cron job prompt (system-generated
 * multi-line instruction to the agent). Checks the first non-empty line of
 * the message against known cron prompt patterns.
 */
export function isCronPromptMessage(text: string): boolean {
  const firstLine =
    text
      .split("\n")
      .find((l) => l.trim())
      ?.trim() ?? "";
  return CRON_PROMPT_PATTERNS.some((pattern) => pattern.test(firstLine));
}

/**
 * Returns true if the (already-cleaned) user content represents a real human
 * message — i.e. has enough text to convey intent and is not a cron prompt.
 */
export function isMeaningfulUserContent(text: string): boolean {
  if (text.trim().length < MEANINGFUL_CONTENT_MIN_CHARS) {
    return false;
  }
  // Even if there's enough text, a cron prompt is not meaningful user content.
  return !isCronPromptMessage(text);
}
