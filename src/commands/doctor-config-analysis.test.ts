import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import {
  formatConfigPath,
  noteMissingDefaultAgent,
  resolveConfigPathTarget,
  stripUnknownConfigKeys,
} from "./doctor-config-analysis.js";

vi.mock("../terminal/note.js", () => ({
  note: vi.fn(),
}));

import { note } from "../terminal/note.js";
const noteMock = note as ReturnType<typeof vi.fn>;

describe("doctor config analysis helpers", () => {
  it("formats config paths predictably", () => {
    expect(formatConfigPath([])).toBe("<root>");
    expect(formatConfigPath(["channels", "slack", "accounts", 0, "token"])).toBe(
      "channels.slack.accounts[0].token",
    );
  });

  it("resolves nested config targets without throwing", () => {
    const target = resolveConfigPathTarget(
      { channels: { slack: { accounts: [{ token: "x" }] } } },
      ["channels", "slack", "accounts", 0],
    );
    expect(target).toEqual({ token: "x" });
    expect(resolveConfigPathTarget({ channels: null }, ["channels", "slack"])).toBeNull();
  });

  it("strips unknown config keys while keeping known values", () => {
    const result = stripUnknownConfigKeys({
      hooks: {},
      unexpected: true,
    } as never);
    expect(result.removed).toContain("unexpected");
    expect((result.config as Record<string, unknown>).unexpected).toBeUndefined();
    expect((result.config as Record<string, unknown>).hooks).toEqual({});
  });
});

describe("noteMissingDefaultAgent", () => {
  it("warns when multiple agents have no default", () => {
    noteMock.mockClear();
    const cfg: OpenClawConfig = {
      agents: {
        list: [{ id: "ocs-nehemiah" }, { id: "mm-ezra" }],
      },
    };
    noteMissingDefaultAgent(cfg);
    expect(noteMock).toHaveBeenCalledWith(
      expect.stringContaining("none has default=true"),
      "Doctor warnings",
    );
    expect(noteMock).toHaveBeenCalledWith(
      expect.stringContaining('"ocs-nehemiah"'),
      expect.any(String),
    );
  });

  it("does not warn when an agent has default=true", () => {
    noteMock.mockClear();
    const cfg: OpenClawConfig = {
      agents: {
        list: [{ id: "main", default: true }, { id: "ocs-nehemiah" }],
      },
    };
    noteMissingDefaultAgent(cfg);
    expect(noteMock).not.toHaveBeenCalled();
  });

  it("does not warn for a single agent", () => {
    noteMock.mockClear();
    const cfg: OpenClawConfig = {
      agents: {
        list: [{ id: "solo" }],
      },
    };
    noteMissingDefaultAgent(cfg);
    expect(noteMock).not.toHaveBeenCalled();
  });

  it("does not warn when no agents list exists", () => {
    noteMock.mockClear();
    noteMissingDefaultAgent({});
    expect(noteMock).not.toHaveBeenCalled();
  });
});
