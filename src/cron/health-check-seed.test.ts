import { describe, it, expect, vi } from "vitest";
import {
  buildHealthCheckJob,
  seedHealthCheckJob,
  HEALTH_CHECK_JOB_ID,
} from "./health-check-seed.js";
import type { CronJob } from "./types.js";

describe("health-check-seed", () => {
  describe("buildHealthCheckJob", () => {
    it("returns a valid job definition with defaults", () => {
      const job = buildHealthCheckJob();
      expect(job.name).toBe("System Health Check");
      expect(job.enabled).toBe(true);
      expect(job.schedule).toEqual({ kind: "cron", expr: "0 */6 * * *" });
      expect(job.sessionTarget).toBe("isolated");
      expect(job.wakeMode).toBe("now");
      expect(job.payload.kind).toBe("agentTurn");
      const payload = job.payload as { kind: "agentTurn"; message: string };
      expect(payload.message).toContain("cron_heal diagnose");
      expect(job.delivery).toEqual({ mode: "none" });
    });

    it("accepts custom schedule", () => {
      const job = buildHealthCheckJob({ schedule: "0 */3 * * *" });
      expect(job.schedule).toEqual({ kind: "cron", expr: "0 */3 * * *" });
    });

    it("accepts agentId", () => {
      const job = buildHealthCheckJob({ agentId: "test-agent" });
      expect((job as Record<string, unknown>).agentId).toBe("test-agent");
    });

    it("omits agentId when not provided", () => {
      const job = buildHealthCheckJob();
      expect((job as Record<string, unknown>).agentId).toBeUndefined();
    });
  });

  describe("seedHealthCheckJob", () => {
    it("creates job when none exists", () => {
      const addJob = vi.fn().mockReturnValue({ id: "new-job" });
      const result = seedHealthCheckJob({ jobs: [], addJob });
      expect(result).toBe(true);
      expect(addJob).toHaveBeenCalledTimes(1);
      expect(addJob.mock.calls[0][0].name).toBe("System Health Check");
    });

    it("skips when job already exists by name", () => {
      const existing = { id: "some-id", name: "System Health Check" } as CronJob;
      const addJob = vi.fn();
      const result = seedHealthCheckJob({ jobs: [existing], addJob });
      expect(result).toBe(false);
      expect(addJob).not.toHaveBeenCalled();
    });

    it("skips when job already exists by ID", () => {
      const existing = { id: HEALTH_CHECK_JOB_ID, name: "Old Name" } as CronJob;
      const addJob = vi.fn();
      const result = seedHealthCheckJob({ jobs: [existing], addJob });
      expect(result).toBe(false);
      expect(addJob).not.toHaveBeenCalled();
    });

    it("handles addJob returning undefined", () => {
      const addJob = vi.fn().mockReturnValue(undefined);
      const result = seedHealthCheckJob({ jobs: [], addJob });
      expect(result).toBe(false);
    });

    it("handles addJob throwing", () => {
      const addJob = vi.fn().mockImplementation(() => {
        throw new Error("store full");
      });
      const result = seedHealthCheckJob({ jobs: [], addJob });
      expect(result).toBe(false);
    });

    it("passes agentId and schedule to buildHealthCheckJob", () => {
      const addJob = vi.fn().mockReturnValue({ id: "created" });
      seedHealthCheckJob({
        jobs: [],
        addJob,
        agentId: "my-agent",
        schedule: "0 */12 * * *",
      });
      const jobDef = addJob.mock.calls[0][0];
      expect(jobDef.schedule.expr).toBe("0 */12 * * *");
      expect(jobDef.agentId).toBe("my-agent");
    });
  });
});
