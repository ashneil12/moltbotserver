/**
 * Session Search Index
 *
 * SQLite-backed full-text search across conversation history using FTS5.
 * Complements the existing vector-based memory search with exact keyword/phrase
 * matching across past session transcripts.
 *
 * Inspired by NousResearch/hermes-agent's hermes_state.py (SQLite + FTS5 session storage).
 *
 * DB location: <workspaceDir>/memory/sessions.db (per-agent, alongside memory index)
 */

import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { requireNodeSqlite } from "../../memory/sqlite.js";
import { ToolStatsIndex } from "./tool-stats.js";

const log = createSubsystemLogger("session-search");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionMessage = {
  sessionId: string;
  agentId: string;
  role: string;
  content: string;
  timestamp: number;
  channel?: string;
};

export type SessionSearchResult = {
  sessionId: string;
  agentId: string;
  role: string;
  content: string;
  timestamp: number;
  channel?: string;
  /** FTS5 rank score (lower = more relevant) */
  rank: number;
  /** Surrounding context messages (1 before + 1 after) when available */
  context?: Array<{ role: string; content: string }>;
};

export type SessionSearchOptions = {
  /** Max results to return. Default: 10 */
  limit?: number;
  /** Filter by agent ID. undefined = search all agents. */
  agentId?: string;
  /** Filter by channel (telegram, discord, web, etc.) */
  channel?: string;
  /** Only search messages after this timestamp (ms since epoch) */
  after?: number;
  /** Only search messages before this timestamp (ms since epoch) */
  before?: number;
  /** Exclude results from this session ID (the current session) */
  excludeSessionId?: string;
  /** Include surrounding context messages (1 before + 1 after) */
  includeContext?: boolean;
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SESSION_DB_FILENAME = "sessions.db";

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS session_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp REAL NOT NULL,
    channel TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_session_messages_session
    ON session_messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_session_messages_agent
    ON session_messages(agent_id);
  CREATE INDEX IF NOT EXISTS idx_session_messages_timestamp
    ON session_messages(timestamp);
`;

/**
 * Migration: add hotness-scoring columns for OpenViking-style access tracking.
 * Uses ALTER TABLE so existing DBs are upgraded transparently.
 */
const HOTNESS_MIGRATION_SQL = `
  ALTER TABLE session_messages ADD COLUMN access_count INTEGER DEFAULT 0;
  ALTER TABLE session_messages ADD COLUMN last_accessed REAL;
`;

const FTS_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts USING fts5(
    content,
    session_id UNINDEXED,
    agent_id UNINDEXED,
    role UNINDEXED,
    channel UNINDEXED,
    timestamp UNINDEXED,
    content=session_messages,
    content_rowid=id
  );
`;

// Triggers to keep FTS in sync with the content table
const TRIGGER_SQL = `
  CREATE TRIGGER IF NOT EXISTS session_messages_ai AFTER INSERT ON session_messages BEGIN
    INSERT INTO session_messages_fts(rowid, content, session_id, agent_id, role, channel, timestamp)
    VALUES (new.id, new.content, new.session_id, new.agent_id, new.role, new.channel, new.timestamp);
  END;

  CREATE TRIGGER IF NOT EXISTS session_messages_ad AFTER DELETE ON session_messages BEGIN
    INSERT INTO session_messages_fts(session_messages_fts, rowid, content, session_id, agent_id, role, channel, timestamp)
    VALUES ('delete', old.id, old.content, old.session_id, old.agent_id, old.role, old.channel, old.timestamp);
  END;
`;

// ---------------------------------------------------------------------------
// Index Manager
// ---------------------------------------------------------------------------

/** Cache of open session search indexes, keyed by workspace dir */
const INDEX_CACHE = new Map<string, SessionSearchIndex>();

export class SessionSearchIndex {
  private db: DatabaseSync;
  private readonly dbPath: string;
  private readonly workspaceDir: string;
  private ftsAvailable = false;

  private constructor(dbPath: string, db: DatabaseSync, workspaceDir: string) {
    this.dbPath = dbPath;
    this.db = db;
    this.workspaceDir = workspaceDir;
  }

  /**
   * Get or create a session search index for a workspace.
   * Returns null if SQLite is unavailable.
   */
  static open(workspaceDir: string): SessionSearchIndex | null {
    const cached = INDEX_CACHE.get(workspaceDir);
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
      log.warn(`cannot open session search DB: ${String(err)}`);
      return null;
    }

    const instance = new SessionSearchIndex(dbPath, db, workspaceDir);
    instance.initSchema();
    INDEX_CACHE.set(workspaceDir, instance);
    return instance;
  }

  private initSchema(): void {
    try {
      this.db.exec(SCHEMA_SQL);
    } catch (err) {
      log.warn(`failed to create session search schema: ${String(err)}`);
      return;
    }

    // Migrate: add hotness columns if missing (idempotent)
    for (const stmt of HOTNESS_MIGRATION_SQL.split(";")) {
      const trimmed = stmt.trim();
      if (!trimmed) {
        continue;
      }
      try {
        this.db.exec(trimmed);
      } catch {
        // Column already exists — expected on subsequent runs
      }
    }

    try {
      this.db.exec(FTS_SQL);
      this.db.exec(TRIGGER_SQL);
      this.ftsAvailable = true;
    } catch (err) {
      log.warn(`FTS5 not available for session search: ${String(err)}`);
      this.ftsAvailable = false;
    }
  }

  /**
   * Index messages from a transcript into the search database.
   */
  indexMessages(messages: SessionMessage[]): number {
    if (messages.length === 0) {
      return 0;
    }

    const insert = this.db.prepare(
      `INSERT INTO session_messages (session_id, agent_id, role, content, timestamp, channel)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    let count = 0;
    try {
      this.db.exec("BEGIN");
      for (const msg of messages) {
        if (!msg.content?.trim()) {
          continue;
        }
        try {
          insert.run(
            msg.sessionId,
            msg.agentId,
            msg.role,
            msg.content,
            msg.timestamp,
            msg.channel ?? null,
          );
          count++;
        } catch (err) {
          log.warn(`failed to index message: ${String(err)}`);
        }
      }
      this.db.exec("COMMIT");
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Best effort rollback
      }
      log.warn(`transaction failed during indexing: ${String(err)}`);
    }

    log.info(`indexed ${count} messages for session ${messages[0]?.sessionId}`);
    return count;
  }

  /**
   * Search past session messages using FTS5 full-text search.
   * Falls back to LIKE-based search if FTS5 is unavailable.
   */
  search(query: string, options?: SessionSearchOptions): SessionSearchResult[] {
    const limit = options?.limit ?? 10;

    if (!query.trim()) {
      return [];
    }

    if (this.ftsAvailable) {
      return this.searchFts(query, limit, options);
    }

    return this.searchLike(query, limit, options);
  }

  private searchFts(
    query: string,
    limit: number,
    options?: SessionSearchOptions,
  ): SessionSearchResult[] {
    const ftsQuery = this.sanitizeFts5Query(query);
    if (!ftsQuery) {
      return [];
    }

    const conditions: string[] = [];
    const params: (string | number | null)[] = [ftsQuery];

    if (options?.agentId) {
      conditions.push("agent_id = ?");
      params.push(options.agentId);
    }
    if (options?.channel) {
      conditions.push("channel = ?");
      params.push(options.channel);
    }
    if (options?.after) {
      conditions.push("timestamp > ?");
      params.push(options.after);
    }
    if (options?.before) {
      conditions.push("timestamp < ?");
      params.push(options.before);
    }
    if (options?.excludeSessionId) {
      conditions.push("session_id != ?");
      params.push(options.excludeSessionId);
    }

    const whereClause = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";

    // Hotness-blended scoring: FTS5 rank (negative, lower=better) is boosted
    // by a hotness signal based on access frequency and recency.
    // Formula: hotness = sigmoid(log1p(access_count)) × exp_decay(age_days, half_life=7)
    // Final: rank + (-0.2 × hotness)  — negative because rank is negative-is-better.
    //
    // NOTE: FTS5 does NOT support table aliases in MATCH clauses, so we use a
    // subquery for the FTS5 match, then JOIN with session_messages for hotness.
    const sql = `
      SELECT
        fts.rowid, fts.session_id, fts.agent_id, fts.role, fts.content,
        fts.channel, fts.timestamp, fts.rank,
        COALESCE(m.access_count, 0) AS access_count,
        m.last_accessed
      FROM (
        SELECT rowid, session_id, agent_id, role, content, channel, timestamp, rank
        FROM session_messages_fts
        WHERE session_messages_fts MATCH ? ${whereClause}
        ORDER BY rank
        LIMIT ?
      ) fts
      LEFT JOIN session_messages m ON m.id = fts.rowid
      ORDER BY fts.rank + (CASE WHEN COALESCE(m.access_count, 0) > 0 AND m.last_accessed IS NOT NULL THEN
        -0.2 * (1.0 / (1.0 + EXP(-1.0 * LOG(1 + m.access_count)))) *
        EXP(-0.099 * MAX(0, julianday('now') - julianday(m.last_accessed / 1000.0, 'unixepoch')))
      ELSE 0 END)
    `;
    params.push(limit);

    try {
      const rows = this.db.prepare(sql).all(...params) as Array<{
        rowid: number;
        session_id: string;
        agent_id: string;
        role: string;
        content: string;
        channel: string | null;
        timestamp: number;
        rank: number;
        access_count: number;
        last_accessed: number | null;
      }>;

      // Track access for hotness scoring (fire-and-forget)
      const rowids = rows.map((r) => r.rowid).filter(Boolean);
      if (rowids.length > 0) {
        this.recordAccess(rowids);
      }

      return rows.map((row) => {
        const result: SessionSearchResult = {
          sessionId: row.session_id,
          agentId: row.agent_id,
          role: row.role,
          content: row.content,
          timestamp: row.timestamp,
          channel: row.channel ?? undefined,
          rank: row.rank,
        };

        // Add surrounding context (1 message before + 1 after the match)
        if (options?.includeContext && row.rowid) {
          try {
            const ctxRows = this.db
              .prepare(
                `SELECT role, content FROM session_messages
                 WHERE session_id = ? AND id >= ? - 1 AND id <= ? + 1
                 ORDER BY id`,
              )
              .all(row.session_id, row.rowid, row.rowid) as Array<{
              role: string;
              content: string;
            }>;
            result.context = ctxRows.map((r) => ({
              role: r.role,
              content: (r.content || "").slice(0, 200),
            }));
          } catch {
            result.context = [];
          }
        }

        return result;
      });
    } catch (err) {
      log.warn(`FTS search failed: ${String(err)}`);
      return this.searchLike(query, limit, options);
    }
  }

  private searchLike(
    query: string,
    limit: number,
    options?: SessionSearchOptions,
  ): SessionSearchResult[] {
    const conditions: string[] = ["content LIKE ?"];
    const params: (string | number | null)[] = [`%${query}%`];

    if (options?.agentId) {
      conditions.push("agent_id = ?");
      params.push(options.agentId);
    }
    if (options?.channel) {
      conditions.push("channel = ?");
      params.push(options.channel);
    }
    if (options?.after) {
      conditions.push("timestamp > ?");
      params.push(options.after);
    }
    if (options?.before) {
      conditions.push("timestamp < ?");
      params.push(options.before);
    }
    if (options?.excludeSessionId) {
      conditions.push("session_id != ?");
      params.push(options.excludeSessionId);
    }

    const sql = `
      SELECT session_id, agent_id, role, content, channel, timestamp
      FROM session_messages
      WHERE ${conditions.join(" AND ")}
      ORDER BY timestamp DESC
      LIMIT ?
    `;
    params.push(limit);

    try {
      const rows = this.db.prepare(sql).all(...params) as Array<{
        session_id: string;
        agent_id: string;
        role: string;
        content: string;
        channel: string | null;
        timestamp: number;
      }>;

      return rows.map((row) => ({
        sessionId: row.session_id,
        agentId: row.agent_id,
        role: row.role,
        content: row.content,
        timestamp: row.timestamp,
        channel: row.channel ?? undefined,
        rank: 0,
      }));
    } catch (err) {
      log.warn(`LIKE search failed: ${String(err)}`);
      return [];
    }
  }

  /**
   * Sanitize user input for safe use in FTS5 MATCH queries.
   *
   * FTS5 has its own query syntax where characters like `"`, `(`, `)`,
   * `+`, `*`, `{`, `}` and bare boolean operators (AND, OR, NOT) have
   * special meaning. Passing raw user input directly to MATCH can cause
   * sqlite3 OperationalError.
   *
   * Ported from NousResearch/hermes-agent hermes_state.py _sanitize_fts5_query.
   */
  private sanitizeFts5Query(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }

    // If already a valid quoted phrase, use directly
    if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 2) {
      return trimmed;
    }

    // Remove FTS5-special characters that are only meaningful as operators
    let sanitized = trimmed.replace(/[+{}()"^]/g, " ");

    // Collapse repeated * (e.g. "***") into one, remove leading *
    sanitized = sanitized.replace(/\*+/g, "*");
    sanitized = sanitized.replace(/(^|\s)\*/g, "$1");

    // Remove dangling boolean operators at start/end
    sanitized = sanitized.replace(/^(AND|OR|NOT)\b\s*/i, "").trim();
    sanitized = sanitized.replace(/\s+(AND|OR|NOT)\s*$/i, "").trim();

    return sanitized || null;
  }

  /**
   * Get the total number of indexed messages.
   */
  count(agentId?: string): number {
    try {
      if (agentId) {
        const row = this.db
          .prepare("SELECT COUNT(*) as cnt FROM session_messages WHERE agent_id = ?")
          .get(agentId) as { cnt: number } | undefined;
        return row?.cnt ?? 0;
      }
      const row = this.db.prepare("SELECT COUNT(*) as cnt FROM session_messages").get() as
        | { cnt: number }
        | undefined;
      return row?.cnt ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Load all messages for a given session, ordered by timestamp.
   * Returns a formatted transcript string suitable for LLM summarization.
   */
  getSessionTranscript(sessionId: string): string {
    try {
      const rows = this.db
        .prepare(
          `SELECT role, content, timestamp FROM session_messages
           WHERE session_id = ? ORDER BY timestamp, id`,
        )
        .all(sessionId) as Array<{ role: string; content: string; timestamp: number }>;

      if (rows.length === 0) {
        return "";
      }

      const parts: string[] = [];
      for (const row of rows) {
        const label =
          row.role === "user"
            ? "USER"
            : row.role === "assistant"
              ? "ASSISTANT"
              : row.role.toUpperCase();
        const content = row.content || "";
        // Truncate very long tool outputs
        if (label === "TOOL" && content.length > 500) {
          parts.push(
            `[${label}]: ${content.slice(0, 250)}\n...[truncated]...\n${content.slice(-250)}`,
          );
        } else {
          parts.push(`[${label}]: ${content}`);
        }
      }
      return parts.join("\n\n");
    } catch (err) {
      log.warn(`failed to load session transcript: ${String(err)}`);
      return "";
    }
  }

  /**
   * Get the earliest timestamp for a session (session start time).
   */
  getSessionStartTime(sessionId: string): number | undefined {
    try {
      const row = this.db
        .prepare(`SELECT MIN(timestamp) as started_at FROM session_messages WHERE session_id = ?`)
        .get(sessionId) as { started_at: number | null } | undefined;
      return row?.started_at ?? undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Deduplicate search results, returning unique session IDs in relevance order.
   * Limited to `maxSessions` to cap LLM summarization cost.
   */
  getUniqueSessionIds(
    results: SessionSearchResult[],
    maxSessions: number = 3,
    excludeSessionId?: string,
  ): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const r of results) {
      if (excludeSessionId && r.sessionId === excludeSessionId) {
        continue;
      }
      if (!seen.has(r.sessionId)) {
        seen.add(r.sessionId);
        unique.push(r.sessionId);
      }
      if (unique.length >= maxSessions) {
        break;
      }
    }
    return unique;
  }

  /**
   * Record access for hotness scoring.
   * Increments access_count and sets last_accessed for matched rows.
   */
  private recordAccess(rowids: number[]): void {
    if (rowids.length === 0) {
      return;
    }
    try {
      const placeholders = rowids.map(() => "?").join(", ");
      this.db
        .prepare(
          `UPDATE session_messages
           SET access_count = access_count + 1, last_accessed = ?
           WHERE id IN (${placeholders})`,
        )
        .run(Date.now(), ...rowids);
    } catch (err) {
      log.debug(`failed to record access: ${String(err)}`);
    }
  }

  /**
   * Close the database connection and remove from cache.
   */
  close(): void {
    try {
      this.db.close();
    } catch {
      // Best effort
    }
    INDEX_CACHE.delete(this.workspaceDir);
  }

  /** Exposed for testing */
  get isFtsAvailable(): boolean {
    return this.ftsAvailable;
  }

  /**
   * Remove the cache entry for a workspace (for testing cleanup).
   */
  static clearCache(): void {
    INDEX_CACHE.clear();
  }

  /**
   * Close all cached instances and clear the cache.
   * Call at process shutdown to prevent SQLite connection leaks.
   */
  static closeAll(): void {
    for (const instance of INDEX_CACHE.values()) {
      try {
        instance.db.close();
      } catch {
        // Best effort
      }
    }
    INDEX_CACHE.clear();
  }
}

// ---------------------------------------------------------------------------
// Transcript indexing helper
// ---------------------------------------------------------------------------

type TranscriptEntry = {
  type: string;
  timestamp?: string;
  message?: {
    role: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
};

function extractText(content: string | Array<{ type: string; text?: string }> | undefined): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text ?? "")
      .join("\n");
  }
  return "";
}

/**
 * Index a session transcript into the session search database.
 * Also records tool usage statistics for OpenViking-style tool learning.
 * Call this during session reset (alongside session context persistence).
 */
export function indexTranscriptForSearch(params: {
  transcriptPath: string;
  workspaceDir: string;
  agentId: string;
  sessionId: string;
  channel?: string;
}): void {
  const index = SessionSearchIndex.open(params.workspaceDir);
  if (!index) {
    return;
  }

  let content: string;
  try {
    content = fs.readFileSync(params.transcriptPath, "utf-8");
  } catch {
    log.warn(`cannot read transcript for indexing: ${params.transcriptPath}`);
    return;
  }

  const messages: SessionMessage[] = [];
  const toolCalls: Array<{ toolName: string; success?: boolean }> = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line) as TranscriptEntry;
    } catch {
      continue;
    }

    if (entry.type !== "message" || !entry.message) {
      continue;
    }

    // Extract tool calls from assistant messages
    if (entry.message.role === "assistant" && Array.isArray(entry.message.content)) {
      for (const block of entry.message.content as Array<Record<string, unknown>>) {
        if (
          (block.type === "toolCall" || block.type === "tool_use" || block.type === "function") &&
          typeof block.name === "string"
        ) {
          toolCalls.push({ toolName: block.name });
        }
      }
    }

    // Track tool result success/failure
    const msgRecord = entry.message as Record<string, unknown>;
    if (entry.message.role === "tool" && typeof msgRecord.name === "string") {
      const toolName = msgRecord.name;
      const text = extractText(entry.message.content).trim();
      const textLower = text.toLowerCase();
      const isError =
        textLower.startsWith("error") ||
        textLower.includes('"error"') ||
        textLower.includes("failed:") ||
        textLower.includes("exception:");
      // Find the most recent unresolved tool call with this name and mark it
      for (let i = toolCalls.length - 1; i >= 0; i--) {
        if (toolCalls[i].toolName === toolName && toolCalls[i].success === undefined) {
          toolCalls[i].success = !isError;
          break;
        }
      }
    }

    const text = extractText(entry.message.content).trim();
    if (!text) {
      continue;
    }

    // Only index user and assistant messages (skip tool results for now)
    if (entry.message.role !== "user" && entry.message.role !== "assistant") {
      continue;
    }

    const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();

    messages.push({
      sessionId: params.sessionId,
      agentId: params.agentId,
      role: entry.message.role,
      content: text,
      timestamp,
      channel: params.channel,
    });
  }

  if (messages.length > 0) {
    index.indexMessages(messages);
  }

  // Record tool usage statistics (best-effort, sync)
  if (toolCalls.length > 0) {
    try {
      const stats = ToolStatsIndex.open(params.workspaceDir);
      if (stats) {
        stats.recordToolCalls(
          params.agentId,
          toolCalls.map((tc) => ({ toolName: tc.toolName, success: tc.success ?? true })),
        );
      }
    } catch (err) {
      log.debug(`tool stats recording failed: ${String(err)}`);
    }
  }
}
