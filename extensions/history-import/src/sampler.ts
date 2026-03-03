/**
 * Smart sampling of conversations for identity reasoning.
 *
 * Selects the most informative conversations based on:
 * - Recency (recent conversations reflect current preferences)
 * - Length (longer conversations reveal more personality)
 * - User message ratio (high user participation = more signal)
 */

import type { NormalizedConversation } from "./types.js";

type ScoredConversation = {
  conversation: NormalizedConversation;
  score: number;
};

/**
 * Score a conversation for informativeness.
 * Higher = more useful for identity extraction.
 */
function scoreConversation(convo: NormalizedConversation, newestTs: number): number {
  let score = 0;

  // Recency: conversations from the last 30 days get a bonus
  if (convo.createdAt && newestTs) {
    const ageSeconds = newestTs - convo.createdAt;
    const ageDays = ageSeconds / 86400;
    if (ageDays <= 7) {
      score += 30;
    } else if (ageDays <= 30) {
      score += 20;
    } else if (ageDays <= 90) {
      score += 10;
    } else if (ageDays <= 365) {
      score += 5;
    }
  }

  // Length: more messages = more signal (diminishing returns)
  const msgCount = convo.messages.length;
  score += Math.min(msgCount * 2, 40);

  // User participation: single-pass for both count and content length
  let userMessages = 0;
  let totalUserChars = 0;
  for (const m of convo.messages) {
    if (m.role === "user") {
      userMessages++;
      totalUserChars += m.content.length;
    }
  }

  const ratio = msgCount > 0 ? userMessages / msgCount : 0;
  score += ratio * 20;

  // Content length: longer user messages contain more personality signal
  score += Math.min(totalUserChars / 100, 20);

  return score;
}

/**
 * Select the top N most informative conversations for identity reasoning.
 */
export function sampleConversations(
  conversations: NormalizedConversation[],
  maxSample: number = 50,
): NormalizedConversation[] {
  if (conversations.length <= maxSample) {
    return conversations;
  }

  // Find the newest timestamp for recency scoring
  const newestTs = conversations.reduce((max, c) => {
    return c.createdAt && c.createdAt > max ? c.createdAt : max;
  }, 0);

  const scored: ScoredConversation[] = conversations.map((conversation) => ({
    conversation,
    score: scoreConversation(conversation, newestTs),
  }));

  // Sort by score descending, pick top N
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, maxSample).map((s) => s.conversation);
}
