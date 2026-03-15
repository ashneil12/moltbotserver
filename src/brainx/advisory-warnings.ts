#!/usr/bin/env npx tsx
/**
 * Advisory Warnings — BrainX-inspired failure pattern detection.
 *
 * Scans diary files and session context files for failure patterns and generates
 * an advisory warnings file that the agent reads on every turn.
 *
 * Patterns detected:
 *   - Deploy/build failures (exit codes, error messages)
 *   - Dangerous commands (rm -rf, DROP TABLE, force push)
 *   - Service crashes / connection failures
 *   - Repeated failures on the same topic
 *   - Permission / auth errors
 *
 * Usage:
 *   npx tsx src/brainx/advisory-warnings.ts [--agent coder] [--dry-run] [--verbose]
 *
 * Designed as a cron job — safe to run repeatedly. Rotates old warnings.
 */

import fs from "node:fs";
import path from "node:path";
import { listAgentIds, parseCliArgs, resolveAgentWorkspaceDir } from "./paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WarningLevel = "critical" | "warning" | "info";

export type AdvisoryWarning = {
  level: WarningLevel;
  message: string;
  source: string;
  /** ISO date extracted from context or now */
  date: string;
};

// ---------------------------------------------------------------------------
// Failure pattern detection
// ---------------------------------------------------------------------------

type PatternDef = {
  level: WarningLevel;
  regex: RegExp;
  /** Template for the warning message. $0 = full match, $1+ = capture groups */
  template: string;
};

const FAILURE_PATTERNS: PatternDef[] = [
  // Deploy / build failures
  {
    level: "critical",
    regex: /(?:deploy|build|push)\s+(?:failed|error|crash|timeout)/gi,
    template: "Deploy/build issue: $0",
  },
  {
    level: "critical",
    regex: /exit\s*(?:code|status)\s*[1-9]\d*/gi,
    template: "Non-zero exit: $0",
  },
  {
    level: "critical",
    regex: /(?:ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|connection\s+refused)/gi,
    template: "Connection failure: $0",
  },

  // Dangerous commands
  {
    level: "critical",
    regex: /rm\s+-(?:rf|fr)\s+(?:\/(?!tmp)[^\s]+)/gi,
    template: "Dangerous rm detected: $0",
  },
  {
    level: "critical",
    regex: /DROP\s+(?:TABLE|DATABASE|SCHEMA)\s+\w+/gi,
    template: "Destructive SQL: $0",
  },
  {
    level: "warning",
    regex: /(?:git\s+)?(?:push|force-push)\s+(?:--force|-f)\s+/gi,
    template: "Force push detected: $0",
  },

  // Auth / permission errors
  {
    level: "warning",
    regex: /(?:401|403|unauthorized|forbidden|permission\s+denied|access\s+denied)/gi,
    template: "Auth/permission issue: $0",
  },

  // Missing env vars / config
  {
    level: "warning",
    regex:
      /(?:missing|undefined|not\s+set|not\s+found)\s+(?:env(?:ironment)?\s+(?:var(?:iable)?)?|config|key|secret|token)\s*[:=]?\s*([A-Z_]+)/gi,
    template: "Missing config: $1",
  },
  {
    level: "warning",
    regex: /([A-Z][A-Z0-9_]{2,})\s+(?:is\s+)?(?:not\s+set|undefined|missing|empty)/gi,
    template: "Missing env var: $1",
  },

  // Service crashes
  {
    level: "critical",
    regex: /(?:OOM|out\s+of\s+memory|heap\s+out\s+of|segmentation\s+fault|SIGKILL|SIGTERM)/gi,
    template: "Process crash: $0",
  },

  // Database errors
  {
    level: "warning",
    regex: /(?:deadlock|lock\s+timeout|duplicate\s+key|constraint\s+violation)/gi,
    template: "Database issue: $0",
  },

  // Rate limiting — require surrounding context to avoid false positives on bare "429"
  {
    level: "info",
    regex:
      /(?:rate\s+limit(?:ed|ing)?|(?:status|code|error|http)\s+429|too\s+many\s+requests|throttl(?:ed|ing))/gi,
    template: "Rate limiting: $0",
  },
];

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

export function detectWarnings(text: string, source: string): AdvisoryWarning[] {
  const warnings: AdvisoryWarning[] = [];
  const seen = new Set<string>();
  const today = new Date().toISOString().split("T")[0];

  for (const pattern of FAILURE_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text)) !== null) {
      const message = pattern.template
        .replace("$0", match[0].trim())
        .replace("$1", (match[1] ?? match[0]).trim());

      // Dedup by normalized message
      const key = message.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      warnings.push({
        level: pattern.level,
        message,
        source,
        date: today,
      });
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// File persistence
// ---------------------------------------------------------------------------

const WARNINGS_FILENAME = "advisory-warnings.md";
const MAX_ADVISORY_CHARS = 4_000;

const LEVEL_ICONS: Record<WarningLevel, string> = {
  critical: "🔴",
  warning: "⚠️",
  info: "ℹ️",
};

export function formatWarningsAsMarkdown(warnings: AdvisoryWarning[]): string {
  if (warnings.length === 0) {
    return "";
  }

  const lines: string[] = [
    "# Active Warnings (auto-generated)\n",
    "> Scanned from diary and session context. Do not edit manually.\n",
  ];

  // Sort: critical first, then warning, then info
  const levelOrder: Record<WarningLevel, number> = { critical: 0, warning: 1, info: 2 };
  const sorted = [...warnings].toSorted((a, b) => levelOrder[a.level] - levelOrder[b.level]);

  for (const w of sorted) {
    const icon = LEVEL_ICONS[w.level];
    lines.push(`${icon} **[${w.date}]** ${w.message} *(${w.source})*`);
  }

  return lines.join("\n") + "\n";
}

function loadExistingWarnings(warningsPath: string): Set<string> {
  const existing = new Set<string>();
  try {
    const content = fs.readFileSync(warningsPath, "utf-8");
    // Parse existing warning messages
    const re = /(?:🔴|⚠️|ℹ️)\s+\*\*\[[\d-]+\]\*\*\s+(.+?)\s+\*\(/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[1]) {
        existing.add(m[1].toLowerCase());
      }
    }
  } catch {
    // File doesn't exist yet
  }
  return existing;
}

export function persistWarnings(
  workspaceDir: string,
  newWarnings: AdvisoryWarning[],
  opts?: { dryRun?: boolean; verbose?: boolean },
): { written: number; skipped: number; total: number } {
  const memoryDir = path.join(workspaceDir, "memory");
  const warningsPath = path.join(memoryDir, WARNINGS_FILENAME);

  // Load existing for dedup
  const existingMessages = loadExistingWarnings(warningsPath);
  const deduped = newWarnings.filter((w) => !existingMessages.has(w.message.toLowerCase()));

  if (deduped.length === 0) {
    return { written: 0, skipped: newWarnings.length, total: existingMessages.size };
  }

  // Read existing content to merge
  let existingBody = "";
  try {
    const content = fs.readFileSync(warningsPath, "utf-8");
    // Extract just the warning lines (skip header)
    const lines = content.split("\n").filter((l) => /^(?:🔴|⚠️|ℹ️)/.test(l));
    existingBody = lines.join("\n");
  } catch {
    // No existing file
  }

  const newBody = formatWarningsAsMarkdown(deduped);
  let combined = newBody;
  if (existingBody) {
    // Append existing warnings after new ones
    combined = combined.trimEnd() + "\n" + existingBody + "\n";
  }

  // Truncate if too large
  if (combined.length > MAX_ADVISORY_CHARS) {
    const lines = combined.split("\n");
    let total = 0;
    const kept: string[] = [];
    for (const line of lines) {
      total += line.length + 1;
      if (total > MAX_ADVISORY_CHARS) {
        break;
      }
      kept.push(line);
    }
    combined = kept.join("\n") + "\n\n*(older warnings rotated out)*\n";
  }

  if (opts?.dryRun) {
    if (opts.verbose) {
      console.log(`[dry-run] Would write ${deduped.length} warnings to ${warningsPath}`);
      console.log(newBody);
    }
    return {
      written: deduped.length,
      skipped: newWarnings.length - deduped.length,
      total: existingMessages.size + deduped.length,
    };
  }

  fs.mkdirSync(memoryDir, { recursive: true });
  fs.writeFileSync(warningsPath, combined, "utf-8");

  return {
    written: deduped.length,
    skipped: newWarnings.length - deduped.length,
    total: existingMessages.size + deduped.length,
  };
}

// ---------------------------------------------------------------------------
// Memory file scanning
// ---------------------------------------------------------------------------

function scanMemoryFiles(workspaceDir: string): Array<{ name: string; content: string }> {
  const memoryDir = path.join(workspaceDir, "memory");
  const results: Array<{ name: string; content: string }> = [];

  /**
   * Safety limits: prevent unbounded memory consumption on workspaces
   * with many memory files or very large individual files.
   */
  const MAX_FILES = 50;
  const MAX_FILE_BYTES = 256 * 1024; // 256 KB per file

  try {
    const files = fs.readdirSync(memoryDir);
    let scanned = 0;
    for (const file of files) {
      if (scanned >= MAX_FILES) {
        break;
      }
      if (!file.endsWith(".md")) {
        continue;
      }
      // Skip our own output files to avoid self-triggering
      if (file === WARNINGS_FILENAME || file === "extracted-facts.md") {
        continue;
      }
      try {
        const filePath = path.join(memoryDir, file);
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_FILE_BYTES) {
          continue;
        } // skip oversized files
        const content = fs.readFileSync(filePath, "utf-8");
        if (content.trim()) {
          results.push({ name: file, content });
          scanned++;
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // memory dir doesn't exist
  }

  // Also scan workspace-level context files
  for (const contextFile of ["session-context.md", "MEMORY.md"]) {
    try {
      const content = fs.readFileSync(path.join(workspaceDir, contextFile), "utf-8");
      if (content.trim()) {
        results.push({ name: contextFile, content });
      }
    } catch {
      // File doesn't exist
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const { dryRun, verbose, agentFilter } = parseCliArgs();
  const agents = agentFilter ? [agentFilter] : listAgentIds();

  if (verbose) {
    console.log(`[advisory-warnings] scanning ${agents.length} agent(s), dryRun=${dryRun}`);
  }

  let totalWritten = 0;

  for (const agentId of agents) {
    const workspaceDir = resolveAgentWorkspaceDir(agentId);
    const memoryFiles = scanMemoryFiles(workspaceDir);

    if (verbose) {
      console.log(
        `[advisory-warnings] agent=${agentId}: ${memoryFiles.length} memory files in ${workspaceDir}`,
      );
    }

    if (memoryFiles.length === 0) {
      continue;
    }

    // Detect warnings from all memory files
    const allWarnings: AdvisoryWarning[] = [];
    for (const file of memoryFiles) {
      const warnings = detectWarnings(file.content, file.name);
      allWarnings.push(...warnings);
    }

    if (allWarnings.length === 0) {
      if (verbose) {
        console.log(`[advisory-warnings] agent=${agentId}: no warnings found`);
      }
      continue;
    }

    const result = persistWarnings(workspaceDir, allWarnings, { dryRun, verbose });
    totalWritten += result.written;

    if (verbose || result.written > 0) {
      console.log(
        `[advisory-warnings] agent=${agentId}: wrote=${result.written} skipped=${result.skipped} total=${result.total}`,
      );
    }
  }

  if (totalWritten > 0 || verbose) {
    console.log(`[advisory-warnings] done: wrote=${totalWritten}`);
  }
}

// Run when executed directly
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith("advisory-warnings.ts") ||
    process.argv[1].endsWith("advisory-warnings.js"));

if (isDirectExecution) {
  main();
}
