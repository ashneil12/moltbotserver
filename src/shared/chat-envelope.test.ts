import { describe, it, expect } from "vitest";
import { stripEnvelope, stripMessageIdHints, stripUntrustedMetaBlocks } from "./chat-envelope.js";

describe("stripEnvelope", () => {
  it("strips a channel timestamp envelope header", () => {
    expect(stripEnvelope("[WebChat 2024-01-01T00:00Z] hello")).toBe("hello");
  });

  it("returns text unchanged when no envelope header", () => {
    expect(stripEnvelope("hello world")).toBe("hello world");
  });

  it("strips injected agent timestamp (DOW YYYY-MM-DD HH:MM TZ format)", () => {
    expect(stripEnvelope("[Thu 2026-02-19 11:29 UTC] hi")).toBe("hi");
  });

  it("strips injected agent timestamp with non-UTC timezone", () => {
    expect(stripEnvelope("[Mon 2026-01-15 14:30 EST] hello there")).toBe("hello there");
  });
});

describe("stripMessageIdHints", () => {
  it("removes [message_id: ...] lines", () => {
    expect(stripMessageIdHints("[message_id: abc-123]\nhello")).toBe("hello");
  });

  it("returns text unchanged without message_id lines", () => {
    expect(stripMessageIdHints("nothing to strip")).toBe("nothing to strip");
  });
});

describe("stripUntrustedMetaBlocks", () => {
  it("strips a Conversation info (untrusted metadata) block", () => {
    const input = [
      "Conversation info (untrusted metadata):",
      "```json",
      JSON.stringify({ message_id: "abc", sender: "openclaw-control-ui" }, null, 2),
      "```",
      "",
      "hello world",
    ].join("\n");
    expect(stripUntrustedMetaBlocks(input)).toBe("hello world");
  });

  it("strips a Sender (untrusted metadata) block", () => {
    const input = [
      "Sender (untrusted metadata):",
      "```json",
      JSON.stringify({ label: "Alice", name: "Alice" }, null, 2),
      "```",
      "",
      "what's up",
    ].join("\n");
    expect(stripUntrustedMetaBlocks(input)).toBe("what's up");
  });

  it("strips Forwarded message context (untrusted metadata) block", () => {
    const input = [
      "Forwarded message context (untrusted metadata):",
      "```json",
      JSON.stringify({ from: "someone" }, null, 2),
      "```",
      "",
      "forwarded text",
    ].join("\n");
    expect(stripUntrustedMetaBlocks(input)).toBe("forwarded text");
  });

  it("strips Replied message (untrusted, for context) block", () => {
    const input = [
      "Replied message (untrusted, for context):",
      "```json",
      JSON.stringify({ body: "original" }, null, 2),
      "```",
      "",
      "my reply",
    ].join("\n");
    expect(stripUntrustedMetaBlocks(input)).toBe("my reply");
  });

  it("strips Chat history (untrusted, for context) block", () => {
    const input = [
      "Chat history since last reply (untrusted, for context):",
      "```json",
      JSON.stringify([{ sender: "bob", body: "hi" }], null, 2),
      "```",
      "",
      "actual message",
    ].join("\n");
    expect(stripUntrustedMetaBlocks(input)).toBe("actual message");
  });

  it("strips Thread starter (untrusted, for context) block", () => {
    const input = [
      "Thread starter (untrusted, for context):",
      "```json",
      JSON.stringify({ body: "thread start" }, null, 2),
      "```",
      "",
      "reply in thread",
    ].join("\n");
    expect(stripUntrustedMetaBlocks(input)).toBe("reply in thread");
  });

  it("strips multiple consecutive metadata blocks", () => {
    const input = [
      "Conversation info (untrusted metadata):",
      "```json",
      JSON.stringify({ message_id: "abc" }, null, 2),
      "```",
      "",
      "Sender (untrusted metadata):",
      "```json",
      JSON.stringify({ label: "Alice" }, null, 2),
      "```",
      "",
      "hello from alice",
    ].join("\n");
    expect(stripUntrustedMetaBlocks(input)).toBe("hello from alice");
  });

  it("returns text unchanged when no metadata blocks present", () => {
    expect(stripUntrustedMetaBlocks("just a normal message")).toBe("just a normal message");
  });

  it("preserves text around stripped blocks", () => {
    const input = [
      "prefix text",
      "",
      "Conversation info (untrusted metadata):",
      "```json",
      "{}",
      "```",
      "",
      "suffix text",
    ].join("\n");
    // The prefix won't match the pattern (starts at line boundary) so the regex
    // only strips the block itself, leaving both prefix and suffix.
    const result = stripUntrustedMetaBlocks(input);
    expect(result).toContain("prefix text");
    expect(result).toContain("suffix text");
    expect(result).not.toContain("untrusted metadata");
  });
});
