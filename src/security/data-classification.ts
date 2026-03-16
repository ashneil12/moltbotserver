/**
 * Data classification and privacy controls.
 *
 * Implements a three-tier classification system:
 * - CONFIDENTIAL: owner DMs only (financials, CRM contacts, deal values, PII)
 * - INTERNAL: trusted group chats OK (strategic notes, tool outputs, system health)
 * - PUBLIC: no restrictions — safe everywhere
 *
 * Usage:
 * ```ts
 * const tier = classifyData("The deal is worth $450,000 closing Q2", { type: "crm" });
 * const allowed = isAllowedInContext(tier, { type: "group", isOwner: false });
 * const clean = filterForContext("Revenue is $2.3M", { type: "group", isOwner: false });
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum DataTier {
  /** Owner DMs only: financials, CRM contacts, deal values, personal emails */
  CONFIDENTIAL = "confidential",
  /** Group chats OK: strategic notes, tool outputs, health info */
  INTERNAL = "internal",
  /** No restrictions */
  PUBLIC = "public",
}

export interface MessageContext {
  /** Communication context type */
  type: "dm" | "group" | "channel" | "external";
  /** Whether the user is the bot owner */
  isOwner: boolean;
  /** Optional channel identifier for more granular rules */
  channelId?: string;
}

export interface DataMetadata {
  /** Content category hint */
  type?: "crm" | "financial" | "email" | "health" | "config" | "tool_output" | "general";
}

export interface ClassificationResult {
  /** Determined data tier */
  tier: DataTier;
  /** Which patterns were detected */
  detectedPatterns: string[];
  /** Confidence 0-100 */
  confidence: number;
}

// ---------------------------------------------------------------------------
// PII patterns
// ---------------------------------------------------------------------------

export interface PiiPattern {
  name: string;
  regex: RegExp;
  /** Precomputed global variant for replace-all (avoids per-call RegExp construction). */
  globalRegex: RegExp;
  replacement: string;
}

const PII_PATTERNS: PiiPattern[] = [
  // US Social Security Numbers (XXX-XX-XXXX)
  {
    name: "ssn",
    regex: /\b\d{3}-\d{2}-\d{4}\b/,
    globalRegex: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[SSN-REDACTED]",
  },
  // Credit card numbers in standard groupings (e.g., 4111-1111-1111-1111).
  // Requires at least one separator (space or dash) to avoid matching
  // timestamps, IDs, and other long digit sequences.
  {
    name: "credit_card",
    regex: /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{1,7}\b/,
    globalRegex: /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{1,7}\b/g,
    replacement: "[CC-REDACTED]",
  },
  // US phone numbers
  {
    name: "phone_us",
    regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
    globalRegex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: "[PHONE-REDACTED]",
  },
  // International phone (+ country code, 8-15 digits)
  {
    name: "phone_intl",
    regex: /\+\d{1,3}[-.\s]?\d{4,14}\b/,
    globalRegex: /\+\d{1,3}[-.\s]?\d{4,14}\b/g,
    replacement: "[PHONE-REDACTED]",
  },
  // Personal email addresses (non-corporate-looking)
  {
    name: "personal_email",
    regex:
      /\b[a-zA-Z0-9._%+-]+@(?:gmail|yahoo|hotmail|outlook|aol|icloud|protonmail|fastmail|yandex|mail)\.\w{2,}\b/i,
    globalRegex:
      /\b[a-zA-Z0-9._%+-]+@(?:gmail|yahoo|hotmail|outlook|aol|icloud|protonmail|fastmail|yandex|mail)\.\w{2,}\b/gi,
    replacement: "[EMAIL-REDACTED]",
  },
  // Dollar amounts ($X,XXX.XX or $X.XXM/K/B)
  {
    name: "dollar_amount",
    regex: /\$\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?(?:\s*[MKBmkb](?:illion)?)?/,
    globalRegex: /\$\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?(?:\s*[MKBmkb](?:illion)?)?/g,
    replacement: "[AMOUNT-REDACTED]",
  },
  // Large numbers with currency context (e.g., "revenue of 2.3 million")
  {
    name: "financial_figure",
    regex: /\b\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s*(?:million|billion|thousand|[MKBmkb])\b/i,
    globalRegex: /\b\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s*(?:million|billion|thousand|[MKBmkb])\b/gi,
    replacement: "[AMOUNT-REDACTED]",
  },
];

// ---------------------------------------------------------------------------
// Developer secret patterns (output-facing redaction)
// ---------------------------------------------------------------------------

export interface SecretPattern {
  name: string;
  regex: RegExp;
  /** Precomputed global variant for replace-all (avoids per-call RegExp construction). */
  globalRegex: RegExp;
  replacement: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // OpenAI / compatible provider keys (sk-...)
  {
    name: "openai_key",
    regex: /\bsk-[A-Za-z0-9_-]{20,}\b/,
    globalRegex: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[SECRET-REDACTED]",
  },
  // GitHub personal access tokens
  {
    name: "github_pat",
    regex: /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}\b/,
    globalRegex: /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}\b/g,
    replacement: "[SECRET-REDACTED]",
  },
  // GitHub OAuth / App tokens
  {
    name: "github_oauth",
    regex: /\b(?:gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]{20,}\b/,
    globalRegex: /\b(?:gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]{20,}\b/g,
    replacement: "[SECRET-REDACTED]",
  },
  // Slack tokens
  {
    name: "slack_token",
    regex: /\b(?:xox[baprs]|xapp)-[A-Za-z0-9-]{10,}\b/,
    globalRegex: /\b(?:xox[baprs]|xapp)-[A-Za-z0-9-]{10,}\b/g,
    replacement: "[SECRET-REDACTED]",
  },
  // Stripe keys
  {
    name: "stripe_key",
    regex: /\b(?:sk_live_|pk_live_|sk_test_|pk_test_|rk_live_|rk_test_)[A-Za-z0-9]{10,}\b/,
    globalRegex: /\b(?:sk_live_|pk_live_|sk_test_|pk_test_|rk_live_|rk_test_)[A-Za-z0-9]{10,}\b/g,
    replacement: "[SECRET-REDACTED]",
  },
  // Google API keys
  {
    name: "google_api_key",
    regex: /\bAIza[0-9A-Za-z\-_]{20,}\b/,
    globalRegex: /\bAIza[0-9A-Za-z\-_]{20,}\b/g,
    replacement: "[SECRET-REDACTED]",
  },
  // AWS access key IDs
  {
    name: "aws_access_key",
    regex: /\bAKIA[0-9A-Z]{16}\b/,
    globalRegex: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: "[SECRET-REDACTED]",
  },
  // Telegram bot tokens (digits:alphanumeric)
  {
    name: "telegram_bot_token",
    regex: /\b\d{8,}:[A-Za-z0-9_-]{20,}\b/,
    globalRegex: /\b\d{8,}:[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[SECRET-REDACTED]",
  },
  // Discord bot tokens (base64-ish, 59+ chars)
  {
    name: "discord_bot_token",
    regex: /\b[MN][A-Za-z0-9]{23,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/,
    globalRegex: /\b[MN][A-Za-z0-9]{23,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/g,
    replacement: "[SECRET-REDACTED]",
  },
  // Groq / Perplexity / npm / Anthropic prefixed keys
  {
    name: "prefixed_api_key",
    regex: /\b(?:gsk_|pplx-|npm_|ant-api)[A-Za-z0-9_-]{10,}\b/,
    globalRegex: /\b(?:gsk_|pplx-|npm_|ant-api)[A-Za-z0-9_-]{10,}\b/g,
    replacement: "[SECRET-REDACTED]",
  },
  // Generic connection strings (postgres://, mysql://, redis://, mongodb://)
  {
    name: "connection_string",
    regex: /\b(?:postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^\s"'`]{10,}/,
    globalRegex: /\b(?:postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^\s"'`]{10,}/g,
    replacement: "[CONNECTION-REDACTED]",
  },
  // Bearer tokens in output (Authorization: Bearer ...)
  {
    name: "bearer_token",
    regex: /Bearer\s+[A-Za-z0-9._\-+=]{18,}/,
    globalRegex: /Bearer\s+[A-Za-z0-9._\-+=]{18,}/g,
    replacement: "Bearer [TOKEN-REDACTED]",
  },
  // PEM private keys
  {
    name: "private_key",
    regex: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/,
    globalRegex: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    replacement: "[PRIVATE-KEY-REDACTED]",
  },
  // JWTs (three base64url segments)
  {
    name: "jwt",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    globalRegex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: "[JWT-REDACTED]",
  },
  // Supabase service role keys (eyJ prefix, long)
  {
    name: "supabase_key",
    regex: /\bsbp_[A-Za-z0-9]{20,}\b/,
    globalRegex: /\bsbp_[A-Za-z0-9]{20,}\b/g,
    replacement: "[SECRET-REDACTED]",
  },
  // Generic high-entropy hex strings that look like secrets (32+ hex chars)
  // Only match when preceded by common secret-assignment patterns
  {
    name: "hex_secret",
    regex: /(?:secret|token|key|password|api_key|apikey)\s*[=:]\s*["']?([0-9a-f]{32,})["']?/i,
    globalRegex:
      /(?:secret|token|key|password|api_key|apikey)\s*[=:]\s*["']?([0-9a-f]{32,})["']?/gi,
    replacement: "[SECRET-REDACTED]",
  },
];

// ---------------------------------------------------------------------------
// Confidential content patterns
// ---------------------------------------------------------------------------

interface ConfidentialPattern {
  name: string;
  regex: RegExp;
  tier: DataTier;
  weight: number;
}

const CLASSIFICATION_PATTERNS: ConfidentialPattern[] = [
  // Financial / deal patterns
  {
    name: "deal_value",
    regex: /\b(?:deal|contract|proposal|bid)\s+(?:is\s+)?(?:worth|valued?\s+at|for)\s+\$/i,
    tier: DataTier.CONFIDENTIAL,
    weight: 30,
  },
  {
    name: "revenue",
    regex: /\b(?:revenue|earnings|profit|income|EBITDA|ARR|MRR)\s+(?:is|of|at|was)\s/i,
    tier: DataTier.CONFIDENTIAL,
    weight: 25,
  },
  {
    name: "salary_comp",
    regex: /\b(?:salary|compensation|bonus|equity|vesting|stock\s+options?)\b/i,
    tier: DataTier.CONFIDENTIAL,
    weight: 30,
  },
  {
    name: "bank_account",
    regex: /\b(?:bank\s+account|routing\s+number|account\s+number|IBAN|SWIFT)\b/i,
    tier: DataTier.CONFIDENTIAL,
    weight: 35,
  },
  {
    name: "ssn_mention",
    regex: /\b(?:social\s+security|SSN|tax\s+ID|EIN)\b/i,
    tier: DataTier.CONFIDENTIAL,
    weight: 35,
  },

  // CRM / contact patterns
  {
    name: "crm_contact",
    regex: /\b(?:lead|prospect|pipeline|opportunity|deal\s+stage|close\s+date)\b/i,
    tier: DataTier.CONFIDENTIAL,
    weight: 20,
  },
  {
    name: "personal_address",
    regex: /\b\d+\s+\w+\s+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln)\b/i,
    tier: DataTier.CONFIDENTIAL,
    weight: 20,
  },

  // Internal / strategic patterns
  {
    name: "strategy",
    regex: /\b(?:strategic\s+plan|roadmap|competitive\s+advantage|go-to-market|GTM)\b/i,
    tier: DataTier.INTERNAL,
    weight: 15,
  },
  {
    name: "internal_metric",
    regex: /\b(?:churn\s+rate|conversion\s+rate|CAC|LTV|burn\s+rate)\b/i,
    tier: DataTier.INTERNAL,
    weight: 15,
  },
  {
    name: "system_health",
    regex: /\b(?:error\s+rate|uptime|latency\s+p\d{2}|incident\s+report)\b/i,
    tier: DataTier.INTERNAL,
    weight: 10,
  },
];

// ---------------------------------------------------------------------------
// Classification logic
// ---------------------------------------------------------------------------

/**
 * Classify content into a data tier based on pattern matching and metadata.
 */
export function classifyData(content: string, metadata?: DataMetadata): ClassificationResult {
  const detectedPatterns: string[] = [];
  let maxTier = DataTier.PUBLIC;
  let totalWeight = 0;

  // Check metadata hint first
  if (metadata?.type === "crm" || metadata?.type === "financial") {
    maxTier = DataTier.CONFIDENTIAL;
    detectedPatterns.push(`metadata:${metadata.type}`);
    totalWeight += 20;
  } else if (metadata?.type === "email") {
    maxTier = DataTier.CONFIDENTIAL;
    detectedPatterns.push("metadata:email");
    totalWeight += 15;
  } else if (metadata?.type === "health" || metadata?.type === "config") {
    maxTier = DataTier.INTERNAL;
    detectedPatterns.push(`metadata:${metadata.type}`);
    totalWeight += 10;
  }

  // Check content patterns
  for (const pattern of CLASSIFICATION_PATTERNS) {
    if (pattern.regex.test(content)) {
      detectedPatterns.push(pattern.name);
      totalWeight += pattern.weight;
      if (tierPriority(pattern.tier) > tierPriority(maxTier)) {
        maxTier = pattern.tier;
      }
    }
  }

  // Check PII patterns (always CONFIDENTIAL)
  for (const pii of PII_PATTERNS) {
    // Patterns are non-global so .test() is safe without lastIndex reset
    if (pii.regex.test(content)) {
      detectedPatterns.push(`pii:${pii.name}`);
      totalWeight += 25;
      maxTier = DataTier.CONFIDENTIAL;
    }
  }

  const confidence = Math.min(100, Math.round(totalWeight * 1.5));

  return {
    tier: maxTier,
    detectedPatterns,
    confidence,
  };
}

function tierPriority(tier: DataTier): number {
  switch (tier) {
    case DataTier.CONFIDENTIAL:
      return 3;
    case DataTier.INTERNAL:
      return 2;
    case DataTier.PUBLIC:
      return 1;
  }
}

// ---------------------------------------------------------------------------
// Context gating
// ---------------------------------------------------------------------------

/**
 * Determine whether data of the given tier is allowed in the given context.
 *
 * Rules:
 * - CONFIDENTIAL → only owner DMs
 * - INTERNAL → owner DMs and group chats (not external/channel)
 * - PUBLIC → everywhere
 */
export function isAllowedInContext(tier: DataTier, context: MessageContext): boolean {
  if (tier === DataTier.PUBLIC) {
    return true;
  }

  if (tier === DataTier.CONFIDENTIAL) {
    return context.type === "dm" && context.isOwner;
  }

  if (tier === DataTier.INTERNAL) {
    if (context.type === "external") {
      return false;
    }
    if (context.type === "dm") {
      return context.isOwner;
    }
    // Group and channel OK for internal data
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Content filtering
// ---------------------------------------------------------------------------

/**
 * Redact PII from text using the PII pattern set.
 */
export function redactPII(text: string): string {
  let result = text;
  for (const pattern of PII_PATTERNS) {
    // Use precomputed global variant. Reset lastIndex for safety since global
    // regexes are stateful — without this, consecutive calls with the same
    // pattern could skip matches if .test() was called between uses.
    pattern.globalRegex.lastIndex = 0;
    result = result.replace(pattern.globalRegex, pattern.replacement);
  }
  return result;
}

/**
 * Redact developer secrets from text using the secret pattern set.
 *
 * This is the output-facing companion to the logging-layer redaction in
 * `logging/redact.ts`. It catches API keys, tokens, connection strings,
 * JWTs, and private key markers that might leak through agent responses.
 */
export function redactSecrets(text: string): { text: string; redactedPatterns: string[] } {
  let result = text;
  const redactedPatterns: string[] = [];
  for (const pattern of SECRET_PATTERNS) {
    // Reset lastIndex for safety — global regexes are stateful.
    pattern.globalRegex.lastIndex = 0;
    const before = result;
    result = result.replace(pattern.globalRegex, pattern.replacement);
    if (result !== before) {
      redactedPatterns.push(pattern.name);
    }
  }
  return { text: result, redactedPatterns };
}

/**
 * Check whether text contains any known secret patterns.
 * Lightweight check (no replacement) for fast detection.
 */
export function containsSecrets(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.regex.test(text));
}

/**
 * Filter a message for a given context.
 *
 * - If the content is classified above the allowed tier for the context,
 *   all PII and financial data is redacted.
 * - If the content contains financial patterns and the context is external,
 *   financial figures are redacted.
 * - Otherwise, the content is returned as-is.
 */
export function filterForContext(
  message: string,
  context: MessageContext,
  metadata?: DataMetadata,
): string {
  const classification = classifyData(message, metadata);

  // If the data tier is allowed in this context, return as-is
  if (isAllowedInContext(classification.tier, context)) {
    return message;
  }

  // For disallowed tiers, redact PII and sensitive data
  return redactPII(message);
}

/**
 * Get a human-readable description of what's allowed in a given context.
 * Useful for system prompt generation.
 */
export function describeContextPolicy(context: MessageContext): string {
  const lines: string[] = [];

  if (context.type === "dm" && context.isOwner) {
    lines.push("All data tiers allowed (owner DM).");
    lines.push("You may share confidential, internal, and public information.");
  } else if (context.type === "group") {
    lines.push("Internal and public data only (group chat).");
    lines.push("DO NOT share: financial details, personal emails, CRM contacts, deal values.");
    lines.push("OK to share: strategic notes, system health, tool outputs.");
  } else if (context.type === "channel") {
    lines.push("Internal and public data only (channel).");
    lines.push("DO NOT share any confidential information.");
  } else if (context.type === "external") {
    lines.push("Public data only (external context).");
    lines.push("DO NOT share any internal or confidential information.");
    lines.push("Redact all financial figures, personal data, and strategic information.");
  } else {
    lines.push("Public data only (unknown context — defaulting to restrictive).");
  }

  return lines.join("\n");
}
