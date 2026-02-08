/**
 * Memory Maker Agent
 *
 * Extracts durable facts from conversation batches using an LLM.
 * This agent analyzes messages and produces structured memories
 * with tags for categorization.
 */

import type {
  MemoryMakerInput,
  MemoryMakerOutput,
  ExtractedMemory,
  MemoryBatchMessage,
} from "./memory-maker-types.js";
import { estimateTokens } from "./memory-maker-types.js";

/**
 * Build the prompt for the Memory Maker agent.
 */
function buildPrompt(input: MemoryMakerInput): string {
  // Format message batch
  const messageBatchText = input.messageBatch
    .map((m) => `[${m.role}]: ${m.content}`)
    .join("\n\n");

  // Format existing memories for dedup
  const existingText =
    input.existingMemories.length > 0
      ? input.existingMemories.map((m) => `- ${m}`).join("\n")
      : "(none)";

  // Optional assembler context
  const contextText = input.assemblerContext || "(no additional context)";

  return `You are the Memory Maker. Extract durable facts from conversation worth remembering.

INPUT:
- Message batch (${input.messageBatch.length} messages):
${messageBatchText}

- Existing memories (for dedup):
${existingText}

- Current context:
${contextText}

TASK:
1. Read through the conversation batch
2. Identify facts worth remembering LONG-TERM:
   - User preferences ("I prefer dark mode", "I'm vegetarian")
   - Decisions made ("We decided to use TypeScript")
   - Key information ("My daughter's name is Emma")
   - Important context ("Working on MoltBot project")
3. Check against existing memories—avoid semantic duplicates
4. Output new memories with tags

OUTPUT FORMAT (if memories to save):
---NEW_MEMORIES---
- User prefers concise responses #preferences #communication
- Working on OpenClaw context management system #projects #current
- Uses DeepSeek for cheap model operations #tools #preferences
---END---

OUTPUT FORMAT (if nothing worth saving):
---NEW_MEMORIES---
N/A
---END---

RULES:
- Only save DURABLE facts (not temporary context like "working on this bug")
- Use 1-3 tags per memory for categorization
- Check for semantic duplicates—don't repeat existing memories
- Casual conversation rarely produces memories
- Quality over quantity—less is more
- If unsure, don't save it`;
}

/**
 * Parse the LLM output to extract memories.
 */
export function parseMemoryOutput(output: string): ExtractedMemory[] | null {
  // Find the memories block
  const startMarker = "---NEW_MEMORIES---";
  const endMarker = "---END---";

  const startIdx = output.indexOf(startMarker);
  const endIdx = output.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    // Try to find any memory-like content
    return parseLooseFormat(output);
  }

  const block = output.slice(startIdx + startMarker.length, endIdx).trim();

  // Check for N/A
  if (block === "N/A" || block.toLowerCase() === "n/a") {
    return null;
  }

  return parseMemoryLines(block);
}

/**
 * Parse memory lines from the extracted block.
 */
function parseMemoryLines(block: string): ExtractedMemory[] {
  const lines = block.split("\n").filter((l) => l.trim());
  const memories: ExtractedMemory[] = [];

  for (const line of lines) {
    // Remove leading dash if present
    let content = line.trim();
    if (content.startsWith("-")) {
      content = content.slice(1).trim();
    }

    // Extract tags (words starting with #)
    const tagMatches = content.match(/#(\w+)/g);
    const tags = tagMatches ? tagMatches.map((t) => t.slice(1)) : [];

    // Remove tags from content
    const cleanContent = content.replace(/#\w+/g, "").trim();

    if (cleanContent.length > 0) {
      memories.push({ content: cleanContent, tags });
    }
  }

  return memories.length > 0 ? memories : null;
}

/**
 * Try to parse memories from a loose format (fallback).
 */
function parseLooseFormat(output: string): ExtractedMemory[] | null {
  // Look for lines that might be memories
  const lines = output.split("\n");
  const memories: ExtractedMemory[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines, headers, and common non-memory patterns
    if (!trimmed || trimmed.startsWith("#") && !trimmed.includes(" ")) {
      continue;
    }

    // Look for lines starting with dash or bullet
    if (trimmed.startsWith("-") || trimmed.startsWith("•") || trimmed.startsWith("*")) {
      let content = trimmed.slice(1).trim();
      
      // Extract tags
      const tagMatches = content.match(/#(\w+)/g);
      const tags = tagMatches ? tagMatches.map((t) => t.slice(1)) : [];
      const cleanContent = content.replace(/#\w+/g, "").trim();

      if (cleanContent.length > 10) { // Minimum meaningful content
        memories.push({ content: cleanContent, tags });
      }
    }
  }

  return memories.length > 0 ? memories : null;
}

/**
 * Check if a memory is a semantic duplicate of existing memories.
 * Uses simple keyword overlap for MVP.
 */
function isSemanticDuplicate(
  newMemory: string,
  existingMemories: string[],
  threshold = 0.7,
): boolean {
  const newWords = new Set(
    newMemory.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
  );

  for (const existing of existingMemories) {
    const existingWords = new Set(
      existing.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
    );

    if (existingWords.size === 0 || newWords.size === 0) continue;

    // Count overlap
    let overlap = 0;
    for (const word of newWords) {
      if (existingWords.has(word)) overlap++;
    }

    const overlapRatio = overlap / Math.min(newWords.size, existingWords.size);
    if (overlapRatio >= threshold) {
      return true;
    }
  }

  return false;
}

/**
 * Filter out duplicate memories.
 */
export function deduplicateMemories(
  memories: ExtractedMemory[],
  existingMemories: string[],
): ExtractedMemory[] {
  const result: ExtractedMemory[] = [];
  const seenContents = new Set<string>();

  for (const memory of memories) {
    const lower = memory.content.toLowerCase().trim();

    // Skip exact duplicates
    if (seenContents.has(lower)) continue;
    if (existingMemories.some((e) => e.toLowerCase().trim() === lower)) continue;

    // Skip semantic duplicates
    if (isSemanticDuplicate(memory.content, existingMemories)) continue;

    seenContents.add(lower);
    result.push(memory);
  }

  return result;
}

/**
 * Type for LLM call function.
 */
export type LLMCallFn = (prompt: string) => Promise<string>;

/**
 * Run the Memory Maker agent.
 *
 * @param input - The input with message batch and existing memories
 * @param llmCall - Function to call the LLM
 * @returns MemoryMakerOutput with extracted memories
 */
export async function runMemoryMaker(
  input: MemoryMakerInput,
  llmCall: LLMCallFn,
): Promise<MemoryMakerOutput> {
  // Skip if batch is empty or too small
  if (input.messageBatch.length < 3) {
    return {
      memories: null,
      hasMemories: false,
    };
  }

  // Check if batch is mostly casual
  if (isMostlyCasual(input.messageBatch)) {
    return {
      memories: null,
      hasMemories: false,
    };
  }

  try {
    const prompt = buildPrompt(input);
    const response = await llmCall(prompt);

    const parsed = parseMemoryOutput(response);
    if (!parsed || parsed.length === 0) {
      return {
        memories: null,
        hasMemories: false,
      };
    }

    // Deduplicate against existing memories
    const deduplicated = deduplicateMemories(parsed, input.existingMemories);
    if (deduplicated.length === 0) {
      return {
        memories: null,
        hasMemories: false,
      };
    }

    return {
      memories: deduplicated,
      hasMemories: true,
    };
  } catch (err) {
    console.error("[memory-maker] Extraction failed:", err);
    return {
      memories: null,
      hasMemories: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Check if a batch of messages is mostly casual conversation.
 */
function isMostlyCasual(messages: MemoryBatchMessage[]): boolean {
  const casualPatterns = [
    /^(hi|hey|hello|yo|sup|hola)\s*[!?.]*$/i,
    /^(how are you|how's it going|what's up|whats up)\s*[?!.]*$/i,
    /^(good morning|good afternoon|good evening|good night)\s*[!?.]*$/i,
    /^(thanks|thank you|thx|ty)\s*[!?.]*$/i,
    /^(bye|goodbye|see you|later|cya)\s*[!?.]*$/i,
    /^(ok|okay|sure|alright|got it|understood)\s*[!?.]*$/i,
    /^(yes|no|yeah|yep|nope|nah)\s*[!?.]*$/i,
  ];

  let casualCount = 0;
  for (const msg of messages) {
    const trimmed = msg.content.trim();
    if (trimmed.length < 20 || casualPatterns.some((p) => p.test(trimmed))) {
      casualCount++;
    }
  }

  // If >70% casual, skip
  return casualCount / messages.length > 0.7;
}
