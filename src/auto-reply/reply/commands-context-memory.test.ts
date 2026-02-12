/**
 * Context Memory Commands Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import type { HandleCommandsParams, CommandContext, CommandHandlerResult } from "./commands-types.js";
import type { InlineDirectives } from "./directive-handling.js";
import {
  handleFreshCommand,
  handleForgetCommand,
  handleRememberCommand,
} from "./commands-context-memory.js";

// Mock the rotation service
vi.mock("../../context/rotation-service.js", () => ({
  forceRotation: vi.fn().mockResolvedValue(undefined),
  clearRotationState: vi.fn(),
}));

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  default: {
    readdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

function createMockParams(
  commandBody: string,
  options: {
    isAuthorized?: boolean;
    sessionKey?: string;
    workspaceDir?: string;
  } = {},
): HandleCommandsParams {
  const command: CommandContext = {
    surface: "chat",
    channel: "test",
    ownerList: ["owner"],
    senderIsOwner: options.isAuthorized ?? true,
    isAuthorizedSender: options.isAuthorized ?? true,
    rawBodyNormalized: commandBody,
    commandBodyNormalized: commandBody,
  };

  return {
    ctx: {} as never,
    cfg: {} as never,
    command,
    directives: {} as InlineDirectives,
    elevated: { enabled: false, allowed: false, failures: [] },
    sessionKey: options.sessionKey ?? "test-session",
    workspaceDir: options.workspaceDir ?? "/tmp/test-workspace",
    defaultGroupActivation: () => "mention",
    resolvedThinkLevel: undefined,
    resolvedVerboseLevel: "none",
    resolvedReasoningLevel: "off",
    resolveDefaultThinkingLevel: async () => undefined,
    provider: "test",
    model: "test",
    contextTokens: 4000,
    isGroup: false,
  };
}

describe("handleFreshCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null for non-/fresh commands", async () => {
    const params = createMockParams("/help");
    const result = await handleFreshCommand(params, true);
    expect(result).toBeNull();
  });

  it("ignores /fresh from unauthorized sender", async () => {
    const params = createMockParams("/fresh", { isAuthorized: false });
    const result = await handleFreshCommand(params, true);
    expect(result).toEqual({ shouldContinue: false });
  });

  it("handles /fresh command", async () => {
    const params = createMockParams("/fresh");
    const result = await handleFreshCommand(params, true);
    expect(result?.shouldContinue).toBe(false);
    expect(result?.reply?.text).toContain("Context cleared");
    expect(result?.reply?.text).toContain("memories are intact");
  });

  it("returns null when text commands disabled", async () => {
    const params = createMockParams("/fresh");
    const result = await handleFreshCommand(params, false);
    expect(result).toBeNull();
  });
});

describe("handleForgetCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null for non-/forget commands", async () => {
    const params = createMockParams("/help");
    const result = await handleForgetCommand(params, true);
    expect(result).toBeNull();
  });

  it("requires a topic", async () => {
    const params = createMockParams("/forget");
    const result = await handleForgetCommand(params, true);
    expect(result?.shouldContinue).toBe(false);
    expect(result?.reply?.text).toContain("Usage:");
  });

  it("ignores /forget from unauthorized sender", async () => {
    const params = createMockParams("/forget something", { isAuthorized: false });
    const result = await handleForgetCommand(params, true);
    expect(result).toEqual({ shouldContinue: false });
  });

  it("returns no results message when no memories found", async () => {
    vi.mocked(fs.readdir).mockResolvedValue([]);
    const params = createMockParams("/forget nonexistent");
    const result = await handleForgetCommand(params, true);
    expect(result?.reply?.text).toContain("No memories found");
  });

  it("returns matching memories for selection", async () => {
    vi.mocked(fs.readdir).mockResolvedValue(["2026-02-07.md"] as never);
    vi.mocked(fs.readFile).mockResolvedValue(`# Memories - 2026-02-07

## 16:30:00
- User prefers TypeScript #preferences
- Working on Emma's project #projects
`);

    const params = createMockParams("/forget Emma");
    const result = await handleForgetCommand(params, true);
    expect(result?.reply?.text).toContain("Found 1 memories");
    expect(result?.reply?.text).toContain("Emma");
  });
});

describe("handleRememberCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null for non-/remember commands", async () => {
    const params = createMockParams("/help");
    const result = await handleRememberCommand(params, true);
    expect(result).toBeNull();
  });

  it("requires a topic", async () => {
    const params = createMockParams("/remember");
    const result = await handleRememberCommand(params, true);
    expect(result?.shouldContinue).toBe(false);
    expect(result?.reply?.text).toContain("Usage:");
  });

  it("ignores /remember from unauthorized sender", async () => {
    const params = createMockParams("/remember something", { isAuthorized: false });
    const result = await handleRememberCommand(params, true);
    expect(result).toEqual({ shouldContinue: false });
  });

  it("returns no results message when no memories found", async () => {
    vi.mocked(fs.readdir).mockResolvedValue([]);
    const params = createMockParams("/remember nonexistent");
    const result = await handleRememberCommand(params, true);
    expect(result?.reply?.text).toContain("No memories found");
  });

  it("injects single result immediately", async () => {
    vi.mocked(fs.readdir).mockResolvedValue(["2026-02-07.md"] as never);
    vi.mocked(fs.readFile).mockResolvedValue(`# Memories - 2026-02-07

## 16:30:00
- Daughter's name is Emma #family
`);

    const params = createMockParams("/remember Emma");
    const result = await handleRememberCommand(params, true);
    expect(result?.reply?.text).toContain("Added to context");
    expect(result?.reply?.text).toContain("Emma");
  });

  it("prompts for selection when multiple results", async () => {
    vi.mocked(fs.readdir).mockResolvedValue(["2026-02-07.md"] as never);
    vi.mocked(fs.readFile).mockResolvedValue(`# Memories - 2026-02-07

## 16:30:00
- Daughter's name is Emma #family
- Emma's school is Riverside #family
`);

    const params = createMockParams("/remember Emma");
    const result = await handleRememberCommand(params, true);
    expect(result?.reply?.text).toContain("Found 2 memories");
    expect(result?.reply?.text).toContain("Enter numbers");
  });
});
