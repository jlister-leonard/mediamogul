import { createHash, timingSafeEqual } from "node:crypto";
import { type ApiErrorEnvelope, errorEnvelope } from "./envelope";

/** Header the phone sets once; guards the LLM route if the URL leaks (PLAN §8). */
export const PASSPHRASE_HEADER = "x-nightstand-passphrase";

export type GuardVerdict =
  | { ok: true }
  | { ok: false; status: 401 | 503; envelope: ApiErrorEnvelope };

/**
 * Constant-time passphrase check. Both sides are hashed to a fixed length
 * before `timingSafeEqual`, so neither content nor *length* of the configured
 * passphrase leaks through timing. Failure responses carry no detail about
 * which part was wrong.
 */
export function checkPassphrase(
  provided: string | null,
  configured: string | undefined,
): GuardVerdict {
  if (configured === undefined || configured === "") {
    return {
      ok: false,
      status: 503,
      envelope: errorEnvelope("unconfigured", "This deployment is not configured."),
    };
  }
  if (provided === null || !constantTimeStringEqual(provided, configured)) {
    return {
      ok: false,
      status: 401,
      envelope: errorEnvelope("unauthorized", "Missing or invalid passphrase."),
    };
  }
  return { ok: true };
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}
