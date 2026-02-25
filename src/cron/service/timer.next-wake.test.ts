import { describe, it, expect } from "vitest";
import { parseNextWakeDuration } from "./timer.js";

describe("parseNextWakeDuration", () => {
  it("parses hours", () => {
    expect(parseNextWakeDuration("some text NEXT_WAKE: 4h")).toBe(4 * 60 * 60_000);
  });

  it("parses minutes", () => {
    // 30m is below the 1h minimum, so it gets clamped to 1h
    expect(parseNextWakeDuration("NEXT_WAKE: 30m")).toBe(60 * 60_000);
  });

  it("parses hours and minutes combined", () => {
    expect(parseNextWakeDuration("NEXT_WAKE: 4h30m")).toBe(4.5 * 60 * 60_000);
  });

  it("parses decimal hours", () => {
    expect(parseNextWakeDuration("NEXT_WAKE: 1.5h")).toBe(1.5 * 60 * 60_000);
  });

  it("clamps to minimum 1h", () => {
    expect(parseNextWakeDuration("NEXT_WAKE: 10m")).toBe(60 * 60_000);
  });

  it("clamps to maximum 12h", () => {
    expect(parseNextWakeDuration("NEXT_WAKE: 24h")).toBe(12 * 60 * 60_000);
  });

  it("returns undefined when no directive found", () => {
    expect(parseNextWakeDuration("nothing here")).toBeUndefined();
  });

  it("returns undefined for empty/undefined input", () => {
    expect(parseNextWakeDuration(undefined)).toBeUndefined();
    expect(parseNextWakeDuration("")).toBeUndefined();
  });

  it("handles multiline text", () => {
    const text = "I reflected on recent events.\nUpdated diary.\nNEXT_WAKE: 6h\n";
    expect(parseNextWakeDuration(text)).toBe(6 * 60 * 60_000);
  });

  it("ignores case in unit", () => {
    expect(parseNextWakeDuration("NEXT_WAKE: 3H")).toBe(3 * 60 * 60_000);
  });
});
