import { afterEach, expect, test, vi } from "vitest";
<<<<<<< HEAD:src/agents/bash-tools.exec.pty-fallback.test.ts
import { resetProcessRegistryForTests } from "./bash-process-registry.js";
import { createExecTool } from "./bash-tools.exec.js";
=======
import { resetProcessRegistryForTests } from "./bash-process-registry";
import { createExecTool } from "./bash-tools.exec";
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/bash-tools.exec.pty-fallback.e2e.test.ts

vi.mock("@lydell/node-pty", () => ({
  spawn: () => {
    const err = new Error("spawn EBADF");
    (err as NodeJS.ErrnoException).code = "EBADF";
    throw err;
  },
}));

afterEach(() => {
  resetProcessRegistryForTests();
  vi.clearAllMocks();
});

test("exec falls back when PTY spawn fails", async () => {
<<<<<<< HEAD:src/agents/bash-tools.exec.pty-fallback.test.ts
  const tool = createExecTool({ allowBackground: false, security: "full", ask: "off" });
=======
  const tool = createExecTool({ allowBackground: false });
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build):src/agents/bash-tools.exec.pty-fallback.e2e.test.ts
  const result = await tool.execute("toolcall", {
    command: "printf ok",
    pty: true,
  });

  expect(result.details.status).toBe("completed");
  const text = result.content?.find((item) => item.type === "text")?.text ?? "";
  expect(text).toContain("ok");
  expect(text).toContain("PTY spawn failed");
});
