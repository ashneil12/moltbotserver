/**
 * Tests for recall-message-tool.ts
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createRecallMessageTool, type RecallResult } from "./recall-message-tool.js";
import fs from "node:fs/promises";
import path from "node:path";

// Mock fs module
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
  },
}));

// Mock child_process spawn
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event, cb) => {
      if (event === "error") {
        // Simulate QMD not found
        cb(new Error("ENOENT"));
      }
    }),
  })),
}));

describe("recall-message-tool", () => {
  const mockWorkspaceDir = "/test/workspace";
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createRecallMessageTool", () => {
    it("creates a tool with correct metadata", () => {
      const tool = createRecallMessageTool({ workspaceDir: mockWorkspaceDir });
      
      expect(tool.name).toBe("recall_message");
      expect(tool.label).toBe("Recall Message");
      expect(tool.description).toContain("conversation archive");
    });

    it("has query as required parameter", () => {
      const tool = createRecallMessageTool();
      
      expect(tool.parameters.properties).toHaveProperty("query");
      expect(tool.parameters.properties).toHaveProperty("timeframe");
      expect(tool.parameters.properties).toHaveProperty("limit");
    });
  });

  describe("execute", () => {
    it("returns empty results when no matches found", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));

      const tool = createRecallMessageTool({ workspaceDir: mockWorkspaceDir });
      const result = await tool.execute("test-id", { query: "nonexistent topic" });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.content[0]).toHaveProperty("type", "text");
      
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.found).toBe(0);
      expect(parsed.results).toEqual([]);
    });

    it("searches conversation files for matching content", async () => {
      const mockHistory = `# Conversation History

## 2026-01-15 14:30:00 - user
I want to discuss the API design for our project.

## 2026-01-15 14:35:00 - assistant
Let's start with the REST endpoints.

---`;
      
      vi.mocked(fs.readFile).mockImplementation(async (filepath) => {
        const pathStr = String(filepath);
        if (pathStr.includes("conversation_history.md")) {
          return mockHistory;
        }
        throw new Error("File not found");
      });

      const tool = createRecallMessageTool({ workspaceDir: mockWorkspaceDir });
      const result = await tool.execute("test-id", { query: "API design" });

      expect(result).toBeDefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.found).toBeGreaterThan(0);
    });

    it("respects limit parameter", async () => {
      const tool = createRecallMessageTool({ workspaceDir: mockWorkspaceDir });
      const result = await tool.execute("test-id", { query: "test", limit: 3 });

      expect(result).toBeDefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.results.length).toBeLessThanOrEqual(3);
    });

    it("includes query and timeframe in response", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));

      const tool = createRecallMessageTool({ workspaceDir: mockWorkspaceDir });
      const result = await tool.execute("test-id", { 
        query: "test query", 
        timeframe: "last week" 
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.query).toBe("test query");
      expect(parsed.timeframe).toBe("last week");
    });

    it("handles timeframe filtering", async () => {
      const mockHistory = `# Conversation History

## 2026-02-01 10:00:00 - user
Recent discussion about API.

## 2025-12-01 10:00:00 - user
Old discussion about API design.

---`;
      
      vi.mocked(fs.readFile).mockImplementation(async (filepath) => {
        const pathStr = String(filepath);
        if (pathStr.includes("conversation_history.md")) {
          return mockHistory;
        }
        throw new Error("File not found");
      });

      const tool = createRecallMessageTool({ workspaceDir: mockWorkspaceDir });
      const result = await tool.execute("test-id", { 
        query: "API",
        timeframe: "last month"
      });

      expect(result).toBeDefined();
    });
  });

  describe("timeframe parsing", () => {
    it("handles 'today' timeframe", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));

      const tool = createRecallMessageTool({ workspaceDir: mockWorkspaceDir });
      const result = await tool.execute("test-id", { 
        query: "test",
        timeframe: "today"
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.timeframe).toBe("today");
    });

    it("handles 'yesterday' timeframe", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));

      const tool = createRecallMessageTool({ workspaceDir: mockWorkspaceDir });
      const result = await tool.execute("test-id", { 
        query: "test",
        timeframe: "yesterday"
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.timeframe).toBe("yesterday");
    });

    it("handles month names", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));

      const tool = createRecallMessageTool({ workspaceDir: mockWorkspaceDir });
      const result = await tool.execute("test-id", { 
        query: "test",
        timeframe: "January"
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.timeframe).toBe("January");
    });

    it("handles relative timeframes like '2 weeks ago'", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));

      const tool = createRecallMessageTool({ workspaceDir: mockWorkspaceDir });
      const result = await tool.execute("test-id", { 
        query: "test",
        timeframe: "2 weeks ago"
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.timeframe).toBe("2 weeks ago");
    });
  });
});
