import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isEphemeralPath, parseMountInfoLine } from "./ephemeral-path.js";

// ---------------------------------------------------------------------------
// parseMountInfoLine
// ---------------------------------------------------------------------------

describe("parseMountInfoLine", () => {
  it("parses a valid mountinfo line", () => {
    // Real-world mountinfo line format:
    // id parent major:minor root mountPoint opts - fsType source superOpts
    const line = "22 1 0:21 / /tmp rw,nosuid,nodev - tmpfs tmpfs rw";
    const result = parseMountInfoLine(line);
    expect(result).toEqual({ mountPoint: "/tmp", fsType: "tmpfs" });
  });

  it("returns null for empty line", () => {
    expect(parseMountInfoLine("")).toBeNull();
    expect(parseMountInfoLine("   ")).toBeNull();
  });

  it("returns null for line without separator", () => {
    expect(parseMountInfoLine("22 1 0:21 / /tmp rw,nosuid,nodev")).toBeNull();
  });

  it("parses ramfs mount", () => {
    const line = "30 1 0:25 / /run/shm rw,nosuid,nodev - ramfs ramfs rw";
    const result = parseMountInfoLine(line);
    expect(result).toEqual({ mountPoint: "/run/shm", fsType: "ramfs" });
  });

  it("parses ext4 mount", () => {
    const line = "28 1 259:1 / / rw,relatime - ext4 /dev/nvme0n1p1 rw";
    const result = parseMountInfoLine(line);
    expect(result).toEqual({ mountPoint: "/", fsType: "ext4" });
  });

  it("handles lines with many optional fields before separator", () => {
    // mountinfo allows optional tagged fields between opts and " - "
    const line = "33 1 0:30 / /sys/fs/cgroup ro,nosuid,nodev shared:9 - cgroup2 cgroup rw";
    const result = parseMountInfoLine(line);
    expect(result).toEqual({ mountPoint: "/sys/fs/cgroup", fsType: "cgroup2" });
  });
});

// ---------------------------------------------------------------------------
// isEphemeralPath
// ---------------------------------------------------------------------------

describe("isEphemeralPath", () => {
  it("detects /tmp as ephemeral", () => {
    const result = isEphemeralPath("/tmp/some-file.txt");
    expect(result.ephemeral).toBe(true);
    expect(result.reason).toContain("ephemeral");
  });

  it("detects /tmp itself as ephemeral", () => {
    const result = isEphemeralPath("/tmp");
    expect(result.ephemeral).toBe(true);
  });

  it("detects os.tmpdir() as ephemeral", () => {
    const tmpDir = os.tmpdir();
    const result = isEphemeralPath(path.join(tmpDir, "test"));
    expect(result.ephemeral).toBe(true);
  });

  it("does not flag /home/user as ephemeral", () => {
    const result = isEphemeralPath("/home/user/workspace");
    expect(result.ephemeral).toBe(false);
  });

  it("does not flag /var/data as ephemeral", () => {
    const result = isEphemeralPath("/var/data/important");
    expect(result.ephemeral).toBe(false);
  });

  it("handles relative paths by resolving them", () => {
    // Even if a relative path resolves to /tmp, it should be detected
    const cwd = process.cwd();
    if (!cwd.startsWith("/tmp")) {
      // If we're not in /tmp, relative paths shouldn't be ephemeral
      const result = isEphemeralPath("./some-local-file");
      expect(result.ephemeral).toBe(false);
    }
  });

  it("detects /var/tmp as ephemeral", () => {
    const result = isEphemeralPath("/var/tmp/something");
    expect(result.ephemeral).toBe(true);
  });

  if (process.platform === "darwin") {
    it("detects /private/tmp as ephemeral on macOS", () => {
      const result = isEphemeralPath("/private/tmp/my-file");
      expect(result.ephemeral).toBe(true);
    });
  }
});
