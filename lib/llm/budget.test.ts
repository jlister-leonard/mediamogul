// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RequestBudget } from "./budget";

describe("RequestBudget", () => {
  it("admits requests up to the limit, then refuses with a retry-after", () => {
    const budget = new RequestBudget(3, 60_000);
    const t0 = 1_000_000;
    expect(budget.take(t0)).toEqual({ allowed: true });
    expect(budget.take(t0 + 1)).toEqual({ allowed: true });
    expect(budget.take(t0 + 2)).toEqual({ allowed: true });

    const refused = budget.take(t0 + 3);
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) {
      // The oldest admission (t0) frees its slot at t0 + 60_000.
      expect(refused.retryAfterSeconds).toBe(Math.ceil((60_000 - 3) / 1000));
    }
  });

  it("frees slots as admissions age out of the rolling window", () => {
    const budget = new RequestBudget(2, 60_000);
    const t0 = 0;
    expect(budget.take(t0).allowed).toBe(true);
    expect(budget.take(t0 + 30_000).allowed).toBe(true);
    expect(budget.take(t0 + 40_000).allowed).toBe(false);
    // t0 admission has aged out; one slot is free again.
    expect(budget.take(t0 + 60_001).allowed).toBe(true);
    expect(budget.take(t0 + 60_002).allowed).toBe(false);
  });

  it("never reports a retry-after below one second", () => {
    const budget = new RequestBudget(1, 1_000);
    expect(budget.take(0).allowed).toBe(true);
    const refused = budget.take(999);
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) {
      expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    }
  });

  it("reset clears the window", () => {
    const budget = new RequestBudget(1, 60_000);
    expect(budget.take(0).allowed).toBe(true);
    expect(budget.take(1).allowed).toBe(false);
    budget.reset();
    expect(budget.take(2).allowed).toBe(true);
  });
});
