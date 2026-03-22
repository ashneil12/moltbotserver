/**
 * System Resource Monitoring
 *
 * Container-aware resource collector that reads cgroup v1/v2 files when
 * running inside Docker, with graceful fallbacks to Node.js/OS APIs.
 *
 * Adapted from chrysb/alphaclaw's system-resources.js (MIT).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryInfo = {
  usedBytes: number;
  totalBytes: number;
  percent: number;
  /** Per-process memory if available */
  process?: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
  };
};

export type CpuInfo = {
  /** CPU utilization percentage (0-100). `null` on first sample. */
  percent: number | null;
  /** Number of cores visible to this container/host. */
  cores: number;
};

export type DiskInfo = {
  usedBytes: number;
  totalBytes: number;
  percent: number;
  path: string;
};

export type SystemResources = {
  memory: MemoryInfo;
  cpu: CpuInfo;
  disk: DiskInfo | null;
  collectedAtMs: number;
};

// ---------------------------------------------------------------------------
// Cgroup paths
// ---------------------------------------------------------------------------

const CGROUP_V2_MEMORY_CURRENT = "/sys/fs/cgroup/memory.current";
const CGROUP_V2_MEMORY_MAX = "/sys/fs/cgroup/memory.max";
const CGROUP_V1_MEMORY_USAGE = "/sys/fs/cgroup/memory/memory.usage_in_bytes";
const CGROUP_V1_MEMORY_LIMIT = "/sys/fs/cgroup/memory/memory.limit_in_bytes";

const CGROUP_V2_CPU_STAT = "/sys/fs/cgroup/cpu.stat";
const CGROUP_V1_CPU_USAGE = "/sys/fs/cgroup/cpuacct/cpuacct.usage";

const CGROUP_V2_CPU_MAX = "/sys/fs/cgroup/cpu.max";
const CGROUP_V1_CPU_QUOTA = "/sys/fs/cgroup/cpu/cpu.cfs_quota_us";
const CGROUP_V1_CPU_PERIOD = "/sys/fs/cgroup/cpu/cpu.cfs_period_us";

/**
 * Sentinel value used by cgroup v2 when no memory limit is set.
 * Also catches cgroup v1's "no limit" which is typically close to host memory.
 */
const NO_LIMIT_SENTINEL = 2 ** 62;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFileInt(filePath: string): number | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    if (raw === "max" || raw === "-1") {
      return null;
    }
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

function readFileText(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function safePercent(used: number, total: number): number {
  if (total <= 0 || used < 0) {
    return 0;
  }
  return Math.min(100, Math.round((used / total) * 1000) / 10);
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

function collectMemoryFromCgroup(): { used: number; total: number } | null {
  // Try cgroup v2 first
  const v2Current = readFileInt(CGROUP_V2_MEMORY_CURRENT);
  const v2Max = readFileInt(CGROUP_V2_MEMORY_MAX);
  if (v2Current !== null && v2Max !== null && v2Max < NO_LIMIT_SENTINEL) {
    return { used: v2Current, total: v2Max };
  }
  // Use v2 current with OS total if no limit set
  if (v2Current !== null) {
    return { used: v2Current, total: os.totalmem() };
  }

  // Try cgroup v1
  const v1Usage = readFileInt(CGROUP_V1_MEMORY_USAGE);
  const v1Limit = readFileInt(CGROUP_V1_MEMORY_LIMIT);
  if (v1Usage !== null && v1Limit !== null && v1Limit < NO_LIMIT_SENTINEL) {
    return { used: v1Usage, total: v1Limit };
  }
  if (v1Usage !== null) {
    return { used: v1Usage, total: os.totalmem() };
  }

  return null;
}

export function collectMemory(): MemoryInfo {
  const cgroup = collectMemoryFromCgroup();
  const totalBytes = cgroup?.total ?? os.totalmem();
  const usedBytes = cgroup?.used ?? os.totalmem() - os.freemem();

  const proc = process.memoryUsage();

  return {
    usedBytes,
    totalBytes,
    percent: safePercent(usedBytes, totalBytes),
    process: {
      rssBytes: proc.rss,
      heapUsedBytes: proc.heapUsed,
      heapTotalBytes: proc.heapTotal,
    },
  };
}

// ---------------------------------------------------------------------------
// CPU
// ---------------------------------------------------------------------------

let lastCpuSampleAtNs = 0n;
let lastCpuUsageNs = 0n;
let lastCpuSampleSource: "v2" | "v1" | "os" | null = null;

/** Parse `usage_usec` from cgroup v2 cpu.stat */
function parseCgroupV2UsageNs(statText: string): bigint | null {
  const match = statText.match(/^usage_usec\s+(\d+)/m);
  if (!match) {
    return null;
  }
  try {
    return BigInt(match[1]) * 1000n; // usec → ns
  } catch {
    return null;
  }
}

/** Resolve the number of CPU cores allocated to this container. */
function resolveAllocatedCores(): number {
  // cgroup v2: cpu.max → "quota period" or "max period"
  const v2Max = readFileText(CGROUP_V2_CPU_MAX);
  if (v2Max) {
    const parts = v2Max.trim().split(/\s+/);
    if (parts.length === 2 && parts[0] !== "max") {
      const quota = Number.parseInt(parts[0], 10);
      const period = Number.parseInt(parts[1], 10);
      if (Number.isFinite(quota) && Number.isFinite(period) && period > 0 && quota > 0) {
        return quota / period;
      }
    }
  }

  // cgroup v1
  const v1Quota = readFileInt(CGROUP_V1_CPU_QUOTA);
  const v1Period = readFileInt(CGROUP_V1_CPU_PERIOD);
  if (v1Quota !== null && v1Quota > 0 && v1Period !== null && v1Period > 0) {
    return v1Quota / v1Period;
  }

  return os.cpus().length;
}

function collectCpuFromCgroupV2(): bigint | null {
  const statText = readFileText(CGROUP_V2_CPU_STAT);
  if (!statText) {
    return null;
  }
  return parseCgroupV2UsageNs(statText);
}

function collectCpuFromCgroupV1(): bigint | null {
  const raw = readFileText(CGROUP_V1_CPU_USAGE);
  if (!raw) {
    return null;
  }
  try {
    return BigInt(raw.trim());
  } catch {
    return null;
  }
}

function collectCpuFromOs(): bigint {
  const cpus = os.cpus();
  let totalUser = 0;
  let totalNice = 0;
  let totalSys = 0;
  for (const cpu of cpus) {
    totalUser += cpu.times.user;
    totalNice += cpu.times.nice;
    totalSys += cpu.times.sys;
  }
  // os.cpus() times are in milliseconds
  return BigInt(totalUser + totalNice + totalSys) * 1_000_000n; // ms → ns
}

export function collectCpu(): CpuInfo {
  const cores = resolveAllocatedCores();
  const nowNs = process.hrtime.bigint();

  // Try cgroup v2
  let currentUsageNs = collectCpuFromCgroupV2();
  let source: "v2" | "v1" | "os" = "v2";
  if (currentUsageNs === null) {
    currentUsageNs = collectCpuFromCgroupV1();
    source = "v1";
  }
  if (currentUsageNs === null) {
    currentUsageNs = collectCpuFromOs();
    source = "os";
  }

  // First sample — store and return null percent
  if (lastCpuSampleAtNs === 0n || lastCpuSampleSource !== source) {
    lastCpuSampleAtNs = nowNs;
    lastCpuUsageNs = currentUsageNs;
    lastCpuSampleSource = source;
    return { percent: null, cores };
  }

  const elapsedNs = nowNs - lastCpuSampleAtNs;
  const usedNs = currentUsageNs - lastCpuUsageNs;

  // Store for next delta
  lastCpuSampleAtNs = nowNs;
  lastCpuUsageNs = currentUsageNs;

  if (elapsedNs <= 0n) {
    return { percent: null, cores };
  }

  // CPU% = (used_ns / elapsed_ns) / allocated_cores * 100
  const coresMultiplied = BigInt(Math.max(1, Math.round(cores * 1000)));
  const percentTimes1000 = ((usedNs * 100_000n) / (elapsedNs * coresMultiplied)) * 1000n;
  const percent = Math.min(100, Math.round(Number(percentTimes1000) / 1000));

  return { percent: Math.max(0, percent), cores };
}

/**
 * Reset CPU sampling state. Exposed for testing only.
 * @internal
 */
export function _resetCpuSamplingState(): void {
  lastCpuSampleAtNs = 0n;
  lastCpuUsageNs = 0n;
  lastCpuSampleSource = null;
}

// ---------------------------------------------------------------------------
// Disk
// ---------------------------------------------------------------------------

export function collectDisk(): DiskInfo | null {
  const checkPath = path.join(os.homedir(), ".openclaw");
  try {
    const stat = fs.statfsSync(checkPath);
    const totalBytes = stat.bsize * stat.blocks;
    const freeBytes = stat.bsize * stat.bavail;
    const usedBytes = totalBytes - freeBytes;
    return {
      usedBytes,
      totalBytes,
      percent: safePercent(usedBytes, totalBytes),
      path: checkPath,
    };
  } catch {
    // Try root filesystem as fallback
    try {
      const stat = fs.statfsSync("/");
      const totalBytes = stat.bsize * stat.blocks;
      const freeBytes = stat.bsize * stat.bavail;
      const usedBytes = totalBytes - freeBytes;
      return {
        usedBytes,
        totalBytes,
        percent: safePercent(usedBytes, totalBytes),
        path: "/",
      };
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Collect current system resource usage.
 *
 * Container-aware: reads cgroup v1/v2 files when inside Docker,
 * falls back to Node.js/OS APIs on bare metal.
 */
export function collectSystemResources(): SystemResources {
  return {
    memory: collectMemory(),
    cpu: collectCpu(),
    disk: collectDisk(),
    collectedAtMs: Date.now(),
  };
}
