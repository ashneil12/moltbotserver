import { describe, it, expect } from "vitest";
import { sampleConversations } from "../src/sampler.js";
import type { NormalizedConversation } from "../src/types.js";

function makeConvo(
  overrides: Partial<NormalizedConversation> & { msgCount?: number },
): NormalizedConversation {
  const msgCount = overrides.msgCount ?? 4;
  const messages = [];
  for (let i = 0; i < msgCount; i++) {
    messages.push({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message ${i} - ${"x".repeat(50 + i * 10)}`,
      timestamp: (overrides.createdAt ?? 1700000000) + i * 60,
    });
  }
  return {
    id: `conv-${Math.random().toString(36).slice(2, 8)}`,
    title: "Test Conversation",
    messages,
    source: "chatgpt",
    createdAt: 1700000000,
    ...overrides,
    // Restore messages if not overridden
    ...(overrides.messages ? {} : { messages }),
  };
}

describe("sampler", () => {
  it("returns all conversations when under the limit", () => {
    const convos = [makeConvo({}), makeConvo({}), makeConvo({})];
    const result = sampleConversations(convos, 10);
    expect(result).toHaveLength(3);
  });

  it("limits to maxSample", () => {
    const convos = Array.from({ length: 20 }, () => makeConvo({}));
    const result = sampleConversations(convos, 5);
    expect(result).toHaveLength(5);
  });

  it("prefers recent conversations", () => {
    const old = makeConvo({ title: "Old", createdAt: 1600000000, msgCount: 4 });
    const recent = makeConvo({ title: "Recent", createdAt: 1700000000, msgCount: 4 });
    const veryRecent = makeConvo({ title: "Very Recent", createdAt: 1700500000, msgCount: 4 });

    const result = sampleConversations([old, recent, veryRecent], 2);
    const titles = result.map((c) => c.title);
    expect(titles).toContain("Very Recent");
  });

  it("prefers longer conversations", () => {
    const short = makeConvo({ title: "Short", msgCount: 2, createdAt: 1700000000 });
    const long = makeConvo({ title: "Long", msgCount: 30, createdAt: 1700000000 });

    const result = sampleConversations([short, long], 1);
    expect(result[0]!.title).toBe("Long");
  });

  it("prefers conversations with high user ratio", () => {
    const lowRatio = makeConvo({ title: "Low Ratio", createdAt: 1700000000 });
    lowRatio.messages = [
      { role: "user", content: "Hi", timestamp: 1700000000 },
      { role: "assistant", content: "A".repeat(500), timestamp: 1700000060 },
      { role: "assistant", content: "B".repeat(500), timestamp: 1700000120 },
      { role: "assistant", content: "C".repeat(500), timestamp: 1700000180 },
    ];

    const highRatio = makeConvo({ title: "High Ratio", createdAt: 1700000000 });
    highRatio.messages = [
      { role: "user", content: "X".repeat(200), timestamp: 1700000000 },
      { role: "assistant", content: "Y".repeat(100), timestamp: 1700000060 },
      { role: "user", content: "Z".repeat(200), timestamp: 1700000120 },
      { role: "assistant", content: "W".repeat(100), timestamp: 1700000180 },
    ];

    const result = sampleConversations([lowRatio, highRatio], 1);
    expect(result[0]!.title).toBe("High Ratio");
  });

  it("handles empty array", () => {
    const result = sampleConversations([], 10);
    expect(result).toHaveLength(0);
  });

  it("defaults to 50 max", () => {
    const convos = Array.from({ length: 100 }, () => makeConvo({}));
    const result = sampleConversations(convos);
    expect(result).toHaveLength(50);
  });
});
