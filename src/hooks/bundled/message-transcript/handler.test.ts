import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../../config/config.js";
import type { HookHandler } from "../../hooks.js";
import { createHookEvent } from "../../hooks.js";
import type { InternalHookEvent } from "../../internal-hooks.js";

let handler: HookHandler;
let suiteRoot = "";
let caseCounter = 0;

async function createCaseDir(prefix = "case"): Promise<string> {
  const dir = path.join(suiteRoot, `${prefix}-${caseCounter}`);
  caseCounter += 1;
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function makeCfg(workspaceDir: string): OpenClawConfig {
  return { agents: { defaults: { workspace: workspaceDir } } } satisfies OpenClawConfig;
}

function makeReceivedEvent(
  workspaceDir: string,
  overrides: Partial<{
    from: string;
    content: string;
    channelId: string;
    timestamp: Date;
    sessionKey: string;
  }> = {},
): InternalHookEvent {
  const ts = overrides.timestamp ?? new Date("2026-03-04T14:32:05.000Z");
  return {
    ...createHookEvent("message", "received", overrides.sessionKey ?? "agent:main:main", {
      from: overrides.from ?? "+1234567890",
      content: overrides.content ?? "Hello there",
      channelId: overrides.channelId ?? "telegram",
      cfg: makeCfg(workspaceDir),
    }),
    timestamp: ts,
  };
}

function makeSentEvent(
  workspaceDir: string,
  overrides: Partial<{
    to: string;
    content: string;
    channelId: string;
    success: boolean;
    timestamp: Date;
    sessionKey: string;
  }> = {},
): InternalHookEvent {
  const ts = overrides.timestamp ?? new Date("2026-03-04T14:32:12.000Z");
  return {
    ...createHookEvent("message", "sent", overrides.sessionKey ?? "agent:main:main", {
      to: overrides.to ?? "+1234567890",
      content: overrides.content ?? "I'm doing great!",
      success: overrides.success ?? true,
      channelId: overrides.channelId ?? "telegram",
      cfg: makeCfg(workspaceDir),
    }),
    timestamp: ts,
  };
}

function makeCfgWithSubAgent(
  defaultWorkspace: string,
  agentId: string,
  agentWorkspace: string,
): OpenClawConfig {
  return {
    agents: {
      defaults: { workspace: defaultWorkspace },
      list: [{ id: agentId, workspace: agentWorkspace }],
    },
  } satisfies OpenClawConfig;
}

async function readTranscript(workspaceDir: string, date: string): Promise<string> {
  const filePath = path.join(workspaceDir, "transcripts", `${date}.md`);
  return fs.readFile(filePath, "utf-8");
}

async function transcriptExists(workspaceDir: string, date: string): Promise<boolean> {
  try {
    await fs.access(path.join(workspaceDir, "transcripts", `${date}.md`));
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  ({ default: handler } = await import("./handler.js"));
  suiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-message-transcript-"));
});

afterAll(async () => {
  if (!suiteRoot) {
    return;
  }
  await fs.rm(suiteRoot, { recursive: true, force: true });
  suiteRoot = "";
  caseCounter = 0;
});

describe("message-transcript hook", () => {
  it("skips non-message events", async () => {
    const dir = await createCaseDir("workspace");
    const event = createHookEvent("command", "new", "agent:main:main", {
      cfg: makeCfg(dir),
    });

    await handler(event);

    const transcriptsDir = path.join(dir, "transcripts");
    await expect(fs.access(transcriptsDir)).rejects.toThrow();
  });

  it("writes received message to daily file", async () => {
    const dir = await createCaseDir("workspace");
    const event = makeReceivedEvent(dir);

    await handler(event);

    const content = await readTranscript(dir, "2026-03-04");
    expect(content).toContain("## 14:32:05 — user: +1234567890 (telegram)");
    expect(content).toContain("Hello there");
    expect(content).toContain("---");
  });

  it("writes sent message to daily file", async () => {
    const dir = await createCaseDir("workspace");
    const event = makeSentEvent(dir);

    await handler(event);

    const content = await readTranscript(dir, "2026-03-04");
    expect(content).toContain("## 14:32:12 — assistant (telegram)");
    expect(content).toContain("I'm doing great!");
    expect(content).toContain("---");
  });

  it("skips failed sends", async () => {
    const dir = await createCaseDir("workspace");
    const event = makeSentEvent(dir, { success: false, content: "Failed message" });

    await handler(event);

    const exists = await transcriptExists(dir, "2026-03-04");
    expect(exists).toBe(false);
  });

  it("skips messages with empty content", async () => {
    const dir = await createCaseDir("workspace");
    const receivedEmpty = makeReceivedEvent(dir, { content: "   " });

    await handler(receivedEmpty);

    const exists = await transcriptExists(dir, "2026-03-04");
    expect(exists).toBe(false);
  });

  it("appends multiple messages to the same daily file", async () => {
    const dir = await createCaseDir("workspace");

    const received = makeReceivedEvent(dir, {
      content: "First message",
      timestamp: new Date("2026-03-04T10:00:00.000Z"),
    });
    const sent = makeSentEvent(dir, {
      content: "First reply",
      timestamp: new Date("2026-03-04T10:00:05.000Z"),
    });
    const received2 = makeReceivedEvent(dir, {
      content: "Second message",
      timestamp: new Date("2026-03-04T10:01:00.000Z"),
    });

    await handler(received);
    await handler(sent);
    await handler(received2);

    const content = await readTranscript(dir, "2026-03-04");
    expect(content).toContain("First message");
    expect(content).toContain("First reply");
    expect(content).toContain("Second message");

    // Verify chronological ordering (received before sent before received2)
    const firstIdx = content.indexOf("First message");
    const replyIdx = content.indexOf("First reply");
    const secondIdx = content.indexOf("Second message");
    expect(firstIdx).toBeLessThan(replyIdx);
    expect(replyIdx).toBeLessThan(secondIdx);
  });

  it("writes messages on different days to separate files", async () => {
    const dir = await createCaseDir("workspace");

    const day1 = makeReceivedEvent(dir, {
      content: "Day one message",
      timestamp: new Date("2026-03-04T23:59:00.000Z"),
    });
    const day2 = makeReceivedEvent(dir, {
      content: "Day two message",
      timestamp: new Date("2026-03-05T00:01:00.000Z"),
    });

    await handler(day1);
    await handler(day2);

    const content1 = await readTranscript(dir, "2026-03-04");
    const content2 = await readTranscript(dir, "2026-03-05");

    expect(content1).toContain("Day one message");
    expect(content1).not.toContain("Day two message");
    expect(content2).toContain("Day two message");
    expect(content2).not.toContain("Day one message");
  });

  it("creates transcripts directory if it does not exist", async () => {
    const dir = await createCaseDir("workspace");

    // Verify transcripts dir doesn't exist yet
    await expect(fs.access(path.join(dir, "transcripts"))).rejects.toThrow();

    await handler(makeReceivedEvent(dir));

    // Now it should exist with a file in it
    const files = await fs.readdir(path.join(dir, "transcripts"));
    expect(files.length).toBe(1);
  });

  it("includes channel info in the header", async () => {
    const dir = await createCaseDir("workspace");

    await handler(makeReceivedEvent(dir, { channelId: "discord" }));
    await handler(makeSentEvent(dir, { channelId: "whatsapp" }));

    const content = await readTranscript(dir, "2026-03-04");
    expect(content).toContain("(discord)");
    expect(content).toContain("(whatsapp)");
  });

  it("redacts secrets from message content", async () => {
    const dir = await createCaseDir("workspace");

    // Use a known secret pattern: OpenAI-style key (sk-...)
    const secretKey = "sk-abcdef1234567890abcdef1234567890";
    const event = makeReceivedEvent(dir, {
      content: `Here is my API key: ${secretKey}`,
    });

    await handler(event);

    const content = await readTranscript(dir, "2026-03-04");
    // The raw secret should NOT appear in the transcript
    expect(content).not.toContain(secretKey);
    // The message should still be written (with the secret masked)
    expect(content).toContain("API key");
    expect(content).toContain("sk-abc");
  });

  it("writes sub-agent transcripts to agent-specific workspace", async () => {
    const rootDir = await createCaseDir("root");
    const defaultWorkspace = path.join(rootDir, "default-workspace");
    const subAgentId = "research";
    const subAgentWorkspace = path.join(rootDir, `workspace-${subAgentId}`);

    const event: InternalHookEvent = {
      ...createHookEvent("message", "received", `agent:${subAgentId}:main`, {
        from: "+1234567890",
        content: "Sub-agent message",
        channelId: "telegram",
        cfg: makeCfgWithSubAgent(defaultWorkspace, subAgentId, subAgentWorkspace),
      }),
      timestamp: new Date("2026-03-04T14:00:00.000Z"),
    };

    await handler(event);

    // Should write to the agent-specific workspace, not the default
    const content = await readTranscript(subAgentWorkspace, "2026-03-04");
    expect(content).toContain("Sub-agent message");

    // Should NOT write to the default workspace
    const existsInDefault = await transcriptExists(defaultWorkspace, "2026-03-04");
    expect(existsInDefault).toBe(false);
  });
});
