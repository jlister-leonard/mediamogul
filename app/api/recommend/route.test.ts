// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recommendBudget } from "../../../lib/llm/budget";
import { LLM_MODELS, MAX_TOOL_ROUNDS, REQUEST_BUDGET } from "../../../lib/llm/config";
import { parseSseStream, type RecommendSseEvent } from "../../../lib/llm/sse";
import {
  type LlmRequest,
  type LlmTransport,
  type LlmTurn,
  MockLlmTransport,
  setTransportForTesting,
} from "../../../lib/llm/transport";
import { POST } from "./route";

const PASSPHRASE = "correct-horse";

const situation = {
  id: "sit-1",
  label: "45 min before bed",
  prompt: "Something for 45 minutes before bed, nothing heavy.",
  source: "built-in",
  createdAt: "2026-07-28T00:00:00.000Z",
};

const endTurn = (text: string): LlmTurn => ({
  stopReason: "end_turn",
  content: [{ type: "text", text }],
});

function makeRequest(
  body: unknown,
  passphrase: string | null = PASSPHRASE,
  signal?: AbortSignal,
): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (passphrase !== null) {
    headers["x-nightstand-passphrase"] = passphrase;
  }
  return new Request("http://nightstand.test/api/recommend", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...(signal !== undefined ? { signal } : {}),
  });
}

async function readSse(response: Response): Promise<RecommendSseEvent[]> {
  return parseSseStream(await response.text());
}

const handBody = { mode: "hand", situation, tasteContext: "TASTE-CONTEXT-BLOB" };

describe("POST /api/recommend", () => {
  const savedPassphrase = process.env.NIGHTSTAND_PASSPHRASE;
  const savedApiKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.NIGHTSTAND_PASSPHRASE = PASSPHRASE;
    recommendBudget.reset();
  });

  afterEach(() => {
    setTransportForTesting(null);
    recommendBudget.reset();
    if (savedPassphrase === undefined) delete process.env.NIGHTSTAND_PASSPHRASE;
    else process.env.NIGHTSTAND_PASSPHRASE = savedPassphrase;
    if (savedApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedApiKey;
  });

  describe("passphrase guard", () => {
    it("returns 503 unconfigured when NIGHTSTAND_PASSPHRASE is unset", async () => {
      delete process.env.NIGHTSTAND_PASSPHRASE;
      const response = await POST(makeRequest(handBody));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: { code: "unconfigured", message: expect.any(String) },
      });
    });

    it("returns 401 with a typed envelope and no detail on a wrong passphrase", async () => {
      const response = await POST(makeRequest(handBody, "wrong"));
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
      expect(JSON.stringify(body)).not.toContain(PASSPHRASE);
    });

    it("returns 401 when the header is missing", async () => {
      const response = await POST(makeRequest(handBody, null));
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("unauthorized");
    });
  });

  describe("request validation", () => {
    it("rejects a non-JSON body with 400", async () => {
      const response = await POST(makeRequest("not json"));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("bad-request");
    });

    it("rejects chat mode without messages", async () => {
      const response = await POST(makeRequest({ mode: "chat", tasteContext: "" }));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("bad-request");
    });

    it("rejects hand mode carrying both situation and messages", async () => {
      const response = await POST(
        makeRequest({
          ...handBody,
          messages: [{ role: "user", content: "hi" }],
        }),
      );
      expect(response.status).toBe(400);
    });

    it("rejects chat whose first message is not a user turn", async () => {
      const response = await POST(
        makeRequest({
          mode: "chat",
          messages: [{ role: "assistant", content: "hello" }],
          tasteContext: "",
        }),
      );
      expect(response.status).toBe(400);
    });

    it("rejects hand-mode messages whose first turn is not a user turn", async () => {
      const response = await POST(
        makeRequest({
          mode: "hand",
          messages: [{ role: "assistant", content: "hello" }],
          tasteContext: "",
        }),
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("bad-request");
    });

    it("rejects an oversized tasteContext with a typed envelope before any model spend", async () => {
      const mock = new MockLlmTransport([]);
      setTransportForTesting(mock);
      const response = await POST(
        makeRequest({ ...handBody, tasteContext: "x".repeat(200_001) }),
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("bad-request");
      expect(mock.requests).toHaveLength(0);
    });

    it("rejects an oversized chat message content", async () => {
      const response = await POST(
        makeRequest({
          mode: "chat",
          messages: [{ role: "user", content: "y".repeat(200_001) }],
          tasteContext: "",
        }),
      );
      expect(response.status).toBe(400);
    });
  });

  describe("cost guard", () => {
    it("returns a typed cooling-down envelope with Retry-After once the hourly budget is spent", async () => {
      setTransportForTesting(new MockLlmTransport([]));
      for (let i = 0; i < REQUEST_BUDGET.maxRequestsPerWindow; i += 1) {
        expect(recommendBudget.take().allowed).toBe(true);
      }
      const response = await POST(makeRequest(handBody));
      expect(response.status).toBe(429);
      const body = await response.json();
      expect(body).toEqual({
        error: {
          code: "cooling-down",
          message: expect.any(String),
          retryAfterSeconds: expect.any(Number),
        },
      });
      expect(Number(response.headers.get("Retry-After"))).toBe(
        body.error.retryAfterSeconds,
      );
    });

    it("caps the model spend per request via config max_tokens", async () => {
      const mock = new MockLlmTransport([{ deltas: [], turn: endTurn("ok") }]);
      setTransportForTesting(mock);
      await POST(makeRequest(handBody));
      expect(mock.requests[0].maxTokens).toBe(LLM_MODELS.hand.maxTokens);
    });
  });

  describe("transport configuration", () => {
    it("returns 503 unconfigured without spending a budget slot", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      // Spend every slot but one: if the 503 path took a slot, the request
      // below would be the one that gets refused.
      for (let i = 0; i < REQUEST_BUDGET.maxRequestsPerWindow - 1; i += 1) {
        expect(recommendBudget.take().allowed).toBe(true);
      }

      const response = await POST(makeRequest(handBody));
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe("unconfigured");

      expect(recommendBudget.take().allowed).toBe(true);
    });
  });

  describe("streaming", () => {
    it("streams model text as well-formed SSE frames ending in done", async () => {
      const mock = new MockLlmTransport([
        { deltas: ["A quiet ", "novella."], turn: endTurn("A quiet novella.") },
      ]);
      setTransportForTesting(mock);

      const response = await POST(makeRequest(handBody));
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
      expect(response.headers.get("Cache-Control")).toBe("no-store");

      const events = await readSse(response);
      expect(events).toEqual([
        { event: "text", data: { delta: "A quiet " } },
        { event: "text", data: { delta: "novella." } },
        { event: "done", data: { stopReason: "end_turn" } },
      ]);
    });

    it("hand mode is a pure conduit: situation prompt as the user turn, tasteContext as system, tools attached", async () => {
      const mock = new MockLlmTransport([{ deltas: [], turn: endTurn("ok") }]);
      setTransportForTesting(mock);
      await POST(makeRequest(handBody));

      expect(mock.requests).toHaveLength(1);
      const request = mock.requests[0];
      expect(request.model).toBe(LLM_MODELS.hand.model);
      expect(request.system).toBe("TASTE-CONTEXT-BLOB");
      expect(request.messages).toEqual([
        { role: "user", content: [{ type: "text", text: situation.prompt }] },
      ]);
      expect(request.tools.map((tool) => tool.name)).toEqual([
        "check_availability",
        "search_catalog",
      ]);
    });

    it("chat mode passes the conversation through verbatim and omits an empty system", async () => {
      const mock = new MockLlmTransport([{ deltas: [], turn: endTurn("ok") }]);
      setTransportForTesting(mock);
      await POST(
        makeRequest({
          mode: "chat",
          messages: [
            { role: "user", content: "Flight tomorrow, 5 hours" },
            { role: "assistant", content: "How about..." },
            { role: "user", content: "shorter" },
          ],
          tasteContext: "",
        }),
      );

      const request = mock.requests[0];
      expect(request.model).toBe(LLM_MODELS.chat.model);
      expect(request.system).toBeUndefined();
      expect(request.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "Flight tomorrow, 5 hours" }] },
        { role: "assistant", content: [{ type: "text", text: "How about..." }] },
        { role: "user", content: [{ type: "text", text: "shorter" }] },
      ]);
    });
  });

  describe("tool round-trip", () => {
    it("executes a model tool call, streams tool events, and feeds the typed result back", async () => {
      const opaqueBlock = { type: "thinking", thinking: "", signature: "sig" };
      const mock = new MockLlmTransport([
        {
          deltas: ["Checking availability…"],
          turn: {
            stopReason: "tool_use",
            content: [
              { type: "opaque", raw: opaqueBlock },
              { type: "text", text: "Checking availability…" },
              {
                type: "tool_use",
                id: "toolu_1",
                name: "check_availability",
                input: { itemRefs: [{ medium: "movie", tmdbId: 603 }] },
              },
            ],
          },
        },
        { deltas: ["The Matrix it is."], turn: endTurn("The Matrix it is.") },
      ]);
      setTransportForTesting(mock);

      const response = await POST(makeRequest(handBody));
      const events = await readSse(response);
      expect(events).toEqual([
        { event: "text", data: { delta: "Checking availability…" } },
        { event: "tool", data: { name: "check_availability", phase: "start" } },
        // lib/providers has not merged (E2.x runs in parallel) — the executor
        // degrades to the typed unavailable result.
        {
          event: "tool",
          data: { name: "check_availability", phase: "result", status: "unavailable" },
        },
        { event: "text", data: { delta: "The Matrix it is." } },
        { event: "done", data: { stopReason: "end_turn" } },
      ]);

      // Second model turn carries the assistant blocks (opaque echoed
      // verbatim) plus the tool result keyed to the tool_use id.
      expect(mock.requests).toHaveLength(2);
      const followUp = mock.requests[1].messages;
      expect(followUp).toHaveLength(3);
      expect(followUp[1]).toEqual({
        role: "assistant",
        content: [
          { type: "opaque", raw: opaqueBlock },
          { type: "text", text: "Checking availability…" },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "check_availability",
            input: { itemRefs: [{ medium: "movie", tmdbId: 603 }] },
          },
        ],
      });
      const lastMessage = followUp[2];
      expect(lastMessage.role).toBe("user");
      const resultBlock = lastMessage.content[0];
      if (resultBlock.type !== "tool_result") {
        throw new Error("expected a tool_result block");
      }
      expect(resultBlock.toolUseId).toBe("toolu_1");
      expect(JSON.parse(resultBlock.content)).toMatchObject({ status: "unavailable" });
    });

    it("stops with tool-rounds-exhausted when the model never stops calling tools", async () => {
      const toolTurn: LlmTurn = {
        stopReason: "tool_use",
        content: [
          { type: "tool_use", id: "toolu_n", name: "search_catalog", input: { query: "x" } },
        ],
      };
      const mock = new MockLlmTransport(
        Array.from({ length: MAX_TOOL_ROUNDS + 1 }, () => ({ deltas: [], turn: toolTurn })),
      );
      setTransportForTesting(mock);

      const response = await POST(makeRequest(handBody));
      const events = await readSse(response);
      expect(events.at(-1)).toEqual({
        event: "done",
        data: { stopReason: "tool-rounds-exhausted" },
      });
      expect(mock.requests).toHaveLength(MAX_TOOL_ROUNDS + 1);
    });
  });

  describe("degraded responses", () => {
    it("turns a transport failure into a terminal typed error event, not a broken stream", async () => {
      const failing = {
        streamTurn: () => Promise.reject(new Error("api.anthropic.com unreachable")),
      };
      setTransportForTesting(failing);

      const response = await POST(makeRequest(handBody));
      expect(response.status).toBe(200);
      const events = await readSse(response);
      expect(events).toEqual([
        {
          event: "error",
          data: { error: { code: "upstream-error", message: expect.any(String) } },
        },
      ]);
      // Upstream detail never leaks to the client.
      expect(JSON.stringify(events)).not.toContain("unreachable");
    });
  });

  describe("client disconnect", () => {
    /**
     * A transport that parks inside the first turn, so a test can disconnect
     * while the model is still streaming — the only moment where failing to
     * abort would keep billing to maxTokens.
     */
    function parkingTransport(onRelease: "reject" | "resolve"): {
      transport: LlmTransport;
      requests: LlmRequest[];
      streaming: Promise<void>;
      release: () => void;
    } {
      const requests: LlmRequest[] = [];
      let started!: () => void;
      let release!: () => void;
      const streaming = new Promise<void>((resolve) => {
        started = resolve;
      });
      const parked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const transport: LlmTransport = {
        async streamTurn(request, onTextDelta) {
          requests.push(request);
          onTextDelta("A quiet ");
          started();
          await parked;
          if (onRelease === "reject") {
            // What the real SDK stream does once its request is aborted.
            throw new DOMException("The operation was aborted.", "AbortError");
          }
          // The race where the turn lands just as the client leaves: the route
          // must still stop rather than run the tool round-trip it asks for.
          return {
            stopReason: "tool_use",
            content: [
              { type: "tool_use", id: "toolu_1", name: "search_catalog", input: { query: "x" } },
            ],
          };
        },
      };
      return { transport, requests, streaming, release };
    }

    /** Two macrotasks: enough for the route's stream body to unwind. */
    const settle = async (): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    it("aborts the in-flight turn and runs no further turns when the reader cancels", async () => {
      const { transport, requests, streaming, release } = parkingTransport("reject");
      setTransportForTesting(transport);
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };
      process.on("unhandledRejection", onUnhandled);

      try {
        const response = await POST(makeRequest(handBody));
        const reader = response.body!.getReader();
        expect(new TextDecoder().decode((await reader.read()).value)).toContain("A quiet ");
        await streaming;

        // The client goes away mid-stream.
        await reader.cancel();
        expect(requests[0].signal!.aborted).toBe(true);

        release();
        await settle();

        // The turn unwound; the tool round-trip it asked for never happened.
        expect(requests).toHaveLength(1);
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });

    it("aborts the in-flight turn when the platform aborts the request signal", async () => {
      const { transport, requests, streaming, release } = parkingTransport("resolve");
      setTransportForTesting(transport);
      const disconnect = new AbortController();

      const response = await POST(makeRequest(handBody, PASSPHRASE, disconnect.signal));
      await streaming;

      disconnect.abort();
      expect(requests[0].signal!.aborted).toBe(true);

      release();
      await settle();
      expect(requests).toHaveLength(1);
      // The stream still terminates cleanly — a truncated body, never a hang.
      expect(await readSse(response)).toEqual([{ event: "text", data: { delta: "A quiet " } }]);
    });
  });
});
