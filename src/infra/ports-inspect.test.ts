import net from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseProcNetTcpListeners } from "./ports-inspect.js";

const runCommandWithTimeoutMock = vi.fn();

vi.mock("../process/exec.js", () => ({
  runCommandWithTimeout: (...args: unknown[]) => runCommandWithTimeoutMock(...args),
}));

const describeUnix = process.platform === "win32" ? describe.skip : describe;

describeUnix("inspectPortUsage", () => {
  beforeEach(() => {
    runCommandWithTimeoutMock.mockReset();
  });

  it("reports busy when lsof is missing but loopback listener exists", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;

    runCommandWithTimeoutMock.mockRejectedValueOnce(
      Object.assign(new Error("spawn lsof ENOENT"), { code: "ENOENT" }),
    );

    try {
      const { inspectPortUsage } = await import("./ports-inspect.js");
      const result = await inspectPortUsage(port);
      expect(result.status).toBe("busy");
      expect(result.errors?.some((err) => err.includes("ENOENT"))).toBe(true);
    } finally {
      server.close();
    }
  });
});

describe("parseProcNetTcpListeners", () => {
  // Realistic /proc/net/tcp format (kernel format, whitespace-separated):
  // sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
  //  0: 00000000:4965 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 ...

  it("matches a LISTEN entry on the target port", () => {
    // Port 18789 = 0x4965
    const content = [
      "  sl  local_address rem_address   st tx_queue rx_queue ...",
      "   0: 00000000:4965 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1",
    ].join("\n");

    const result = parseProcNetTcpListeners(content, 18789);
    expect(result.listeners).toHaveLength(1);
    expect(result.listeners[0].address).toBe("00000000:4965");
    expect(result.detail).toBeDefined();
  });

  it("ignores ESTABLISHED connections (state 01)", () => {
    // Same port but state 01 (ESTABLISHED), not 0A (LISTEN)
    const content = [
      "  sl  local_address rem_address   st ...",
      "   0: 0100007F:4965 0100007F:9C40 01 00000000:00000000 00:00000000 00000000     0        0 99999 1",
    ].join("\n");

    const result = parseProcNetTcpListeners(content, 18789);
    expect(result.listeners).toHaveLength(0);
  });

  it("ignores TIME_WAIT connections (state 06)", () => {
    const content = [
      "   0: 00000000:4965 0100007F:9C40 06 00000000:00000000 00:00000000 00000000     0        0 99999 1",
    ].join("\n");

    const result = parseProcNetTcpListeners(content, 18789);
    expect(result.listeners).toHaveLength(0);
  });

  it("handles empty content", () => {
    const result = parseProcNetTcpListeners("", 18789);
    expect(result.listeners).toHaveLength(0);
    expect(result.detail).toBeUndefined();
  });

  it("finds multiple LISTEN entries across tcp and tcp6", () => {
    // Two entries: one IPv4, one IPv6, both LISTEN on port 18789
    const content = [
      "   0: 00000000:4965 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1",
      "   1: 00000000000000000000000000000000:4965 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12346 1",
    ].join("\n");

    const result = parseProcNetTcpListeners(content, 18789);
    expect(result.listeners).toHaveLength(2);
  });

  it("correctly converts port numbers to hex for matching", () => {
    // Port 80 = 0x0050
    const content = [
      "   0: 00000000:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 11111 1",
    ].join("\n");

    const result = parseProcNetTcpListeners(content, 80);
    expect(result.listeners).toHaveLength(1);
  });

  it("does not match port in remote address", () => {
    // Port 18789 appears in REMOTE address, not local — should not match
    const content = [
      "   0: 0100007F:9C40 0100007F:4965 01 00000000:00000000 00:00000000 00000000     0        0 33333 1",
    ].join("\n");

    const result = parseProcNetTcpListeners(content, 18789);
    expect(result.listeners).toHaveLength(0);
  });
});
