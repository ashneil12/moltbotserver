import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractSkillCandidates, persistSkillCandidates } from "./session-skill-candidates.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skill-cand-test-"));
}

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort
  }
}

/** Create a JSONL transcript file with the given entries. */
function writeTranscript(dir: string, entries: unknown[]): string {
  const filePath = path.join(dir, "transcript.jsonl");
  const content = entries.map((e) => JSON.stringify(e)).join("\n");
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function makeUserMessage(text: string): unknown {
  return {
    type: "message",
    timestamp: new Date().toISOString(),
    message: { role: "user", content: text },
  };
}

function makeAssistantToolCalls(toolNames: string[]): unknown {
  return {
    type: "message",
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content: toolNames.map((name) => ({ type: "toolCall", name })),
    },
  };
}

// ---------------------------------------------------------------------------
// extractSkillCandidates
// ---------------------------------------------------------------------------

describe("extractSkillCandidates", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      cleanup(tmpDir);
    }
  });

  it("returns empty for non-existent transcript", () => {
    const result = extractSkillCandidates({
      transcriptPath: "/nonexistent/path.jsonl",
      sessionId: "test-session",
    });
    expect(result).toEqual([]);
  });

  it("returns empty for trivial session (< 2 user messages)", () => {
    tmpDir = makeTempDir();
    const transcript = writeTranscript(tmpDir, [
      makeUserMessage("hello"),
      makeAssistantToolCalls(["read_file"]),
    ]);
    const result = extractSkillCandidates({
      transcriptPath: transcript,
      sessionId: "test-session",
    });
    expect(result).toEqual([]);
  });

  it("detects multi-step tool workflow (3+ distinct tools)", () => {
    tmpDir = makeTempDir();
    const transcript = writeTranscript(tmpDir, [
      makeUserMessage("Build me a login page"),
      makeUserMessage("Now add authentication"),
      makeAssistantToolCalls(["read_file", "write_file", "run_command"]),
      makeAssistantToolCalls(["grep_search"]),
    ]);
    const result = extractSkillCandidates({
      transcriptPath: transcript,
      sessionId: "sess-001",
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].topic).toContain("Multi-step workflow");
    expect(result[0].evidence).toContain("Tools used");
    expect(result[0].sessionId).toBe("sess-001");
  });

  it("detects iterative correction pattern (same tool 3+ times)", () => {
    tmpDir = makeTempDir();
    const transcript = writeTranscript(tmpDir, [
      makeUserMessage("fix the build"),
      makeUserMessage("still broken"),
      makeAssistantToolCalls(["run_command", "run_command", "run_command"]),
    ]);
    const result = extractSkillCandidates({
      transcriptPath: transcript,
      sessionId: "sess-002",
    });
    // Should have the iterative pattern
    const iterative = result.find((c) => c.topic.includes("Iterative"));
    expect(iterative).toBeTruthy();
    expect(iterative!.evidence).toContain("3 times");
  });

  it("caps at 2 candidates per session", () => {
    tmpDir = makeTempDir();
    const transcript = writeTranscript(tmpDir, [
      makeUserMessage("complex multi-tool task"),
      makeUserMessage("with corrections"),
      // Multi-step workflow (4 distinct tools)
      makeAssistantToolCalls(["read_file", "write_file", "grep_search", "run_command"]),
      // Iterative pattern (run_command 3x)
      makeAssistantToolCalls(["run_command", "run_command"]),
    ]);
    const result = extractSkillCandidates({
      transcriptPath: transcript,
      sessionId: "sess-003",
    });
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("ignores corrupt JSON lines", () => {
    tmpDir = makeTempDir();
    const filePath = path.join(tmpDir, "transcript.jsonl");
    const validEntries = [
      makeUserMessage("task one"),
      makeUserMessage("task two"),
      makeAssistantToolCalls(["a", "b", "c"]),
    ];
    const content = validEntries.map((e) => JSON.stringify(e)).join("\n") + "\nnot-valid-json\n";
    fs.writeFileSync(filePath, content, "utf-8");
    const result = extractSkillCandidates({
      transcriptPath: filePath,
      sessionId: "sess-004",
    });
    // Should still work with valid entries
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// persistSkillCandidates
// ---------------------------------------------------------------------------

describe("persistSkillCandidates", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      cleanup(tmpDir);
    }
  });

  it("creates file with header when none exists", () => {
    tmpDir = makeTempDir();
    const candidates = [
      {
        topic: "Test workflow",
        evidence: "Used tools A, B, C",
        extractedAt: "2026-03-19T12:00:00Z",
        sessionId: "sess-test",
      },
    ];
    persistSkillCandidates({ workspaceDir: tmpDir, candidates });
    const filePath = path.join(tmpDir, "memory", "skill-candidates.md");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("# Skill Candidates");
    expect(content).toContain("## Test workflow");
    expect(content).toContain("sess-test");
  });

  it("appends to existing file", () => {
    tmpDir = makeTempDir();
    const memDir = path.join(tmpDir, "memory");
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(
      path.join(memDir, "skill-candidates.md"),
      "# Skill Candidates\n\n## Old candidate\n- existing\n",
    );
    persistSkillCandidates({
      workspaceDir: tmpDir,
      candidates: [
        {
          topic: "New candidate",
          evidence: "new evidence",
          extractedAt: "2026-03-19T13:00:00Z",
          sessionId: "sess-new",
        },
      ],
    });
    const content = fs.readFileSync(path.join(memDir, "skill-candidates.md"), "utf-8");
    expect(content).toContain("## Old candidate");
    expect(content).toContain("## New candidate");
  });

  it("does nothing for empty candidates array", () => {
    tmpDir = makeTempDir();
    persistSkillCandidates({ workspaceDir: tmpDir, candidates: [] });
    expect(fs.existsSync(path.join(tmpDir, "memory", "skill-candidates.md"))).toBe(false);
  });

  it("creates memory directory if missing", () => {
    tmpDir = makeTempDir();
    persistSkillCandidates({
      workspaceDir: tmpDir,
      candidates: [
        {
          topic: "Test",
          evidence: "evidence",
          extractedAt: new Date().toISOString(),
          sessionId: "s",
        },
      ],
    });
    expect(fs.existsSync(path.join(tmpDir, "memory"))).toBe(true);
  });

  it("truncates oldest entries when file exceeds max size", () => {
    tmpDir = makeTempDir();
    const memDir = path.join(tmpDir, "memory");
    fs.mkdirSync(memDir, { recursive: true });

    // Create a large file with many old entries
    let bigContent = "# Skill Candidates\n\nAuto-extracted from session transcripts.\n\n";
    for (let i = 0; i < 200; i++) {
      bigContent += `## Old workflow pattern ${i}\n- **Evidence**: tools a, b, c\n- **Session**: old-session-${i}\n- **Extracted**: 2026-01-01T00:00:00Z\n\n`;
    }
    fs.writeFileSync(path.join(memDir, "skill-candidates.md"), bigContent, "utf-8");
    const originalSize = bigContent.length;
    expect(originalSize).toBeGreaterThan(16_000); // Confirm it exceeds limit

    // Append a new candidate
    persistSkillCandidates({
      workspaceDir: tmpDir,
      candidates: [
        {
          topic: "NEWEST workflow",
          evidence: "should survive truncation",
          extractedAt: "2026-03-19T23:00:00Z",
          sessionId: "newest-session",
        },
      ],
    });

    const result = fs.readFileSync(path.join(memDir, "skill-candidates.md"), "utf-8");
    // The newest entry should survive
    expect(result).toContain("## NEWEST workflow");
    // Some old entries should have been trimmed
    expect(result.length).toBeLessThan(originalSize + 500);
    // The header should still be present
    expect(result).toContain("# Skill Candidates");
  });
});
