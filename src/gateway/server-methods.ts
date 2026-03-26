import { withPluginRuntimeGatewayRequestScope } from "../plugins/runtime/gateway-request-scope.js";
import { formatControlPlaneActor, resolveControlPlaneActor } from "./control-plane-audit.js";
import { consumeControlPlaneWriteBudget } from "./control-plane-rate-limit.js";
import { ADMIN_SCOPE, authorizeOperatorScopesForMethod } from "./method-scopes.js";
import { ErrorCodes, errorShape } from "./protocol/index.js";
import { isManagedPlatformAdmin } from "./server-methods/utils.js";
import { isRoleAuthorizedForMethod, parseGatewayRole } from "./role-policy.js";
import { agentHandlers } from "./server-methods/agent.js";
import { agentsHandlers } from "./server-methods/agents.js";
import { browserHandlers } from "./server-methods/browser.js";
import { channelsHandlers } from "./server-methods/channels.js";
import { chatHandlers } from "./server-methods/chat.js";
import { configHandlers } from "./server-methods/config.js";
import { connectHandlers } from "./server-methods/connect.js";
import { cronHandlers } from "./server-methods/cron.js";
import { deviceHandlers } from "./server-methods/devices.js";
import { doctorHandlers } from "./server-methods/doctor.js";
import { execApprovalsHandlers } from "./server-methods/exec-approvals.js";
import { healthHandlers } from "./server-methods/health.js";
import { logsHandlers } from "./server-methods/logs.js";
import { modelsHandlers } from "./server-methods/models.js";
import { nodePendingHandlers } from "./server-methods/nodes-pending.js";
import { nodeHandlers } from "./server-methods/nodes.js";
import { pushHandlers } from "./server-methods/push.js";
import { sendHandlers } from "./server-methods/send.js";
import { sessionsHandlers } from "./server-methods/sessions.js";
import { skillsHandlers } from "./server-methods/skills.js";
import { systemHandlers } from "./server-methods/system.js";
import { talkHandlers } from "./server-methods/talk.js";
import { toolsCatalogHandlers } from "./server-methods/tools-catalog.js";
import { toolsEffectiveHandlers } from "./server-methods/tools-effective.js";
import { ttsHandlers } from "./server-methods/tts.js";
import type { GatewayRequestHandlers, GatewayRequestOptions } from "./server-methods/types.js";
import { updateHandlers } from "./server-methods/update.js";
import { usageHandlers } from "./server-methods/usage.js";
import { voicewakeHandlers } from "./server-methods/voicewake.js";
import { webHandlers } from "./server-methods/web.js";
import { wizardHandlers } from "./server-methods/wizard.js";

/**
 * Methods exempt from operator scope enforcement for ANY authenticated client.
 *
 * Backend clients (e.g. the dashboard) authenticate with the shared gateway
 * token but have no device identity, so the gateway strips their self-declared
 * scopes (`clearUnboundScopes`). These monitoring/read-only methods must still
 * be callable by any authenticated operator regardless of scope bindings.
 */
const SHARED_AUTH_EXEMPT_METHODS = new Set([
  "health",
  "system.diskHealth",
  "system.diskCleanup",
  "system.resources",
  "health.sentinel",
  // Cron dashboard methods — dashboard backend clients authenticate via gateway
  // token but have no device identity, so their scopes are stripped.
  "cron.list",
  "cron.status",
  "cron.health",
  "cron.runs",
  "cron.add",
  "cron.update",
  "cron.remove",
  "cron.run",
]);

/**
 * Methods callable by the MoltBot dashboard backend (`gateway-client`) and
 * the embedded Control UI (`openclaw-control-ui`) on **managed-platform
 * deployments only** (`OPENCLAW_MANAGED_PLATFORM=1`).
 *
 * These clients connect via shared token without device identity, so
 * `clearUnboundScopes` strips their scopes. This set covers all read and
 * write methods needed for the Control UI to function.
 *
 * This exemption is intentionally a no-op in self-hosted mode.
 */
const MANAGED_PLATFORM_CLIENT_EXEMPT_METHODS = new Set([
  // Read scope
  "status",
  "doctor.memory.status",
  "logs.tail",
  "channels.status",
  "usage.status",
  "usage.cost",
  "models.list",
  "tools.catalog",
  "agents.list",
  "agent.identity.get",
  "skills.status",
  "voicewake.get",
  "sessions.list",
  "sessions.get",
  "sessions.preview",
  "sessions.resolve",
  "sessions.subscribe",
  "sessions.unsubscribe",
  "sessions.messages.subscribe",
  "sessions.messages.unsubscribe",
  "sessions.usage",
  "sessions.usage.timeseries",
  "sessions.usage.logs",
  "gateway.identity.get",
  "system-presence",
  "last-heartbeat",
  "node.list",
  "node.describe",
  "chat.history",
  "config.get",
  "config.schema.lookup",
  "talk.config",
  "tts.status",
  "tts.providers",
  "agents.files.list",
  "agents.files.get",
  // Write scope
  "send",
  "poll",
  "agent",
  "agent.wait",
  "wake",
  "chat.send",
  "chat.abort",
  "talk.mode",
  "talk.speak",
  "tts.enable",
  "tts.disable",
  "tts.convert",
  "tts.setProvider",
  "voicewake.set",
  "push.test",
  "sessions.create",
  "sessions.send",
  "sessions.steer",
  "sessions.abort",
  "browser.request",
  "node.invoke",
  "node.pending.enqueue",
]);

/**
 * Returns true when a method call by a known managed-platform client should
 * bypass scope enforcement. This is a no-op for self-hosted deployments.
 */
function isManagedPlatformExempt(
  method: string,
  client: GatewayRequestOptions["client"],
): boolean {
  if (!MANAGED_PLATFORM_CLIENT_EXEMPT_METHODS.has(method)) {
    return false;
  }
  return isManagedPlatformAdmin(client);
}

const CONTROL_PLANE_WRITE_METHODS = new Set(["config.apply", "config.patch", "update.run"]);
function authorizeGatewayMethod(method: string, client: GatewayRequestOptions["client"]) {
  if (!client?.connect) {
    return null;
  }
  if (SHARED_AUTH_EXEMPT_METHODS.has(method)) {
    return null;
  }
  if (isManagedPlatformExempt(method, client)) {
    return null;
  }
  const roleRaw = client.connect.role ?? "operator";
  const role = parseGatewayRole(roleRaw);
  if (!role) {
    return errorShape(ErrorCodes.INVALID_REQUEST, `unauthorized role: ${roleRaw}`);
  }
  const scopes = client.connect.scopes ?? [];
  if (!isRoleAuthorizedForMethod(role, method)) {
    return errorShape(ErrorCodes.INVALID_REQUEST, `unauthorized role: ${role}`);
  }
  if (role === "node") {
    return null;
  }
  if (scopes.includes(ADMIN_SCOPE)) {
    return null;
  }
  const scopeAuth = authorizeOperatorScopesForMethod(method, scopes);
  if (!scopeAuth.allowed) {
    return errorShape(ErrorCodes.INVALID_REQUEST, `missing scope: ${scopeAuth.missingScope}`);
  }
  return null;
}

export const coreGatewayHandlers: GatewayRequestHandlers = {
  ...connectHandlers,
  ...logsHandlers,
  ...voicewakeHandlers,
  ...healthHandlers,
  ...channelsHandlers,
  ...chatHandlers,
  ...cronHandlers,
  ...deviceHandlers,
  ...doctorHandlers,
  ...execApprovalsHandlers,
  ...webHandlers,
  ...modelsHandlers,
  ...configHandlers,
  ...wizardHandlers,
  ...talkHandlers,
  ...toolsCatalogHandlers,
  ...toolsEffectiveHandlers,
  ...ttsHandlers,
  ...skillsHandlers,
  ...sessionsHandlers,
  ...systemHandlers,
  ...updateHandlers,
  ...nodeHandlers,
  ...nodePendingHandlers,
  ...pushHandlers,
  ...sendHandlers,
  ...usageHandlers,
  ...agentHandlers,
  ...agentsHandlers,
  ...browserHandlers,
};

export async function handleGatewayRequest(
  opts: GatewayRequestOptions & { extraHandlers?: GatewayRequestHandlers },
): Promise<void> {
  const { req, respond, client, isWebchatConnect, context } = opts;
  const authError = authorizeGatewayMethod(req.method, client);
  if (authError) {
    respond(false, undefined, authError);
    return;
  }
  if (CONTROL_PLANE_WRITE_METHODS.has(req.method)) {
    const budget = consumeControlPlaneWriteBudget({ client });
    if (!budget.allowed) {
      const actor = resolveControlPlaneActor(client);
      context.logGateway.warn(
        `control-plane write rate-limited method=${req.method} ${formatControlPlaneActor(actor)} retryAfterMs=${budget.retryAfterMs} key=${budget.key}`,
      );
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `rate limit exceeded for ${req.method}; retry after ${Math.ceil(budget.retryAfterMs / 1000)}s`,
          {
            retryable: true,
            retryAfterMs: budget.retryAfterMs,
            details: {
              method: req.method,
              limit: "3 per 60s",
            },
          },
        ),
      );
      return;
    }
  }
  const handler = opts.extraHandlers?.[req.method] ?? coreGatewayHandlers[req.method];
  if (!handler) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `unknown method: ${req.method}`),
    );
    return;
  }
  const invokeHandler = () =>
    handler({
      req,
      params: (req.params ?? {}) as Record<string, unknown>,
      client,
      isWebchatConnect,
      respond,
      context,
    });
  // All handlers run inside a request scope so that plugin runtime
  // subagent methods (e.g. context engine tools spawning sub-agents
  // during tool execution) can dispatch back into the gateway.
  await withPluginRuntimeGatewayRequestScope({ context, client, isWebchatConnect }, invokeHandler);
}
