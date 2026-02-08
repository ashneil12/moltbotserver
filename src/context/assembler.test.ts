/**
 * Context Assembler Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  assembleContext,
  mergeAssemblerConfig,
  getAssembledContextString,
} from "./assembler.js";
import { runMemoryManager } from "./memory-manager-agent.js";
import { runHistoryManager } from "./history-manager-agent.js";
import {
  estimateTokenCount,
  formatAssembledContext,
  DEFAULT_ASSEMBLER_CONFIG,
} from "./assembler-types.js";
import type { ContextMessage, ContextAssemblerConfig } from "./assembler-types.js";

describe("assembler-types", () => {
  describe("estimateTokenCount", () => {
    it("estimates ~4 chars per token", () => {
      expect(estimateTokenCount("")).toBe(0);
      expect(estimateTokenCount("test")).toBe(1);
      expect(estimateTokenCount("hello world")).toBe(3); // 11 chars / 4 = 2.75 -> ceil = 3
    });
  });

  describe("formatAssembledContext", () => {
    it("returns empty string when hasContent is false", () => {
      const result = formatAssembledContext({
        memories: null,
        historySummary: null,
        specificMessages: null,
        totalTokens: 0,
        hasContent: false,
        assemblyTimeMs: 0,
        errors: [],
      });
      expect(result).toBe("");
    });

    it("formats memories correctly", () => {
      const result = formatAssembledContext({
        memories: ["Memory 1", "Memory 2"],
        historySummary: null,
        specificMessages: null,
        totalTokens: 10,
        hasContent: true,
        assemblyTimeMs: 100,
        errors: [],
      });
      expect(result).toContain("## Relevant Memories");
      expect(result).toContain("- Memory 1");
      expect(result).toContain("- Memory 2");
    });

    it("formats history summary correctly", () => {
      const result = formatAssembledContext({
        memories: null,
        historySummary: "This is a summary of the conversation.",
        specificMessages: null,
        totalTokens: 10,
        hasContent: true,
        assemblyTimeMs: 100,
        errors: [],
      });
      expect(result).toContain("## Recent Conversation Context");
      expect(result).toContain("This is a summary of the conversation.");
    });

    it("formats specific messages correctly", () => {
      const result = formatAssembledContext({
        memories: null,
        historySummary: null,
        specificMessages: [
          { reference: "2024-01-01 12:00", role: "user", content: "Hello" },
        ],
        totalTokens: 10,
        hasContent: true,
        assemblyTimeMs: 100,
        errors: [],
      });
      expect(result).toContain("## Specific Past Messages");
      expect(result).toContain("[2024-01-01 12:00]");
      expect(result).toContain("user: Hello");
    });
  });
});

describe("mergeAssemblerConfig", () => {
  it("returns defaults when no config provided", () => {
    const config = mergeAssemblerConfig();
    expect(config.enabled).toBe(true);
    expect(config.totalBudget).toBe(4000);
    expect(config.memoryManager.maxTokens).toBe(1500);
    expect(config.historyManager.summaryMaxTokens).toBe(500);
  });

  it("merges partial config with defaults", () => {
    const config = mergeAssemblerConfig({
      enabled: false,
      memoryManager: { enabled: false },
    });
    expect(config.enabled).toBe(false);
    expect(config.memoryManager.enabled).toBe(false);
    expect(config.memoryManager.maxTokens).toBe(1500); // Default preserved
    expect(config.historyManager.enabled).toBe(true); // Default preserved
  });
});

describe("runMemoryManager", () => {
  it("returns null for casual messages", async () => {
    const mockSearch = vi.fn();
    const result = await runMemoryManager(
      {
        currentMessage: "hi",
        recentMessages: [],
        workspaceDir: "/test",
      },
      mockSearch,
    );
    expect(result.memories).toBeNull();
    expect(result.injected).toBe(false);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("searches memory for substantive messages", async () => {
    const mockSearch = vi.fn().mockResolvedValue([
      { path: "memory.md", snippet: "User prefers dark mode", score: 0.8 },
    ]);
    const result = await runMemoryManager(
      {
        currentMessage: "What are my UI preferences?",
        recentMessages: [],
        workspaceDir: "/test",
      },
      mockSearch,
    );
    expect(mockSearch).toHaveBeenCalled();
    expect(result.memories).toEqual(["User prefers dark mode"]);
    expect(result.injected).toBe(true);
  });

  it("returns null when no results found", async () => {
    const mockSearch = vi.fn().mockResolvedValue([]);
    const result = await runMemoryManager(
      {
        currentMessage: "What are my preferences?",
        recentMessages: [],
        workspaceDir: "/test",
      },
      mockSearch,
    );
    expect(result.memories).toBeNull();
    expect(result.injected).toBe(false);
  });

  it("handles search errors gracefully", async () => {
    const mockSearch = vi.fn().mockRejectedValue(new Error("Search failed"));
    const result = await runMemoryManager(
      {
        currentMessage: "What are my preferences?",
        recentMessages: [],
        workspaceDir: "/test",
      },
      mockSearch,
    );
    expect(result.memories).toBeNull();
    expect(result.injected).toBe(false);
  });
});

describe("runHistoryManager", () => {
  it("returns null for casual messages", async () => {
    const result = await runHistoryManager({
      currentMessage: "thanks!",
      recentMessages: [],
      historyFilePath: "/nonexistent/path",
      workspaceDir: "/test",
    });
    expect(result.summary).toBeNull();
    expect(result.specificMessages).toBeNull();
    expect(result.injected).toBe(false);
  });

  it("handles missing history file gracefully", async () => {
    const result = await runHistoryManager({
      currentMessage: "What did we discuss earlier?",
      recentMessages: [],
      historyFilePath: "/nonexistent/path",
      workspaceDir: "/test",
    });
    expect(result.summary).toBeNull();
    expect(result.injected).toBe(false);
  });
});

describe("assembleContext", () => {
  const baseConfig: ContextAssemblerConfig = {
    ...DEFAULT_ASSEMBLER_CONFIG,
    enabled: true,
  };

  it("returns empty context when disabled", async () => {
    const result = await assembleContext(
      {
        currentMessage: "test",
        recentMessages: [],
        workspaceDir: "/test",
        historyFilePath: "/test/history.md",
        config: { ...baseConfig, enabled: false },
      },
      undefined,
    );
    expect(result.hasContent).toBe(false);
  });

  it("runs both managers in parallel", async () => {
    const mockSearch = vi.fn().mockResolvedValue([
      { path: "memory.md", snippet: "Test memory", score: 0.8 },
    ]);

    const result = await assembleContext(
      {
        currentMessage: "What do you know about my preferences?",
        recentMessages: [],
        workspaceDir: "/test",
        historyFilePath: "/nonexistent/path",
        config: baseConfig,
      },
      mockSearch,
    );

    // Memory manager should have been called
    expect(mockSearch).toHaveBeenCalled();
    // Should have memory result
    expect(result.memories).toEqual(["Test memory"]);
  });

  it("tracks assembly time", async () => {
    const result = await assembleContext(
      {
        currentMessage: "test",
        recentMessages: [],
        workspaceDir: "/test",
        historyFilePath: "/nonexistent/path",
        config: baseConfig,
      },
      undefined,
    );
    expect(result.assemblyTimeMs).toBeGreaterThanOrEqual(0);
  });
});
