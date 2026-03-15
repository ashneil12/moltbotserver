export type EmbeddedContextFile = { path: string; content: string };

export type FailoverReason =
  | "auth"
  | "auth_permanent"
  | "format"
  | "rate_limit"
  | "overloaded"
  | "billing"
  | "timeout"
  | "model_not_found"
  | "session_expired"
  | "unknown";

/**
 * Classifies how a failover error should be handled:
 * - `retry`: Same request will likely succeed on retry (rate_limit, timeout, overloaded)
 * - `adapt`: Goal is achievable but needs a different approach (format errors, context overflow)
 * - `abandon`: This operation is fundamentally broken (auth_permanent, model_not_found, billing)
 */
export type FailoverFixability = "retry" | "adapt" | "abandon";
