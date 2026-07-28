/**
 * The shared error envelope for Nightstand API routes: `{ error: { code,
 * message } }`. No E2.x provider route had merged when this bead landed, so
 * E6.1 defines the convention — provider routes should adopt the same shape
 * (wave-4 note in the E6.1 report).
 *
 * `message` is safe for display and never carries request details or secrets.
 */
export type ApiErrorCode =
  | "unauthorized"
  | "unconfigured"
  | "cooling-down"
  | "bad-request"
  | "upstream-error";

export interface ApiErrorEnvelope {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Present only on `cooling-down`: seconds until the budget window frees up. */
    retryAfterSeconds?: number;
  };
}

export function errorEnvelope(
  code: ApiErrorCode,
  message: string,
  retryAfterSeconds?: number,
): ApiErrorEnvelope {
  return {
    error:
      retryAfterSeconds === undefined
        ? { code, message }
        : { code, message, retryAfterSeconds },
  };
}
