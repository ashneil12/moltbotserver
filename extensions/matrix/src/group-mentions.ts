import type { ChannelGroupContext, GroupToolPolicyConfig } from "openclaw/plugin-sdk";
<<<<<<< HEAD
=======
import type { CoreConfig } from "./types.js";
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
import { resolveMatrixAccountConfig } from "./matrix/accounts.js";
import { resolveMatrixRoomConfig } from "./matrix/monitor/rooms.js";
import type { CoreConfig } from "./types.js";

function stripLeadingPrefixCaseInsensitive(value: string, prefix: string): string {
  return value.toLowerCase().startsWith(prefix.toLowerCase())
    ? value.slice(prefix.length).trim()
    : value;
}

function resolveMatrixRoomConfigForGroup(params: ChannelGroupContext) {
  const rawGroupId = params.groupId?.trim() ?? "";
  let roomId = rawGroupId;
  roomId = stripLeadingPrefixCaseInsensitive(roomId, "matrix:");
  roomId = stripLeadingPrefixCaseInsensitive(roomId, "channel:");
  roomId = stripLeadingPrefixCaseInsensitive(roomId, "room:");

  const groupChannel = params.groupChannel?.trim() ?? "";
  const aliases = groupChannel ? [groupChannel] : [];
  const cfg = params.cfg as CoreConfig;
  const matrixConfig = resolveMatrixAccountConfig({ cfg, accountId: params.accountId });
<<<<<<< HEAD
  return resolveMatrixRoomConfig({
=======
  const resolved = resolveMatrixRoomConfig({
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    rooms: matrixConfig.groups ?? matrixConfig.rooms,
    roomId,
    aliases,
    name: groupChannel || undefined,
  }).config;
}

export function resolveMatrixGroupRequireMention(params: ChannelGroupContext): boolean {
  const resolved = resolveMatrixRoomConfigForGroup(params);
  if (resolved) {
    if (resolved.autoReply === true) {
      return false;
    }
    if (resolved.autoReply === false) {
      return true;
    }
    if (typeof resolved.requireMention === "boolean") {
      return resolved.requireMention;
    }
  }
  return true;
}

export function resolveMatrixGroupToolPolicy(
  params: ChannelGroupContext,
): GroupToolPolicyConfig | undefined {
<<<<<<< HEAD
  const resolved = resolveMatrixRoomConfigForGroup(params);
=======
  const rawGroupId = params.groupId?.trim() ?? "";
  let roomId = rawGroupId;
  const lower = roomId.toLowerCase();
  if (lower.startsWith("matrix:")) {
    roomId = roomId.slice("matrix:".length).trim();
  }
  if (roomId.toLowerCase().startsWith("channel:")) {
    roomId = roomId.slice("channel:".length).trim();
  }
  if (roomId.toLowerCase().startsWith("room:")) {
    roomId = roomId.slice("room:".length).trim();
  }
  const groupChannel = params.groupChannel?.trim() ?? "";
  const aliases = groupChannel ? [groupChannel] : [];
  const cfg = params.cfg as CoreConfig;
  const matrixConfig = resolveMatrixAccountConfig({ cfg, accountId: params.accountId });
  const resolved = resolveMatrixRoomConfig({
    rooms: matrixConfig.groups ?? matrixConfig.rooms,
    roomId,
    aliases,
    name: groupChannel || undefined,
  }).config;
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  return resolved?.tools;
}
