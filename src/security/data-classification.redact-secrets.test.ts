import { describe, expect, it } from "vitest";
import { containsSecrets, redactSecrets } from "./data-classification.js";

// ---------------------------------------------------------------------------
// redactSecrets
// ---------------------------------------------------------------------------

describe("redactSecrets", () => {
  describe("API key patterns", () => {
    it("redacts OpenAI-style sk- keys", () => {
      const input = "Use this key: sk-abc1234567890123456789012345";
      const { text, redactedPatterns } = redactSecrets(input);
      expect(text).not.toContain("sk-abc");
      expect(text).toContain("[SECRET-REDACTED]");
      expect(redactedPatterns).toContain("openai_key");
    });

    it("redacts GitHub PATs (ghp_)", () => {
      const input = "Token: ghp_1234567890abcdefghij1234";
      const { text, redactedPatterns } = redactSecrets(input);
      expect(text).not.toContain("ghp_");
      expect(redactedPatterns).toContain("github_pat");
    });

    it("redacts GitHub fine-grained PATs (github_pat_)", () => {
      const input = "Token: github_pat_11AAAAAA0abcdefghij1234567890abcdefghij";
      const { text, redactedPatterns } = redactSecrets(input);
      expect(text).not.toContain("github_pat_");
      expect(redactedPatterns).toContain("github_pat");
    });

    it("redacts Slack tokens (xoxb-)", () => {
      const input = "Bot token: xoxb-123456789-abcdefghij";
      const { text, redactedPatterns } = redactSecrets(input);
      expect(text).not.toContain("xoxb-");
      expect(redactedPatterns).toContain("slack_token");
    });

    it("redacts Stripe live keys", () => {
      const input = "sk_live_1234567890abcdefghij";
      const { text, redactedPatterns } = redactSecrets(input);
      expect(text).not.toContain("sk_live_");
      expect(redactedPatterns).toContain("stripe_key");
    });

    it("redacts Google API keys (AIza...)", () => {
      const input = "Key: AIzaSyA1234567890abcdefghijkl";
      const { text, redactedPatterns } = redactSecrets(input);
      expect(text).not.toContain("AIzaSy");
      expect(redactedPatterns).toContain("google_api_key");
    });

    it("redacts AWS access key IDs", () => {
      const input = "AWS key: AKIAIOSFODNN7EXAMPLE";
      const { text, redactedPatterns } = redactSecrets(input);
      expect(text).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(redactedPatterns).toContain("aws_access_key");
    });

    it("redacts Telegram bot tokens", () => {
      const input = "Bot: 12345678:ABCDEFghijklmnopqrstuvwxyz12345";
      const { text, redactedPatterns } = redactSecrets(input);
      expect(text).not.toContain("12345678:");
      expect(redactedPatterns).toContain("telegram_bot_token");
    });

    it("redacts prefixed API keys (gsk_, pplx-, npm_)", () => {
      const input = "Groq: gsk_abc1234567890123456789";
      const { text, redactedPatterns } = redactSecrets(input);
      expect(text).not.toContain("gsk_");
      expect(redactedPatterns).toContain("prefixed_api_key");
    });
  });

  describe("connection strings", () => {
    it("redacts postgres connection strings", () => {
      const input = "Connect to postgres://user:pass@host:5432/db";
      const { text, redactedPatterns } = redactSecrets(input);
      expect(text).toContain("[CONNECTION-REDACTED]");
      expect(text).not.toContain("user:pass");
      expect(redactedPatterns).toContain("connection_string");
    });

    it("redacts redis connection strings", () => {
      const input = "Redis: redis://default:secret@redis.example.com:6379";
      const { text, redactedPatterns } = redactSecrets(input);
      expect(text).toContain("[CONNECTION-REDACTED]");
      expect(redactedPatterns).toContain("connection_string");
    });

    it("redacts mongodb+srv connection strings", () => {
      const input = "mongodb+srv://user:pass@cluster0.abc.mongodb.net/db";
      const { text, redactedPatterns } = redactSecrets(input);
      expect(text).toContain("[CONNECTION-REDACTED]");
      expect(redactedPatterns).toContain("connection_string");
    });
  });

  describe("tokens and credentials", () => {
    it("redacts Bearer tokens", () => {
      const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def";
      const { text, redactedPatterns } = redactSecrets(input);
      expect(text).toContain("[TOKEN-REDACTED]");
      expect(redactedPatterns).toContain("bearer_token");
    });

    it("redacts private key markers", () => {
      const input = "Here's the key:\n-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANB...";
      const { text, redactedPatterns } = redactSecrets(input);
      expect(text).toContain("[PRIVATE-KEY-REDACTED]");
      expect(redactedPatterns).toContain("private_key");
    });

    it("redacts JWTs", () => {
      const input =
        "Token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
      const { text, redactedPatterns } = redactSecrets(input);
      expect(text).toContain("[JWT-REDACTED]");
      expect(redactedPatterns).toContain("jwt");
    });
  });

  describe("safe text", () => {
    it("leaves normal text unchanged", () => {
      const input = "Hello, how can I help you today?";
      const { text, redactedPatterns } = redactSecrets(input);
      expect(text).toBe(input);
      expect(redactedPatterns).toHaveLength(0);
    });

    it("leaves code snippets without secrets unchanged", () => {
      const input = 'const x = await fetch("https://api.example.com/data");';
      const { text, redactedPatterns } = redactSecrets(input);
      expect(text).toBe(input);
      expect(redactedPatterns).toHaveLength(0);
    });

    it("leaves short sk- prefixes unchanged (not long enough)", () => {
      const input = "The key sk-short is invalid";
      const { text, redactedPatterns } = redactSecrets(input);
      expect(text).toBe(input);
      expect(redactedPatterns).toHaveLength(0);
    });
  });

  it("redacts multiple secrets in one text", () => {
    const input = "API: sk-abc1234567890123456789012345, DB: postgres://u:p@h:5432/db_name_here";
    const { text, redactedPatterns } = redactSecrets(input);
    expect(text).toContain("[SECRET-REDACTED]");
    expect(text).toContain("[CONNECTION-REDACTED]");
    expect(redactedPatterns).toContain("openai_key");
    expect(redactedPatterns).toContain("connection_string");
  });
});

// ---------------------------------------------------------------------------
// containsSecrets
// ---------------------------------------------------------------------------

describe("containsSecrets", () => {
  it("returns true for text containing a secret", () => {
    expect(containsSecrets("sk-abc1234567890123456789012345")).toBe(true);
  });

  it("returns false for safe text", () => {
    expect(containsSecrets("Hello, world!")).toBe(false);
  });

  it("detects connection strings", () => {
    expect(containsSecrets("postgres://user:pass@host:5432/db")).toBe(true);
  });
});
