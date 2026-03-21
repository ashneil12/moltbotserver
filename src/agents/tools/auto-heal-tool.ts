/**
 * Auto-Heal Tool — agent-facing tool for autonomous code repair.
 *
 * Follows the TDD loop: diagnose → backup → test → fix → verify → journal.
 *
 * Actions:
 * - diagnose: Read error-journal, classify errors, suggest repair targets
 * - attempt-fix: backup → patch → run vitest → commit or rollback
 * - rollback: Restore a .bak file for a specific target
 * - journal: View auto-heal history
 * - status: Summary of pending/resolved/escalated errors
 *
 * Safety constraints:
 * - Leaf-only scope (tools/, skills/, utils/, cron/)
 * - Mandatory file backup before any edit
 * - 3-strike limit per error (3 distinct approaches max)
 * - Hard-reject modifications to trunk nodes (system-prompt, security, config)
 */

import fs from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import {
  resolveAutoHealJournalPath,
  resolveBackgroundFixesPath,
  checkFileScope,
  createAutoHealEntry,
  countAttempts,
  isMaxAttemptsReached,
  getMaxAttempts,
  readAllEntries as readAutoHealEntries,
  generateBackgroundFixesMd,
} from "../../cron/auto-heal-journal.js";
import {
  resolveErrorJournalPath,
  readPendingErrors,
  getErrorJournalSummary,
  markError,
} from "../../logging/error-journal.js";
import {
  buildEscalationMessage,
  buildSuccessNotification,
  type EscalationContext,
} from "./auto-heal-escalation.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

// ═══════════════════════════════════════════════════════════════════════════
// Schema
// ═══════════════════════════════════════════════════════════════════════════

const AUTO_HEAL_ACTIONS = ["diagnose", "attempt-fix", "rollback", "journal", "status"] as const;

const AutoHealToolSchema = Type.Object(
  {
    action: Type.Union(
      AUTO_HEAL_ACTIONS.map((a) => Type.Literal(a)),
      { description: "The action to perform." },
    ),
    /** Error reference ID (for attempt-fix). */
    errorRef: Type.Optional(
      Type.String({ description: "Error journal entry ID to attempt fixing." }),
    ),
    /** Target file path (for attempt-fix, rollback). */
    targetFile: Type.Optional(Type.String({ description: "Absolute path to the file to repair." })),
    /** Description of the fix approach (for attempt-fix). */
    approach: Type.Optional(
      Type.String({ description: "Brief description of the fix approach being tried." }),
    ),
    /** Test command to run for verification (for attempt-fix). */
    testCommand: Type.Optional(
      Type.String({
        description:
          "Vitest command for verification (e.g. 'npx vitest run src/agents/tools/my-tool.test.ts'). Required for attempt-fix.",
      }),
    ),
    /** Whether the test passed (for attempt-fix, reported by the agent after running exec). */
    testPassed: Type.Optional(
      Type.Boolean({ description: "Whether the verification test passed." }),
    ),
    /** Test output (for attempt-fix). */
    testOutput: Type.Optional(Type.String({ description: "Trimmed test output from vitest." })),
    /** Plain-English summary for the BACKGROUND_FIXES entry. */
    humanSummary: Type.Optional(
      Type.String({ description: "Plain-English summary of what was fixed (for the changelog)." }),
    ),
    /** Limit for journal/status queries. */
    limit: Type.Optional(Type.Number({ description: "Max entries to return." })),
  },
  { additionalProperties: true },
);

// ═══════════════════════════════════════════════════════════════════════════
// Tool Factory
// ═══════════════════════════════════════════════════════════════════════════

export function createAutoHealTool(options?: {
  /** Override base directory for journals (testing). */
  baseDir?: string;
  /** Workspace directory for BACKGROUND_FIXES.md output. */
  workspaceDir?: string;
}): AnyAgentTool {
  const errorJournalPath = resolveErrorJournalPath(options?.baseDir);
  const healJournalPath = resolveAutoHealJournalPath(options?.baseDir);
  const workspaceDir = options?.workspaceDir;

  return {
    label: "Auto Heal",
    name: "auto_heal",
    ownerOnly: true,
    description: `Autonomous code repair tool. Use this to diagnose and fix errors captured in the error journal.

ACTIONS:
- diagnose: Check error journal for pending errors. Returns classified errors with severity and suggested targets.
- attempt-fix: Report the result of a fix attempt. Requires errorRef, targetFile, approach, testCommand, and testPassed.
  The agent should: (1) backup the file, (2) apply a code fix, (3) run the test via exec, (4) call this with the result.
  On pass: commits the fix to the journal. On fail: records the failure for retry tracking.
- rollback: Restore a backed-up file. Provide targetFile (the .bak path is auto-resolved).
- journal: View auto-heal history (successes, failures, rollbacks).
- status: Get a summary of error journal + auto-heal state.

SAFETY RULES:
- Max ${getMaxAttempts()} distinct approaches per error. After that, the tool escalates automatically.
- Only files in tools/, skills/, utils/, cron/ can be modified (leaf nodes).
- Core system files (system-prompt.ts, security/, config/, Dockerfile, package.json) are hard-rejected.
- Always create a backup (.bak) before editing via exec: cp <file> <file>.bak
- Run the FULL test suite for the affected file after every fix attempt.`,
    parameters: AutoHealToolSchema,
    execute: async (_toolCallId, params) => {
      const action = readStringParam(params, "action", { required: true });

      switch (action) {
        case "diagnose":
          return jsonResult(handleDiagnose(errorJournalPath, healJournalPath));

        case "attempt-fix":
          return jsonResult(
            handleAttemptFix(
              params as Record<string, unknown>,
              errorJournalPath,
              healJournalPath,
              workspaceDir,
            ),
          );

        case "rollback":
          return jsonResult(handleRollback(params as Record<string, unknown>));

        case "journal":
          return jsonResult(handleJournal(healJournalPath, params as Record<string, unknown>));

        case "status":
          return jsonResult(handleStatus(errorJournalPath, healJournalPath));

        default:
          return jsonResult({ error: `Unknown action: ${String(action)}` });
      }
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Action Handlers
// ═══════════════════════════════════════════════════════════════════════════

function handleDiagnose(errorJournalPath: string, healJournalPath: string) {
  const pendingErrors = readPendingErrors(errorJournalPath);
  const summary = getErrorJournalSummary(errorJournalPath);

  // Group by severity and check which have exceeded max attempts
  const actionable = pendingErrors
    .filter((e) => !isMaxAttemptsReached(healJournalPath, e.id))
    .map((e) => {
      const attempts = countAttempts(healJournalPath, e.id);
      const scopeCheck = checkFileScope(e.sourceFile);
      return {
        errorId: e.id,
        sourceFile: e.sourceFile,
        errorMessage: e.errorMessage.slice(0, 200),
        severity: e.severity,
        occurrenceCount: e.occurrenceCount,
        previousAttempts: attempts,
        remainingAttempts: getMaxAttempts() - attempts,
        inScope: scopeCheck.allowed,
        scopeReason: scopeCheck.reason,
        toolContext: e.toolContext,
      };
    });

  const exhausted = pendingErrors
    .filter((e) => isMaxAttemptsReached(healJournalPath, e.id))
    .map((e) => ({
      errorId: e.id,
      sourceFile: e.sourceFile,
      errorMessage: e.errorMessage.slice(0, 200),
      severity: e.severity,
      status: "max-attempts-reached",
    }));

  return {
    summary,
    actionableErrors: actionable,
    exhaustedErrors: exhausted,
    guidance:
      actionable.length > 0
        ? `${actionable.length} error(s) can be attempted. Start with highest severity. For each: backup file → write test → apply fix → run vitest → report result with attempt-fix.`
        : exhausted.length > 0
          ? `All pending errors have exhausted auto-heal attempts. Escalation to main agent/human is needed.`
          : "No pending errors. System is healthy. ✅",
  };
}

function handleAttemptFix(
  params: Record<string, unknown>,
  errorJournalPath: string,
  healJournalPath: string,
  workspaceDir?: string,
) {
  const errorRef = readStringParam(params, "errorRef", { required: true });
  const targetFile = readStringParam(params, "targetFile", { required: true });
  const approach = readStringParam(params, "approach", { required: true });
  const testCommand = readStringParam(params, "testCommand", { required: true });
  const testPassed = params.testPassed === true;
  const testOutput = readStringParam(params, "testOutput") ?? undefined;
  const humanSummary = readStringParam(params, "humanSummary") ?? undefined;

  if (!errorRef || !targetFile || !approach || !testCommand) {
    return {
      error: "errorRef, targetFile, approach, and testCommand are all required for attempt-fix.",
    };
  }

  // Scope enforcement
  const scopeCheck = checkFileScope(targetFile);
  if (!scopeCheck.allowed) {
    return {
      error: "scope_violation",
      message: scopeCheck.reason,
      allowed: false,
    };
  }

  // Check attempt limit
  if (isMaxAttemptsReached(healJournalPath, errorRef)) {
    // Build escalation context
    const previousEntries = readAutoHealEntries(healJournalPath).filter(
      (e) => e.errorRef === errorRef,
    );
    const escalationContext: EscalationContext = {
      errorMessage: previousEntries[0]?.approach ?? "Unknown error",
      targetFile,
      subagentAttempts: previousEntries.length,
      mainAgentAttempts: 0,
      approachesTried: previousEntries.map((e) => e.approach),
      rolledBack: true,
      isRecurring: false,
    };
    const escalation = buildEscalationMessage(escalationContext);

    // Mark the error as escalated
    markError(errorJournalPath, errorRef, "escalated");

    return {
      error: "max_attempts_exceeded",
      message: `Maximum ${getMaxAttempts()} attempts reached for this error. Escalating to main agent/human.`,
      escalationMessage: escalation.body,
      escalationOptions: escalation.options,
    };
  }

  const attemptNumber = countAttempts(healJournalPath, errorRef) + 1;
  const backupPath = targetFile + ".bak";

  // Record the attempt
  const outcome = testPassed ? "applied" : "rolled-back";
  const entry = createAutoHealEntry({
    journalPath: healJournalPath,
    errorRef,
    targetFile,
    approach,
    attemptNumber,
    backupPath,
    testCommand,
    testResult: {
      status: testPassed ? "pass" : "fail",
      output: testOutput?.slice(0, 500),
    },
    outcome,
    rollbackReason: testPassed ? undefined : "Test verification failed",
    humanSummary,
  });

  // If test passed, mark the error as resolved and rebuild BACKGROUND_FIXES.md
  if (testPassed) {
    markError(errorJournalPath, errorRef, "resolved", {
      resolvedByRef: entry.id,
      resolutionSummary: humanSummary ?? approach,
    });

    // Rebuild BACKGROUND_FIXES.md if workspace is available
    if (workspaceDir) {
      try {
        generateBackgroundFixesMd({
          journalPath: healJournalPath,
          outputPath: resolveBackgroundFixesPath(workspaceDir),
        });
      } catch {
        // Non-fatal — the fix is still recorded in the journal
      }
    }

    const notification = buildSuccessNotification({
      targetFile,
      approach,
      humanSummary,
    });

    return {
      success: true,
      journalEntryId: entry.id,
      attemptNumber,
      outcome: "applied",
      message: `Fix applied and verified! Test passed. BACKGROUND_FIXES.md updated.`,
      notification,
    };
  }

  // Test failed
  const remaining = getMaxAttempts() - attemptNumber;
  return {
    success: false,
    journalEntryId: entry.id,
    attemptNumber,
    outcome: "rolled-back",
    remainingAttempts: remaining,
    message:
      remaining > 0
        ? `Attempt ${attemptNumber}/${getMaxAttempts()} failed. ${remaining} attempt(s) remaining. Restore from .bak and try a different approach.`
        : `All ${getMaxAttempts()} attempts exhausted. Escalation needed.`,
  };
}

function handleRollback(params: Record<string, unknown>) {
  const targetFile = readStringParam(params, "targetFile", { required: true });
  if (!targetFile) {
    return { error: "targetFile is required for rollback." };
  }

  const backupPath = targetFile + ".bak";

  if (!fs.existsSync(backupPath)) {
    return {
      error: "no_backup",
      message: `No backup file found at ${backupPath}. Nothing to rollback.`,
    };
  }

  try {
    fs.copyFileSync(backupPath, targetFile);
    fs.unlinkSync(backupPath);
    return {
      success: true,
      message: `Restored ${path.basename(targetFile)} from backup. Backup file removed.`,
    };
  } catch (err) {
    return {
      error: "rollback_failed",
      message: `Failed to restore from backup: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function handleJournal(healJournalPath: string, params: Record<string, unknown>) {
  const limit = typeof params.limit === "number" ? params.limit : 20;
  const entries = readAutoHealEntries(healJournalPath)
    .toSorted((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);

  return {
    entries: entries.map((e) => ({
      id: e.id,
      timestamp: new Date(e.timestamp).toISOString(),
      targetFile: path.basename(e.targetFile),
      approach: e.approach,
      attemptNumber: e.attemptNumber,
      testResult: e.testResult.status,
      outcome: e.outcome,
      humanSummary: e.humanSummary,
      rollbackReason: e.rollbackReason,
    })),
    total: entries.length,
  };
}

function handleStatus(errorJournalPath: string, healJournalPath: string) {
  const errorSummary = getErrorJournalSummary(errorJournalPath);
  const healEntries = readAutoHealEntries(healJournalPath);

  const healStats = {
    totalAttempts: healEntries.length,
    applied: healEntries.filter((e) => e.outcome === "applied").length,
    rolledBack: healEntries.filter((e) => e.outcome === "rolled-back").length,
    escalated: healEntries.filter((e) => e.outcome === "escalated").length,
  };

  const successRate =
    healStats.totalAttempts > 0
      ? Math.round((healStats.applied / healStats.totalAttempts) * 100)
      : 100;

  return {
    errorJournal: errorSummary,
    autoHeal: healStats,
    successRate: `${successRate}%`,
    healthy: errorSummary.pending === 0 && errorSummary.inProgress === 0,
    message:
      errorSummary.pending === 0
        ? "✅ No pending errors. System is healthy."
        : `⚠️ ${errorSummary.pending} error(s) pending auto-heal.`,
  };
}
