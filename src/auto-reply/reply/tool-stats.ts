/**
 * Tool Usage Statistics
 *
 * Tracks per-tool call counts, success/failure rates, and timing across sessions.
 * Uses the same sessions.db SQLite database as the session search index.
 *
 * Inspired by OpenViking's per-tool statistics accumulation.
 */

import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { requireNodeSqlite } from "../../memory/sqlite.js";

const log = createSubsystemLogger("tool-stats");

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SESSION_DB_FILENAME = "sessions.db";

const TOOL_STATS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS tool_stats (
    tool_name TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    call_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    total_duration_ms REAL DEFAULT 0,
    last_used REAL,
    PRIMARY KEY (tool_name, agent_id)
  );
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolStatsEntry = {
  toolName: string;
  agentId: string;
  callCount: number;
  successCount: number;
  failCount: number;
  totalDurationMs: number;
  lastUsed: number | null;
  /** Derived: success rate as percentage (0-100) */
  successRate: number;
  /** Derived: average duration per call in ms */
  avgDurationMs: number;
};

/** Raw row shape from the tool_stats table. */
type ToolStatsRow = {
  tool_name: string;
  agent_id: string;
  call_count: number;
  success_count: number;
  fail_count: number;
  total_duration_ms: number;
  last_used: number | null;
};

/** Map a raw DB row to the typed ToolStatsEntry with derived fields. */
function mapToolStatsRow(row: ToolStatsRow): ToolStatsEntry {
  return {
    toolName: row.tool_name,
    agentId: row.agent_id,
    callCount: row.call_count,
    successCount: row.success_count,
    failCount: row.fail_count,
    totalDurationMs: row.total_duration_ms,
    lastUsed: row.last_used,
    successRate: row.call_count > 0 ? (row.success_count / row.call_count) * 100 : 0,
    avgDurationMs: row.call_count > 0 ? row.total_duration_ms / row.call_count : 0,
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Cache of open tool stats instances, keyed by workspace dir */
const STATS_CACHE = new Map<string, ToolStatsIndex>();

export class ToolStatsIndex {
  private db: DatabaseSync;
  private readonly workspaceDir: string;

  private constructor(db: DatabaseSync, workspaceDir: string) {
    this.db = db;
    this.workspaceDir = workspaceDir;
  }

  /**
   * Get or create a tool stats index for a workspace.
   * Shares the same sessions.db used by SessionSearchIndex.
   * Returns null if SQLite is unavailable.
   */
  static open(workspaceDir: string): ToolStatsIndex | null {
    const cached = STATS_CACHE.get(workspaceDir);
    if (cached) {
      return cached;
    }

    const memoryDir = path.join(workspaceDir, "memory");
    try {
      fs.mkdirSync(memoryDir, { recursive: true });
    } catch {
      log.warn(`cannot create memory directory: ${memoryDir}`);
      return null;
    }

    const dbPath = path.join(memoryDir, SESSION_DB_FILENAME);

    let db: DatabaseSync;
    try {
      const { DatabaseSync: DbConstructor } = requireNodeSqlite();
      db = new DbConstructor(dbPath);
    } catch (err) {
      log.warn(`cannot open tool stats DB: ${String(err)}`);
      return null;
    }

    try {
      db.exec(TOOL_STATS_SCHEMA_SQL);
    } catch (err) {
      log.warn(`failed to create tool_stats schema: ${String(err)}`);
      return null;
    }

    const instance = new ToolStatsIndex(db, workspaceDir);
    STATS_CACHE.set(workspaceDir, instance);
    return instance;
  }

  /**
   * Record a tool call. Upserts into tool_stats — increments counts,
   * accumulates duration, updates last_used timestamp.
   */
  recordToolCall(params: {
    toolName: string;
    agentId: string;
    success: boolean;
    durationMs?: number;
  }): void {
    try {
      this.db
        .prepare(
          `INSERT INTO tool_stats (tool_name, agent_id, call_count, success_count, fail_count, total_duration_ms, last_used)
           VALUES (?, ?, 1, ?, ?, ?, ?)
           ON CONFLICT(tool_name, agent_id) DO UPDATE SET
             call_count = call_count + 1,
             success_count = success_count + ?,
             fail_count = fail_count + ?,
             total_duration_ms = total_duration_ms + ?,
             last_used = ?`,
        )
        .run(
          params.toolName,
          params.agentId,
          params.success ? 1 : 0,
          params.success ? 0 : 1,
          params.durationMs ?? 0,
          Date.now(),
          // ON CONFLICT values:
          params.success ? 1 : 0,
          params.success ? 0 : 1,
          params.durationMs ?? 0,
          Date.now(),
        );
    } catch (err) {
      log.debug(`failed to record tool call: ${String(err)}`);
    }
  }

  /**
   * Batch-record tool calls from a set of tool metas.
   * Wraps in a single transaction for O(1) fsync instead of O(n).
   */
  recordToolCalls(
    agentId: string,
    calls: Array<{ toolName: string; success?: boolean; durationMs?: number }>,
  ): void {
    if (calls.length === 0) {
      return;
    }
    try {
      this.db.exec("BEGIN");
      for (const call of calls) {
        this.recordToolCall({
          toolName: call.toolName,
          agentId,
          success: call.success ?? true,
          durationMs: call.durationMs,
        });
      }
      this.db.exec("COMMIT");
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Best effort rollback
      }
      log.debug(`batch tool stats recording failed: ${String(err)}`);
    }
  }

  /**
   * Get all tool stats for an agent, ordered by call count descending.
   */
  getToolStats(agentId: string): ToolStatsEntry[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT tool_name, agent_id, call_count, success_count, fail_count,
                  total_duration_ms, last_used
           FROM tool_stats WHERE agent_id = ?
           ORDER BY call_count DESC`,
        )
        .all(agentId) as ToolStatsRow[];

      return rows.map(mapToolStatsRow);
    } catch (err) {
      log.warn(`failed to get tool stats: ${String(err)}`);
      return [];
    }
  }

  /**
   * Get top N tools by call count for an agent.
   * Uses SQL LIMIT for efficiency rather than fetching all rows.
   */
  getTopTools(agentId: string, limit: number = 10): ToolStatsEntry[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT tool_name, agent_id, call_count, success_count, fail_count,
                  total_duration_ms, last_used
           FROM tool_stats WHERE agent_id = ?
           ORDER BY call_count DESC
           LIMIT ?`,
        )
        .all(agentId, limit) as ToolStatsRow[];

      return rows.map(mapToolStatsRow);
    } catch (err) {
      log.warn(`failed to get top tools: ${String(err)}`);
      return [];
    }
  }

  /**
   * Close the underlying database and remove from cache.
   */
  close(): void {
    try {
      this.db.close();
    } catch {
      // Best effort
    }
    STATS_CACHE.delete(this.workspaceDir);
  }

  /**
   * Clear the cache (for testing).
   */
  static clearCache(): void {
    STATS_CACHE.clear();
  }

  /**
   * Close all cached instances and clear the cache.
   * Call at process shutdown to prevent SQLite connection leaks.
   */
  static closeAll(): void {
    for (const instance of STATS_CACHE.values()) {
      try {
        instance.db.close();
      } catch {
        // Best effort
      }
    }
    STATS_CACHE.clear();
  }
}
