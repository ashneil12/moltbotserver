import { describe, expect, it } from "vitest";
import {
  ALIGNMENT_DEFAULTS,
  type AlignmentConfig,
  advanceTurn,
  createAlignmentState,
  recordCheck,
  scoreSeverity,
  shouldCheck,
} from "./alignment-state.js";

describe("createAlignmentState", () => {
  it("returns a fresh state with sane defaults", () => {
    const state = createAlignmentState();
    expect(state.turnNumber).toBe(0);
    expect(state.lastCheckTurn).toBe(-Infinity);
    expect(state.lastScore).toBeNull();
    expect(state.consecutiveMildDrifts).toBe(0);
    expect(state.totalChecks).toBe(0);
    expect(state.totalCorrections).toBe(0);
  });
});

describe("advanceTurn", () => {
  it("increments turnNumber by 1", () => {
    const state = advanceTurn(createAlignmentState());
    expect(state.turnNumber).toBe(1);
    expect(advanceTurn(state).turnNumber).toBe(2);
  });

  it("does not mutate the original state", () => {
    const original = createAlignmentState();
    const next = advanceTurn(original);
    expect(original.turnNumber).toBe(0);
    expect(next.turnNumber).toBe(1);
  });
});

describe("shouldCheck", () => {
  it("allows the first check (lastCheckTurn is -Infinity)", () => {
    const state = advanceTurn(createAlignmentState());
    expect(shouldCheck(state)).toBe(true);
  });

  it("blocks checks within the cooldown window", () => {
    let state = createAlignmentState();
    state = advanceTurn(state); // turn 1
    state = recordCheck(state, 0.9, false); // checked at turn 1
    state = advanceTurn(state); // turn 2
    expect(shouldCheck(state)).toBe(false); // only 1 turn since last check, cooldown is 3
  });

  it("allows checks after cooldown expires", () => {
    let state = createAlignmentState();
    state = advanceTurn(state); // 1
    state = recordCheck(state, 0.9, false); // checked at 1
    state = advanceTurn(state); // 2
    state = advanceTurn(state); // 3
    state = advanceTurn(state); // 4
    expect(shouldCheck(state)).toBe(true); // 3 turns since last check
  });

  it("respects custom cooldown config", () => {
    const config: AlignmentConfig = { cooldownTurns: 1 };
    let state = createAlignmentState();
    state = advanceTurn(state); // 1
    state = recordCheck(state, 0.9, false); // checked at 1
    state = advanceTurn(state); // 2
    expect(shouldCheck(state, config)).toBe(true); // 1 turn since last check, cooldown is 1
  });

  it("triggers early check when mild drifts reach escalation threshold", () => {
    let state = createAlignmentState();
    state = advanceTurn(state); // 1
    // Simulate 3 consecutive mild drifts (score between severe and correction threshold)
    state = recordCheck(state, 0.6, false); // mild
    state = advanceTurn(state); // 2
    state = recordCheck(state, 0.65, false); // mild
    state = advanceTurn(state); // 3
    state = recordCheck(state, 0.55, false); // mild → now at 3 consecutive
    // Next turn — only 0 turns since last check but escalation triggers
    state = advanceTurn(state); // 4
    expect(shouldCheck(state)).toBe(true);
  });
});

describe("recordCheck", () => {
  it("records score and advances lastCheckTurn", () => {
    let state = createAlignmentState();
    state = advanceTurn(state);
    state = recordCheck(state, 0.85, false);
    expect(state.lastScore).toBe(0.85);
    expect(state.lastCheckTurn).toBe(1);
    expect(state.totalChecks).toBe(1);
    expect(state.totalCorrections).toBe(0);
  });

  it("increments totalCorrections when correction was injected", () => {
    let state = createAlignmentState();
    state = advanceTurn(state);
    state = recordCheck(state, 0.4, true);
    expect(state.totalCorrections).toBe(1);
  });

  it("resets consecutiveMildDrifts when score is aligned", () => {
    let state = createAlignmentState();
    state = advanceTurn(state);
    state = recordCheck(state, 0.6, false); // mild
    expect(state.consecutiveMildDrifts).toBe(1);
    state = advanceTurn(state);
    state = recordCheck(state, 0.9, false); // aligned
    expect(state.consecutiveMildDrifts).toBe(0);
  });

  it("resets consecutiveMildDrifts on severe drift (below severe threshold)", () => {
    let state = createAlignmentState();
    state = advanceTurn(state);
    state = recordCheck(state, 0.6, false); // mild
    state = advanceTurn(state);
    state = recordCheck(state, 0.3, true); // severe → resets mild counter
    expect(state.consecutiveMildDrifts).toBe(0);
  });

  it("increments consecutiveMildDrifts for scores in the mild range", () => {
    let state = createAlignmentState();
    state = advanceTurn(state);
    state = recordCheck(state, 0.65, false);
    expect(state.consecutiveMildDrifts).toBe(1);
    state = advanceTurn(state);
    state = recordCheck(state, 0.55, false);
    expect(state.consecutiveMildDrifts).toBe(2);
  });

  it("does not mutate the original state", () => {
    const original = advanceTurn(createAlignmentState());
    const next = recordCheck(original, 0.5, true);
    expect(original.totalChecks).toBe(0);
    expect(next.totalChecks).toBe(1);
  });
});

describe("scoreSeverity", () => {
  it('returns "aligned" for scores at or above the correction threshold', () => {
    expect(scoreSeverity(1.0)).toBe("aligned");
    expect(scoreSeverity(0.7)).toBe("aligned");
    expect(scoreSeverity(0.85)).toBe("aligned");
  });

  it('returns "mild" for scores between severe and correction thresholds', () => {
    expect(scoreSeverity(0.69)).toBe("mild");
    expect(scoreSeverity(0.5)).toBe("mild");
    expect(scoreSeverity(0.6)).toBe("mild");
  });

  it('returns "severe" for scores below the severe threshold', () => {
    expect(scoreSeverity(0.49)).toBe("severe");
    expect(scoreSeverity(0.0)).toBe("severe");
    expect(scoreSeverity(0.3)).toBe("severe");
  });

  it("respects custom thresholds", () => {
    const config: AlignmentConfig = { correctionThreshold: 0.9, severeThreshold: 0.6 };
    expect(scoreSeverity(0.95, config)).toBe("aligned");
    expect(scoreSeverity(0.75, config)).toBe("mild");
    expect(scoreSeverity(0.5, config)).toBe("severe");
  });
});

describe("ALIGNMENT_DEFAULTS", () => {
  it("exposes expected default values", () => {
    expect(ALIGNMENT_DEFAULTS.cooldownTurns).toBe(3);
    expect(ALIGNMENT_DEFAULTS.correctionThreshold).toBe(0.7);
    expect(ALIGNMENT_DEFAULTS.severeThreshold).toBe(0.5);
    expect(ALIGNMENT_DEFAULTS.mildDriftEscalation).toBe(3);
    expect(ALIGNMENT_DEFAULTS.timeoutMs).toBe(2000);
  });
});
