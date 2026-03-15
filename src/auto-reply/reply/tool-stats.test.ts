import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolStatsIndex } from "./tool-stats.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-stats-test-"));
  ToolStatsIndex.clearCache();
});

afterEach(() => {
  ToolStatsIndex.closeAll();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Best effort
  }
});

describe("ToolStatsIndex", () => {
  it("opens and initializes a new index", () => {
    const index = ToolStatsIndex.open(tmpDir);
    expect(index).not.toBeNull();

    // Verify DB file exists (tool-stats shares sessions.db with SessionSearchIndex)
    const dbPath = path.join(tmpDir, "memory", "sessions.db");
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("returns cached instance for same workspace", () => {
    const index1 = ToolStatsIndex.open(tmpDir);
    const index2 = ToolStatsIndex.open(tmpDir);
    expect(index1).toBe(index2);
  });

  it("records a single tool call", () => {
    const index = ToolStatsIndex.open(tmpDir)!;

    index.recordToolCall({
      toolName: "web_search",
      agentId: "agent-1",
      durationMs: 150,
      success: true,
    });

    const stats = index.getToolStats("agent-1");
    expect(stats).toHaveLength(1);
    expect(stats[0].toolName).toBe("web_search");
    expect(stats[0].callCount).toBe(1);
    expect(stats[0].successCount).toBe(1);
    expect(stats[0].failCount).toBe(0);
    expect(stats[0].totalDurationMs).toBe(150);
    expect(stats[0].successRate).toBe(100);
    expect(stats[0].avgDurationMs).toBe(150);
  });

  it("records failed tool calls", () => {
    const index = ToolStatsIndex.open(tmpDir)!;

    index.recordToolCall({
      toolName: "file_read",
      agentId: "agent-1",
      durationMs: 50,
      success: false,
    });

    const stats = index.getToolStats("agent-1");
    expect(stats[0].failCount).toBe(1);
    expect(stats[0].successCount).toBe(0);
    expect(stats[0].successRate).toBe(0);
  });

  it("accumulates calls via upsert", () => {
    const index = ToolStatsIndex.open(tmpDir)!;

    index.recordToolCall({
      toolName: "web_search",
      agentId: "agent-1",
      durationMs: 100,
      success: true,
    });
    index.recordToolCall({
      toolName: "web_search",
      agentId: "agent-1",
      durationMs: 200,
      success: true,
    });
    index.recordToolCall({
      toolName: "web_search",
      agentId: "agent-1",
      durationMs: 300,
      success: false,
    });

    const stats = index.getToolStats("agent-1");
    expect(stats).toHaveLength(1);
    expect(stats[0].callCount).toBe(3);
    expect(stats[0].successCount).toBe(2);
    expect(stats[0].failCount).toBe(1);
    expect(stats[0].totalDurationMs).toBe(600);
    expect(stats[0].avgDurationMs).toBe(200);
    expect(stats[0].successRate).toBeCloseTo(66.67, 0);
  });

  it("records batch of tool calls", () => {
    const index = ToolStatsIndex.open(tmpDir)!;

    index.recordToolCalls("agent-1", [
      { toolName: "web_search", durationMs: 100, success: true },
      { toolName: "file_read", durationMs: 50, success: true },
      { toolName: "web_search", durationMs: 200, success: false },
    ]);

    const stats = index.getToolStats("agent-1");
    expect(stats).toHaveLength(2);
  });

  it("getTopTools respects limit", () => {
    const index = ToolStatsIndex.open(tmpDir)!;

    // Record 5 different tools
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j <= i; j++) {
        index.recordToolCall({
          toolName: `tool_${i}`,
          agentId: "agent-1",
          durationMs: 100,
          success: true,
        });
      }
    }

    const top2 = index.getTopTools("agent-1", 2);
    expect(top2).toHaveLength(2);
    // Most used should be first
    expect(top2[0].toolName).toBe("tool_4");
    expect(top2[1].toolName).toBe("tool_3");
  });

  it("getToolStats returns empty for unknown agent", () => {
    const index = ToolStatsIndex.open(tmpDir)!;
    const stats = index.getToolStats("nonexistent");
    expect(stats).toEqual([]);
  });

  it("isolates stats by agentId", () => {
    const index = ToolStatsIndex.open(tmpDir)!;

    index.recordToolCall({
      toolName: "web_search",
      agentId: "agent-1",
      durationMs: 100,
      success: true,
    });
    index.recordToolCall({
      toolName: "web_search",
      agentId: "agent-2",
      durationMs: 200,
      success: true,
    });

    const stats1 = index.getToolStats("agent-1");
    const stats2 = index.getToolStats("agent-2");
    expect(stats1).toHaveLength(1);
    expect(stats2).toHaveLength(1);
    expect(stats1[0].totalDurationMs).toBe(100);
    expect(stats2[0].totalDurationMs).toBe(200);
  });

  it("closeAll cleans up all cached instances", () => {
    ToolStatsIndex.open(tmpDir);
    ToolStatsIndex.closeAll();
    // After closeAll, opening again should create a fresh instance
    const fresh = ToolStatsIndex.open(tmpDir);
    expect(fresh).not.toBeNull();
  });
});
