import type { OutboundIdentity } from "../../../infra/outbound/identity.js";
import { getGlobalHookRunner } from "../../../plugins/hook-runner-global.js";
import { sendMessageSlack, type SlackSendIdentity } from "../../../slack/send.js";
import type { ChannelOutboundAdapter } from "../types.js";
<<<<<<< HEAD

function resolveSlackSendIdentity(identity?: OutboundIdentity): SlackSendIdentity | undefined {
  if (!identity) {
    return undefined;
  }
  const username = identity.name?.trim() || undefined;
  const iconUrl = identity.avatarUrl?.trim() || undefined;
  const rawEmoji = identity.emoji?.trim();
  const iconEmoji = !iconUrl && rawEmoji && /^:[^:\s]+:$/.test(rawEmoji) ? rawEmoji : undefined;
  if (!username && !iconUrl && !iconEmoji) {
    return undefined;
  }
  return { username, iconUrl, iconEmoji };
}

async function applySlackMessageSendingHooks(params: {
  to: string;
  text: string;
  threadTs?: string;
  accountId?: string;
  mediaUrl?: string;
}): Promise<{ cancelled: boolean; text: string }> {
  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("message_sending")) {
    return { cancelled: false, text: params.text };
  }
  const hookResult = await hookRunner.runMessageSending(
    {
      to: params.to,
      content: params.text,
      metadata: {
        threadTs: params.threadTs,
        channelId: params.to,
        ...(params.mediaUrl ? { mediaUrl: params.mediaUrl } : {}),
      },
    },
    { channelId: "slack", accountId: params.accountId ?? undefined },
  );
  if (hookResult?.cancel) {
    return { cancelled: true, text: params.text };
  }
  return { cancelled: false, text: hookResult?.content ?? params.text };
}

async function sendSlackOutboundMessage(params: {
  to: string;
  text: string;
  mediaUrl?: string;
  mediaLocalRoots?: readonly string[];
  accountId?: string | null;
  deps?: { sendSlack?: typeof sendMessageSlack } | null;
  replyToId?: string | null;
  threadId?: string | number | null;
  identity?: OutboundIdentity;
}) {
  const send = params.deps?.sendSlack ?? sendMessageSlack;
  // Use threadId fallback so routed tool notifications stay in the Slack thread.
  const threadTs =
    params.replyToId ?? (params.threadId != null ? String(params.threadId) : undefined);
  const hookResult = await applySlackMessageSendingHooks({
    to: params.to,
    text: params.text,
    threadTs,
    mediaUrl: params.mediaUrl,
    accountId: params.accountId ?? undefined,
  });
  if (hookResult.cancelled) {
    return {
      channel: "slack" as const,
      messageId: "cancelled-by-hook",
      channelId: params.to,
      meta: { cancelled: true },
    };
  }

  const slackIdentity = resolveSlackSendIdentity(params.identity);
  const result = await send(params.to, hookResult.text, {
    threadTs,
    accountId: params.accountId ?? undefined,
    ...(params.mediaUrl
      ? { mediaUrl: params.mediaUrl, mediaLocalRoots: params.mediaLocalRoots }
      : {}),
    ...(slackIdentity ? { identity: slackIdentity } : {}),
  });
  return { channel: "slack" as const, ...result };
}
=======
import { getGlobalHookRunner } from "../../../plugins/hook-runner-global.js";
import { sendMessageSlack } from "../../../slack/send.js";
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

export const slackOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: null,
  textChunkLimit: 4000,
<<<<<<< HEAD
  sendText: async ({ to, text, accountId, deps, replyToId, threadId, identity }) => {
    return await sendSlackOutboundMessage({
      to,
      text,
      accountId,
      deps,
      replyToId,
      threadId,
      identity,
=======
  sendText: async ({ to, text, accountId, deps, replyToId, threadId }) => {
    const send = deps?.sendSlack ?? sendMessageSlack;
    // Use threadId fallback so routed tool notifications stay in the Slack thread.
    const threadTs = replyToId ?? (threadId != null ? String(threadId) : undefined);
    let finalText = text;

    // Run message_sending hooks (e.g. thread-ownership can cancel the send).
    const hookRunner = getGlobalHookRunner();
    if (hookRunner?.hasHooks("message_sending")) {
      const hookResult = await hookRunner.runMessageSending(
        { to, content: text, metadata: { threadTs, channelId: to } },
        { channelId: "slack", accountId: accountId ?? undefined },
      );
      if (hookResult?.cancel) {
        return {
          channel: "slack",
          messageId: "cancelled-by-hook",
          channelId: to,
          meta: { cancelled: true },
        };
      }
      if (hookResult?.content) {
        finalText = hookResult.content;
      }
    }

    const result = await send(to, finalText, {
      threadTs,
      accountId: accountId ?? undefined,
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    });
  },
<<<<<<< HEAD
  sendMedia: async ({
    to,
    text,
    mediaUrl,
    mediaLocalRoots,
    accountId,
    deps,
    replyToId,
    threadId,
    identity,
  }) => {
    return await sendSlackOutboundMessage({
      to,
      text,
=======
  sendMedia: async ({ to, text, mediaUrl, accountId, deps, replyToId, threadId }) => {
    const send = deps?.sendSlack ?? sendMessageSlack;
    // Use threadId fallback so routed tool notifications stay in the Slack thread.
    const threadTs = replyToId ?? (threadId != null ? String(threadId) : undefined);
    let finalText = text;

    // Run message_sending hooks (e.g. thread-ownership can cancel the send).
    const hookRunner = getGlobalHookRunner();
    if (hookRunner?.hasHooks("message_sending")) {
      const hookResult = await hookRunner.runMessageSending(
        { to, content: text, metadata: { threadTs, channelId: to, mediaUrl } },
        { channelId: "slack", accountId: accountId ?? undefined },
      );
      if (hookResult?.cancel) {
        return {
          channel: "slack",
          messageId: "cancelled-by-hook",
          channelId: to,
          meta: { cancelled: true },
        };
      }
      if (hookResult?.content) {
        finalText = hookResult.content;
      }
    }

    const result = await send(to, finalText, {
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
      mediaUrl,
      mediaLocalRoots,
      accountId,
      deps,
      replyToId,
      threadId,
      identity,
    });
  },
};
