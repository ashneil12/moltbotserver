/**
 * Context Management Module
 *
 * Context management is now handled by OpenClaw's built-in compaction system.
 * Use OPENCLAW_CONTEXT_PERCENT env var to control compaction aggressiveness.
 *
 * This module is intentionally minimal — the custom rotation, assembler,
 * and memory maker agents have been removed in favor of native features.
 */

/** Sentinel indicating context management is handled natively. */
export const CONTEXT_MANAGED_NATIVELY = true;
