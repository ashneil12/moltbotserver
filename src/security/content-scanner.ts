/**
 * Two-stage ACIP content scanner for external/untrusted content.
 *
 * Stage 1: Deterministic regex-based scanning — fast, predictable, zero false negatives
 *          on known patterns. Covers prompt injection, SQL injection, role marker
 *          spoofing, data exfiltration, and command injection.
 *
 * Stage 2: Frontier model scanning — runs only for ambiguous cases (score 20–70).
 *          Interface is pluggable; callers inject their own LLM scanner.
 *
 * Usage:
 * ```ts
 * const result = await scanContent(emailBody, {
 *   source: "email",
 *   sender: "user@example.com",
 * });
 * if (result.quarantined) {
 *   // do not pass to agent without additional review
 * }
 * // result.sanitizedContent is always safe to pass to the agent
 * ```
 */

import { detectSuspiciousPatterns, wrapExternalContent } from "./external-content.js";
import type { ExternalContentSource } from "./external-content.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FindingCategory =
  | "prompt_injection"
  | "sql_injection"
  | "role_marker"
  | "data_exfiltration"
  | "command_injection"
  | "encoding_smuggling";

export type FindingSeverity = "low" | "medium" | "high" | "critical";

export interface Finding {
  /** Which pattern family matched */
  category: FindingCategory;
  /** How severe this match is on its own */
  severity: FindingSeverity;
  /** Matched pattern source (regex source string) */
  pattern: string;
  /** Brief human-readable description */
  description: string;
  /** Weight used in risk score calculation (0–20) */
  weight: number;
}

export interface FrontierScanResult {
  /** Whether the frontier model considers the content safe */
  safe: boolean;
  /** Model confidence 0–100 */
  confidence: number;
  /** Textual findings from the model */
  findings: string[];
}

/**
 * Pluggable frontier scanner interface.
 * Callers provide their own implementation that sends
 * the (already deterministically sanitized) content to a frontier model
 * running in a sandboxed context.
 */
export type FrontierScanner = (sanitizedContent: string) => Promise<FrontierScanResult>;

export interface ScanResult {
  /** Overall safety determination */
  safe: boolean;
  /** Composite risk score 0–100 */
  riskScore: number;
  /** Confidence in the assessment 0–100 */
  confidence: number;
  /** Individual findings from both stages */
  findings: Finding[];
  /** Whether content was quarantined (score ≥ 70) */
  quarantined: boolean;
  /** Content wrapped with security boundary markers — always safe to pass to agent */
  sanitizedContent: string;
  /** Whether the frontier scanner was invoked */
  frontierScanned: boolean;
  /** Raw frontier result if stage 2 ran */
  frontierResult?: FrontierScanResult;
}

export interface ScanOptions {
  /** Source type for boundary marker metadata */
  source: ExternalContentSource;
  /** Sender identifier (email address, webhook source, etc.) */
  sender?: string;
  /** Subject line if applicable */
  subject?: string;
  /** Optional frontier scanner for stage 2 */
  frontierScanner?: FrontierScanner;
  /**
   * Score threshold above which content is quarantined.
   * Default: 70
   */
  quarantineThreshold?: number;
  /**
   * Score range within which frontier scanning is triggered.
   * Default: [20, 70]
   */
  frontierScanRange?: [low: number, high: number];
}

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHTS: Record<FindingSeverity, number> = {
  low: 5,
  medium: 10,
  high: 15,
  critical: 20,
};

interface PatternDef {
  regex: RegExp;
  category: FindingCategory;
  severity: FindingSeverity;
  description: string;
}

/**
 * All deterministic detection patterns.
 *
 * Patterns from the existing `external-content.ts` SUSPICIOUS_PATTERNS are
 * re-declared here with category/severity metadata. This avoids coupling to
 * the other module's internal array while ensuring full coverage.
 */
const SCANNER_PATTERNS: PatternDef[] = [
  // ── Prompt injection ────────────────────────────────────────────────
  {
    regex: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i,
    category: "prompt_injection",
    severity: "critical",
    description: "Attempts to override prior instructions",
  },
  {
    regex: /disregard\s+(all\s+)?(previous|prior|above)/i,
    category: "prompt_injection",
    severity: "critical",
    description: "Attempts to disregard prior context",
  },
  {
    regex: /forget\s+(everything|all|your)\s+(\w+\s+)?(instructions?|rules?|guidelines?)/i,
    category: "prompt_injection",
    severity: "critical",
    description: "Attempts to reset agent instructions",
  },
  {
    regex: /you\s+are\s+now\s+(a|an)\s+/i,
    category: "prompt_injection",
    severity: "high",
    description: "Role reassignment attempt",
  },
  {
    regex: /new\s+instructions?:/i,
    category: "prompt_injection",
    severity: "high",
    description: "Attempts to inject new instructions",
  },
  {
    regex: /\bact\s+as\s+(a|an|my|the)\b/i,
    category: "prompt_injection",
    severity: "medium",
    description: "Role assumption directive",
  },
  {
    regex: /\bpretend\s+(you('re|\s+are)|to\s+be)\b/i,
    category: "prompt_injection",
    severity: "medium",
    description: "Role pretense directive",
  },
  {
    regex: /\b(jailbreak|do\s+anything\s+now|DAN\s+mode)\b/i,
    category: "prompt_injection",
    severity: "critical",
    description: "Known jailbreak pattern",
  },
  {
    regex: /\boverride\s+(all\s+)?(safety|security|restrictions?|rules?)\b/i,
    category: "prompt_injection",
    severity: "critical",
    description: "Attempts to override safety constraints",
  },

  // ── Role marker spoofing ────────────────────────────────────────────
  {
    regex: /system\s*:?\s*(prompt|override|command)/i,
    category: "role_marker",
    severity: "critical",
    description: "System prompt override attempt",
  },
  {
    regex: /<\/?(system|assistant|user)>/i,
    category: "role_marker",
    severity: "high",
    description: "XML role tag injection",
  },
  {
    regex: /\]\s*\n\s*\[?(system|assistant|user)\]?:/i,
    category: "role_marker",
    severity: "high",
    description: "Bracket-style role marker injection",
  },
  {
    regex: /<\|im_start\|>\s*(system|assistant|user)/i,
    category: "role_marker",
    severity: "critical",
    description: "ChatML role marker injection",
  },
  {
    regex: /\[INST\]|\[\/INST\]|<<SYS>>|<\/SYS>>/i,
    category: "role_marker",
    severity: "critical",
    description: "Llama/Mistral role marker injection",
  },
  {
    regex: /\bSYSTEM\s*:\s*\n/,
    category: "role_marker",
    severity: "high",
    description: "Line-initial SYSTEM: role marker",
  },
  {
    regex: /\bADMIN\s*(MODE|OVERRIDE|ACCESS)\s*:?\s*(ENABLED|ON|TRUE)/i,
    category: "role_marker",
    severity: "critical",
    description: "False admin authority claim",
  },

  // ── SQL injection ──────────────────────────────────────────────────
  {
    regex: /\bUNION\s+(ALL\s+)?SELECT\b/i,
    category: "sql_injection",
    severity: "high",
    description: "UNION SELECT injection",
  },
  {
    regex: /\bDROP\s+(TABLE|DATABASE|INDEX)\b/i,
    category: "sql_injection",
    severity: "critical",
    description: "DROP statement injection",
  },
  {
    regex: /\bDELETE\s+FROM\b/i,
    category: "sql_injection",
    severity: "high",
    description: "DELETE FROM injection",
  },
  {
    regex: /\bINSERT\s+INTO\b/i,
    category: "sql_injection",
    severity: "medium",
    description: "INSERT INTO injection",
  },
  {
    regex: /\bUPDATE\s+\w+\s+SET\b/i,
    category: "sql_injection",
    severity: "medium",
    description: "UPDATE SET injection",
  },
  {
    regex: /['"];\s*--/,
    category: "sql_injection",
    severity: "high",
    description: "SQL comment termination pattern",
  },
  {
    regex: /\bOR\s+['"]?1['"]?\s*=\s*['"]?1['"]?/i,
    category: "sql_injection",
    severity: "high",
    description: "OR 1=1 tautology injection",
  },
  {
    regex: /\bEXEC\s*\(\s*['@]/i,
    category: "sql_injection",
    severity: "critical",
    description: "Dynamic SQL execution",
  },
  {
    regex: /\bxp_cmdshell\b/i,
    category: "sql_injection",
    severity: "critical",
    description: "SQL Server command shell",
  },

  // ── Command injection ──────────────────────────────────────────────
  {
    regex: /\bexec\b.*command\s*=/i,
    category: "command_injection",
    severity: "critical",
    description: "Exec command injection",
  },
  {
    regex: /elevated\s*=\s*true/i,
    category: "command_injection",
    severity: "high",
    description: "Privilege escalation flag",
  },
  {
    regex: /rm\s+-rf/i,
    category: "command_injection",
    severity: "critical",
    description: "Recursive file deletion command",
  },
  {
    regex: /delete\s+all\s+(emails?|files?|data)/i,
    category: "command_injection",
    severity: "high",
    description: "Mass deletion command",
  },
  {
    regex: /\bcurl\s+.*\|\s*(bash|sh|zsh)\b/i,
    category: "command_injection",
    severity: "critical",
    description: "Remote script execution via curl pipe",
  },
  {
    regex: /\bwget\s+.*&&\s*(bash|sh|chmod)\b/i,
    category: "command_injection",
    severity: "critical",
    description: "Remote script download and execution",
  },
  {
    regex: /\b(sudo|chmod\s+777|chown\s+root)\b/i,
    category: "command_injection",
    severity: "high",
    description: "Privilege escalation command",
  },

  // ── Data exfiltration ──────────────────────────────────────────────
  {
    regex: /\b(reveal|show|display|output)\s+(your\s+)?(system\s+prompt|instructions|rules)/i,
    category: "data_exfiltration",
    severity: "high",
    description: "System prompt extraction attempt",
  },
  {
    regex: /\bsend\s+.{0,50}(https?:\/\/|ftp:\/\/|mailto:)/i,
    category: "data_exfiltration",
    severity: "high",
    description: "Data exfiltration to external endpoint",
  },
  {
    regex: /\b(fetch|get|download)\s+.*\/(etc\/passwd|\.env|\.ssh)/i,
    category: "data_exfiltration",
    severity: "critical",
    description: "Sensitive file access attempt",
  },

  // ── Encoding / smuggling ───────────────────────────────────────────
  {
    regex: /\b(base64|atob|btoa)\s*\(/i,
    category: "encoding_smuggling",
    severity: "medium",
    description: "Base64 encoding/decoding function call",
  },
  {
    regex: /\beval\s*\(/i,
    category: "encoding_smuggling",
    severity: "high",
    description: "Dynamic code evaluation",
  },
  {
    regex: /\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){3,}/i,
    category: "encoding_smuggling",
    severity: "medium",
    description: "Hex-encoded character sequence",
  },
];

// ---------------------------------------------------------------------------
// Stage 1: Deterministic scanning
// ---------------------------------------------------------------------------

function runDeterministicScan(content: string): {
  findings: Finding[];
  riskScore: number;
} {
  const findings: Finding[] = [];

  for (const def of SCANNER_PATTERNS) {
    if (def.regex.test(content)) {
      findings.push({
        category: def.category,
        severity: def.severity,
        pattern: def.regex.source,
        description: def.description,
        weight: SEVERITY_WEIGHTS[def.severity],
      });
    }
  }

  // Also run the legacy detection as a safety net.
  // The patterns above are a superset, but if the legacy detector
  // catches something we missed, include it as a medium-severity finding.
  if (findings.length === 0) {
    const legacyMatches = detectSuspiciousPatterns(content);
    for (const src of legacyMatches) {
      findings.push({
        category: "prompt_injection",
        severity: "medium",
        pattern: src,
        description: "Legacy pattern match",
        weight: SEVERITY_WEIGHTS.medium,
      });
    }
  }

  // Compute risk score: sqrt(rawSum) * 15, clamped to 0–100.
  // This gives diminishing returns for multiple findings:
  //   Single critical (weight=20) → sqrt(20)*15 ≈ 67
  //   Two criticals (weight=40)   → sqrt(40)*15 ≈ 95
  //   Three criticals (weight=60) → 100 (clamped)
  const rawSum = findings.reduce((sum, f) => sum + f.weight, 0);
  const riskScore = Math.min(100, Math.round(Math.sqrt(rawSum) * 15));

  return { findings, riskScore };
}

// ---------------------------------------------------------------------------
// Stage 2: Frontier model scanning (pluggable)
// ---------------------------------------------------------------------------

function combineFrontierResult(
  deterministicScore: number,
  frontierResult: FrontierScanResult,
): { riskScore: number; confidence: number } {
  // If frontier says unsafe, boost the score
  const frontierBoost = frontierResult.safe ? 0 : 25;
  const combinedScore = Math.min(100, deterministicScore + frontierBoost);

  // Confidence: blend deterministic certainty with frontier confidence
  // High deterministic score = high confidence regardless
  const deterministicConfidence = deterministicScore >= 70 ? 95 : deterministicScore >= 20 ? 60 : 90;
  const blendedConfidence = Math.round(
    deterministicConfidence * 0.4 + frontierResult.confidence * 0.6,
  );

  return { riskScore: combinedScore, confidence: blendedConfidence };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const DEFAULT_QUARANTINE_THRESHOLD = 70;
const DEFAULT_FRONTIER_RANGE: [number, number] = [20, 70];

/**
 * Scan untrusted content through a two-stage pipeline.
 *
 * Stage 1 always runs (deterministic regex). Stage 2 (frontier model)
 * runs only if the score falls in the ambiguous range and a scanner
 * is provided.
 *
 * The returned `sanitizedContent` is always wrapped with ACIP security
 * boundary markers and is safe to pass to the agent.
 */
export async function scanContent(
  content: string,
  options: ScanOptions,
): Promise<ScanResult> {
  const quarantineThreshold = options.quarantineThreshold ?? DEFAULT_QUARANTINE_THRESHOLD;
  const [frontierLow, frontierHigh] = options.frontierScanRange ?? DEFAULT_FRONTIER_RANGE;

  // ── Stage 1 ─────────────────────────────────────────────────────────
  const stage1 = runDeterministicScan(content);

  let riskScore = stage1.riskScore;
  let confidence = stage1.riskScore >= 70 ? 95 : stage1.riskScore < 20 ? 90 : 55;
  let frontierScanned = false;
  let frontierResult: FrontierScanResult | undefined;

  // ── Stage 2 (conditional) ───────────────────────────────────────────
  if (
    options.frontierScanner &&
    riskScore >= frontierLow &&
    riskScore < frontierHigh
  ) {
    try {
      frontierResult = await options.frontierScanner(content);
      frontierScanned = true;
      const combined = combineFrontierResult(riskScore, frontierResult);
      riskScore = combined.riskScore;
      confidence = combined.confidence;

      // Merge frontier findings into our findings list
      if (frontierResult.findings.length > 0) {
        for (const desc of frontierResult.findings) {
          stage1.findings.push({
            category: "prompt_injection",
            severity: "medium",
            pattern: "frontier_model",
            description: desc,
            weight: SEVERITY_WEIGHTS.medium,
          });
        }
      }
    } catch {
      // Frontier scan failure: fall back to deterministic result.
      // Bump confidence down since we couldn't verify.
      confidence = Math.max(30, confidence - 20);
    }
  }

  // ── Always wrap content with boundary markers ───────────────────────
  const quarantined = riskScore >= quarantineThreshold;

  const sanitizedContent = wrapExternalContent(content, {
    source: options.source,
    sender: options.sender,
    subject: options.subject,
    includeWarning: true,
  });

  return {
    safe: riskScore < quarantineThreshold,
    riskScore,
    confidence,
    findings: stage1.findings,
    quarantined,
    sanitizedContent,
    frontierScanned,
    frontierResult,
  };
}

/**
 * Synchronous convenience for callers that don't need frontier scanning.
 * Equivalent to `scanContent(content, { ...options, frontierScanner: undefined })`.
 */
export function scanContentSync(
  content: string,
  options: Omit<ScanOptions, "frontierScanner">,
): Omit<ScanResult, "frontierResult"> {
  const stage1 = runDeterministicScan(content);
  const quarantineThreshold = options.quarantineThreshold ?? DEFAULT_QUARANTINE_THRESHOLD;

  const riskScore = stage1.riskScore;
  const confidence = riskScore >= 70 ? 95 : riskScore < 20 ? 90 : 55;
  const quarantined = riskScore >= quarantineThreshold;

  const sanitizedContent = wrapExternalContent(content, {
    source: options.source,
    sender: options.sender,
    subject: options.subject,
    includeWarning: true,
  });

  return {
    safe: !quarantined,
    riskScore,
    confidence,
    findings: stage1.findings,
    quarantined,
    sanitizedContent,
    frontierScanned: false,
  };
}

// Re-export types that callers will need
export type { ExternalContentSource } from "./external-content.js";
