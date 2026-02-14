<<<<<<< HEAD:src/infra/outbound/message.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getChannelPlugin: vi.fn(),
  resolveOutboundTarget: vi.fn(),
  deliverOutboundPayloads: vi.fn(),
}));

vi.mock("../../channels/plugins/index.js", () => ({
  normalizeChannelId: (channel?: string) => channel?.trim().toLowerCase() ?? undefined,
  getChannelPlugin: mocks.getChannelPlugin,
}));

vi.mock("./targets.js", () => ({
  resolveOutboundTarget: mocks.resolveOutboundTarget,
}));

vi.mock("./deliver.js", () => ({
  deliverOutboundPayloads: mocks.deliverOutboundPayloads,
}));

import { sendMessage } from "./message.js";

describe("sendMessage", () => {
  beforeEach(() => {
    mocks.getChannelPlugin.mockClear();
    mocks.resolveOutboundTarget.mockClear();
    mocks.deliverOutboundPayloads.mockClear();

    mocks.getChannelPlugin.mockReturnValue({
      outbound: { deliveryMode: "direct" },
=======
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelOutboundAdapter, ChannelPlugin } from "../../channels/plugins/types.js";
import { setActivePluginRegistry } from "../../plugins/runtime.js";
import { createIMessageTestPlugin, createTestRegistry } from "../../test-utils/channel-plugins.js";
import { sendMessage, sendPoll } from "./message.js";

const setRegistry = (registry: ReturnType<typeof createTestRegistry>) => {
  setActivePluginRegistry(registry);
};

const callGatewayMock = vi.fn();
vi.mock("../../gateway/call.js", () => ({
  callGateway: (...args: unknown[]) => callGatewayMock(...args),
  randomIdempotencyKey: () => "idem-1",
}));

describe("sendMessage channel normalization", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
    setRegistry(emptyRegistry);
  });

  afterEach(() => {
    setRegistry(emptyRegistry);
  });

  it("normalizes Teams alias", async () => {
    const sendMSTeams = vi.fn(async () => ({
      messageId: "m1",
      conversationId: "c1",
    }));
    setRegistry(
      createTestRegistry([
        {
          pluginId: "msteams",
          source: "test",
          plugin: createMSTeamsPlugin({
            outbound: createMSTeamsOutbound(),
            aliases: ["teams"],
          }),
        },
      ]),
    );
    const result = await sendMessage({
      cfg: {},
      to: "conversation:19:abc@thread.tacv2",
      content: "hi",
      channel: "teams",
      deps: { sendMSTeams },
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/infra/outbound/message.e2e.test.ts
    });
    mocks.resolveOutboundTarget.mockImplementation(({ to }: { to: string }) => ({ ok: true, to }));
    mocks.deliverOutboundPayloads.mockResolvedValue([{ channel: "mattermost", messageId: "m1" }]);
  });

<<<<<<< HEAD:src/infra/outbound/message.test.ts
  it("passes explicit agentId to outbound delivery for scoped media roots", async () => {
=======
  it("normalizes iMessage alias", async () => {
    const sendIMessage = vi.fn(async () => ({ messageId: "i1" }));
    setRegistry(
      createTestRegistry([
        {
          pluginId: "imessage",
          source: "test",
          plugin: createIMessageTestPlugin(),
        },
      ]),
    );
    const result = await sendMessage({
      cfg: {},
      to: "someone@example.com",
      content: "hi",
      channel: "imsg",
      deps: { sendIMessage },
    });

    expect(sendIMessage).toHaveBeenCalledWith("someone@example.com", "hi", expect.any(Object));
    expect(result.channel).toBe("imessage");
  });
});

describe("sendMessage replyToId threading", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
    setRegistry(emptyRegistry);
  });

  afterEach(() => {
    setRegistry(emptyRegistry);
  });

  it("passes replyToId through to the outbound adapter", async () => {
    const capturedCtx: Record<string, unknown>[] = [];
    const plugin = createMattermostLikePlugin({
      onSendText: (ctx) => {
        capturedCtx.push(ctx);
      },
    });
    setRegistry(createTestRegistry([{ pluginId: "mattermost", source: "test", plugin }]));

>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/infra/outbound/message.e2e.test.ts
    await sendMessage({
      cfg: {},
      channel: "mattermost",
<<<<<<< HEAD:src/infra/outbound/message.test.ts
=======
      replyToId: "post123",
    });

    expect(capturedCtx).toHaveLength(1);
    expect(capturedCtx[0]?.replyToId).toBe("post123");
  });

  it("passes threadId through to the outbound adapter", async () => {
    const capturedCtx: Record<string, unknown>[] = [];
    const plugin = createMattermostLikePlugin({
      onSendText: (ctx) => {
        capturedCtx.push(ctx);
      },
    });
    setRegistry(createTestRegistry([{ pluginId: "mattermost", source: "test", plugin }]));

    await sendMessage({
      cfg: {},
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/infra/outbound/message.e2e.test.ts
      to: "channel:town-square",
      content: "hi",
      agentId: "work",
    });

<<<<<<< HEAD:src/infra/outbound/message.test.ts
    expect(mocks.deliverOutboundPayloads).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "work",
        channel: "mattermost",
        to: "channel:town-square",
      }),
=======
    expect(capturedCtx).toHaveLength(1);
    expect(capturedCtx[0]?.threadId).toBe("topic456");
  });
});

describe("sendPoll channel normalization", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
    setRegistry(emptyRegistry);
  });

  afterEach(() => {
    setRegistry(emptyRegistry);
  });

  it("normalizes Teams alias for polls", async () => {
    callGatewayMock.mockResolvedValueOnce({ messageId: "p1" });
    setRegistry(
      createTestRegistry([
        {
          pluginId: "msteams",
          source: "test",
          plugin: createMSTeamsPlugin({
            aliases: ["teams"],
            outbound: createMSTeamsOutbound({ includePoll: true }),
          }),
        },
      ]),
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/infra/outbound/message.e2e.test.ts
    );
  });
});
