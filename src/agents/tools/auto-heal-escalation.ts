/**
 * Auto-Heal Escalation — translates technical failures into
 * plain-English user messages with fix-first options.
 *
 * Key design principle: "Disable" is always the LAST option.
 * The first options should always be actionable fix attempts.
 *
 * This module generates the escalation messages that the Main Agent
 * sends to the human when the auto-heal subagent cannot resolve
 * an error autonomously.
 */

import path from "node:path";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("auto-heal-escalation");

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface EscalationContext {
  /** The original error message. */
  errorMessage: string;
  /** The file that was being repaired. */
  targetFile: string;
  /** Number of approaches tried by the auto-heal subagent. */
  subagentAttempts: number;
  /** Number of approaches tried by the main agent (if applicable). */
  mainAgentAttempts: number;
  /** Brief summaries of each approach tried. */
  approachesTried: string[];
  /** The tool or subsystem affected. */
  toolContext?: string;
  /** Whether all changes have been rolled back. */
  rolledBack: boolean;
  /** Whether this is a recurring error (seen multiple times). */
  isRecurring: boolean;
  /** Occurrence count if recurring. */
  occurrenceCount?: number;
}

export interface EscalationMessage {
  /** The main message body (plain English, no code). */
  body: string;
  /** Numbered options for the user. */
  options: EscalationOption[];
  /** Technical details payload (only shown if user requests it). */
  technicalDetails: string;
}

export interface EscalationOption {
  /** Option number (1-indexed). */
  number: number;
  /** Emoji prefix. */
  emoji: string;
  /** Short label. */
  label: string;
  /** Description of what this option does. */
  description: string;
  /** Internal action identifier for the main agent to route. */
  actionId: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Plain-English Translation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Translate a technical error into a plain-English impact summary.
 *
 * Maps common error patterns to human-understandable descriptions.
 */
function translateErrorToPlainEnglish(errorMessage: string, toolContext?: string): string {
  const msg = errorMessage.toLowerCase();

  // Network / API errors
  if (msg.includes("econnrefused") || msg.includes("econnreset") || msg.includes("timeout")) {
    return toolContext
      ? `the ${toolContext} tool had trouble connecting to an external service`
      : "one of the tools had trouble connecting to an external service";
  }

  // Parse / data errors
  if (msg.includes("unexpected token") || msg.includes("json") || msg.includes("parse")) {
    return toolContext
      ? `the ${toolContext} tool received data in an unexpected format`
      : "a tool received data in an unexpected format and couldn't process it";
  }

  // Type / reference errors
  if (
    msg.includes("cannot read properties") ||
    msg.includes("undefined") ||
    msg.includes("typeerror")
  ) {
    return toolContext
      ? `the ${toolContext} tool hit a coding issue where it expected data that wasn't there`
      : "a tool hit a coding issue where it expected data that wasn't there";
  }

  // File system errors
  if (msg.includes("enoent") || msg.includes("no such file") || msg.includes("permission")) {
    return toolContext
      ? `the ${toolContext} tool couldn't find or access a file it needed`
      : "a tool couldn't find or access a file it needed";
  }

  // Rate limiting
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many")) {
    return toolContext
      ? `the ${toolContext} tool was making requests too quickly and got temporarily blocked`
      : "a tool was making requests too quickly and got temporarily blocked";
  }

  // Generic fallback
  return toolContext
    ? `the ${toolContext} tool ran into an issue it couldn't handle`
    : "one of the background tools ran into an issue it couldn't handle";
}

// ═══════════════════════════════════════════════════════════════════════════
// Escalation Message Builder
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a complete escalation message for the human.
 *
 * Options are ordered: fix-oriented first, disable/pause last.
 */
export function buildEscalationMessage(context: EscalationContext): EscalationMessage {
  const plainError = translateErrorToPlainEnglish(context.errorMessage, context.toolContext);
  const fileName = path.basename(context.targetFile);
  const totalAttempts = context.subagentAttempts + context.mainAgentAttempts;

  // Build the main body
  const bodyParts: string[] = [];

  bodyParts.push(`🔧 Quick update — ${plainError}.`);
  bodyParts.push("");

  if (totalAttempts > 0) {
    bodyParts.push(
      `I tried ${totalAttempts} different approach${totalAttempts === 1 ? "" : "es"} to fix it automatically but couldn't verify the fix safely.`,
    );
  }

  if (context.rolledBack) {
    bodyParts.push(
      "Everything has been rolled back to normal — nothing is broken, the system is stable.",
    );
  }

  if (context.isRecurring && context.occurrenceCount && context.occurrenceCount > 1) {
    bodyParts.push(
      `This issue has come up ${context.occurrenceCount} times, so it's worth addressing.`,
    );
  }

  bodyParts.push("");
  bodyParts.push("Here's what you can do:");

  // Build options — FIX-FIRST, disable LAST
  const options: EscalationOption[] = [];
  let optNum = 1;

  // Option 1: Try a different strategy (always available)
  options.push({
    number: optNum++,
    emoji: "✅",
    label: "Try a different strategy",
    description:
      "I'll research this error pattern online and attempt a completely new approach that hasn't been tried yet",
    actionId: "retry-research",
  });

  // Option 2: Show plain-English summary
  options.push({
    number: optNum++,
    emoji: "🔍",
    label: "Show me what went wrong",
    description:
      "A simple, plain-English summary of the problem and what was tried — no code, no jargon",
    actionId: "explain-simple",
  });

  // Option 3: Deep technical details for a developer
  options.push({
    number: optNum++,
    emoji: "🛠️",
    label: "Save technical details for a developer",
    description:
      "Drop the full error logs and fix attempts into a file that you or a dev can review later",
    actionId: "save-technical",
  });

  // Option 4: Schedule a retry later (sometimes the issue is transient)
  if (
    context.errorMessage.toLowerCase().includes("timeout") ||
    context.errorMessage.toLowerCase().includes("econnrefused") ||
    context.errorMessage.toLowerCase().includes("rate limit")
  ) {
    options.push({
      number: optNum++,
      emoji: "⏰",
      label: "Try again later",
      description: "This might be a temporary issue. I'll schedule another attempt in a few hours",
      actionId: "retry-later",
    });
  }

  // Option LAST: Pause/disable the tool (always last)
  options.push({
    number: optNum++,
    emoji: "⏸️",
    label: "Pause this tool temporarily",
    description: "Disable the affected tool until we figure it out — everything else keeps running",
    actionId: "pause-tool",
  });

  // Build technical details payload
  const technicalDetails = buildTechnicalDetails(context);

  // Format options into body
  for (const opt of options) {
    bodyParts.push(`${opt.number}. ${opt.emoji} **${opt.label}** — ${opt.description}`);
  }

  const body = bodyParts.join("\n");

  log.info(`escalation built for ${fileName}: ${options.length} options presented`);

  return { body, options, technicalDetails };
}

/**
 * Build the technical details string (only shown on request).
 */
function buildTechnicalDetails(context: EscalationContext): string {
  const lines: string[] = [];

  lines.push("# Auto-Heal Technical Report");
  lines.push("");
  lines.push(`**File:** ${context.targetFile}`);
  lines.push(`**Error:** ${context.errorMessage}`);
  lines.push(`**Tool Context:** ${context.toolContext ?? "unknown"}`);
  lines.push(`**Rolled Back:** ${context.rolledBack ? "Yes (system stable)" : "No"}`);
  lines.push(`**Recurring:** ${context.isRecurring ? `Yes (${context.occurrenceCount}x)` : "No"}`);
  lines.push("");
  lines.push("## Approaches Tried");
  lines.push("");

  for (let i = 0; i < context.approachesTried.length; i++) {
    lines.push(`${i + 1}. ${context.approachesTried[i]}`);
  }

  lines.push("");
  lines.push(
    `**Subagent attempts:** ${context.subagentAttempts} | **Main agent attempts:** ${context.mainAgentAttempts}`,
  );

  return lines.join("\n");
}

/**
 * Build a success notification for the human (when a background fix worked).
 * This is a lightweight "FYI" message, not a full escalation.
 */
export function buildSuccessNotification(params: {
  targetFile: string;
  approach: string;
  humanSummary?: string;
}): string {
  const fileName = path.basename(params.targetFile);
  const summary = params.humanSummary ?? params.approach;

  return [
    `✅ Background fix applied: ${summary}`,
    "",
    `The engineering agent automatically fixed an issue in \`${fileName}\`. ` +
      `Tests passed, and the fix has been committed. ` +
      `You can view the full history in BACKGROUND_FIXES.md.`,
  ].join("\n");
}
