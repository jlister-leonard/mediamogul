import type { ApiErrorEnvelope } from "./envelope";
import type { LlmStopReason } from "./transport";
import type { ToolOutcome } from "./tools";

/**
 * The SSE vocabulary of `POST /api/recommend`. One `event:` line naming the
 * type, one `data:` line carrying JSON — parseable by EventSource semantics
 * and by the test parser below.
 */
export type RecommendSseEvent =
  | { event: "text"; data: { delta: string } }
  | {
      event: "tool";
      data:
        | { name: string; phase: "start" }
        | { name: string; phase: "result"; status: ToolOutcome["status"] };
    }
  | { event: "done"; data: { stopReason: LlmStopReason | "tool-rounds-exhausted" } }
  /** Graceful degraded shape: the UI renders `data.error.message` and stops. */
  | { event: "error"; data: ApiErrorEnvelope };

export function encodeSseEvent(event: RecommendSseEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/**
 * Strict parser for the framing above — used by tests to prove the stream is
 * well-formed SSE, not just that expected substrings appear somewhere.
 */
export function parseSseStream(raw: string): RecommendSseEvent[] {
  const events: RecommendSseEvent[] = [];
  const frames = raw.split("\n\n").filter((frame) => frame !== "");
  for (const frame of frames) {
    const lines = frame.split("\n");
    if (lines.length !== 2) {
      throw new Error(`Malformed SSE frame (expected 2 lines): ${JSON.stringify(frame)}`);
    }
    const eventMatch = /^event: (.+)$/.exec(lines[0]);
    const dataMatch = /^data: (.+)$/.exec(lines[1]);
    if (eventMatch === null || dataMatch === null) {
      throw new Error(`Malformed SSE frame: ${JSON.stringify(frame)}`);
    }
    events.push({
      event: eventMatch[1],
      data: JSON.parse(dataMatch[1]),
    } as RecommendSseEvent);
  }
  return events;
}
