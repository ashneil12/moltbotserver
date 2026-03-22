import { describe, it, expect, beforeEach } from "vitest";

// We test the pure utility functions; cgroup file reads are mocked at fs level.

describe("system-resources", () => {
  beforeEach(async () => {
    // Reset CPU sampling state between tests
    const mod = await import("./system-resources.js");
    mod._resetCpuSamplingState();
  });

  describe("collectMemory", () => {
    it("returns memory info with percent, usedBytes, totalBytes", async () => {
      const { collectMemory } = await import("./system-resources.js");
      const mem = collectMemory();
      expect(mem).toBeDefined();
      expect(typeof mem.usedBytes).toBe("number");
      expect(typeof mem.totalBytes).toBe("number");
      expect(typeof mem.percent).toBe("number");
      expect(mem.usedBytes).toBeGreaterThanOrEqual(0);
      expect(mem.totalBytes).toBeGreaterThan(0);
      expect(mem.percent).toBeGreaterThanOrEqual(0);
      expect(mem.percent).toBeLessThanOrEqual(100);
    });

    it("includes process memory info", async () => {
      const { collectMemory } = await import("./system-resources.js");
      const mem = collectMemory();
      expect(mem.process).toBeDefined();
      expect(typeof mem.process!.rssBytes).toBe("number");
      expect(typeof mem.process!.heapUsedBytes).toBe("number");
      expect(typeof mem.process!.heapTotalBytes).toBe("number");
      expect(mem.process!.rssBytes).toBeGreaterThan(0);
    });
  });

  describe("collectCpu", () => {
    it("returns null percent on first sample (needs delta)", async () => {
      const { collectCpu, _resetCpuSamplingState } = await import("./system-resources.js");
      _resetCpuSamplingState();
      const cpu = collectCpu();
      expect(cpu).toBeDefined();
      expect(cpu.percent).toBeNull();
      expect(typeof cpu.cores).toBe("number");
      expect(cpu.cores).toBeGreaterThan(0);
    });

    it("returns numeric percent on second sample", async () => {
      const { collectCpu, _resetCpuSamplingState } = await import("./system-resources.js");
      _resetCpuSamplingState();
      collectCpu(); // first sample (calibration)

      // Small busy-wait to ensure elapsed time
      const start = Date.now();
      while (Date.now() - start < 50) {
        // spin
      }

      const cpu = collectCpu(); // second sample
      // On macOS testing with OS fallback, percent should be a number
      expect(typeof cpu.percent).toBe("number");
      expect(cpu.percent!).toBeGreaterThanOrEqual(0);
      expect(cpu.percent!).toBeLessThanOrEqual(100);
    });
  });

  describe("collectDisk", () => {
    it("returns disk info or null", async () => {
      const { collectDisk } = await import("./system-resources.js");
      const disk = collectDisk();
      // May be null on some test environments
      if (disk) {
        expect(typeof disk.usedBytes).toBe("number");
        expect(typeof disk.totalBytes).toBe("number");
        expect(typeof disk.percent).toBe("number");
        expect(typeof disk.path).toBe("string");
        expect(disk.totalBytes).toBeGreaterThan(0);
        expect(disk.percent).toBeGreaterThanOrEqual(0);
        expect(disk.percent).toBeLessThanOrEqual(100);
      }
    });
  });

  describe("collectSystemResources", () => {
    it("returns a complete SystemResources object", async () => {
      const { collectSystemResources } = await import("./system-resources.js");
      const resources = collectSystemResources();

      expect(resources).toBeDefined();
      expect(resources.memory).toBeDefined();
      expect(resources.cpu).toBeDefined();
      expect(typeof resources.collectedAtMs).toBe("number");
      expect(resources.collectedAtMs).toBeGreaterThan(0);

      // Memory
      expect(resources.memory.usedBytes).toBeGreaterThanOrEqual(0);
      expect(resources.memory.totalBytes).toBeGreaterThan(0);

      // CPU (first sample → null)
      expect(resources.cpu.cores).toBeGreaterThan(0);

      // Disk may or may not be available
      if (resources.disk) {
        expect(resources.disk.totalBytes).toBeGreaterThan(0);
      }
    });

    it("does not throw on repeated calls", async () => {
      const { collectSystemResources } = await import("./system-resources.js");
      expect(() => collectSystemResources()).not.toThrow();
      expect(() => collectSystemResources()).not.toThrow();
      expect(() => collectSystemResources()).not.toThrow();
    });
  });
});
