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
  type?:
    | "crm"
    | "financial"
    | "email"
    | "health"
    | "config"
    | "tool_output"
    | "general";
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
  replacement: string;
}

const PII_PATTERNS: PiiPattern[] = [
  // US Social Security Numbers (XXX-XX-XXXX)
  {
    name: "ssn",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[SSN-REDACTED]",
  },
  // Credit card numbers (13-19 digits, optionally separated by spaces or dashes)
  {
    name: "credit_card",
    regex: /\b(?:\d[ -]*?){13,19}\b/g,
    replacement: "[CC-REDACTED]",
  },
  // US phone numbers
  {
    name: "phone_us",
    regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: "[PHONE-REDACTED]",
  },
  // International phone (+ country code, 8-15 digits)
  {
    name: "phone_intl",
    regex: /\+\d{1,3}[-.\s]?\d{4,14}\b/g,
    replacement: "[PHONE-REDACTED]",
  },
  // Personal email addresses (non-corporate-looking)
  {
    name: "personal_email",
    regex:
      /\b[a-zA-Z0-9._%+-]+@(?:gmail|yahoo|hotmail|outlook|aol|icloud|protonmail|fastmail|yandex|mail)\.\w{2,}\b/gi,
    replacement: "[EMAIL-REDACTED]",
  },
  // Dollar amounts ($X,XXX.XX or $X.XXM/K/B)
  {
    name: "dollar_amount",
    regex: /\$\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?(?:\s*[MKBmkb](?:illion)?)?/g,
    replacement: "[AMOUNT-REDACTED]",
  },
  // Large numbers with currency context (e.g., "revenue of 2.3 million")
  {
    name: "financial_figure",
    regex:
      /\b\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s*(?:million|billion|thousand|[MKBmkb])\b/gi,
    replacement: "[AMOUNT-REDACTED]",
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
export function classifyData(
  content: string,
  metadata?: DataMetadata,
): ClassificationResult {
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
    // Create a fresh regex to avoid shared state
    const freshRegex = new RegExp(pii.regex.source, pii.regex.flags);
    if (freshRegex.test(content)) {
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
    // Create fresh regex to reset lastIndex for global patterns
    const freshRegex = new RegExp(pattern.regex.source, pattern.regex.flags);
    result = result.replace(freshRegex, pattern.replacement);
  }
  return result;
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
