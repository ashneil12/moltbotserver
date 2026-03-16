/**
 * Noise-patterns tests.
 *
 * Tests the shared noise-filtering primitives used by both the trajectory
 * compressor and the session-context extractor. These ensure that system-
 * injected lines (metadata, heartbeats, cron prompts, UI control payloads)
 * are properly stripped from user transcripts so only real human messages
 * survive into session context.
 *
 * This is a custom MoltBot addition — upstream has no equivalent filtering.
 */
import { describe, expect, it } from "vitest";
import {
  CRON_PROMPT_PATTERNS,
  MEANINGFUL_CONTENT_MIN_CHARS,
  NOISE_LINE_PATTERNS,
  cleanUserContent,
  isCronPromptMessage,
  isMeaningfulUserContent,
} from "./noise-patterns.js";

// ── NOISE_LINE_PATTERNS ─────────────────────────────────────────────────────

describe("NOISE_LINE_PATTERNS", () => {
  it("matches sender metadata lines", () => {
    expect(NOISE_LINE_PATTERNS.some((p) => p.test("Sender (untrusted metadata):"))).toBe(true);
    expect(NOISE_LINE_PATTERNS.some((p) => p.test("Sender (untrusted metadata)"))).toBe(true);
    // Leading whitespace: patterns use ^ anchor, so direct match fails —
    // but cleanUserContent trims lines before testing, which is the intended usage.
    expect(cleanUserContent("  Sender (untrusted metadata):  ")).toBe("");
  });

  it("matches [SYSTEM: ...] lines", () => {
    expect(NOISE_LINE_PATTERNS.some((p) => p.test("[SYSTEM: bootstrap]"))).toBe(true);
    expect(NOISE_LINE_PATTERNS.some((p) => p.test("  [SYSTEM: restarted]"))).toBe(true);
  });

  it("matches HEARTBEAT_OK", () => {
    expect(NOISE_LINE_PATTERNS.some((p) => p.test("HEARTBEAT_OK"))).toBe(true);
    expect(NOISE_LINE_PATTERNS.some((p) => p.test("  HEARTBEAT_OK  "))).toBe(true);
  });

  it("matches bare HEARTBEAT", () => {
    expect(NOISE_LINE_PATTERNS.some((p) => p.test("HEARTBEAT"))).toBe(true);
  });

  it("matches JSON control UI blobs", () => {
    expect(NOISE_LINE_PATTERNS.some((p) => p.test('{"label":"boot","ts":1234}'))).toBe(true);
    expect(
      NOISE_LINE_PATTERNS.some((p) => p.test('{"openclaw-control-ui": true, "action": "reload"}')),
    ).toBe(true);
  });

  it("does NOT match real user messages", () => {
    expect(NOISE_LINE_PATTERNS.some((p) => p.test("hey can you help me?"))).toBe(false);
    expect(NOISE_LINE_PATTERNS.some((p) => p.test("What is the heartbeat interval?"))).toBe(false);
    expect(NOISE_LINE_PATTERNS.some((p) => p.test("Please check the system status"))).toBe(false);
  });
});

// ── cleanUserContent ────────────────────────────────────────────────────────

describe("cleanUserContent", () => {
  it("strips noise lines and keeps real content", () => {
    const input = [
      "Sender (untrusted metadata):",
      "Hello, how are you?",
      "HEARTBEAT_OK",
      "I need help with my project",
    ].join("\n");
    expect(cleanUserContent(input)).toBe("Hello, how are you?\nI need help with my project");
  });

  it("returns empty string when entire message is noise", () => {
    const input = ["Sender (untrusted metadata):", "HEARTBEAT_OK", "HEARTBEAT"].join("\n");
    expect(cleanUserContent(input)).toBe("");
  });

  it("handles empty input", () => {
    expect(cleanUserContent("")).toBe("");
  });

  it("handles whitespace-only input", () => {
    expect(cleanUserContent("  \n  \n  ")).toBe("");
  });

  it("preserves multi-line user content", () => {
    const input = "First line\nSecond line\nThird line";
    expect(cleanUserContent(input)).toBe("First line\nSecond line\nThird line");
  });

  it("strips [SYSTEM:] injections but keeps surrounding content", () => {
    const input =
      "[SYSTEM: session resumed]\nHey, I wanted to continue our conversation\n[SYSTEM: ready]";
    expect(cleanUserContent(input)).toBe("Hey, I wanted to continue our conversation");
  });

  it("strips JSON metadata payloads", () => {
    const input = '{"label":"control","ts":12345}\nActual user message here';
    expect(cleanUserContent(input)).toBe("Actual user message here");
  });
});

// ── CRON_PROMPT_PATTERNS ────────────────────────────────────────────────────

describe("CRON_PROMPT_PATTERNS", () => {
  const cronMessages = [
    "Pre-reset memory flush — saving context before session reset",
    "WORKSPACE MAINTENANCE — clean up stale files",
    "SELF-REVIEW — reflect on recent conversations",
    "You are in background consciousness mode for maintenance",
    "DEEP REVIEW — comprehensive analysis of recent decisions",
    "MORNING BRIEFING — daily standup summary",
    "NIGHTLY INNOVATION — explore new approaches",
    "WEEKLY STRATEGIC SELF-AUDIT — evaluate performance",
    "DIARY CONTINUITY — maintain narrative thread",
    "BROWSER TAB CLEANUP — close idle tabs",
    "WORKSPACE DOC CONVERTER — process new documents",
    "MEMORY EXTRACTION — extract facts from conversations",
    "SYSTEM TASK — scheduled maintenance",
    "SKILL EVOLUTION — generate skills from failures",
    "SECURITY AUDIT — scan for vulnerabilities",
    "Run `openclaw update` to update to latest version",
    "Run openclaw backup to create a backup",
  ];

  for (const msg of cronMessages) {
    it(`matches cron prompt: "${msg.slice(0, 50)}..."`, () => {
      expect(CRON_PROMPT_PATTERNS.some((p) => p.test(msg))).toBe(true);
    });
  }

  it("does NOT match real user messages", () => {
    expect(CRON_PROMPT_PATTERNS.some((p) => p.test("Can you review my code?"))).toBe(false);
    expect(CRON_PROMPT_PATTERNS.some((p) => p.test("What's the morning briefing?"))).toBe(false);
    expect(CRON_PROMPT_PATTERNS.some((p) => p.test("I want to do a deep review of this PR"))).toBe(
      false,
    );
  });
});

// ── isCronPromptMessage ─────────────────────────────────────────────────────

describe("isCronPromptMessage", () => {
  it("returns true for cron prompt with leading blank lines", () => {
    expect(isCronPromptMessage("\n\n  SELF-REVIEW — check recent work")).toBe(true);
  });

  it("returns true for multi-line cron prompt (checks first non-empty line)", () => {
    const msg = "MORNING BRIEFING — daily summary\n\nHere are the highlights:\n- Item 1\n- Item 2";
    expect(isCronPromptMessage(msg)).toBe(true);
  });

  it("returns false for user message", () => {
    expect(isCronPromptMessage("hey, can you help me with something?")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isCronPromptMessage("")).toBe(false);
  });
});

// ── isMeaningfulUserContent ─────────────────────────────────────────────────

describe("isMeaningfulUserContent", () => {
  it("returns true for real user message", () => {
    expect(isMeaningfulUserContent("Can you help me fix this bug?")).toBe(true);
  });

  it("returns false for short noise residue", () => {
    // Less than MEANINGFUL_CONTENT_MIN_CHARS
    expect(isMeaningfulUserContent("hi")).toBe(false);
    expect(isMeaningfulUserContent("ok")).toBe(false);
  });

  it("returns false for cron prompt even if long enough", () => {
    expect(isMeaningfulUserContent("SELF-REVIEW — check recent work quality")).toBe(false);
  });

  it("returns true for content at exactly the minimum length", () => {
    const exact = "a".repeat(MEANINGFUL_CONTENT_MIN_CHARS);
    expect(isMeaningfulUserContent(exact)).toBe(true);
  });

  it("returns false for whitespace-only content", () => {
    expect(isMeaningfulUserContent("   ")).toBe(false);
  });

  it("returns false for content just under the minimum length", () => {
    const short = "a".repeat(MEANINGFUL_CONTENT_MIN_CHARS - 1);
    expect(isMeaningfulUserContent(short)).toBe(false);
  });
});
