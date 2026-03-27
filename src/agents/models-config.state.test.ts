import { describe, expect, it } from "vitest";
import {
  MODELS_JSON_READY_CACHE,
  MODELS_JSON_WRITE_LOCKS,
  resetModelsJsonReadyCacheForTest,
  resetModelsJsonStateForTest,
} from "./models-config.state.js";

describe("models-config shared state", () => {
  it("clears only the ready cache when requested", () => {
    MODELS_JSON_READY_CACHE.set(
      "models.json",
      Promise.resolve({ fingerprint: "fp", result: { agentDir: "a", wrote: false } }),
    );
    MODELS_JSON_WRITE_LOCKS.set("models.json", Promise.resolve());

    resetModelsJsonReadyCacheForTest();

    expect(MODELS_JSON_READY_CACHE.size).toBe(0);
    expect(MODELS_JSON_WRITE_LOCKS.size).toBe(1);

    MODELS_JSON_WRITE_LOCKS.clear();
  });

  it("clears both caches and write locks during full test reset", () => {
    MODELS_JSON_READY_CACHE.set(
      "models.json",
      Promise.resolve({ fingerprint: "fp", result: { agentDir: "a", wrote: false } }),
    );
    MODELS_JSON_WRITE_LOCKS.set("models.json", Promise.resolve());

    resetModelsJsonStateForTest();

    expect(MODELS_JSON_READY_CACHE.size).toBe(0);
    expect(MODELS_JSON_WRITE_LOCKS.size).toBe(0);
  });
});
