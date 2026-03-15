import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractFactsFromText,
  formatFactsAsMarkdown,
  persistExtractedFacts,
  type ExtractedFact,
} from "./extract-facts.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "extract-facts-test-"));
  await fs.promises.mkdir(path.join(tmpDir, "memory"), { recursive: true });
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// extractFactsFromText — URL patterns
// ---------------------------------------------------------------------------

describe("extractFactsFromText — URLs", () => {
  it("extracts simple URLs", () => {
    const facts = extractFactsFromText("Visit https://example.com for docs");
    expect(facts).toContainEqual(
      expect.objectContaining({ type: "url", value: "https://example.com" }),
    );
  });

  it("extracts URLs with paths", () => {
    const facts = extractFactsFromText("See https://api.example.com/v2/users/123");
    expect(facts).toContainEqual(
      expect.objectContaining({ type: "url", value: "https://api.example.com/v2/users/123" }),
    );
  });

  it("strips trailing punctuation from URLs", () => {
    const facts = extractFactsFromText("Check https://example.com/page.");
    const url = facts.find((f) => f.type === "url");
    expect(url?.value).toBe("https://example.com/page");
  });

  it("handles multiple URLs in one text", () => {
    const facts = extractFactsFromText(
      "Frontend: https://app.example.com Backend: http://api.example.com:3000/health",
    );
    const urls = facts.filter((f) => f.type === "url");
    expect(urls.length).toBe(2);
  });

  it("deduplicates identical URLs", () => {
    const facts = extractFactsFromText(
      "Visit https://example.com and also https://example.com again",
    );
    const urls = facts.filter((f) => f.type === "url");
    expect(urls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// extractFactsFromText — Git repo patterns
// ---------------------------------------------------------------------------

describe("extractFactsFromText — repos", () => {
  it("extracts GitHub repos", () => {
    const facts = extractFactsFromText("Clone github.com/openclaw/openclaw");
    expect(facts).toContainEqual(
      expect.objectContaining({ type: "repo", value: "github.com/openclaw/openclaw" }),
    );
  });

  it("extracts GitLab repos", () => {
    const facts = extractFactsFromText("See gitlab.com/my-org/my-project");
    expect(facts).toContainEqual(
      expect.objectContaining({ type: "repo", value: "gitlab.com/my-org/my-project" }),
    );
  });

  it("normalizes .git suffix", () => {
    const facts = extractFactsFromText("git clone github.com/org/repo.git");
    const repo = facts.find((f) => f.type === "repo");
    expect(repo?.value).toBe("github.com/org/repo");
  });
});

// ---------------------------------------------------------------------------
// extractFactsFromText — port patterns
// ---------------------------------------------------------------------------

describe("extractFactsFromText — ports", () => {
  it("extracts port from 'port 3000'", () => {
    const facts = extractFactsFromText("Running on port 3000");
    expect(facts).toContainEqual(expect.objectContaining({ type: "port", value: "3000" }));
  });

  it("extracts port from ':8080'", () => {
    const facts = extractFactsFromText("Listen on :8080");
    expect(facts).toContainEqual(expect.objectContaining({ type: "port", value: "8080" }));
  });

  it("captures PORT=5432 as env_var key only (not port pattern)", () => {
    const facts = extractFactsFromText("PORT=5432");
    // PORT=5432 matches env_var pattern — captures key only (security: no value leakage)
    const envFact = facts.find((f) => f.type === "env_var");
    expect(envFact?.value).toBe("PORT");
    // Port pattern works with colon syntax
    const colonFacts = extractFactsFromText("service on :5432");
    const portFact = colonFacts.find((f) => f.type === "port");
    expect(portFact?.value).toBe("5432");
  });

  it("rejects very short numbers", () => {
    const facts = extractFactsFromText("port 1"); // 1-digit, below 2-digit minimum
    const ports = facts.filter((f) => f.type === "port");
    expect(ports.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// extractFactsFromText — branch patterns
// ---------------------------------------------------------------------------

describe("extractFactsFromText — branches", () => {
  it("extracts 'checkout -b feature/login'", () => {
    const facts = extractFactsFromText("git checkout -b feature/login");
    expect(facts).toContainEqual(
      expect.objectContaining({ type: "branch", value: "feature/login" }),
    );
  });

  it("extracts 'merge main'", () => {
    const facts = extractFactsFromText("git merge main");
    expect(facts).toContainEqual(expect.objectContaining({ type: "branch", value: "main" }));
  });

  it("extracts 'branch develop'", () => {
    const facts = extractFactsFromText("git branch develop");
    expect(facts).toContainEqual(expect.objectContaining({ type: "branch", value: "develop" }));
  });
});

// ---------------------------------------------------------------------------
// extractFactsFromText — env var patterns
// ---------------------------------------------------------------------------

describe("extractFactsFromText — env vars", () => {
  it("extracts DATABASE_URL key (value redacted)", () => {
    const facts = extractFactsFromText("DATABASE_URL=postgres://localhost:5432/mydb");
    const envFact = facts.find((f) => f.type === "env_var");
    // Security: only captures the key name, not the full connection string
    expect(envFact?.value).toBe("DATABASE_URL");
  });

  it("extracts key from 'export API_KEY=abc123' (value redacted)", () => {
    const facts = extractFactsFromText("export API_KEY=abc123");
    const envFact = facts.find((f) => f.type === "env_var");
    // Security: only captures the key name
    expect(envFact?.value).toBe("API_KEY");
  });

  it("ignores short keys", () => {
    // Key must be 3+ chars (A-Z start)
    const facts = extractFactsFromText("AB=value");
    const envFacts = facts.filter((f) => f.type === "env_var");
    expect(envFacts.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// extractFactsFromText — mixed content
// ---------------------------------------------------------------------------

describe("extractFactsFromText — mixed", () => {
  it("extracts multiple fact types from one text", () => {
    const text = `
      Deployed to https://myapp.railway.app on port 3000.
      Clone github.com/myorg/myapp and checkout -b feature/auth.
      Set DATABASE_URL=postgres://db.supabase.co:5432/app
    `;
    const facts = extractFactsFromText(text);
    expect(facts.some((f) => f.type === "url")).toBe(true);
    expect(facts.some((f) => f.type === "port")).toBe(true);
    expect(facts.some((f) => f.type === "repo")).toBe(true);
    expect(facts.some((f) => f.type === "branch")).toBe(true);
    expect(facts.some((f) => f.type === "env_var")).toBe(true);
  });

  it("returns empty array for noise-only content", () => {
    const facts = extractFactsFromText("ok done yes listo ready");
    expect(facts.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// formatFactsAsMarkdown
// ---------------------------------------------------------------------------

describe("formatFactsAsMarkdown", () => {
  it("returns empty string for no facts", () => {
    expect(formatFactsAsMarkdown([])).toBe("");
  });

  it("groups facts by type", () => {
    const facts: ExtractedFact[] = [
      { type: "url", value: "https://example.com" },
      { type: "port", value: "3000" },
      { type: "url", value: "https://other.com" },
    ];
    const md = formatFactsAsMarkdown(facts);
    expect(md).toContain("### URLs");
    expect(md).toContain("### Ports");
    expect(md).toContain("`https://example.com`");
    expect(md).toContain("`https://other.com`");
    expect(md).toContain("`3000`");
  });
});

// ---------------------------------------------------------------------------
// persistExtractedFacts
// ---------------------------------------------------------------------------

describe("persistExtractedFacts", () => {
  it("creates new file when none exists", () => {
    const facts: ExtractedFact[] = [
      { type: "url", value: "https://example.com" },
      { type: "port", value: "3000" },
    ];
    const result = persistExtractedFacts(tmpDir, facts);
    expect(result.written).toBe(2);
    expect(result.skipped).toBe(0);

    const content = fs.readFileSync(path.join(tmpDir, "memory", "extracted-facts.md"), "utf-8");
    expect(content).toContain("# Extracted Facts");
    expect(content).toContain("`https://example.com`");
    expect(content).toContain("`3000`");
  });

  it("deduplicates against existing file", () => {
    // Write initial facts
    const initial: ExtractedFact[] = [{ type: "url", value: "https://example.com" }];
    persistExtractedFacts(tmpDir, initial);

    // Write again with same + new
    const combined: ExtractedFact[] = [
      { type: "url", value: "https://example.com" }, // existing
      { type: "url", value: "https://new.com" }, // new
    ];
    const result = persistExtractedFacts(tmpDir, combined);
    expect(result.written).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("returns 0 written when all facts already exist", () => {
    const facts: ExtractedFact[] = [{ type: "url", value: "https://example.com" }];
    persistExtractedFacts(tmpDir, facts);
    const result = persistExtractedFacts(tmpDir, facts);
    expect(result.written).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("dry-run does not write file", () => {
    const facts: ExtractedFact[] = [{ type: "url", value: "https://example.com" }];
    const result = persistExtractedFacts(tmpDir, facts, { dryRun: true });
    expect(result.written).toBe(1); // reports what would be written
    expect(fs.existsSync(path.join(tmpDir, "memory", "extracted-facts.md"))).toBe(false);
  });
});
