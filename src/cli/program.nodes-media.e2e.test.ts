import * as fs from "node:fs/promises";
<<<<<<< HEAD:src/cli/program.nodes-media.test.ts
import { Command } from "commander";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { IOS_NODE, createIosNodeListResponse } from "./program.nodes-test-helpers.js";
import { callGateway, installBaseProgramMocks, runtime } from "./program.test-mocks.js";
=======
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCameraSnapPayload, parseCameraClipPayload } from "./nodes-camera.js";
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/cli/program.nodes-media.e2e.test.ts

installBaseProgramMocks();
let registerNodesCli: (program: Command) => void;

function getFirstRuntimeLogLine(): string {
  const first = runtime.log.mock.calls[0]?.[0];
  if (typeof first !== "string") {
    throw new Error(`Expected runtime.log first arg to be string, got ${typeof first}`);
  }
  return first;
}

async function expectLoggedSingleMediaFile(params?: {
  expectedContent?: string;
  expectedPathPattern?: RegExp;
}): Promise<string> {
  const out = getFirstRuntimeLogLine();
  const mediaPath = out.replace(/^MEDIA:/, "").trim();
  if (params?.expectedPathPattern) {
    expect(mediaPath).toMatch(params.expectedPathPattern);
  }
  try {
    await expect(fs.readFile(mediaPath, "utf8")).resolves.toBe(params?.expectedContent ?? "hi");
  } finally {
    await fs.unlink(mediaPath).catch(() => {});
  }
  return mediaPath;
}

function mockNodeGateway(command?: string, payload?: Record<string, unknown>) {
  callGateway.mockImplementation(async (...args: unknown[]) => {
    const opts = (args[0] ?? {}) as { method?: string };
    if (opts.method === "node.list") {
      return createIosNodeListResponse();
    }
    if (opts.method === "node.invoke" && command) {
      return {
        ok: true,
        nodeId: IOS_NODE.nodeId,
        command,
        payload,
      };
    }
    return { ok: true };
  });
}

describe("cli program (nodes media)", () => {
  let program: Command;

  beforeAll(async () => {
    ({ registerNodesCli } = await import("./nodes-cli.js"));
    program = new Command();
    program.exitOverride();
    registerNodesCli(program);
  });

  async function runNodesCommand(argv: string[]) {
    runtime.log.mockClear();
    await program.parseAsync(argv, { from: "user" });
  }

  async function runAndExpectUrlPayloadMediaFile(params: {
    command: "camera.snap" | "camera.clip";
    payload: Record<string, unknown>;
    argv: string[];
    expectedPathPattern: RegExp;
  }) {
    mockNodeGateway(params.command, params.payload);
    await runNodesCommand(params.argv);
    await expectLoggedSingleMediaFile({
      expectedPathPattern: params.expectedPathPattern,
      expectedContent: "url-content",
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs nodes camera snap and prints two MEDIA paths", async () => {
    mockNodeGateway("camera.snap", { format: "jpg", base64: "aGk=", width: 1, height: 1 });

    await runNodesCommand(["nodes", "camera", "snap", "--node", "ios-node"]);

    const invokeCalls = callGateway.mock.calls
      .map((call) => call[0] as { method?: string; params?: Record<string, unknown> })
      .filter((call) => call.method === "node.invoke");
    const facings = invokeCalls
      .map((call) => (call.params?.params as { facing?: string } | undefined)?.facing)
      .filter((facing): facing is string => Boolean(facing))
      .toSorted((a, b) => a.localeCompare(b));
    expect(facings).toEqual(["back", "front"]);

    const out = getFirstRuntimeLogLine();
    const mediaPaths = out
      .split("\n")
      .filter((l) => l.startsWith("MEDIA:"))
      .map((l) => l.replace(/^MEDIA:/, ""))
      .filter(Boolean);
    expect(mediaPaths).toHaveLength(2);
    expect(mediaPaths[0]).toContain("openclaw-camera-snap-");
    expect(mediaPaths[1]).toContain("openclaw-camera-snap-");

    try {
      // Content bytes are covered by single-output camera/file tests; here we
      // only verify dual snapshot behavior and that both paths were written.
      await expect(fs.stat(mediaPaths[0])).resolves.toBeTruthy();
      await expect(fs.stat(mediaPaths[1])).resolves.toBeTruthy();
    } finally {
      await Promise.all(mediaPaths.map((p) => fs.unlink(p).catch(() => {})));
    }
  });

  it("runs nodes camera clip and prints one MEDIA path", async () => {
    mockNodeGateway("camera.clip", {
      format: "mp4",
      base64: "aGk=",
      durationMs: 3000,
      hasAudio: true,
    });

    await runNodesCommand(["nodes", "camera", "clip", "--node", "ios-node", "--duration", "3000"]);

    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "node.invoke",
        params: expect.objectContaining({
          nodeId: "ios-node",
          command: "camera.clip",
          timeoutMs: 90000,
          idempotencyKey: "idem-test",
          params: expect.objectContaining({
            facing: "front",
            durationMs: 3000,
            includeAudio: true,
            format: "mp4",
          }),
        }),
      }),
    );

    await expectLoggedSingleMediaFile({
      expectedPathPattern: /openclaw-camera-clip-front-.*\.mp4$/,
    });
  });

  it("runs nodes camera snap with facing front and passes params", async () => {
    mockNodeGateway("camera.snap", { format: "jpg", base64: "aGk=", width: 1, height: 1 });

    await runNodesCommand([
      "nodes",
      "camera",
      "snap",
      "--node",
      "ios-node",
      "--facing",
      "front",
      "--max-width",
      "640",
      "--quality",
      "0.8",
      "--delay-ms",
      "2000",
      "--device-id",
      "cam-123",
    ]);

    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "node.invoke",
        params: expect.objectContaining({
          nodeId: "ios-node",
          command: "camera.snap",
          timeoutMs: 20000,
          idempotencyKey: "idem-test",
          params: expect.objectContaining({
            facing: "front",
            maxWidth: 640,
            quality: 0.8,
            delayMs: 2000,
            deviceId: "cam-123",
          }),
        }),
      }),
    );

    await expectLoggedSingleMediaFile();
  });

  it("runs nodes camera clip with --no-audio", async () => {
    mockNodeGateway("camera.clip", {
      format: "mp4",
      base64: "aGk=",
      durationMs: 3000,
      hasAudio: false,
    });

    await runNodesCommand([
      "nodes",
      "camera",
      "clip",
      "--node",
      "ios-node",
      "--duration",
      "3000",
      "--no-audio",
      "--device-id",
      "cam-123",
    ]);

    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "node.invoke",
        params: expect.objectContaining({
          nodeId: "ios-node",
          command: "camera.clip",
          timeoutMs: 90000,
          idempotencyKey: "idem-test",
          params: expect.objectContaining({
            includeAudio: false,
            deviceId: "cam-123",
          }),
        }),
      }),
    );

    await expectLoggedSingleMediaFile();
  });

  it("runs nodes camera clip with human duration (10s)", async () => {
    mockNodeGateway("camera.clip", {
      format: "mp4",
      base64: "aGk=",
      durationMs: 10_000,
      hasAudio: true,
    });

    await runNodesCommand(["nodes", "camera", "clip", "--node", "ios-node", "--duration", "10s"]);

    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "node.invoke",
        params: expect.objectContaining({
          nodeId: "ios-node",
          command: "camera.clip",
          params: expect.objectContaining({ durationMs: 10_000 }),
        }),
      }),
    );
  });

  it("runs nodes canvas snapshot and prints MEDIA path", async () => {
    mockNodeGateway("canvas.snapshot", { format: "png", base64: "aGk=" });

    await runNodesCommand(["nodes", "canvas", "snapshot", "--node", "ios-node", "--format", "png"]);

    await expectLoggedSingleMediaFile({
      expectedPathPattern: /openclaw-canvas-snapshot-.*\.png$/,
    });
  });

  it("fails nodes camera snap on invalid facing", async () => {
    mockNodeGateway();

    const program = new Command();
    program.exitOverride();
    registerNodesCli(program);
    runtime.error.mockClear();

    await expect(
      program.parseAsync(["nodes", "camera", "snap", "--node", "ios-node", "--facing", "nope"], {
        from: "user",
      }),
    ).rejects.toThrow(/exit/i);

    expect(runtime.error.mock.calls.some(([msg]) => /invalid facing/i.test(String(msg)))).toBe(
      true,
    );
  });

  describe("URL-based payloads", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeAll(() => {
      originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(
        async () =>
          new Response("url-content", {
            status: 200,
            headers: { "content-length": String("11") },
          }),
      ) as unknown as typeof globalThis.fetch;
    });

    afterAll(() => {
      globalThis.fetch = originalFetch;
    });

<<<<<<< HEAD:src/cli/program.nodes-media.test.ts
    it.each([
      {
        label: "runs nodes camera snap with url payload",
        command: "camera.snap" as const,
        payload: {
          format: "jpg",
          url: "https://example.com/photo.jpg",
          width: 640,
          height: 480,
        },
        argv: ["nodes", "camera", "snap", "--node", "ios-node", "--facing", "front"],
        expectedPathPattern: /openclaw-camera-snap-front-.*\.jpg$/,
      },
      {
        label: "runs nodes camera clip with url payload",
        command: "camera.clip" as const,
        payload: {
          format: "mp4",
          url: "https://example.com/clip.mp4",
          durationMs: 5000,
          hasAudio: true,
        },
        argv: ["nodes", "camera", "clip", "--node", "ios-node", "--duration", "5000"],
        expectedPathPattern: /openclaw-camera-clip-front-.*\.mp4$/,
      },
    ])("$label", async ({ command, payload, argv, expectedPathPattern }) => {
      await runAndExpectUrlPayloadMediaFile({
        command,
        payload,
        argv,
        expectedPathPattern,
      });
=======
    it("runs nodes camera snap with url payload", async () => {
      callGateway.mockImplementation(async (opts: { method?: string }) => {
        if (opts.method === "node.list") {
          return {
            ts: Date.now(),
            nodes: [
              {
                nodeId: "ios-node",
                displayName: "iOS Node",
                remoteIp: "192.168.0.88",
                connected: true,
              },
            ],
          };
        }
        if (opts.method === "node.invoke") {
          return {
            ok: true,
            nodeId: "ios-node",
            command: "camera.snap",
            payload: {
              format: "jpg",
              url: "https://example.com/photo.jpg",
              width: 640,
              height: 480,
            },
          };
        }
        return { ok: true };
      });

      const program = buildProgram();
      runtime.log.mockClear();
      await program.parseAsync(
        ["nodes", "camera", "snap", "--node", "ios-node", "--facing", "front"],
        { from: "user" },
      );

      const out = String(runtime.log.mock.calls[0]?.[0] ?? "");
      const mediaPath = out.replace(/^MEDIA:/, "").trim();
      expect(mediaPath).toMatch(/openclaw-camera-snap-front-.*\.jpg$/);

      try {
        await expect(fs.readFile(mediaPath, "utf8")).resolves.toBe("url-content");
      } finally {
        await fs.unlink(mediaPath).catch(() => {});
      }
    });

    it("runs nodes camera clip with url payload", async () => {
      callGateway.mockImplementation(async (opts: { method?: string }) => {
        if (opts.method === "node.list") {
          return {
            ts: Date.now(),
            nodes: [
              {
                nodeId: "ios-node",
                displayName: "iOS Node",
                remoteIp: "192.168.0.88",
                connected: true,
              },
            ],
          };
        }
        if (opts.method === "node.invoke") {
          return {
            ok: true,
            nodeId: "ios-node",
            command: "camera.clip",
            payload: {
              format: "mp4",
              url: "https://example.com/clip.mp4",
              durationMs: 5000,
              hasAudio: true,
            },
          };
        }
        return { ok: true };
      });

      const program = buildProgram();
      runtime.log.mockClear();
      await program.parseAsync(
        ["nodes", "camera", "clip", "--node", "ios-node", "--duration", "5000"],
        { from: "user" },
      );

      const out = String(runtime.log.mock.calls[0]?.[0] ?? "");
      const mediaPath = out.replace(/^MEDIA:/, "").trim();
      expect(mediaPath).toMatch(/openclaw-camera-clip-front-.*\.mp4$/);

      try {
        await expect(fs.readFile(mediaPath, "utf8")).resolves.toBe("url-content");
      } finally {
        await fs.unlink(mediaPath).catch(() => {});
      }
    });
  });

  describe("parseCameraSnapPayload with url", () => {
    it("accepts url without base64", () => {
      const result = parseCameraSnapPayload({
        format: "jpg",
        url: "https://example.com/photo.jpg",
        width: 640,
        height: 480,
      });
      expect(result.url).toBe("https://example.com/photo.jpg");
      expect(result.base64).toBeUndefined();
    });

    it("accepts both base64 and url", () => {
      const result = parseCameraSnapPayload({
        format: "jpg",
        base64: "aGk=",
        url: "https://example.com/photo.jpg",
        width: 640,
        height: 480,
      });
      expect(result.base64).toBe("aGk=");
      expect(result.url).toBe("https://example.com/photo.jpg");
    });

    it("rejects payload with neither base64 nor url", () => {
      expect(() => parseCameraSnapPayload({ format: "jpg", width: 640, height: 480 })).toThrow(
        "invalid camera.snap payload",
      );
    });
  });

  describe("parseCameraClipPayload with url", () => {
    it("accepts url without base64", () => {
      const result = parseCameraClipPayload({
        format: "mp4",
        url: "https://example.com/clip.mp4",
        durationMs: 3000,
        hasAudio: true,
      });
      expect(result.url).toBe("https://example.com/clip.mp4");
      expect(result.base64).toBeUndefined();
    });

    it("rejects payload with neither base64 nor url", () => {
      expect(() =>
        parseCameraClipPayload({ format: "mp4", durationMs: 3000, hasAudio: true }),
      ).toThrow("invalid camera.clip payload");
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/cli/program.nodes-media.e2e.test.ts
    });
  });
});
