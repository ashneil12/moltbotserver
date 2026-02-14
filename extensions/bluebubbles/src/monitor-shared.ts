<<<<<<< HEAD
import { normalizeWebhookPath, type OpenClawConfig } from "openclaw/plugin-sdk";
import type { ResolvedBlueBubblesAccount } from "./accounts.js";
import { getBlueBubblesRuntime } from "./runtime.js";
import type { BlueBubblesAccountConfig } from "./types.js";

export { normalizeWebhookPath };
=======
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { ResolvedBlueBubblesAccount } from "./accounts.js";
import type { BlueBubblesAccountConfig } from "./types.js";
import { getBlueBubblesRuntime } from "./runtime.js";
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

export type BlueBubblesRuntimeEnv = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

export type BlueBubblesMonitorOptions = {
  account: ResolvedBlueBubblesAccount;
  config: OpenClawConfig;
  runtime: BlueBubblesRuntimeEnv;
  abortSignal: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  webhookPath?: string;
};

export type BlueBubblesCoreRuntime = ReturnType<typeof getBlueBubblesRuntime>;

export type WebhookTarget = {
  account: ResolvedBlueBubblesAccount;
  config: OpenClawConfig;
  runtime: BlueBubblesRuntimeEnv;
  core: BlueBubblesCoreRuntime;
  path: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

export const DEFAULT_WEBHOOK_PATH = "/bluebubbles-webhook";

<<<<<<< HEAD
=======
export function normalizeWebhookPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "/";
  }
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withSlash.length > 1 && withSlash.endsWith("/")) {
    return withSlash.slice(0, -1);
  }
  return withSlash;
}

>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
export function resolveWebhookPathFromConfig(config?: BlueBubblesAccountConfig): string {
  const raw = config?.webhookPath?.trim();
  if (raw) {
    return normalizeWebhookPath(raw);
  }
  return DEFAULT_WEBHOOK_PATH;
}
