import { describe, expect, it } from "vitest";

import {
  computeBvcPreflight,
  didBvcCritiqueImprove,
  evaluateBvcCritique,
} from "./bvcPolicy.js";

describe("BVC v2 policy", () => {
  it("routes a one-file one-error task to fallback", () => {
    const result = computeBvcPreflight("Fix TypeError in src/user.ts");
    expect(result.signals.nFiles).toBe(1);
    expect(result.triggerCouncil).toBe(false);
  });

  it("uses the deterministic hard-signal override for ambiguous multi-root tasks", () => {
    const result = computeBvcPreflight(
      "Behavior may originate in src/a.ts, src/b.ts, src/c.ts, or src/d.ts",
    );
    expect(result.hardSignals).toBeGreaterThanOrEqual(3);
    expect(result.triggerCouncil).toBe(true);
  });

  it("never treats missing structured output as a reason to critique", () => {
    const decision = evaluateBvcCritique({
      dVote: undefined,
      dCov: 0.75,
      comparableAxes: 0,
      uncertainty: 1,
      tauVote: 0.3,
      tauCrit: 0.7,
      tauCov: 0.5,
      round: 0,
      maxRounds: 2,
      activeRoles: 4,
      usedBudget: 4,
      totalBudget: 13,
      reserve: 1,
      lastImproved: true,
      lambdaCost: 0.1,
      epsilonNum: 1e-6,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("two valid votes");
  });

  it("allows substantive first-round critique when gain exceeds cost", () => {
    const decision = evaluateBvcCritique({
      dVote: 0.6,
      dCov: 0.1,
      comparableAxes: 4,
      uncertainty: 1,
      tauVote: 0.3,
      tauCrit: 0.7,
      tauCov: 0.5,
      round: 0,
      maxRounds: 2,
      activeRoles: 4,
      usedBudget: 4,
      totalBudget: 13,
      reserve: 1,
      lastImproved: true,
      lambdaCost: 0.1,
      epsilonNum: 1e-6,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.gain).toBeGreaterThan(decision.cost);
  });

  it("blocks another round when the previous critique did not improve", () => {
    const decision = evaluateBvcCritique({
      dVote: 0.6,
      dCov: 0.1,
      comparableAxes: 4,
      uncertainty: 1,
      tauVote: 0.3,
      tauCrit: 0.7,
      tauCov: 0.5,
      round: 1,
      maxRounds: 2,
      activeRoles: 4,
      usedBudget: 8,
      totalBudget: 17,
      reserve: 1,
      lastImproved: false,
      lambdaCost: 0.1,
      epsilonNum: 1e-6,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("did not improve");
  });

  it("requires both vote improvement and stable coverage", () => {
    expect(didBvcCritiqueImprove(0.6, 0.1, 0.5, 0.12, 0.05, 0.03)).toBe(true);
    expect(didBvcCritiqueImprove(0.6, 0.1, 0.57, 0.12, 0.05, 0.03)).toBe(false);
    expect(didBvcCritiqueImprove(0.6, 0.1, 0.5, 0.2, 0.05, 0.03)).toBe(false);
  });
});
