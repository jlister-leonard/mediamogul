import { z } from "zod";
import { situationSchema } from "../../../lib/types";
import { recommendBudget } from "../../../lib/llm/budget";
import {
  LLM_MODELS,
  MAX_MODEL_TURNS,
  MAX_REQUEST_MESSAGES,
  MAX_REQUEST_TEXT_CHARS,
  MAX_TOOL_CALLS_PER_REQUEST,
  MAX_TOOL_CALLS_PER_ROUND,
  MAX_TOOL_ROUNDS,
} from "../../../lib/llm/config";
import { type ApiErrorEnvelope, errorEnvelope } from "../../../lib/llm/envelope";
import { checkPassphrase, PASSPHRASE_HEADER } from "../../../lib/llm/guard";
import { encodeSseEvent, type RecommendSseEvent } from "../../../lib/llm/sse";
import {
  executeTool,
  serializeToolOutcome,
  TOOL_DEFINITIONS,
} from "../../../lib/llm/tools";
import {
  getTransport,
  type LlmMessage,
  type LlmRequest,
  type LlmTransport,
  type LlmUserBlock,
  TransportUnconfiguredError,
} from "../../../lib/llm/transport";

/**
 * POST /api/recommend — the intelligence endpoint (E6.1). One engine, both
 * faces: `hand` (one-shot hand generation) and `chat` (multi-turn), streamed
 * as SSE.
 *
 * This route is a conduit. It holds NO prompt engineering:
 * - `tasteContext` is an opaque string built client-side by E6.2
 *   (lib/llm/context.ts) and passed through verbatim as the system prompt.
 * - the user-side ask is E6.3/E6.4 property: `hand` sends a Situation (its
 *   `prompt` becomes the single user turn) or a prepared `messages` array;
 *   `chat` sends the conversation `messages`.
 */

export const runtime = "nodejs";

/**
 * Size bounds are a cheap circuit breaker for a buggy client-side context
 * builder (E6.2) — far below any model limit, far above any legitimate
 * payload.
 */
const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MAX_REQUEST_TEXT_CHARS),
});

const requestSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("hand"),
      situation: situationSchema.optional(),
      messages: z.array(chatMessageSchema).min(1).max(MAX_REQUEST_MESSAGES).optional(),
      tasteContext: z.string().max(MAX_REQUEST_TEXT_CHARS),
    })
    .refine((body) => (body.situation !== undefined) !== (body.messages !== undefined), {
      message: "hand mode takes exactly one of `situation` or `messages`",
    })
    .refine((body) => body.messages === undefined || body.messages[0].role === "user", {
      message: "hand `messages` must start with a user turn",
    }),
  z
    .object({
      mode: z.literal("chat"),
      messages: z.array(chatMessageSchema).min(1).max(MAX_REQUEST_MESSAGES),
      tasteContext: z.string().max(MAX_REQUEST_TEXT_CHARS),
    })
    .refine((body) => body.messages[0].role === "user", {
      message: "chat `messages` must start with a user turn",
    }),
]);

type RecommendRequest = z.infer<typeof requestSchema>;

export async function POST(request: Request): Promise<Response> {
  const verdict = checkPassphrase(
    request.headers.get(PASSPHRASE_HEADER),
    process.env.NIGHTSTAND_PASSPHRASE,
  );
  if (!verdict.ok) {
    return jsonError(verdict.envelope, verdict.status);
  }

  let parsed: RecommendRequest;
  try {
    const body: unknown = await request.json();
    const result = requestSchema.safeParse(body);
    if (!result.success) {
      return jsonError(
        errorEnvelope("bad-request", "Request body does not match the recommend contract."),
        400,
      );
    }
    parsed = result.data;
    if (requestTextCharacters(parsed) > MAX_REQUEST_TEXT_CHARS) {
      return jsonError(
        errorEnvelope(
          "bad-request",
          "This request is too large. Shorten the conversation or taste context and try again.",
        ),
        400,
      );
    }
  } catch {
    return jsonError(errorEnvelope("bad-request", "Request body must be JSON."), 400);
  }

  // Transport before budget: an unconfigured deployment must not burn a
  // budget slot on its way to a 503.
  let transport: LlmTransport;
  try {
    transport = getTransport();
  } catch (error) {
    if (error instanceof TransportUnconfiguredError) {
      return jsonError(
        errorEnvelope("unconfigured", "This deployment is not configured."),
        503,
      );
    }
    throw error;
  }

  const budget = recommendBudget.take();
  if (!budget.allowed) {
    return jsonError(
      errorEnvelope(
        "cooling-down",
        "The engine is cooling down — too many requests this hour.",
        budget.retryAfterSeconds,
      ),
      429,
      { "Retry-After": String(budget.retryAfterSeconds) },
    );
  }

  const config = LLM_MODELS[parsed.mode];
  const base: Omit<LlmRequest, "messages"> = {
    model: config.model,
    maxTokens: config.maxTokens,
    ...(parsed.tasteContext !== "" ? { system: parsed.tasteContext } : {}),
    tools: TOOL_DEFINITIONS,
  };

  // Client-disconnect handling: aborting `abort` cancels the upstream SDK
  // stream (via LlmRequest.signal), so a dropped connection stops billing
  // immediately instead of streaming to completion.
  const abort = new AbortController();
  if (request.signal.aborted) {
    abort.abort();
  } else {
    request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  }
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: RecommendSseEvent): void => {
        // No-op once the consumer is gone: termination is a `break`, never a
        // throw through a cancelled controller.
        if (closed) {
          return;
        }
        controller.enqueue(encoder.encode(encodeSseEvent(event)));
      };
      const close = (): void => {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // Already cancelled by the consumer — nothing to close.
          }
        }
      };

      try {
        let messages = initialMessages(parsed);
        let modelTurns = 0;
        let toolRounds = 0;
        let totalToolCalls = 0;
        modelLoop: for (;;) {
          if (abort.signal.aborted) break;
          if (modelTurns >= MAX_MODEL_TURNS) {
            sendSafetyExhaustion(send, "model-turns-exhausted");
            break;
          }
          modelTurns += 1;
          const turn = await transport.streamTurn(
            { ...base, messages, signal: abort.signal },
            (delta) => {
              send({ event: "text", data: { delta } });
            },
          );
          // A disconnect mid-turn must not buy tool work. (The next turn needs
          // no such guard: `streamTurn` gets the aborted signal and the SDK
          // rejects it without touching the network.)
          if (abort.signal.aborted) {
            break;
          }

          const toolUses = turn.content.filter((block) => block.type === "tool_use");
          if (turn.stopReason !== "tool_use" || toolUses.length === 0) {
            send({ event: "done", data: { stopReason: turn.stopReason } });
            break;
          }
          if (toolRounds >= MAX_TOOL_ROUNDS) {
            sendSafetyExhaustion(send, "tool-rounds-exhausted");
            break;
          }
          if (
            toolUses.length > MAX_TOOL_CALLS_PER_ROUND ||
            totalToolCalls + toolUses.length > MAX_TOOL_CALLS_PER_REQUEST
          ) {
            sendSafetyExhaustion(send, "tool-calls-exhausted");
            break;
          }
          toolRounds += 1;
          totalToolCalls += toolUses.length;

          const resultBlocks: LlmUserBlock[] = [];
          for (const toolUse of toolUses) {
            if (abort.signal.aborted) break modelLoop;
            send({ event: "tool", data: { name: toolUse.name, phase: "start" } });
            const outcome = await executeTool(
              toolUse.name,
              toolUse.input,
              undefined,
              abort.signal,
            );
            if (abort.signal.aborted) break modelLoop;
            send({
              event: "tool",
              data: { name: toolUse.name, phase: "result", status: outcome.status },
            });
            resultBlocks.push({
              type: "tool_result",
              toolUseId: toolUse.id,
              content: serializeToolOutcome(outcome),
            });
          }
          messages = [
            ...messages,
            { role: "assistant", content: turn.content },
            { role: "user", content: resultBlocks },
          ];
        }
      } catch {
        // Degraded-but-renderable: same envelope shape as the JSON error
        // responses, delivered as a terminal SSE event. Never carries
        // upstream detail (secrets stay server-side); if the consumer has
        // already gone, `send` drops it.
        if (!abort.signal.aborted) {
          send({
            event: "error",
            data: errorEnvelope("upstream-error", "The engine hit a problem — try again."),
          });
        }
      } finally {
        close();
      }
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function requestTextCharacters(body: RecommendRequest): number {
  const prompt =
    body.mode === "hand" && body.situation !== undefined
      ? body.situation.prompt.length
      : (body.messages ?? []).reduce(
          (total, message) => total + message.content.length,
          0,
        );
  return body.tasteContext.length + prompt;
}

function sendSafetyExhaustion(
  send: (event: RecommendSseEvent) => void,
  stopReason:
    | "model-turns-exhausted"
    | "tool-rounds-exhausted"
    | "tool-calls-exhausted",
): void {
  send({
    event: "text",
    data: {
      delta:
        "I couldn't finish safely within this request. Please try a narrower question.",
    },
  });
  send({ event: "done", data: { stopReason } });
}

function initialMessages(body: RecommendRequest): LlmMessage[] {
  if (body.mode === "hand" && body.situation !== undefined) {
    return [{ role: "user", content: [{ type: "text", text: body.situation.prompt }] }];
  }
  // `messages` is guaranteed present here by the request schema.
  const messages = body.messages ?? [];
  return messages.map((message): LlmMessage => {
    if (message.role === "user") {
      return { role: "user", content: [{ type: "text", text: message.content }] };
    }
    return { role: "assistant", content: [{ type: "text", text: message.content }] };
  });
}

function jsonError(
  envelope: ApiErrorEnvelope,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return Response.json(envelope, { status, headers });
}
