import fs from "node:fs/promises";
import path from "node:path";
<<<<<<< HEAD
import { describe, expect, it } from "vitest";
import { withStateDirEnv } from "../test-helpers/state-dir-env.js";
import { loadOrCreateDeviceIdentity } from "./device-identity.js";

describe("device identity state dir defaults", () => {
  it("writes the default identity file under OPENCLAW_STATE_DIR", async () => {
    await withStateDirEnv("openclaw-identity-state-", async ({ stateDir }) => {
      const identity = loadOrCreateDeviceIdentity();
=======
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  restoreStateDirEnv,
  setStateDirEnv,
  snapshotStateDirEnv,
} from "../test-helpers/state-dir-env.js";
import { loadOrCreateDeviceIdentity } from "./device-identity.js";

describe("device identity state dir defaults", () => {
  let envSnapshot: ReturnType<typeof snapshotStateDirEnv>;

  beforeEach(() => {
    envSnapshot = snapshotStateDirEnv();
  });

  afterEach(() => {
    restoreStateDirEnv(envSnapshot);
  });

  it("writes the default identity file under OPENCLAW_STATE_DIR", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-identity-state-"));
    const stateDir = path.join(tempRoot, "state");
    setStateDirEnv(stateDir);
    const identity = loadOrCreateDeviceIdentity();

    try {
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
      const identityPath = path.join(stateDir, "identity", "device.json");
      const raw = JSON.parse(await fs.readFile(identityPath, "utf8")) as { deviceId?: string };
      expect(raw.deviceId).toBe(identity.deviceId);
    });
  });
});
