/**
 * CLI command handler for `openclaw history-import`.
 */

import type { OpenClawPluginApi } from "../../../src/plugins/types.js";
import { writeConversations } from "./importer.js";
import { loadAndParse } from "./parsers/detect.js";
import { sampleConversations } from "./sampler.js";
import type { ImportOptions } from "./types.js";

/**
 * Run the history import pipeline.
 */
export async function runHistoryImport(
  filePath: string,
  options: ImportOptions,
  api: OpenClawPluginApi,
): Promise<void> {
  const log = api.logger;

  // Resolve workspace directory
  const workspaceDir =
    options.workspaceDir?.trim() ||
    (api.config?.agents?.defaults?.workspace as string | undefined)?.trim() ||
    process.cwd();

  log.info(`Loading export from: ${filePath}`);

  // Phase 1: Parse
  let parsed;
  try {
    parsed = await loadAndParse(filePath, options.source);
  } catch (err) {
    log.error(`Failed to parse export: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  const { source, conversations } = parsed;
  log.info(`Detected source: ${source}`);
  log.info(`Found ${conversations.length} conversations`);

  if (conversations.length === 0) {
    log.warn("No conversations found in export. Nothing to import.");
    return;
  }

  // Show date range
  const timestamps = conversations
    .map((c) => c.createdAt)
    .filter((t): t is number => typeof t === "number" && t > 0);

  if (timestamps.length > 0) {
    let min = timestamps[0]!;
    let max = timestamps[0]!;
    for (let i = 1; i < timestamps.length; i++) {
      if (timestamps[i]! < min) min = timestamps[i]!;
      if (timestamps[i]! > max) max = timestamps[i]!;
    }
    const oldest = new Date(min * 1000).toISOString().slice(0, 10);
    const newest = new Date(max * 1000).toISOString().slice(0, 10);
    log.info(`Date range: ${oldest} → ${newest}`);
  }

  // Show message stats
  const totalMessages = conversations.reduce((sum, c) => sum + c.messages.length, 0);
  log.info(`Total messages: ${totalMessages}`);

  if (options.dryRun) {
    log.info("\n--- DRY RUN ---");
    log.info(`Would import ${conversations.length} conversations to:`);
    log.info(`  ${workspaceDir}/memory/imported/${source}/`);

    // Show sample info
    const sampled = sampleConversations(conversations, 50);
    log.info(`\nFor identity reasoning, would sample ${sampled.length} conversations:`);
    for (const convo of sampled.slice(0, 10)) {
      const date = convo.createdAt
        ? new Date(convo.createdAt * 1000).toISOString().slice(0, 10)
        : "unknown";
      log.info(`  ${date} - ${convo.title ?? "Untitled"} (${convo.messages.length} msgs)`);
    }
    if (sampled.length > 10) {
      log.info(`  ... and ${sampled.length - 10} more`);
    }
    return;
  }

  // Phase 2: Write to memory/imported/
  log.info(`\nImporting to: ${workspaceDir}/memory/imported/${source}/`);

  const result = writeConversations(conversations, workspaceDir, {
    dryRun: false,
    maxConversations: options.maxConversations || 0,
  });

  log.info(`\n✓ Import complete`);
  log.info(`  Conversations imported: ${result.importedConversations}`);
  log.info(`  Messages: ${result.totalMessages}`);
  log.info(`  Files written: ${result.filesWritten.length}`);

  if (result.skipped > 0) {
    log.info(`  Skipped (already imported or over limit): ${result.skipped}`);
  }

  if (result.errors.length > 0) {
    log.warn(`  Errors: ${result.errors.length}`);
    for (const err of result.errors.slice(0, 5)) {
      log.warn(`    ${err}`);
    }
  }

  log.info("\nConversations are now searchable via memory_search / QMD.");
  log.info('To analyze and seed identity files, ask your agent: "analyze my imported history"');
}
