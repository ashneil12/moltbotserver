import { completeSimple } from "@mariozechner/pi-ai";
import type { OpenClawConfig } from "../config/config.js";
import { resolvePluginTools } from "../plugins/tools.js";
import { getActiveRuntimeWebToolsMetadata } from "../secrets/runtime.js";
import type { GatewayMessageChannel } from "../utils/message-channel.js";
import { getApiKeyForModel, requireApiKey } from "./model-auth.js";
import {
  resolveDefaultModelForAgent,
  buildModelAliasIndex,
  resolveModelRefFromString,
} from "./model-selection.js";
import { resolveModel } from "./pi-embedded-runner/model.js";
import { resolveSessionAgentId } from "./agent-scope.js";
import type { SandboxFsBridge } from "./sandbox/fs-bridge.js";
import type { SpawnedToolContext } from "./spawned-context.js";
import type { ToolFsPolicy } from "./tool-fs-policy.js";
import { createAgentsListTool } from "./tools/agents-list-tool.js";
import { createAutoHealTool } from "./tools/auto-heal-tool.js";
import { createBrowserTool } from "./tools/browser-tool.js";
import { createCanvasTool } from "./tools/canvas-tool.js";
import type { AnyAgentTool } from "./tools/common.js";
import { createCronHealTool } from "./tools/cron-heal-tool.js";
import { createCronTool } from "./tools/cron-tool.js";
import { createGatewayTool } from "./tools/gateway-tool.js";
import { createImageTool } from "./tools/image-tool.js";
import { createMessageTool } from "./tools/message-tool.js";
import { createNodesTool } from "./tools/nodes-tool.js";
import { createPdfTool } from "./tools/pdf-tool.js";
import { createSessionSearchTool } from "./tools/session-search-tool.js";
import { createSessionStatusTool } from "./tools/session-status-tool.js";
import { createSessionsHistoryTool } from "./tools/sessions-history-tool.js";
import { createSessionsListTool } from "./tools/sessions-list-tool.js";
import { createSessionsSendTool } from "./tools/sessions-send-tool.js";
import { createSessionsSpawnTool } from "./tools/sessions-spawn-tool.js";
import { createSessionsYieldTool } from "./tools/sessions-yield-tool.js";
import { createSkillManageTool } from "./tools/skill-manage-tool.js";
import { createSkillViewTool } from "./tools/skill-view-tool.js";
import { createSqlExecuteTool, createSqlQueryTool } from "./tools/sql-tool.js";
import { createSubagentsTool } from "./tools/subagents-tool.js";
import { createTtsTool } from "./tools/tts-tool.js";
import { createWebFetchTool, createWebSearchTool } from "./tools/web-tools.js";
import { resolveWorkspaceRoot } from "./workspace-dir.js";

export function createOpenClawTools(
  options?: {
    sandboxBrowserBridgeUrl?: string;
    allowHostBrowserControl?: boolean;
    agentSessionKey?: string;
    agentChannel?: GatewayMessageChannel;
    agentAccountId?: string;
    /** Delivery target (e.g. telegram:group:123:topic:456) for topic/thread routing. */
    agentTo?: string;
    /** Thread/topic identifier for routing replies to the originating thread. */
    agentThreadId?: string | number;
    agentDir?: string;
    sandboxRoot?: string;
    sandboxFsBridge?: SandboxFsBridge;
    fsPolicy?: ToolFsPolicy;
    sandboxed?: boolean;
    config?: OpenClawConfig;
    pluginToolAllowlist?: string[];
    /** Current channel ID for auto-threading (Slack). */
    currentChannelId?: string;
    /** Current thread timestamp for auto-threading (Slack). */
    currentThreadTs?: string;
    /** Current inbound message id for action fallbacks (e.g. Telegram react). */
    currentMessageId?: string | number;
    /** Reply-to mode for Slack auto-threading. */
    replyToMode?: "off" | "first" | "all";
    /** Mutable ref to track if a reply was sent (for "first" mode). */
    hasRepliedRef?: { value: boolean };
    /** If true, the model has native vision capability */
    modelHasVision?: boolean;
    /** If true, nodes action="invoke" can call media-returning commands directly. */
    allowMediaInvokeCommands?: boolean;
    /** Explicit agent ID override for cron/hook sessions. */
    requesterAgentIdOverride?: string;
    /** Require explicit message targets (no implicit last-route sends). */
    requireExplicitMessageTarget?: boolean;
    /** If true, omit the message tool from the tool list. */
    disableMessageTool?: boolean;
    /** Trusted sender id from inbound context (not tool args). */
    requesterSenderId?: string | null;
    /** Whether the requesting sender is an owner. */
    senderIsOwner?: boolean;
    /** Ephemeral session UUID — regenerated on /new and /reset. */
    sessionId?: string;
    /**
     * Workspace directory to pass to spawned subagents for inheritance.
     * Defaults to workspaceDir. Use this to pass the actual agent workspace when the
     * session itself is running in a copied-workspace sandbox (`ro` or `none`) so
     * subagents inherit the real workspace path instead of the sandbox copy.
     */
    spawnWorkspaceDir?: string;
    /** Callback invoked when sessions_yield tool is called. */
    onYield?: (message: string) => Promise<void> | void;
    /** Resolved skills for progressive disclosure skill_view tool. */
    resolvedSkills?: import("@mariozechner/pi-coding-agent").Skill[];
  } & SpawnedToolContext,
): AnyAgentTool[] {
  const workspaceDir = resolveWorkspaceRoot(options?.workspaceDir);
  const spawnWorkspaceDir = resolveWorkspaceRoot(
    options?.spawnWorkspaceDir ?? options?.workspaceDir,
  );
  const runtimeWebTools = getActiveRuntimeWebToolsMetadata();
  const sandbox =
    options?.sandboxRoot && options?.sandboxFsBridge
      ? { root: options.sandboxRoot, bridge: options.sandboxFsBridge }
      : undefined;
  const imageTool = options?.agentDir?.trim()
    ? createImageTool({
        config: options?.config,
        agentDir: options.agentDir,
        workspaceDir,
        sandbox,
        fsPolicy: options?.fsPolicy,
        modelHasVision: options?.modelHasVision,
      })
    : null;
  const pdfTool = options?.agentDir?.trim()
    ? createPdfTool({
        config: options?.config,
        agentDir: options.agentDir,
        workspaceDir,
        sandbox,
        fsPolicy: options?.fsPolicy,
      })
    : null;
  const webSearchTool = createWebSearchTool({
    config: options?.config,
    sandboxed: options?.sandboxed,
    runtimeWebSearch: runtimeWebTools?.search,
  });
  const webFetchTool = createWebFetchTool({
    config: options?.config,
    sandboxed: options?.sandboxed,
    runtimeFirecrawl: runtimeWebTools?.fetch.firecrawl,
  });
  const messageTool = options?.disableMessageTool
    ? null
    : createMessageTool({
        agentAccountId: options?.agentAccountId,
        agentSessionKey: options?.agentSessionKey,
        config: options?.config,
        currentChannelId: options?.currentChannelId,
        currentChannelProvider: options?.agentChannel,
        currentThreadTs: options?.currentThreadTs,
        currentMessageId: options?.currentMessageId,
        replyToMode: options?.replyToMode,
        hasRepliedRef: options?.hasRepliedRef,
        sandboxRoot: options?.sandboxRoot,
        requireExplicitTarget: options?.requireExplicitMessageTarget,
        requesterSenderId: options?.requesterSenderId ?? undefined,
      });
  const tools: AnyAgentTool[] = [
    createBrowserTool({
      sandboxBridgeUrl: options?.sandboxBrowserBridgeUrl,
      allowHostControl: options?.allowHostBrowserControl,
      agentId: resolveSessionAgentId({
        sessionKey: options?.agentSessionKey,
        config: options?.config,
      }),
      agentSessionKey: options?.agentSessionKey,
    }),
    createCanvasTool({ config: options?.config }),
    createNodesTool({
      agentSessionKey: options?.agentSessionKey,
      agentChannel: options?.agentChannel,
      agentAccountId: options?.agentAccountId,
      currentChannelId: options?.currentChannelId,
      currentThreadTs: options?.currentThreadTs,
      config: options?.config,
      modelHasVision: options?.modelHasVision,
      allowMediaInvokeCommands: options?.allowMediaInvokeCommands,
    }),
    createCronTool({
      agentSessionKey: options?.agentSessionKey,
    }),
    createCronHealTool(),
    createAutoHealTool({ workspaceDir }),
    ...(messageTool ? [messageTool] : []),
    createTtsTool({
      agentChannel: options?.agentChannel,
      config: options?.config,
    }),
    createGatewayTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createAgentsListTool({
      agentSessionKey: options?.agentSessionKey,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
    }),
    createSessionsListTool({
      agentSessionKey: options?.agentSessionKey,
      sandboxed: options?.sandboxed,
      config: options?.config,
    }),
    createSessionsHistoryTool({
      agentSessionKey: options?.agentSessionKey,
      sandboxed: options?.sandboxed,
      config: options?.config,
    }),
    createSessionsSendTool({
      agentSessionKey: options?.agentSessionKey,
      agentChannel: options?.agentChannel,
      sandboxed: options?.sandboxed,
      config: options?.config,
    }),
    createSessionsYieldTool({
      sessionId: options?.sessionId,
      onYield: options?.onYield,
    }),
    createSessionsSpawnTool({
      agentSessionKey: options?.agentSessionKey,
      agentChannel: options?.agentChannel,
      agentAccountId: options?.agentAccountId,
      agentTo: options?.agentTo,
      agentThreadId: options?.agentThreadId,
      agentGroupId: options?.agentGroupId,
      agentGroupChannel: options?.agentGroupChannel,
      agentGroupSpace: options?.agentGroupSpace,
      sandboxed: options?.sandboxed,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
      workspaceDir: spawnWorkspaceDir,
    }),
    createSubagentsTool({
      agentSessionKey: options?.agentSessionKey,
    }),
    createSessionStatusTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
      sandboxed: options?.sandboxed,
    }),
    ...(webSearchTool ? [webSearchTool] : []),
    ...(webFetchTool ? [webFetchTool] : []),
    ...(imageTool ? [imageTool] : []),
    ...(pdfTool ? [pdfTool] : []),
  ];

  // SQL tools — sql_query needs memory config, sql_execute needs a workspace
  const sqlQueryTool = createSqlQueryTool({
    config: options?.config,
    agentSessionKey: options?.agentSessionKey,
  });
  if (sqlQueryTool) {
    tools.push(sqlQueryTool);
  }
  const sqlExecuteTool = createSqlExecuteTool({
    config: options?.config,
    agentSessionKey: options?.agentSessionKey,
    workspaceDir,
  });
  if (sqlExecuteTool) {
    tools.push(sqlExecuteTool);
  }

  // Session search — FTS5 keyword search across past conversations
  // with Hermes-style LLM summarization of matching sessions
  const agentId = resolveSessionAgentId({
    sessionKey: options?.agentSessionKey,
    config: options?.config,
  });

  // Build the summarize callback if we have a model config
  let sessionSummarize:
    | import("./tools/session-search-tool.js").SessionSummarizeCallback
    | undefined;
  if (options?.config) {
    const cfg = options.config;
    sessionSummarize = async (params) => {
      try {
        // Static imports at top of file (previously lazy to avoid circular deps)

        // Resolve the session search model (from config or default)
        const defaultRef = resolveDefaultModelForAgent({ cfg });
        const sessionSearchModelStr = cfg.memory?.sessionSearchModel?.trim();
        let modelRef = defaultRef;

        if (sessionSearchModelStr) {
          const aliasIndex = buildModelAliasIndex({ cfg, defaultProvider: defaultRef.provider });
          const resolved = resolveModelRefFromString({
            raw: sessionSearchModelStr,
            defaultProvider: defaultRef.provider,
            aliasIndex,
          });
          if (resolved) {
            modelRef = resolved.ref;
          }
        }

        const resolved = resolveModel(modelRef.provider, modelRef.model, undefined, cfg);
        if (!resolved.model) {
          return undefined;
        }

        const apiKey = requireApiKey(
          await getApiKeyForModel({ model: resolved.model, cfg }),
          modelRef.provider,
        );

        const systemPrompt =
          "You are reviewing a past conversation transcript to help recall what happened. " +
          "Summarize the conversation with a focus on the search topic. Include:\n" +
          "1. What the user asked about or wanted to accomplish\n" +
          "2. What actions were taken and what the outcomes were\n" +
          "3. Key decisions, solutions found, or conclusions reached\n" +
          "4. Any specific commands, files, URLs, or technical details that were important\n" +
          "5. Anything left unresolved or notable\n\n" +
          "Be thorough but concise. Preserve specific details (commands, paths, error messages) " +
          "that would be useful to recall. Write in past tense as a factual recap.";

        const userPrompt =
          `Search topic: ${params.query}\n` +
          `Session date: ${params.sessionMeta.startedAt ?? "unknown"}\n` +
          (params.sessionMeta.channel ? `Session source: ${params.sessionMeta.channel}\n` : "") +
          `\nCONVERSATION TRANSCRIPT:\n${params.sessionTranscript}\n\n` +
          `Summarize this conversation with focus on: ${params.query}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);

        try {
          const res = await completeSimple(
            resolved.model,
            {
              messages: [
                {
                  role: "user" as const,
                  content: systemPrompt + "\n\n---\n\n" + userPrompt,
                  timestamp: Date.now(),
                },
              ],
            },
            {
              apiKey,
              maxTokens: 4096,
              temperature: 0.1,
              signal: controller.signal,
            },
          );

          const text = res.content
            .filter((block: { type: string }) => block.type === "text")
            .map((block: { type: string; text?: string }) =>
              (block as { text: string }).text?.trim(),
            )
            .filter(Boolean)
            .join(" ")
            .trim();

          return text || undefined;
        } finally {
          clearTimeout(timeout);
        }
      } catch {
        // Fail silently — tool falls back to raw results
        return undefined;
      }
    };
  }

  const sessionSearchTool = createSessionSearchTool({
    config: options?.config,
    agentId,
    isSubagent: Boolean(options?.agentSessionKey && options.agentSessionKey.includes(":spawned:")),
    currentSessionId: options?.sessionId,
    summarize: sessionSummarize,
  });
  if (sessionSearchTool) {
    tools.push(sessionSearchTool);
  }

  // Skill management — agents can create/update/delete/list skill docs
  const skillManageTool = createSkillManageTool({
    config: options?.config,
    agentId,
  });
  if (skillManageTool) {
    tools.push(skillManageTool);
  }

  // Skill view — progressive disclosure: agents load full SKILL.md on demand by name
  const useProgressiveDisclosure = options?.config?.skills?.progressiveDisclosure !== false;
  if (useProgressiveDisclosure && options?.resolvedSkills && options.resolvedSkills.length > 0) {
    tools.push(createSkillViewTool({ resolvedSkills: options.resolvedSkills }));
  }

  const pluginTools = resolvePluginTools({
    context: {
      config: options?.config,
      workspaceDir,
      agentDir: options?.agentDir,
      agentId: resolveSessionAgentId({
        sessionKey: options?.agentSessionKey,
        config: options?.config,
      }),
      sessionKey: options?.agentSessionKey,
      sessionId: options?.sessionId,
      messageChannel: options?.agentChannel,
      agentAccountId: options?.agentAccountId,
      requesterSenderId: options?.requesterSenderId ?? undefined,
      senderIsOwner: options?.senderIsOwner ?? undefined,
      sandboxed: options?.sandboxed,
    },
    existingToolNames: new Set(tools.map((tool) => tool.name)),
    toolAllowlist: options?.pluginToolAllowlist,
  });

  return [...tools, ...pluginTools];
}
