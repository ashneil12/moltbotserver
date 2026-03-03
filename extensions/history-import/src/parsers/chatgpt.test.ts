import { describe, it, expect } from "vitest";
import { parseChatGptExport } from "./chatgpt.js";

// -- Synthetic ChatGPT export fixtures --

function makeMessage(role: string, text: string, createTime?: number) {
  const id = `msg-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    message: {
      id,
      author: { role },
      content: { content_type: "text", parts: [text] },
      create_time: createTime ?? null,
      status: "finished_successfully",
    },
    parent: null as string | null,
    children: [] as string[],
  };
}

function makeConversation(
  title: string,
  messages: Array<{ role: string; text: string; time?: number }>,
  opts?: { id?: string; createTime?: number },
) {
  const nodes = messages.map((m, i) => makeMessage(m.role, m.text, m.time ?? 1700000000 + i * 60));
  // Wire up parent/child links (linear chain)
  for (let i = 1; i < nodes.length; i++) {
    nodes[i]!.parent = nodes[i - 1]!.id;
    nodes[i - 1]!.children = [nodes[i]!.id];
  }
  const mapping: Record<string, (typeof nodes)[number]> = {};
  for (const node of nodes) {
    mapping[node.id] = node;
  }
  return {
    id: opts?.id ?? `conv-${Math.random().toString(36).slice(2, 8)}`,
    title,
    mapping,
    create_time: opts?.createTime ?? 1700000000,
  };
}

describe("ChatGPT parser", () => {
  it("parses a basic conversation", () => {
    const data = [
      makeConversation("Hello World", [
        { role: "user", text: "Hi there!" },
        { role: "assistant", text: "Hello! How can I help?" },
        { role: "user", text: "What's 2+2?" },
        { role: "assistant", text: "4" },
      ]),
    ];

    const result = parseChatGptExport(data);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Hello World");
    expect(result[0]!.source).toBe("chatgpt");
    expect(result[0]!.messages).toHaveLength(4);
    expect(result[0]!.messages[0]!.role).toBe("user");
    expect(result[0]!.messages[0]!.content).toBe("Hi there!");
    expect(result[0]!.messages[1]!.role).toBe("assistant");
  });

  it("skips tool messages", () => {
    const data = [
      makeConversation("With Tools", [
        { role: "user", text: "Search for cats" },
        { role: "tool", text: "tool result here" },
        { role: "assistant", text: "Here are some cats!" },
      ]),
    ];

    const result = parseChatGptExport(data);
    expect(result[0]!.messages).toHaveLength(2);
    expect(result[0]!.messages[0]!.role).toBe("user");
    expect(result[0]!.messages[1]!.role).toBe("assistant");
  });

  it("skips empty messages", () => {
    const data = [
      makeConversation("Empty Msg", [
        { role: "user", text: "Hello" },
        { role: "assistant", text: "" },
        { role: "user", text: "Anyone there?" },
      ]),
    ];

    const result = parseChatGptExport(data);
    expect(result[0]!.messages).toHaveLength(2);
  });

  it("handles multi-part content", () => {
    const conv = makeConversation("Multi-part", [{ role: "user", text: "placeholder" }]);
    // Override with multi-part content
    const nodeId = Object.keys(conv.mapping)[0]!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (conv.mapping[nodeId]!.message as any).content = {
      content_type: "text",
      parts: ["First part", { type: "text", text: "Second part" }],
    };

    const result = parseChatGptExport([conv]);
    expect(result[0]!.messages[0]!.content).toBe("First part\nSecond part");
  });

  it("handles multiple conversations", () => {
    const data = [
      makeConversation("Conv 1", [
        { role: "user", text: "Hello" },
        { role: "assistant", text: "Hi" },
      ]),
      makeConversation("Conv 2", [
        { role: "user", text: "Goodbye" },
        { role: "assistant", text: "Bye!" },
      ]),
      makeConversation("Conv 3", [
        { role: "user", text: "Test" },
        { role: "assistant", text: "OK" },
      ]),
    ];

    const result = parseChatGptExport(data);
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.title)).toEqual(["Conv 1", "Conv 2", "Conv 3"]);
  });

  it("skips conversations with no valid messages", () => {
    const conv = makeConversation("Empty", []);
    // Force mapping to have a node with no message
    (conv.mapping as Record<string, unknown>)["orphan"] = {
      id: "orphan",
      message: null,
      parent: null,
      children: [],
    };

    const result = parseChatGptExport([conv]);
    expect(result).toHaveLength(0);
  });

  it("preserves timestamps", () => {
    const data = [
      makeConversation("Timestamps", [
        { role: "user", text: "Hello", time: 1700000100 },
        { role: "assistant", text: "Hi", time: 1700000200 },
      ]),
    ];

    const result = parseChatGptExport(data);
    expect(result[0]!.messages[0]!.timestamp).toBe(1700000100);
    expect(result[0]!.messages[1]!.timestamp).toBe(1700000200);
  });

  it("throws on non-array input", () => {
    expect(() => parseChatGptExport({ not: "an array" })).toThrow("must be a JSON array");
  });
});
