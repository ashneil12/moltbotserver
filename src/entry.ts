#!/usr/bin/env node
import { spawn } from "node:child_process";
console.log("DEBUG: src/entry.ts loaded");
import path from "node:path";
import process from "node:process";
import { applyCliProfileEnv, parseCliProfileArgs } from "./cli/profile.js";
import { shouldSkipRespawnForArgv } from "./cli/respawn-policy.js";
import { normalizeWindowsArgv } from "./cli/windows-argv.js";
import { isTruthyEnvValue, normalizeEnv } from "./infra/env.js";
import { installProcessWarningFilter } from "./infra/warning-filter.js";
import { attachChildProcessBridge } from "./process/child-process-bridge.js";

console.log("DEBUG: imports done");

process.title = "openclaw";
console.log("DEBUG: process.title set");
installProcessWarningFilter();
normalizeEnv();

if (process.argv.includes("--no-color")) {
  process.env.NO_COLOR = "1";
  process.env.FORCE_COLOR = "0";
}

const EXPERIMENTAL_WARNING_FLAG = "--disable-warning=ExperimentalWarning";

function hasExperimentalWarningSuppressed(): boolean {
  const nodeOptions = process.env.NODE_OPTIONS ?? "";
  if (nodeOptions.includes(EXPERIMENTAL_WARNING_FLAG) || nodeOptions.includes("--no-warnings")) {
    return true;
  }
  for (const arg of process.execArgv) {
    if (arg === EXPERIMENTAL_WARNING_FLAG || arg === "--no-warnings") {
      return true;
    }
  }
  return false;
}

function ensureExperimentalWarningSuppressed(): boolean {
  if (shouldSkipRespawnForArgv(process.argv)) {
    return false;
  }
  if (isTruthyEnvValue(process.env.OPENCLAW_NO_RESPAWN)) {
    return false;
  }
  if (isTruthyEnvValue(process.env.OPENCLAW_NODE_OPTIONS_READY)) {
    console.log("DEBUG: skipping respawn (OPENCLAW_NODE_OPTIONS_READY)");
    return false;
  }
  if (hasExperimentalWarningSuppressed()) {
    console.log("DEBUG: skipping respawn (already suppressed)");
    return false;
  }

  // Respawn guard (and keep recursion bounded if something goes wrong).
  process.env.OPENCLAW_NODE_OPTIONS_READY = "1";
  // Pass flag as a Node CLI option, not via NODE_OPTIONS (--disable-warning is disallowed in NODE_OPTIONS).
  const child = spawn(
    process.execPath,
    [EXPERIMENTAL_WARNING_FLAG, ...process.execArgv, ...process.argv.slice(1)],
    {
      stdio: "inherit",
      env: process.env,
    },
  );

  attachChildProcessBridge(child);

  child.once("exit", (code, signal) => {
    if (signal) {
      process.exitCode = 1;
      return;
    }
    process.exit(code ?? 1);
  });

  child.once("error", (error) => {
    console.error(
      "[openclaw] Failed to respawn CLI:",
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exit(1);
  });

  // Parent must not continue running the CLI.
  return true;
}

process.argv = normalizeWindowsArgv(process.argv);

console.log("DEBUG: checking respawn");
if (!ensureExperimentalWarningSuppressed()) {
  console.log("DEBUG: proceeding with execution");
  const parsed = parseCliProfileArgs(process.argv);
  if (!parsed.ok) {
    // Keep it simple; Commander will handle rich help/errors after we strip flags.
    console.error(`[openclaw] ${parsed.error}`);
    process.exit(2);
  }

  if (parsed.profile) {
    applyCliProfileEnv({ profile: parsed.profile });
    // Keep Commander and ad-hoc argv checks consistent.
    process.argv = parsed.argv;
  }

  console.log("DEBUG: starting granular imports check");
  try {
    console.log("DEBUG: importing infra/env");
    await import("./infra/env.js");
    console.log("DEBUG: importing infra/path-env");
    await import("./infra/path-env.js");
    console.log("DEBUG: importing runtime");
    await import("./runtime.js");
    console.log("DEBUG: importing cli/ports");
    await import("./cli/ports.js");

    // context dependencies
    console.log("DEBUG: importing version");
    await import("./version.js");
    console.log("DEBUG: importing logging");
    await import("./logging.js");

    // plugin-registry dependencies (loader.ts)
    console.log("DEBUG: importing plugins/schema-validator");
    await import("./plugins/schema-validator.js");
    console.log("DEBUG: importing plugins/config-state");
    await import("./plugins/config-state.js");
    console.log("DEBUG: importing plugins/discovery");
    await import("./plugins/discovery.js");
    console.log("DEBUG: importing plugins/hook-runner-global");
    await import("./plugins/hook-runner-global.js");
    console.log("DEBUG: importing plugins/manifest-registry");
    await import("./plugins/manifest-registry.js");
    console.log("DEBUG: importing plugins/registry");
    await import("./plugins/registry.js");

    // runtime dependencies
    console.log("DEBUG: importing ws");
    await import("ws");
    console.log("DEBUG: importing undici");
    await import("undici");
    console.log("DEBUG: importing @buape/carbon");
    await import("@buape/carbon");

    // discord monitor sub-modules
    console.log("DEBUG: importing discord/monitor/allow-list");
    await import("./discord/monitor/allow-list.js");
    console.log("DEBUG: importing discord/monitor/listeners");
    await import("./discord/monitor/listeners.js");

    // message-handler dependencies
    console.log("DEBUG: importing auto-reply/inbound-debounce");
    await import("./auto-reply/inbound-debounce.js");
    console.log("DEBUG: importing auto-reply/inbound-debounce");
    await import("./auto-reply/inbound-debounce.js");

    // command-detection dependencies
    console.log("DEBUG: importing plugins/runtime");
    await import("./plugins/runtime.js");
    console.log("DEBUG: importing channels/dock");
    await import("./channels/dock.js");
    console.log("DEBUG: importing auto-reply/commands-registry.data");
    await import("./auto-reply/commands-registry.data.js");

    // commands-registry dependencies
    console.log("DEBUG: importing utils");
    await import("./utils.js");
    console.log("DEBUG: importing agents/defaults");
    await import("./agents/defaults.js");

    // model-selection dependencies
    console.log("DEBUG: importing config/paths");
    await import("./config/paths.js");
    console.log("DEBUG: importing agents/workspace");
    await import("./agents/workspace.js");

    // models-config.providers dependencies
    console.log("DEBUG: importing agents/auth-profiles");
    await import("./agents/auth-profiles.js");
    console.log("DEBUG: importing agents/model-auth");
    await import("./agents/model-auth.js");
    console.log("DEBUG: importing agents/synthetic-models");
    await import("./agents/synthetic-models.js");
    console.log("DEBUG: importing agents/together-models");
    await import("./agents/together-models.js");
    console.log("DEBUG: importing agents/venice-models");
    await import("./agents/venice-models.js");
    console.log("DEBUG: importing agents/bedrock-discovery");
    await import("./agents/bedrock-discovery.js");
    console.log("DEBUG: importing agents/cloudflare-ai-gateway");
    await import("./agents/cloudflare-ai-gateway.js");
    console.log("DEBUG: importing providers/github-copilot-token");
    await import("./providers/github-copilot-token.js");

    console.log("DEBUG: importing agents/models-config.providers");
    await import("./agents/models-config.providers.js");
    console.log("DEBUG: importing sessions/session-key-utils");
    await import("./sessions/session-key-utils.js");
    console.log("DEBUG: importing routing/session-key");
    await import("./routing/session-key.js");
    console.log("DEBUG: importing agents/agent-scope");
    await import("./agents/agent-scope.js");

    console.log("DEBUG: importing agents/model-selection");
    await import("./agents/model-selection.js");

    console.log("DEBUG: importing auto-reply/commands-registry");
    await import("./auto-reply/commands-registry.js");

    // abort dependencies
    console.log("DEBUG: importing globals");
    await import("./globals.js");
    console.log("DEBUG: importing routing/session-key");
    await import("./routing/session-key.js");
    console.log("DEBUG: importing config/sessions");
    await import("./config/sessions.js");

    console.log("DEBUG: importing agents/subagent-registry");
    await import("./agents/subagent-registry.js");
    console.log("DEBUG: importing agents/pi-embedded");
    await import("./agents/pi-embedded.js");

    console.log("DEBUG: importing auto-reply/command-auth");
    await import("./auto-reply/command-auth.js");
    console.log("DEBUG: importing auto-reply/reply/mentions");
    await import("./auto-reply/reply/mentions.js");
    console.log("DEBUG: importing auto-reply/reply/queue");
    await import("./auto-reply/reply/queue.js");

    console.log("DEBUG: importing auto-reply/reply/abort");
    await import("./auto-reply/reply/abort.js");

    console.log("DEBUG: importing auto-reply/command-detection");
    await import("./auto-reply/command-detection.js");
    console.log("DEBUG: importing discord/monitor/message-handler.preflight");
    await import("./discord/monitor/message-handler.preflight.js");
    console.log("DEBUG: importing discord/monitor/message-handler.process");
    await import("./discord/monitor/message-handler.process.js");

    console.log("DEBUG: importing discord/monitor/message-handler");
    await import("./discord/monitor/message-handler.js");
    console.log("DEBUG: importing discord/monitor/message-utils");
    await import("./discord/monitor/message-utils.js");
    console.log("DEBUG: importing discord/monitor/native-command");
    await import("./discord/monitor/native-command.js");
    console.log("DEBUG: importing discord/monitor/provider");
    await import("./discord/monitor/provider.js");
    console.log("DEBUG: importing discord/monitor/threading");
    await import("./discord/monitor/threading.js");

    console.log("DEBUG: importing discord/monitor");
    await import("./discord/monitor.js");
    console.log("DEBUG: importing slack/index");
    await import("./slack/index.js");
    console.log("DEBUG: importing signal/index");
    await import("./signal/index.js");
    console.log("DEBUG: importing telegram/monitor");
    await import("./telegram/monitor.js");
    console.log("DEBUG: importing whatsapp/outbound");
    await import("./web/outbound.js");
    console.log("DEBUG: importing line/monitor");
    await import("./line/monitor.js");
    console.log("DEBUG: importing media/image-ops");
    await import("./media/image-ops.js");

    console.log("DEBUG: importing plugins/runtime/index");
    await import("./plugins/runtime/index.js");
    console.log("DEBUG: importing plugins/commands");
    await import("./plugins/commands.js");
    console.log("DEBUG: importing plugins/loader");
    await import("./plugins/loader.js");

    console.log("DEBUG: importing cli/plugin-registry");
    await import("./cli/plugin-registry.js");
    console.log("DEBUG: importing cli/channel-options");
    await import("./cli/channel-options.js");

    console.log("DEBUG: importing cli/program/context");
    await import("./cli/program/context.js");

    // command-registry dependencies
    console.log("DEBUG: importing cli/program/help");
    await import("./cli/program/help.js");
    console.log("DEBUG: importing cli/program/preaction");
    await import("./cli/program/preaction.js");

    console.log("DEBUG: importing commands/agents");
    await import("./commands/agents.js");
    console.log("DEBUG: importing commands/health");
    await import("./commands/health.js");
    console.log("DEBUG: importing commands/sessions");
    await import("./commands/sessions.js");
    console.log("DEBUG: importing commands/status");
    await import("./commands/status.js");
    console.log("DEBUG: importing cli/argv");
    await import("./cli/argv.js");

    console.log("DEBUG: importing cli/program/command-registry");
    await import("./cli/program/command-registry.js");
    console.log("DEBUG: imports for build-program passed");
  } catch (err) {
    console.error("DEBUG: granular import failed", err);
  }

  console.log("DEBUG: importing run-main");
  import("./cli/run-main.js")
    .then(({ runCli }) => {
      console.log("DEBUG: runCli starting");
      return runCli(process.argv);
    })
    .catch((error) => {
      console.error(
        "[openclaw] Failed to start CLI:",
        error instanceof Error ? (error.stack ?? error.message) : error,
      );
      process.exitCode = 1;
    });
} else {
  console.log("DEBUG: respawning child process");
}
