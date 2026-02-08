/**
 * Memory Maker Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MemoryBatchMessage, ExtractedMemory } from "./memory-maker-types.js";
import {
  estimateTokens,
  formatMemoriesForFile,
  getMemoryFilePath,
  createMemoryFileHeader,
} from "./memory-maker-types.js";
import {
  parseMemoryOutput,
  deduplicateMemories,
  runMemoryMaker,
} from "./memory-maker-agent.js";

describe("memory-maker-types", () => {
  describe("estimateTokens", () => {
    it("estimates ~4 chars per token", () => {
      expect(estimateTokens("hello world")).toBe(3); // 11 chars / 4 = 2.75 -> 3
    });

    it("returns 0 for empty string", () => {
      expect(estimateTokens("")).toBe(0);
    });
  });

  describe("formatMemoriesForFile", () => {
    it("formats memories with timestamp and tags", () => {
      const memories: ExtractedMemory[] = [
        { content: "User prefers dark mode", tags: ["preferences", "ui"] },
        { content: "Working on MoltBot", tags: ["projects"] },
      ];

      const date = new Date("2026-02-07T16:30:00Z");
      const result = formatMemoriesForFile(memories, date);

      expect(result).toContain("## 16:30:00");
      expect(result).toContain("- User prefers dark mode #preferences #ui");
      expect(result).toContain("- Working on MoltBot #projects");
    });
  });

  describe("getMemoryFilePath", () => {
    it("returns path with date", () => {
      const date = new Date("2026-02-07T12:00:00Z");
      const result = getMemoryFilePath("/workspace", date);
      expect(result).toBe("/workspace/memory/2026-02-07.md");
    });
  });

  describe("createMemoryFileHeader", () => {
    it("creates header with date", () => {
      const date = new Date("2026-02-07T12:00:00Z");
      const result = createMemoryFileHeader(date);
      expect(result).toBe("# Memories - 2026-02-07\n");
    });
  });
});

describe("parseMemoryOutput", () => {
  it("parses memories with markers", () => {
    const output = `Here are the memories:

---NEW_MEMORIES---
- User prefers concise responses #preferences #communication
- Working on context management #projects #current
---END---

Done.`;

    const result = parseMemoryOutput(output);
    expect(result).toHaveLength(2);
    expect(result![0].content).toBe("User prefers concise responses");
    expect(result![0].tags).toEqual(["preferences", "communication"]);
    expect(result![1].content).toBe("Working on context management");
    expect(result![1].tags).toEqual(["projects", "current"]);
  });

  it("returns null for N/A", () => {
    const output = `---NEW_MEMORIES---
N/A
---END---`;

    const result = parseMemoryOutput(output);
    expect(result).toBeNull();
  });

  it("handles memories without tags", () => {
    const output = `---NEW_MEMORIES---
- User's daughter is named Emma
---END---`;

    const result = parseMemoryOutput(output);
    expect(result).toHaveLength(1);
    expect(result![0].content).toBe("User's daughter is named Emma");
    expect(result![0].tags).toEqual([]);
  });

  it("falls back to loose parsing if no markers found", () => {
    const output = `Here are some memories:
- User prefers TypeScript over JavaScript #preferences
- Uses VSCode as editor #tools`;

    const result = parseMemoryOutput(output);
    expect(result).toHaveLength(2);
  });
});

describe("deduplicateMemories", () => {
  it("removes exact duplicates from existing", () => {
    const memories: ExtractedMemory[] = [
      { content: "User prefers dark mode", tags: ["preferences"] },
      { content: "New fact", tags: ["new"] },
    ];
    const existing = ["User prefers dark mode #preferences"];

    const result = deduplicateMemories(memories, existing);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("New fact");
  });

  it("removes semantic duplicates", () => {
    const memories: ExtractedMemory[] = [
      { content: "User prefers dark mode for the interface", tags: ["preferences"] },
    ];
    const existing = ["User prefers dark mode for the interface #preferences #ui"];

    const result = deduplicateMemories(memories, existing);
    expect(result).toHaveLength(0);
  });

  it("keeps unique memories", () => {
    const memories: ExtractedMemory[] = [
      { content: "Python is the preferred language", tags: ["preferences"] },
    ];
    const existing = ["User prefers dark mode #preferences"];

    const result = deduplicateMemories(memories, existing);
    expect(result).toHaveLength(1);
  });
});

describe("runMemoryMaker", () => {
  const mockLLMCall = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns empty for too few messages", async () => {
    const result = await runMemoryMaker(
      {
        messageBatch: [{ role: "user", content: "hi" }],
        existingMemories: [],
      },
      mockLLMCall,
    );

    expect(result.hasMemories).toBe(false);
    expect(mockLLMCall).not.toHaveBeenCalled();
  });

  it("returns empty for mostly casual messages", async () => {
    const batch: MemoryBatchMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "thanks" },
      { role: "assistant", content: "You're welcome!" },
    ];

    const result = await runMemoryMaker(
      { messageBatch: batch, existingMemories: [] },
      mockLLMCall,
    );

    expect(result.hasMemories).toBe(false);
    expect(mockLLMCall).not.toHaveBeenCalled();
  });

  it("extracts memories from substantive messages", async () => {
    const batch: MemoryBatchMessage[] = [
      { role: "user", content: "I prefer to use TypeScript over JavaScript" },
      { role: "assistant", content: "Good choice! TypeScript provides type safety." },
      { role: "user", content: "Yes, and I always use strict mode" },
      { role: "assistant", content: "That's a best practice for catching errors early." },
    ];

    mockLLMCall.mockResolvedValueOnce(`---NEW_MEMORIES---
- User prefers TypeScript over JavaScript #preferences #languages
- User always uses strict mode in TypeScript #preferences #coding
---END---`);

    const result = await runMemoryMaker(
      { messageBatch: batch, existingMemories: [] },
      mockLLMCall,
    );

    expect(result.hasMemories).toBe(true);
    expect(result.memories).toHaveLength(2);
    expect(mockLLMCall).toHaveBeenCalledOnce();
  });

  it("deduplicates against existing memories", async () => {
    const batch: MemoryBatchMessage[] = [
      { role: "user", content: "I prefer TypeScript" },
      { role: "assistant", content: "Great choice!" },
      { role: "user", content: "I also like dark mode" },
      { role: "assistant", content: "Dark mode is easier on the eyes." },
    ];

    mockLLMCall.mockResolvedValueOnce(`---NEW_MEMORIES---
- User prefers TypeScript #preferences
- User likes dark mode #preferences #ui
---END---`);

    const result = await runMemoryMaker(
      { messageBatch: batch, existingMemories: ["User prefers TypeScript #preferences"] },
      mockLLMCall,
    );

    expect(result.hasMemories).toBe(true);
    expect(result.memories).toHaveLength(1);
    expect(result.memories![0].content).toBe("User likes dark mode");
  });

  it("handles LLM errors gracefully", async () => {
    const batch: MemoryBatchMessage[] = [
      { role: "user", content: "Some substantive content here for testing" },
      { role: "assistant", content: "Response with useful information" },
      { role: "user", content: "More content to analyze" },
      { role: "assistant", content: "Additional response" },
    ];

    mockLLMCall.mockRejectedValueOnce(new Error("LLM unavailable"));

    const result = await runMemoryMaker(
      { messageBatch: batch, existingMemories: [] },
      mockLLMCall,
    );

    expect(result.hasMemories).toBe(false);
    expect(result.error).toBe("LLM unavailable");
  });

  it("returns null when LLM returns N/A", async () => {
    const batch: MemoryBatchMessage[] = [
      { role: "user", content: "Can you help me understand this code?" },
      { role: "assistant", content: "Sure, let me explain." },
      { role: "user", content: "What does this function do?" },
      { role: "assistant", content: "It processes the input and returns a result." },
    ];

    mockLLMCall.mockResolvedValueOnce(`---NEW_MEMORIES---
N/A
---END---`);

    const result = await runMemoryMaker(
      { messageBatch: batch, existingMemories: [] },
      mockLLMCall,
    );

    expect(result.hasMemories).toBe(false);
    expect(result.memories).toBeNull();
  });
});
