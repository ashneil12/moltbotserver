#!/usr/bin/env npx tsx
/**
 * Fact Extractor — BrainX-inspired structured fact extraction from session transcripts.
 *
 * Scans session JSONL transcripts and extracts structured facts:
 *   - URLs (http/https)
 *   - Git repositories (GitHub/GitLab/Bitbucket)
 *   - Ports (service ports, listen ports)
 *   - Git branches (checkout, merge, branch refs)
 *   - Environment variables (key names only — values redacted for security)
 *   - Service/infra names (Railway, Docker, Supabase, Vercel, etc.)
 *
 * Writes deduplicated facts to {workspace}/memory/extracted-facts.md.
 *
 * Usage:
 *   npx tsx src/brainx/extract-facts.ts [--hours 24] [--agent coder] [--dry-run] [--verbose]
 *
 * Designed as a cron job — safe to run repeatedly. Deduplicates against existing file.
 */

import fs from "node:fs";
import path from "node:path";
import {
  findRecentTranscripts,
  listAgentIds,
  parseCliArgs,
  readTranscriptText,
  resolveAgentSessionsDir,
  resolveAgentWorkspaceDir,
} from "./paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FactType = "url" | "repo" | "port" | "branch" | "env_var" | "service";

export type ExtractedFact = {
  type: FactType;
  value: string;
  /** Source context (e.g. which transcript) */
  source?: string;
};

// ---------------------------------------------------------------------------
// Extraction patterns
// ---------------------------------------------------------------------------

/**
 * Each pattern has a type, a regex, and an optional group index (default 0 = full match).
 * The `normalize` function cleans up the matched value before dedup comparison.
 */
type PatternDef = {
  type: FactType;
  regex: RegExp;
  group?: number;
  normalize?: (value: string) => string;
};

const PATTERNS: PatternDef[] = [
  // URLs — match http/https, stop at whitespace, quotes, parens, backticks, brackets
  {
    type: "url",
    regex: /https?:\/\/[^\s)"'`\]>]+/g,
    normalize: (v) => v.replace(/[.,;:!?)]+$/, ""), // strip trailing punctuation
  },
  // Git repos — github.com/org/repo, gitlab.com/org/repo, bitbucket.org/org/repo
  {
    type: "repo",
    regex: /(?:github|gitlab|bitbucket)\.(?:com|org)\/[\w.-]+\/[\w.-]+/gi,
    normalize: (v) => v.toLowerCase().replace(/\.git$/, ""),
  },
  // Ports — "port 3000", ":8080", "listen on 443"
  // Note: PORT=5432 is captured by the env_var pattern, not this one.
  {
    type: "port",
    regex: /(?:port|PORT|listen(?:\s+on)?|:)\s*(\d{2,5})\b/g,
    group: 1,
    normalize: (v) => v.trim(),
  },
  // Git branches — "branch feature/foo", "checkout -b dev", "merge main"
  {
    type: "branch",
    regex: /(?:branch|checkout(?:\s+-[bB])?|merge|rebase(?:\s+onto)?)\s+[`"']?([\w\-/.]+)/g,
    group: 1,
    normalize: (v) => v.trim(),
  },
  // Environment variables — "DATABASE_URL=postgres://...", "export API_KEY=abc123"
  // SECURITY: Only captures the KEY name, not the value. Values may contain
  // credentials (DB passwords, API keys) and must not be written to memory files.
  {
    type: "env_var",
    regex: /(?:export\s+)?([A-Z][A-Z0-9_]{2,})=["']?[^\s"']+/g,
    group: 1, // capture only the KEY name
    normalize: (v) => v.replace(/^export\s+/, "").trim(),
  },
  // Service/infra names — Railway, Docker, Supabase, Vercel, Render, Fly.io references
  {
    type: "service",
    regex:
      /(?:railway|docker|supabase|vercel|render|fly\.io|cloudflare|heroku|netlify|aws|gcp|azure)\s+(?:deploy|run|push|build|service|project|app)\s+([\w\-/.]+)/gi,
    group: 0,
    normalize: (v) => v.trim(),
  },
];

// ---------------------------------------------------------------------------
// Fact extraction
// ---------------------------------------------------------------------------

export function extractFactsFromText(text: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const seen = new Set<string>();

  for (const pattern of PATTERNS) {
    // Reset regex lastIndex for global patterns
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text)) !== null) {
      const raw = match[pattern.group ?? 0];
      if (!raw) {
        continue;
      }
      const value = pattern.normalize ? pattern.normalize(raw) : raw.trim();
      if (!value) {
        continue;
      }

      // Dedup key: type + normalized value (case-insensitive for URLs/repos)
      const key =
        pattern.type === "url" || pattern.type === "repo"
          ? `${pattern.type}:${value.toLowerCase()}`
          : `${pattern.type}:${value}`;

      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      facts.push({ type: pattern.type, value });
    }
  }

  return facts;
}

// ---------------------------------------------------------------------------
// File persistence
// ---------------------------------------------------------------------------

const FACTS_FILENAME = "extracted-facts.md";
const MAX_FACTS_FILE_CHARS = 16_000;
const FACTS_HEADER = `# Extracted Facts (auto-generated)\n\n> Do not edit — regenerated by the fact extraction cron.\n> Contains structured data extracted from recent sessions.\n\n`;

export function formatFactsAsMarkdown(facts: ExtractedFact[]): string {
  if (facts.length === 0) {
    return "";
  }

  const grouped = new Map<FactType, ExtractedFact[]>();
  for (const fact of facts) {
    const list = grouped.get(fact.type) ?? [];
    list.push(fact);
    grouped.set(fact.type, list);
  }

  const TYPE_LABELS: Record<FactType, string> = {
    url: "URLs",
    repo: "Repositories",
    port: "Ports",
    branch: "Branches",
    env_var: "Environment Variables",
    service: "Services & Infrastructure",
  };

  const sections: string[] = [];
  for (const [type, label] of Object.entries(TYPE_LABELS) as [FactType, string][]) {
    const items = grouped.get(type);
    if (!items || items.length === 0) {
      continue;
    }
    sections.push(`### ${label}\n`);
    for (const item of items) {
      sections.push(`- \`${item.value}\``);
    }
    sections.push("");
  }

  return sections.join("\n");
}

function loadExistingFacts(factsPath: string): Set<string> {
  const existing = new Set<string>();
  try {
    const content = fs.readFileSync(factsPath, "utf-8");
    // Parse existing backtick-wrapped values: `value`
    const re = /^- `([^`]+)`/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[1]) {
        existing.add(m[1]);
      }
    }
  } catch {
    // File doesn't exist yet — that's fine
  }
  return existing;
}

export function persistExtractedFacts(
  workspaceDir: string,
  newFacts: ExtractedFact[],
  opts?: { dryRun?: boolean; verbose?: boolean },
): { written: number; skipped: number; total: number } {
  const memoryDir = path.join(workspaceDir, "memory");
  const factsPath = path.join(memoryDir, FACTS_FILENAME);

  // Load existing facts for dedup
  const existingValues = loadExistingFacts(factsPath);
  const dedupedFacts = newFacts.filter((f) => !existingValues.has(f.value));

  if (dedupedFacts.length === 0) {
    return { written: 0, skipped: newFacts.length, total: existingValues.size };
  }

  // Read existing content (minus header) to append
  let existingBody = "";
  try {
    const content = fs.readFileSync(factsPath, "utf-8");
    // Strip header to reconstruct
    const headerEnd = content.indexOf("### ");
    if (headerEnd >= 0) {
      existingBody = content.slice(headerEnd);
    }
  } catch {
    // No existing file
  }

  const newBody = formatFactsAsMarkdown(dedupedFacts);
  let combined = FACTS_HEADER + newBody + (existingBody ? "\n---\n\n" + existingBody : "");

  // Truncate if too large (keep newest, trim from the end)
  if (combined.length > MAX_FACTS_FILE_CHARS) {
    combined = combined.slice(0, MAX_FACTS_FILE_CHARS).trimEnd() + "\n\n*(truncated)*\n";
  }

  if (opts?.dryRun) {
    if (opts.verbose) {
      console.log(`[dry-run] Would write ${dedupedFacts.length} new facts to ${factsPath}`);
      console.log(newBody);
    }
    return {
      written: dedupedFacts.length,
      skipped: newFacts.length - dedupedFacts.length,
      total: existingValues.size + dedupedFacts.length,
    };
  }

  fs.mkdirSync(memoryDir, { recursive: true });
  fs.writeFileSync(factsPath, combined, "utf-8");

  return {
    written: dedupedFacts.length,
    skipped: newFacts.length - dedupedFacts.length,
    total: existingValues.size + dedupedFacts.length,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const { dryRun, verbose, hours, agentFilter } = parseCliArgs();
  const agents = agentFilter ? [agentFilter] : listAgentIds();

  if (verbose) {
    console.log(
      `[extract-facts] scanning ${agents.length} agent(s), last ${hours}h, dryRun=${dryRun}`,
    );
  }

  let totalWritten = 0;
  let totalSkipped = 0;

  for (const agentId of agents) {
    const sessionsDir = resolveAgentSessionsDir(agentId);
    const workspaceDir = resolveAgentWorkspaceDir(agentId);
    const transcripts = findRecentTranscripts(sessionsDir, hours);

    if (verbose) {
      console.log(
        `[extract-facts] agent=${agentId}: ${transcripts.length} transcripts in ${sessionsDir}`,
      );
    }

    if (transcripts.length === 0) {
      continue;
    }

    // Extract facts from all transcripts
    const allFacts: ExtractedFact[] = [];
    for (const transcript of transcripts) {
      const text = readTranscriptText(transcript);
      if (!text) {
        continue;
      }
      const facts = extractFactsFromText(text);
      for (const fact of facts) {
        fact.source = path.basename(transcript);
      }
      allFacts.push(...facts);
    }

    if (allFacts.length === 0) {
      if (verbose) {
        console.log(`[extract-facts] agent=${agentId}: no facts found`);
      }
      continue;
    }

    const result = persistExtractedFacts(workspaceDir, allFacts, { dryRun, verbose });
    totalWritten += result.written;
    totalSkipped += result.skipped;

    if (verbose || result.written > 0) {
      console.log(
        `[extract-facts] agent=${agentId}: wrote=${result.written} skipped=${result.skipped} total=${result.total}`,
      );
    }
  }

  if (totalWritten > 0 || verbose) {
    console.log(`[extract-facts] done: wrote=${totalWritten} skipped=${totalSkipped}`);
  }
}

// Run when executed directly
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith("extract-facts.ts") || process.argv[1].endsWith("extract-facts.js"));

if (isDirectExecution) {
  main();
}
