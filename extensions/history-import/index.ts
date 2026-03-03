import type { OpenClawPluginApi } from "../../src/plugins/types.js";

export default function register(api: OpenClawPluginApi) {
  api.registerCli(
    ({ program }) => {
      program
        .command("history-import <path>")
        .description("Import chat history from ChatGPT or Claude into searchable memory")
        .option("-s, --source <source>", "Force source type (chatgpt|claude)", "")
        .option("-d, --dry-run", "Preview without writing files")
        .option("-n, --max <count>", "Max conversations to import (0 = all)", "0")
        .option("-w, --workspace <dir>", "Override workspace directory")
        .action(
          async (
            filePath: string,
            opts: { source?: string; dryRun?: boolean; max?: string; workspace?: string },
          ) => {
            const { runHistoryImport } = await import("./src/cli.js");
            await runHistoryImport(
              filePath,
              {
                source: (opts.source as "chatgpt" | "claude") || undefined,
                dryRun: opts.dryRun === true,
                maxConversations: Number(opts.max) || 0,
                workspaceDir: opts.workspace || undefined,
              },
              api,
            );
          },
        );
    },
    { commands: ["history-import"] },
  );
}
