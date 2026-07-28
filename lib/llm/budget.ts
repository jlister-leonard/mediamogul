import { REQUEST_BUDGET } from "./config";

export type BudgetVerdict =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Rolling-window request budget. In-memory and PER-INSTANCE (see
 * `REQUEST_BUDGET` in config.ts for why that is acceptable here): a sliding
 * window of admission timestamps, pruned on every check.
 */
export class RequestBudget {
  private admitted: number[] = [];

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  /** Admit one request, or report how long until the window frees a slot. */
  take(now: number = Date.now()): BudgetVerdict {
    const windowStart = now - this.windowMs;
    this.admitted = this.admitted.filter((at) => at > windowStart);
    if (this.admitted.length >= this.maxRequests) {
      const oldest = this.admitted[0];
      const retryAfterMs = oldest + this.windowMs - now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      };
    }
    this.admitted.push(now);
    return { allowed: true };
  }

  /** Test seam: clear the window. */
  reset(): void {
    this.admitted = [];
  }
}

/** The one budget instance the recommend route draws from. */
export const recommendBudget = new RequestBudget(
  REQUEST_BUDGET.maxRequestsPerWindow,
  REQUEST_BUDGET.windowMs,
);
