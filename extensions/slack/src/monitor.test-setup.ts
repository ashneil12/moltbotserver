import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { vi, type MockInstance } from "vitest";
import type { ResolvedSlackAccount } from "./accounts.js";

// --- SHARED STATE ---
export const slackTestState = {
  config: {} as any,
  reactMock: vi.fn().mockResolvedValue({ ok: true }),
  updateLastRouteMock: vi.fn().mockResolvedValue(undefined),
  sendMock: vi.fn().mockResolvedValue({ ok: true, ts: "123" }),
  replyMock: vi.fn(),
  readAllowFromStoreMock: vi.fn().mockResolvedValue(true),
  upsertPairingRequestMock: vi.fn().mockResolvedValue(undefined),
};

// --- UTILITIES ---
export function getSlackTestState() {
  return slackTestState;
}

export function resetSlackTestState(cfg: any = {}) {
  slackTestState.config = cfg;
  slackTestState.reactMock.mockClear();
  slackTestState.updateLastRouteMock.mockClear();
  slackTestState.sendMock.mockClear();
  slackTestState.replyMock.mockClear().mockResolvedValue({ text: "mock reply" });
  slackTestState.readAllowFromStoreMock.mockClear();
  slackTestState.upsertPairingRequestMock.mockClear();
}

export function getSlackClient() {
  return (globalThis as any).__slackClient;
}
export function getSlackHandlers() {
  return (globalThis as any).__slackHandlers;
}

export async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export const defaultSlackTestConfig = (): OpenClawConfig => ({
  messages: {
    responsePrefix: "PFX",
    ackReaction: "👀",
    ackReactionScope: "group-mentions",
  },
  channels: {
    slack: {
      enabled: true,
      dm: { enabled: true, policy: "open", allowFrom: ["*"] },
      groupPolicy: "open",
    },
  },
});

export function startSlackMonitor(provider: any, opts?: any) {
  console.error("STARTING SLACK MONITOR", !!provider, typeof provider);
  const controller = new AbortController();
  const cfg = slackTestState.config;
  const account = {
    accountId: "default",
    enabled: true,
    botToken: opts?.botToken ?? { value: "bot-token", source: "config" },
    appToken: opts?.appToken ?? { value: "app-token", source: "config" },
    config: {
      mode: "socket",
    },
  };
  const monitorOpts = {
    config: cfg,
    accountId: "default",
    botToken: "xoxb-default",
    appToken: "xapp-default",
    abortSignal: controller.signal,
    runtime: { error: console.error, log: console.error },
    ...opts,
  };

  const result = provider(monitorOpts);
  console.error("PROVIDER RESULT", !!result);

  return {
    controller: result && result.abort ? result : controller,
    run: (p: any) => p,
    start: async () => {},
  };
}

export async function stopSlackMonitor(params: { controller: any; run: any }) {
  params.controller?.abort();
}

export async function waitForSlackEvent(name: string) {
  for (let i = 0; i < 10; i += 1) {
    if (getSlackHandlers()?.has(name)) {
      return;
    }
    await flush();
  }
}

export async function getSlackHandlerOrThrow(name: string) {
  await waitForSlackEvent(name);
  const handlers = getSlackHandlers();
  if (!handlers) throw new Error("Slack message handler not registered (handlers Map is missing)");
  const handler = handlers.get(name);
  if (!handler)
    throw new Error(
      `Slack handler for ${name} not registered. Available: ${[...handlers.keys()].join(", ")}`,
    );
  return handler;
}

export async function runSlackMessageOnce(providerOrMessage: any, message?: any) {
  const providerToRun = typeof providerOrMessage === "function" ? providerOrMessage : null;
  const rawMessage = providerToRun ? message : providerOrMessage;

  const { controller, run, start } = providerToRun
    ? startSlackMonitor(providerToRun)
    : { controller: null, run: null, start: async () => {} };

  await start();

  const event = rawMessage.event ?? rawMessage;
  const body = rawMessage.body ?? {};
  const handler = await getSlackHandlerOrThrow("message");

  try {
    const promise = handler({ event, body });
    if (run) {
      await run(promise);
    } else {
      await promise;
    }
  } finally {
    if (controller) {
      controller.abort();
    }
  }
}

// --- MOCKS ---

vi.mock("./accounts.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./accounts.js")>();
  return {
    ...actual,
    resolveSlackAccount: vi.fn(
      (params) =>
        ({
          accountId: params.accountId ?? "default",
          enabled: true,
          botToken: "xoxb-default",
          botTokenSource: "config",
          appTokenSource: "config",
          userTokenSource: "config",
          name: "Mock Bot",
          replyToMode: "all",
          allowNameMatching: false,
          typingReaction: "",
          dm: { enabled: true, policy: "open" },
          channels: { "*": { allow: true } },
          config: { botToken: "xoxb-default" },
        }) as unknown as ResolvedSlackAccount,
    ),
    __esModule: true,
  };
});

vi.mock("../../../src/config/io.js", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    channels: {
      slack: { enabled: true, accounts: { default: { enabled: true, botToken: "xoxb-default" } } },
    },
  }),
  __esModule: true,
}));

vi.mock("../../../src/config/config.js", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    channels: {
      slack: { enabled: true, accounts: { default: { enabled: true, botToken: "xoxb-default" } } },
    },
  }),
  __esModule: true,
}));

vi.mock("../../../src/config/sessions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/config/sessions.js")>();
  return {
    ...actual,
    resolveStorePath: vi.fn(() => "/tmp/openclaw-sessions.json"),
    updateLastRoute: (...args: unknown[]) => slackTestState.updateLastRouteMock(...args),
    readSessionUpdatedAt: vi.fn(() => undefined),
    recordSessionMetaFromInbound: vi.fn().mockResolvedValue(undefined),
    __esModule: true,
  };
});

vi.mock("@slack/bolt", () => {
  const handlers = new Map<string, any>();
  (globalThis as any).__slackHandlers = handlers;
  const client = {
    auth: { test: vi.fn().mockResolvedValue({ user_id: "bot-user" }) },
    conversations: {
      info: vi.fn().mockResolvedValue({ channel: { name: "dm", is_im: true } }),
      replies: vi.fn().mockResolvedValue({ messages: [] }),
      history: vi.fn().mockResolvedValue({ messages: [] }),
    },
    users: { info: vi.fn().mockResolvedValue({ user: { profile: { display_name: "Ada" } } }) },
    assistant: { threads: { setStatus: vi.fn().mockResolvedValue({ ok: true }) } },
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ok: true, ts: "123" }),
      update: vi.fn().mockResolvedValue({ ok: true, ts: "123" }),
    },
    reactions: { add: vi.fn() },
  };
  (globalThis as any).__slackClient = client;

  class App {
    client = client;
    event(name: string, handler: any) {
      handlers.set(name, handler);
    }
    command() {}
    async start() {}
    async stop() {}
  }
  class HTTPReceiver {
    requestListener = vi.fn();
  }

  return { App, HTTPReceiver, default: { App, HTTPReceiver } };
});

vi.mock("../../../src/pairing/pairing-store.js", () => ({
  readChannelAllowFromStore: (...args: unknown[]) => slackTestState.readAllowFromStoreMock(...args),
  upsertChannelPairingRequest: (...args: unknown[]) =>
    slackTestState.upsertPairingRequestMock(...args),
  __esModule: true,
}));
