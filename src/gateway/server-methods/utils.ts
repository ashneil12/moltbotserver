import { GATEWAY_CLIENT_IDS } from "../protocol/client-info.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

/**
 * Returns true if the client is a trusted managed-platform admin (the dashboard or Control UI)
 * and the deployment is running in managed-platform mode.
 */
export function isManagedPlatformAdmin(client: GatewayRequestHandlerOptions["client"]): boolean {
  if (process.env.OPENCLAW_MANAGED_PLATFORM !== "1") {
    return false;
  }
  const clientId = client?.connect?.client?.id;
  return (
    clientId === GATEWAY_CLIENT_IDS.GATEWAY_CLIENT ||
    clientId === GATEWAY_CLIENT_IDS.CONTROL_UI
  );
}
