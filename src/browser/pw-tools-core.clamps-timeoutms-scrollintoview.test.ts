import { describe, expect, it, vi } from "vitest";
import {
  installPwToolsCoreTestHooks,
  setPwToolsCoreCurrentPage,
  setPwToolsCoreCurrentRefLocator,
} from "./pw-tools-core.test-harness.js";

<<<<<<< HEAD
installPwToolsCoreTestHooks();
=======
let currentPage: Record<string, unknown> | null = null;
let currentRefLocator: Record<string, unknown> | null = null;
let pageState: {
  console: unknown[];
  armIdUpload: number;
  armIdDialog: number;
  armIdDownload: number;
};

const sessionMocks = vi.hoisted(() => ({
  getPageForTargetId: vi.fn(async () => {
    if (!currentPage) {
      throw new Error("missing page");
    }
    return currentPage;
  }),
  ensurePageState: vi.fn(() => pageState),
  restoreRoleRefsForTarget: vi.fn(() => {}),
  refLocator: vi.fn(() => {
    if (!currentRefLocator) {
      throw new Error("missing locator");
    }
    return currentRefLocator;
  }),
  rememberRoleRefsForTarget: vi.fn(() => {}),
}));

vi.mock("./pw-session.js", () => sessionMocks);
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
const mod = await import("./pw-tools-core.js");

describe("pw-tools-core", () => {
  it("clamps timeoutMs for scrollIntoView", async () => {
    const scrollIntoViewIfNeeded = vi.fn(async () => {});
    setPwToolsCoreCurrentRefLocator({ scrollIntoViewIfNeeded });
    setPwToolsCoreCurrentPage({});

    await mod.scrollIntoViewViaPlaywright({
      cdpUrl: "http://127.0.0.1:18792",
      targetId: "T1",
      ref: "1",
      timeoutMs: 50,
    });

    expect(scrollIntoViewIfNeeded).toHaveBeenCalledWith({ timeout: 500 });
  });
  it.each([
    {
      name: "strict mode violations for scrollIntoView",
      errorMessage: 'Error: strict mode violation: locator("aria-ref=1") resolved to 2 elements',
      expectedMessage: /Run a new snapshot/i,
    },
    {
      name: "not-visible timeouts for scrollIntoView",
      errorMessage: 'Timeout 5000ms exceeded. waiting for locator("aria-ref=1") to be visible',
      expectedMessage: /not found or not visible/i,
    },
  ])("rewrites $name", async ({ errorMessage, expectedMessage }) => {
    const scrollIntoViewIfNeeded = vi.fn(async () => {
      throw new Error(errorMessage);
    });
    setPwToolsCoreCurrentRefLocator({ scrollIntoViewIfNeeded });
    setPwToolsCoreCurrentPage({});

    await expect(
      mod.scrollIntoViewViaPlaywright({
        cdpUrl: "http://127.0.0.1:18792",
        targetId: "T1",
        ref: "1",
      }),
    ).rejects.toThrow(expectedMessage);
  });
<<<<<<< HEAD
  it.each([
    {
      name: "strict mode violations into snapshot hints",
      errorMessage: 'Error: strict mode violation: locator("aria-ref=1") resolved to 2 elements',
      expectedMessage: /Run a new snapshot/i,
    },
    {
      name: "not-visible timeouts into snapshot hints",
      errorMessage: 'Timeout 5000ms exceeded. waiting for locator("aria-ref=1") to be visible',
      expectedMessage: /not found or not visible/i,
    },
  ])("rewrites $name", async ({ errorMessage, expectedMessage }) => {
=======
  it("rewrites not-visible timeouts for scrollIntoView", async () => {
    const scrollIntoViewIfNeeded = vi.fn(async () => {
      throw new Error('Timeout 5000ms exceeded. waiting for locator("aria-ref=1") to be visible');
    });
    currentRefLocator = { scrollIntoViewIfNeeded };
    currentPage = {};

    await expect(
      mod.scrollIntoViewViaPlaywright({
        cdpUrl: "http://127.0.0.1:18792",
        targetId: "T1",
        ref: "1",
      }),
    ).rejects.toThrow(/not found or not visible/i);
  });
  it("rewrites strict mode violations into snapshot hints", async () => {
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    const click = vi.fn(async () => {
      throw new Error(errorMessage);
    });
    setPwToolsCoreCurrentRefLocator({ click });
    setPwToolsCoreCurrentPage({});

    await expect(
      mod.clickViaPlaywright({
        cdpUrl: "http://127.0.0.1:18792",
        targetId: "T1",
        ref: "1",
      }),
<<<<<<< HEAD
    ).rejects.toThrow(expectedMessage);
=======
    ).rejects.toThrow(/Run a new snapshot/i);
  });
  it("rewrites not-visible timeouts into snapshot hints", async () => {
    const click = vi.fn(async () => {
      throw new Error('Timeout 5000ms exceeded. waiting for locator("aria-ref=1") to be visible');
    });
    currentRefLocator = { click };
    currentPage = {};

    await expect(
      mod.clickViaPlaywright({
        cdpUrl: "http://127.0.0.1:18792",
        targetId: "T1",
        ref: "1",
      }),
    ).rejects.toThrow(/not found or not visible/i);
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  });
  it("rewrites covered/hidden errors into interactable hints", async () => {
    const click = vi.fn(async () => {
      throw new Error(
        "Element is not receiving pointer events because another element intercepts pointer events",
      );
    });
    setPwToolsCoreCurrentRefLocator({ click });
    setPwToolsCoreCurrentPage({});

    await expect(
      mod.clickViaPlaywright({
        cdpUrl: "http://127.0.0.1:18792",
        targetId: "T1",
        ref: "1",
      }),
    ).rejects.toThrow(/not interactable/i);
  });
});
