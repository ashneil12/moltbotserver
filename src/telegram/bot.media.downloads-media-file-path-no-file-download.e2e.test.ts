<<<<<<< HEAD:src/telegram/bot.media.downloads-media-file-path-no-file-download.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { setNextSavedMediaPath } from "./bot.media.e2e-harness.js";
import {
  TELEGRAM_TEST_TIMINGS,
  createBotHandler,
  createBotHandlerWithOptions,
  mockTelegramFileDownload,
  mockTelegramPngDownload,
} from "./bot.media.test-utils.js";
=======
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetInboundDedupe } from "../auto-reply/reply/inbound-dedupe.js";
import * as ssrf from "../infra/net/ssrf.js";

const useSpy = vi.fn();
const middlewareUseSpy = vi.fn();
const onSpy = vi.fn();
const stopSpy = vi.fn();
const sendChatActionSpy = vi.fn();
const cacheStickerSpy = vi.fn();
const getCachedStickerSpy = vi.fn();
const describeStickerImageSpy = vi.fn();
const resolvePinnedHostname = ssrf.resolvePinnedHostname;
const lookupMock = vi.fn();
let resolvePinnedHostnameSpy: ReturnType<typeof vi.spyOn> = null;
const TELEGRAM_TEST_TIMINGS = {
  mediaGroupFlushMs: 20,
  textFragmentGapMs: 30,
} as const;

const sleep = async (ms: number) => {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
};

type ApiStub = {
  config: { use: (arg: unknown) => void };
  sendChatAction: typeof sendChatActionSpy;
  setMyCommands: (commands: Array<{ command: string; description: string }>) => Promise<void>;
};

const apiStub: ApiStub = {
  config: { use: useSpy },
  sendChatAction: sendChatActionSpy,
  setMyCommands: vi.fn(async () => undefined),
};

beforeEach(() => {
  vi.useRealTimers();
  resetInboundDedupe();
  lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  resolvePinnedHostnameSpy = vi
    .spyOn(ssrf, "resolvePinnedHostname")
    .mockImplementation((hostname) => resolvePinnedHostname(hostname, lookupMock));
});

afterEach(() => {
  lookupMock.mockReset();
  resolvePinnedHostnameSpy?.mockRestore();
  resolvePinnedHostnameSpy = null;
});

vi.mock("grammy", () => ({
  Bot: class {
    api = apiStub;
    use = middlewareUseSpy;
    on = onSpy;
    command = vi.fn();
    stop = stopSpy;
    catch = vi.fn();
    constructor(public token: string) {}
  },
  InputFile: class {},
  webhookCallback: vi.fn(),
}));

vi.mock("@grammyjs/runner", () => ({
  sequentialize: () => vi.fn(),
}));

const throttlerSpy = vi.fn(() => "throttler");
vi.mock("@grammyjs/transformer-throttler", () => ({
  apiThrottler: () => throttlerSpy(),
}));

vi.mock("../media/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../media/store.js")>();
  return {
    ...actual,
    saveMediaBuffer: vi.fn(async (buffer: Buffer, contentType?: string) => ({
      id: "media",
      path: "/tmp/telegram-media",
      size: buffer.byteLength,
      contentType: contentType ?? "application/octet-stream",
    })),
  };
});

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => ({
      channels: { telegram: { dmPolicy: "open", allowFrom: ["*"] } },
    }),
  };
});

vi.mock("../config/sessions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/sessions.js")>();
  return {
    ...actual,
    updateLastRoute: vi.fn(async () => undefined),
  };
});

vi.mock("./sticker-cache.js", () => ({
  cacheSticker: (...args: unknown[]) => cacheStickerSpy(...args),
  getCachedSticker: (...args: unknown[]) => getCachedStickerSpy(...args),
  describeStickerImage: (...args: unknown[]) => describeStickerImageSpy(...args),
}));

vi.mock("../pairing/pairing-store.js", () => ({
  readChannelAllowFromStore: vi.fn(async () => [] as string[]),
  upsertChannelPairingRequest: vi.fn(async () => ({
    code: "PAIRCODE",
    created: true,
  })),
}));

vi.mock("../auto-reply/reply.js", () => {
  const replySpy = vi.fn(async (_ctx, opts) => {
    await opts?.onReplyStart?.();
    return undefined;
  });
  return { getReplyFromConfig: replySpy, __replySpy: replySpy };
});
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/telegram/bot.media.downloads-media-file-path-no-file-download.e2e.test.ts

describe("telegram inbound media", () => {
  // Parallel vitest shards can make this suite slower than the standalone run.
  const INBOUND_MEDIA_TEST_TIMEOUT_MS = process.platform === "win32" ? 120_000 : 90_000;

  it(
    "handles file_path media downloads and missing file_path safely",
    async () => {
      const runtimeLog = vi.fn();
      const runtimeError = vi.fn();
<<<<<<< HEAD:src/telegram/bot.media.downloads-media-file-path-no-file-download.test.ts
      const { handler, replySpy } = await createBotHandlerWithOptions({
        runtimeLog,
        runtimeError,
      });

      for (const scenario of [
        {
          name: "downloads via file_path",
          messageId: 1,
          getFile: async () => ({ file_path: "photos/1.jpg" }),
          setupFetch: () =>
            mockTelegramFileDownload({
              contentType: "image/jpeg",
              bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
            }),
          assert: (params: {
            fetchSpy: ReturnType<typeof vi.spyOn>;
            replySpy: ReturnType<typeof vi.fn>;
            runtimeError: ReturnType<typeof vi.fn>;
          }) => {
            expect(params.runtimeError).not.toHaveBeenCalled();
            expect(params.fetchSpy).toHaveBeenCalledWith(
              "https://api.telegram.org/file/bottok/photos/1.jpg",
              expect.objectContaining({ redirect: "manual" }),
            );
            expect(params.replySpy).toHaveBeenCalledTimes(1);
            const payload = params.replySpy.mock.calls[0][0];
            expect(payload.Body).toContain("<media:image>");
=======
      createTelegramBot({
        token: "tok",
        testTimings: TELEGRAM_TEST_TIMINGS,
        runtime: {
          log: runtimeLog,
          error: runtimeError,
          exit: () => {
            throw new Error("exit");
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/telegram/bot.media.downloads-media-file-path-no-file-download.e2e.test.ts
          },
        },
        {
          name: "skips when file_path is missing",
          messageId: 2,
          getFile: async () => ({}),
          setupFetch: () => vi.spyOn(globalThis, "fetch"),
          assert: (params: {
            fetchSpy: ReturnType<typeof vi.spyOn>;
            replySpy: ReturnType<typeof vi.fn>;
            runtimeError: ReturnType<typeof vi.fn>;
          }) => {
            expect(params.fetchSpy).not.toHaveBeenCalled();
            expect(params.replySpy).not.toHaveBeenCalled();
            expect(params.runtimeError).not.toHaveBeenCalled();
          },
        },
      ]) {
        replySpy.mockClear();
        runtimeError.mockClear();
        const fetchSpy = scenario.setupFetch();

        await handler({
          message: {
            message_id: scenario.messageId,
            chat: { id: 1234, type: "private" },
            photo: [{ file_id: "fid" }],
            date: 1736380800, // 2025-01-09T00:00:00Z
          },
          me: { username: "openclaw_bot" },
          getFile: scenario.getFile,
        });

        scenario.assert({ fetchSpy, replySpy, runtimeError });
        fetchSpy.mockRestore();
      }
    },
    INBOUND_MEDIA_TEST_TIMEOUT_MS,
  );

  it(
    "keeps Telegram inbound media paths with triple-dash ids",
    async () => {
      const runtimeError = vi.fn();
      const { handler, replySpy } = await createBotHandlerWithOptions({ runtimeError });
      const fetchSpy = mockTelegramFileDownload({
        contentType: "image/jpeg",
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
      });
      const inboundPath = "/tmp/media/inbound/file_1095---f00a04a2-99a0-4d98-99b0-dfe61c5a4198.jpg";
      setNextSavedMediaPath({
        path: inboundPath,
        size: 4,
        contentType: "image/jpeg",
      });

      try {
        await handler({
          message: {
            message_id: 1001,
            chat: { id: 1234, type: "private" },
            photo: [{ file_id: "fid" }],
            date: 1736380800,
          },
          me: { username: "openclaw_bot" },
          getFile: async () => ({ file_path: "photos/1.jpg" }),
        });

        expect(runtimeError).not.toHaveBeenCalled();
        expect(replySpy).toHaveBeenCalledTimes(1);
        const payload = replySpy.mock.calls[0]?.[0] as { Body?: string; MediaPaths?: string[] };
        expect(payload.Body).toContain("<media:image>");
        expect(payload.MediaPaths).toContain(inboundPath);
      } finally {
        fetchSpy.mockRestore();
      }
    },
    INBOUND_MEDIA_TEST_TIMEOUT_MS,
  );

  it("prefers proxyFetch over global fetch", async () => {
    const runtimeLog = vi.fn();
    const runtimeError = vi.fn();
    const globalFetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("global fetch should not be called");
    });
    const proxyFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff]).buffer,
    } as unknown as Response);

<<<<<<< HEAD:src/telegram/bot.media.downloads-media-file-path-no-file-download.test.ts
    const { handler } = await createBotHandlerWithOptions({
=======
    createTelegramBot({
      token: "tok",
      testTimings: TELEGRAM_TEST_TIMINGS,
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/telegram/bot.media.downloads-media-file-path-no-file-download.e2e.test.ts
      proxyFetch: proxyFetch as unknown as typeof fetch,
      runtimeLog,
      runtimeError,
    });

    await handler({
      message: {
        message_id: 2,
        chat: { id: 1234, type: "private" },
        photo: [{ file_id: "fid" }],
      },
      me: { username: "openclaw_bot" },
      getFile: async () => ({ file_path: "photos/2.jpg" }),
    });

    expect(runtimeError).not.toHaveBeenCalled();
    expect(proxyFetch).toHaveBeenCalledWith(
      "https://api.telegram.org/file/bottok/photos/2.jpg",
      expect.objectContaining({ redirect: "manual" }),
    );

    globalFetchSpy.mockRestore();
  });

  it("captures pin and venue location payload fields", async () => {
    const { handler, replySpy } = await createBotHandler();

<<<<<<< HEAD:src/telegram/bot.media.downloads-media-file-path-no-file-download.test.ts
    const cases = [
      {
        message: {
          chat: { id: 42, type: "private" as const },
          message_id: 5,
          caption: "Meet here",
          date: 1736380800,
          location: {
            latitude: 48.858844,
            longitude: 2.294351,
            horizontal_accuracy: 12,
          },
        },
        assert: (payload: Record<string, unknown>) => {
          expect(payload.Body).toContain("Meet here");
          expect(payload.Body).toContain("48.858844");
          expect(payload.LocationLat).toBe(48.858844);
          expect(payload.LocationLon).toBe(2.294351);
          expect(payload.LocationSource).toBe("pin");
          expect(payload.LocationIsLive).toBe(false);
=======
    onSpy.mockReset();
    replySpy.mockReset();

    const runtimeLog = vi.fn();
    const runtimeError = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch" as never);

    createTelegramBot({
      token: "tok",
      testTimings: TELEGRAM_TEST_TIMINGS,
      runtime: {
        log: runtimeLog,
        error: runtimeError,
        exit: () => {
          throw new Error("exit");
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/telegram/bot.media.downloads-media-file-path-no-file-download.e2e.test.ts
        },
      },
      {
        message: {
          chat: { id: 42, type: "private" as const },
          message_id: 6,
          date: 1736380800,
          venue: {
            title: "Eiffel Tower",
            address: "Champ de Mars, Paris",
            location: { latitude: 48.858844, longitude: 2.294351 },
          },
        },
        assert: (payload: Record<string, unknown>) => {
          expect(payload.Body).toContain("Eiffel Tower");
          expect(payload.LocationName).toBe("Eiffel Tower");
          expect(payload.LocationAddress).toBe("Champ de Mars, Paris");
          expect(payload.LocationSource).toBe("place");
        },
      },
    ] as const;

    for (const testCase of cases) {
      replySpy.mockClear();
      await handler({
        message: testCase.message,
        me: { username: "openclaw_bot" },
        getFile: async () => ({ file_path: "unused" }),
      });

      expect(replySpy).toHaveBeenCalledTimes(1);
      const payload = replySpy.mock.calls[0][0] as Record<string, unknown>;
      testCase.assert(payload);
    }
  });
});

describe("telegram media groups", () => {
  afterEach(() => {
    vi.clearAllTimers();
  });

  const MEDIA_GROUP_TEST_TIMEOUT_MS = process.platform === "win32" ? 45_000 : 20_000;
<<<<<<< HEAD:src/telegram/bot.media.downloads-media-file-path-no-file-download.test.ts
  const MEDIA_GROUP_FLUSH_MS = TELEGRAM_TEST_TIMINGS.mediaGroupFlushMs + 40;
=======
  const MEDIA_GROUP_FLUSH_MS = TELEGRAM_TEST_TIMINGS.mediaGroupFlushMs + 60;
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/telegram/bot.media.downloads-media-file-path-no-file-download.e2e.test.ts

  it(
    "handles same-group buffering and separate-group independence",
    async () => {
      const runtimeError = vi.fn();
      const { handler, replySpy } = await createBotHandlerWithOptions({ runtimeError });
      const fetchSpy = mockTelegramPngDownload();

<<<<<<< HEAD:src/telegram/bot.media.downloads-media-file-path-no-file-download.test.ts
      try {
        for (const scenario of [
          {
            messages: [
              {
                chat: { id: 42, type: "private" as const },
                message_id: 1,
                caption: "Here are my photos",
                date: 1736380800,
                media_group_id: "album123",
                photo: [{ file_id: "photo1" }],
                filePath: "photos/photo1.jpg",
              },
              {
                chat: { id: 42, type: "private" as const },
                message_id: 2,
                date: 1736380801,
                media_group_id: "album123",
                photo: [{ file_id: "photo2" }],
                filePath: "photos/photo2.jpg",
              },
            ],
            expectedReplyCount: 1,
            assert: (replySpy: ReturnType<typeof vi.fn>) => {
              const payload = replySpy.mock.calls[0]?.[0];
              expect(payload?.Body).toContain("Here are my photos");
              expect(payload?.MediaPaths).toHaveLength(2);
            },
=======
      createTelegramBot({
        token: "tok",
        testTimings: TELEGRAM_TEST_TIMINGS,
        runtime: {
          log: vi.fn(),
          error: runtimeError,
          exit: () => {
            throw new Error("exit");
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/telegram/bot.media.downloads-media-file-path-no-file-download.e2e.test.ts
          },
          {
            messages: [
              {
                chat: { id: 42, type: "private" as const },
                message_id: 11,
                caption: "Album A",
                date: 1736380800,
                media_group_id: "albumA",
                photo: [{ file_id: "photoA1" }],
                filePath: "photos/photoA1.jpg",
              },
              {
                chat: { id: 42, type: "private" as const },
                message_id: 12,
                caption: "Album B",
                date: 1736380801,
                media_group_id: "albumB",
                photo: [{ file_id: "photoB1" }],
                filePath: "photos/photoB1.jpg",
              },
            ],
            expectedReplyCount: 2,
            assert: () => {},
          },
        ]) {
          replySpy.mockClear();
          runtimeError.mockClear();

          await Promise.all(
            scenario.messages.map((message) =>
              handler({
                message,
                me: { username: "openclaw_bot" },
                getFile: async () => ({ file_path: message.filePath }),
              }),
            ),
          );

          expect(replySpy).not.toHaveBeenCalled();
          await vi.waitFor(
            () => {
              expect(replySpy).toHaveBeenCalledTimes(scenario.expectedReplyCount);
            },
            { timeout: MEDIA_GROUP_FLUSH_MS * 4, interval: 2 },
          );

<<<<<<< HEAD:src/telegram/bot.media.downloads-media-file-path-no-file-download.test.ts
          expect(runtimeError).not.toHaveBeenCalled();
          scenario.assert(replySpy);
        }
      } finally {
        fetchSpy.mockRestore();
      }
=======
      await first;
      await second;

      expect(replySpy).not.toHaveBeenCalled();
      await sleep(MEDIA_GROUP_FLUSH_MS);

      expect(runtimeError).not.toHaveBeenCalled();
      expect(replySpy).toHaveBeenCalledTimes(1);
      const payload = replySpy.mock.calls[0][0];
      expect(payload.Body).toContain("Here are my photos");
      expect(payload.MediaPaths).toHaveLength(2);

      fetchSpy.mockRestore();
    },
    MEDIA_GROUP_TEST_TIMEOUT_MS,
  );

  it(
    "processes separate media groups independently",
    async () => {
      const { createTelegramBot } = await import("./bot.js");
      const replyModule = await import("../auto-reply/reply.js");
      const replySpy = replyModule.__replySpy as unknown as ReturnType<typeof vi.fn>;

      onSpy.mockReset();
      replySpy.mockReset();

      const fetchSpy = vi.spyOn(globalThis, "fetch" as never).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "image/png" },
        arrayBuffer: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
      } as Response);

      createTelegramBot({ token: "tok", testTimings: TELEGRAM_TEST_TIMINGS });
      const handler = onSpy.mock.calls.find((call) => call[0] === "message")?.[1] as (
        ctx: Record<string, unknown>,
      ) => Promise<void>;
      expect(handler).toBeDefined();

      const first = handler({
        message: {
          chat: { id: 42, type: "private" },
          message_id: 1,
          caption: "Album A",
          date: 1736380800,
          media_group_id: "albumA",
          photo: [{ file_id: "photoA1" }],
        },
        me: { username: "openclaw_bot" },
        getFile: async () => ({ file_path: "photos/photoA1.jpg" }),
      });

      const second = handler({
        message: {
          chat: { id: 42, type: "private" },
          message_id: 2,
          caption: "Album B",
          date: 1736380801,
          media_group_id: "albumB",
          photo: [{ file_id: "photoB1" }],
        },
        me: { username: "openclaw_bot" },
        getFile: async () => ({ file_path: "photos/photoB1.jpg" }),
      });

      await Promise.all([first, second]);

      expect(replySpy).not.toHaveBeenCalled();
      await sleep(MEDIA_GROUP_FLUSH_MS);

      expect(replySpy).toHaveBeenCalledTimes(2);

      fetchSpy.mockRestore();
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/telegram/bot.media.downloads-media-file-path-no-file-download.e2e.test.ts
    },
    MEDIA_GROUP_TEST_TIMEOUT_MS,
  );
});

<<<<<<< HEAD:src/telegram/bot.media.downloads-media-file-path-no-file-download.test.ts
describe("telegram forwarded bursts", () => {
=======
describe("telegram stickers", () => {
  const STICKER_TEST_TIMEOUT_MS = process.platform === "win32" ? 30_000 : 20_000;

  beforeEach(() => {
    cacheStickerSpy.mockReset();
    getCachedStickerSpy.mockReset();
    describeStickerImageSpy.mockReset();
  });

  it(
    "downloads static sticker (WEBP) and includes sticker metadata",
    async () => {
      const { createTelegramBot } = await import("./bot.js");
      const replyModule = await import("../auto-reply/reply.js");
      const replySpy = replyModule.__replySpy as unknown as ReturnType<typeof vi.fn>;

      onSpy.mockReset();
      replySpy.mockReset();
      sendChatActionSpy.mockReset();

      const runtimeLog = vi.fn();
      const runtimeError = vi.fn();
      createTelegramBot({
        token: "tok",
        testTimings: TELEGRAM_TEST_TIMINGS,
        runtime: {
          log: runtimeLog,
          error: runtimeError,
          exit: () => {
            throw new Error("exit");
          },
        },
      });
      const handler = onSpy.mock.calls.find((call) => call[0] === "message")?.[1] as (
        ctx: Record<string, unknown>,
      ) => Promise<void>;
      expect(handler).toBeDefined();

      const fetchSpy = vi.spyOn(globalThis, "fetch" as never).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "image/webp" },
        arrayBuffer: async () => new Uint8Array([0x52, 0x49, 0x46, 0x46]).buffer, // RIFF header
      } as Response);

      await handler({
        message: {
          message_id: 100,
          chat: { id: 1234, type: "private" },
          sticker: {
            file_id: "sticker_file_id_123",
            file_unique_id: "sticker_unique_123",
            type: "regular",
            width: 512,
            height: 512,
            is_animated: false,
            is_video: false,
            emoji: "🎉",
            set_name: "TestStickerPack",
          },
          date: 1736380800,
        },
        me: { username: "openclaw_bot" },
        getFile: async () => ({ file_path: "stickers/sticker.webp" }),
      });

      expect(runtimeError).not.toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.telegram.org/file/bottok/stickers/sticker.webp",
        expect.objectContaining({ redirect: "manual" }),
      );
      expect(replySpy).toHaveBeenCalledTimes(1);
      const payload = replySpy.mock.calls[0][0];
      expect(payload.Body).toContain("<media:sticker>");
      expect(payload.Sticker?.emoji).toBe("🎉");
      expect(payload.Sticker?.setName).toBe("TestStickerPack");
      expect(payload.Sticker?.fileId).toBe("sticker_file_id_123");

      fetchSpy.mockRestore();
    },
    STICKER_TEST_TIMEOUT_MS,
  );

  it(
    "refreshes cached sticker metadata on cache hit",
    async () => {
      const { createTelegramBot } = await import("./bot.js");
      const replyModule = await import("../auto-reply/reply.js");
      const replySpy = replyModule.__replySpy as unknown as ReturnType<typeof vi.fn>;

      onSpy.mockReset();
      replySpy.mockReset();
      sendChatActionSpy.mockReset();

      getCachedStickerSpy.mockReturnValue({
        fileId: "old_file_id",
        fileUniqueId: "sticker_unique_456",
        emoji: "😴",
        setName: "OldSet",
        description: "Cached description",
        cachedAt: "2026-01-20T10:00:00.000Z",
      });

      const runtimeError = vi.fn();
      createTelegramBot({
        token: "tok",
        testTimings: TELEGRAM_TEST_TIMINGS,
        runtime: {
          log: vi.fn(),
          error: runtimeError,
          exit: () => {
            throw new Error("exit");
          },
        },
      });
      const handler = onSpy.mock.calls.find((call) => call[0] === "message")?.[1] as (
        ctx: Record<string, unknown>,
      ) => Promise<void>;
      expect(handler).toBeDefined();

      const fetchSpy = vi.spyOn(globalThis, "fetch" as never).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "image/webp" },
        arrayBuffer: async () => new Uint8Array([0x52, 0x49, 0x46, 0x46]).buffer,
      } as Response);

      await handler({
        message: {
          message_id: 103,
          chat: { id: 1234, type: "private" },
          sticker: {
            file_id: "new_file_id",
            file_unique_id: "sticker_unique_456",
            type: "regular",
            width: 512,
            height: 512,
            is_animated: false,
            is_video: false,
            emoji: "🔥",
            set_name: "NewSet",
          },
          date: 1736380800,
        },
        me: { username: "openclaw_bot" },
        getFile: async () => ({ file_path: "stickers/sticker.webp" }),
      });

      expect(runtimeError).not.toHaveBeenCalled();
      expect(cacheStickerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: "new_file_id",
          emoji: "🔥",
          setName: "NewSet",
        }),
      );
      const payload = replySpy.mock.calls[0][0];
      expect(payload.Sticker?.fileId).toBe("new_file_id");
      expect(payload.Sticker?.cachedDescription).toBe("Cached description");

      fetchSpy.mockRestore();
    },
    STICKER_TEST_TIMEOUT_MS,
  );

  it(
    "skips animated stickers (TGS format)",
    async () => {
      const { createTelegramBot } = await import("./bot.js");
      const replyModule = await import("../auto-reply/reply.js");
      const replySpy = replyModule.__replySpy as unknown as ReturnType<typeof vi.fn>;

      onSpy.mockReset();
      replySpy.mockReset();

      const runtimeError = vi.fn();
      const fetchSpy = vi.spyOn(globalThis, "fetch" as never);

      createTelegramBot({
        token: "tok",
        testTimings: TELEGRAM_TEST_TIMINGS,
        runtime: {
          log: vi.fn(),
          error: runtimeError,
          exit: () => {
            throw new Error("exit");
          },
        },
      });
      const handler = onSpy.mock.calls.find((call) => call[0] === "message")?.[1] as (
        ctx: Record<string, unknown>,
      ) => Promise<void>;
      expect(handler).toBeDefined();

      await handler({
        message: {
          message_id: 101,
          chat: { id: 1234, type: "private" },
          sticker: {
            file_id: "animated_sticker_id",
            file_unique_id: "animated_unique",
            type: "regular",
            width: 512,
            height: 512,
            is_animated: true, // TGS format
            is_video: false,
            emoji: "😎",
            set_name: "AnimatedPack",
          },
          date: 1736380800,
        },
        me: { username: "openclaw_bot" },
        getFile: async () => ({ file_path: "stickers/animated.tgs" }),
      });

      // Should not attempt to download animated stickers
      expect(fetchSpy).not.toHaveBeenCalled();
      // Should still process the message (as text-only, no media)
      expect(replySpy).not.toHaveBeenCalled(); // No text content, so no reply generated
      expect(runtimeError).not.toHaveBeenCalled();

      fetchSpy.mockRestore();
    },
    STICKER_TEST_TIMEOUT_MS,
  );

  it(
    "skips video stickers (WEBM format)",
    async () => {
      const { createTelegramBot } = await import("./bot.js");
      const replyModule = await import("../auto-reply/reply.js");
      const replySpy = replyModule.__replySpy as unknown as ReturnType<typeof vi.fn>;

      onSpy.mockReset();
      replySpy.mockReset();

      const runtimeError = vi.fn();
      const fetchSpy = vi.spyOn(globalThis, "fetch" as never);

      createTelegramBot({
        token: "tok",
        testTimings: TELEGRAM_TEST_TIMINGS,
        runtime: {
          log: vi.fn(),
          error: runtimeError,
          exit: () => {
            throw new Error("exit");
          },
        },
      });
      const handler = onSpy.mock.calls.find((call) => call[0] === "message")?.[1] as (
        ctx: Record<string, unknown>,
      ) => Promise<void>;
      expect(handler).toBeDefined();

      await handler({
        message: {
          message_id: 102,
          chat: { id: 1234, type: "private" },
          sticker: {
            file_id: "video_sticker_id",
            file_unique_id: "video_unique",
            type: "regular",
            width: 512,
            height: 512,
            is_animated: false,
            is_video: true, // WEBM format
            emoji: "🎬",
            set_name: "VideoPack",
          },
          date: 1736380800,
        },
        me: { username: "openclaw_bot" },
        getFile: async () => ({ file_path: "stickers/video.webm" }),
      });

      // Should not attempt to download video stickers
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(replySpy).not.toHaveBeenCalled();
      expect(runtimeError).not.toHaveBeenCalled();

      fetchSpy.mockRestore();
    },
    STICKER_TEST_TIMEOUT_MS,
  );
});

describe("telegram text fragments", () => {
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/telegram/bot.media.downloads-media-file-path-no-file-download.e2e.test.ts
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

<<<<<<< HEAD:src/telegram/bot.media.downloads-media-file-path-no-file-download.test.ts
  const FORWARD_BURST_TEST_TIMEOUT_MS = process.platform === "win32" ? 45_000 : 20_000;
=======
  const TEXT_FRAGMENT_TEST_TIMEOUT_MS = process.platform === "win32" ? 45_000 : 20_000;
  const TEXT_FRAGMENT_FLUSH_MS = TELEGRAM_TEST_TIMINGS.textFragmentGapMs + 80;
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/telegram/bot.media.downloads-media-file-path-no-file-download.e2e.test.ts

  it(
    "coalesces forwarded text + forwarded attachment into a single processing turn with default debounce config",
    async () => {
      const runtimeError = vi.fn();
      const { handler, replySpy } = await createBotHandlerWithOptions({ runtimeError });
      const fetchSpy = mockTelegramPngDownload();
      vi.useFakeTimers();

      try {
        await handler({
          message: {
            chat: { id: 42, type: "private" },
            from: { id: 777, is_bot: false, first_name: "N" },
            message_id: 21,
            text: "Look at this",
            date: 1736380800,
            forward_origin: { type: "hidden_user", date: 1736380700, sender_user_name: "A" },
          },
          me: { username: "openclaw_bot" },
          getFile: async () => ({}),
        });

<<<<<<< HEAD:src/telegram/bot.media.downloads-media-file-path-no-file-download.test.ts
        await handler({
          message: {
            chat: { id: 42, type: "private" },
            from: { id: 777, is_bot: false, first_name: "N" },
            message_id: 22,
            date: 1736380801,
            photo: [{ file_id: "fwd_photo_1" }],
            forward_origin: { type: "hidden_user", date: 1736380701, sender_user_name: "A" },
          },
          me: { username: "openclaw_bot" },
          getFile: async () => ({ file_path: "photos/fwd1.jpg" }),
        });
=======
      createTelegramBot({ token: "tok", testTimings: TELEGRAM_TEST_TIMINGS });
      const handler = onSpy.mock.calls.find((call) => call[0] === "message")?.[1] as (
        ctx: Record<string, unknown>,
      ) => Promise<void>;
      expect(handler).toBeDefined();
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/telegram/bot.media.downloads-media-file-path-no-file-download.e2e.test.ts

        await vi.runAllTimersAsync();
        expect(replySpy).toHaveBeenCalledTimes(1);

        expect(runtimeError).not.toHaveBeenCalled();
        const payload = replySpy.mock.calls[0][0];
        expect(payload.Body).toContain("Look at this");
        expect(payload.MediaPaths).toHaveLength(1);
      } finally {
        fetchSpy.mockRestore();
        vi.useRealTimers();
      }
    },
    FORWARD_BURST_TEST_TIMEOUT_MS,
  );
});
