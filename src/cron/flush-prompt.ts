/**
 * Shared memory flush prompt builder.
 *
 * All three flush mechanisms (pre-reset, pre-idle, /new|/reset trigger) use
 * the same structured prompt body instructing the agent to persist durable
 * memories. Only the header (reason/context) differs across callers.
 *
 * This module centralizes the shared instructions so any changes to the
 * memory flush prompt template propagate consistently.
 */

import { SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";

/**
 * Build a complete memory flush prompt with a caller-specific header.
 *
 * @param header - One or two lines explaining WHY this flush is running.
 *   Examples:
 *     "Pre-reset memory flush.\nThe daily session reset will happen in ~20 minutes — store any durable memories now."
 *     "Pre-idle-reset memory flush.\nThis session is about to expire due to inactivity — store any durable memories now."
 */
export function buildFlushPrompt(header: string): string {
  return [
    header,
    "",
    "## 1. Daily memory log",
    "Write to memory/YYYY-MM-DD.md; create memory/ if needed.",
    "IMPORTANT: If the file already exists, APPEND new content only — do not overwrite existing entries.",
    "Include a ### Seemingly Insignificant / Minor Notes section for small details, asides,",
    "offhand mentions, or anything that didn't feel important at the time.",
    "These often turn out to matter later. Better to write it down than lose it.",
    "",
    `If nothing to store, reply with ${SILENT_REPLY_TOKEN}.`,
  ].join("\n");
}
