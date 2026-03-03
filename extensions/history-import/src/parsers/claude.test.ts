import { describe, it, expect } from "vitest";
import { parseClaudeExport } from "./claude.js";

// -- Synthetic Claude export fixtures --

function makeClaudeConversation(
  name: string,
  messages: Array<{ sender: string; text: string; createdAt?: string }>,
  opts?: { uuid?: string; createdAt?: string },
) {
  return {
    uuid: opts?.uuid ?? `uuid-${Math.random().toString(36).slice(2, 8)}`,
    name,
    created_at: opts?.createdAt ?? "2025-01-15T10:30:00Z",
    chat_messages: messages.map((m, i) => ({
      uuid: `msg-${i}-${Math.random().toString(36).slice(2, 8)}`,
      sender: m.sender,
      text: m.text,
      created_at: m.createdAt ?? `2025-01-15T10:${30 + i}:00Z`,
    })),
  };
}

describe("Claude parser", () => {
  it("parses a basic conversation", () => {
    const data = [
      makeClaudeConversation("Coding Help", [
        { sender: "human", text: "Help me with Python" },
        { sender: "assistant", text: "Sure! What do you need?" },
        { sender: "human", text: "How do I read a CSV?" },
        { sender: "assistant", text: "Use pandas: pd.read_csv('file.csv')" },
      ]),
    ];

    const result = parseClaudeExport(data);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Coding Help");
    expect(result[0]!.source).toBe("claude");
    expect(result[0]!.messages).toHaveLength(4);
    expect(result[0]!.messages[0]!.role).toBe("user");
    expect(result[0]!.messages[0]!.content).toBe("Help me with Python");
    expect(result[0]!.messages[1]!.role).toBe("assistant");
  });

  it("handles 'user' sender (alternate format)", () => {
    const data = [
      makeClaudeConversation("Alt Format", [
        { sender: "user", text: "Hello" },
        { sender: "assistant", text: "Hi!" },
      ]),
    ];

    const result = parseClaudeExport(data);
    expect(result[0]!.messages[0]!.role).toBe("user");
  });

  it("skips messages with unknown senders", () => {
    const conv = makeClaudeConversation("Unknown", [
      { sender: "human", text: "Hello" },
      { sender: "tool_use", text: "some tool output" },
      { sender: "assistant", text: "Here's the result" },
    ]);

    const result = parseClaudeExport([conv]);
    expect(result[0]!.messages).toHaveLength(2);
  });

  it("handles empty messages gracefully", () => {
    const conv = makeClaudeConversation("Empties", [
      { sender: "human", text: "Hello" },
      { sender: "assistant", text: "" },
      { sender: "human", text: "Still here?" },
    ]);

    const result = parseClaudeExport([conv]);
    expect(result[0]!.messages).toHaveLength(2);
  });

  it("parses multiple conversations", () => {
    const data = [
      makeClaudeConversation("Topic A", [
        { sender: "human", text: "A question" },
        { sender: "assistant", text: "An answer" },
      ]),
      makeClaudeConversation("Topic B", [
        { sender: "human", text: "B question" },
        { sender: "assistant", text: "B answer" },
      ]),
    ];

    const result = parseClaudeExport(data);
    expect(result).toHaveLength(2);
    expect(result[0]!.title).toBe("Topic A");
    expect(result[1]!.title).toBe("Topic B");
  });

  it("handles a single conversation object (not array)", () => {
    const conv = makeClaudeConversation("Solo", [
      { sender: "human", text: "Just one" },
      { sender: "assistant", text: "Got it" },
    ]);

    const result = parseClaudeExport(conv);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Solo");
  });

  it("parses timestamps from ISO strings", () => {
    const data = [
      makeClaudeConversation("Timed", [
        { sender: "human", text: "Hello", createdAt: "2025-06-15T14:30:00Z" },
        { sender: "assistant", text: "Hi", createdAt: "2025-06-15T14:31:00Z" },
      ]),
    ];

    const result = parseClaudeExport(data);
    const ts = result[0]!.messages[0]!.timestamp!;
    // Should be epoch seconds for 2025-06-15T14:30:00Z
    expect(ts).toBeCloseTo(new Date("2025-06-15T14:30:00Z").getTime() / 1000, 0);
  });

  it("skips conversations with no valid messages", () => {
    const conv = {
      uuid: "empty-conv",
      name: "Empty",
      chat_messages: [],
      created_at: "2025-01-01T00:00:00Z",
    };

    const result = parseClaudeExport([conv]);
    expect(result).toHaveLength(0);
  });

  it("throws on invalid input shape", () => {
    expect(() => parseClaudeExport("invalid" as unknown)).toThrow();
  });
});
