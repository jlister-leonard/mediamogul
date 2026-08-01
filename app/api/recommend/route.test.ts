// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recommendBudget } from "../../../lib/llm/budget";
import { LLM_MODELS, REQUEST_BUDGET } from "../../../lib/llm/config";
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
        makeRequest({ ...handBody, tasteContext: "x".repeat(256_001) }),
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("bad-request");
      expect(mock.requests).toHaveLength(0);
    });

    it("accepts exactly 256,000 aggregate model-bound characters", async () => {
      const mock = new MockLlmTransport([{ deltas: [], turn: endTurn("ok") }]);
      setTransportForTesting(mock);
      const response = await POST(
        makeRequest({
          mode: "chat",
          messages: [{ role: "user", content: "y" }],
          tasteContext: "x".repeat(255_999),
        }),
      );
      await readSse(response);
      expect(response.status).toBe(200);
      expect(mock.requests).toHaveLength(1);
    });

    it("rejects 256,001 aggregate characters before any model spend", async () => {
      const mock = new MockLlmTransport([]);
      setTransportForTesting(mock);
      const response = await POST(
        makeRequest({
          mode: "chat",
          messages: [{ role: "user", content: "y" }],
          tasteContext: "x".repeat(256_000),
        }),
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error.message).toMatch(/too large/i);
      expect(mock.requests).toHaveLength(0);
    });

    it("rejects oversized serialized availability before any model spend", async () => {
      const mock = new MockLlmTransport([]);
      setTransportForTesting(mock);
      const url = "https://example.com/".padEnd(2_048, "x");
      const availabilityContext = Array.from({ length: 32 }, (_, index) => ({
        ref: { medium: "movie" as const, tmdbId: index + 1 },
        offers: [{
          kind: "subscription" as const,
          providerId: "provider",
          region: "US" as const,
          fetchedAt: "2026-08-01T16:00:00.000Z",
          url,
        }],
      }));
      const response = await POST(makeRequest({ ...handBody, availabilityContext }));
      expect(response.status).toBe(400);
      expect((await response.json()).error.message).toMatch(/too large/i);
      expect(mock.requests).toHaveLength(0);
    });

    it.each([
      ["provider id", { providerId: "p".repeat(101) }],
      ["offer URL", { url: "https://example.com/".padEnd(2_049, "x") }],
    ])("rejects an overlong availability %s before any model spend", async (_label, override) => {
      const mock = new MockLlmTransport([]);
      setTransportForTesting(mock);
      const response = await POST(makeRequest({
        ...handBody,
        availabilityContext: [{
          ref: { medium: "movie", tmdbId: 603 },
          offers: [{
            kind: "subscription",
            providerId: "provider",
            region: "US",
            fetchedAt: "2026-08-01T16:00:00.000Z",
            ...override,
          }],
        }],
      }));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("bad-request");
      expect(mock.requests).toHaveLength(0);
    });

    it("accepts 40 messages and rejects 41 before any model spend", async () => {
      const accepted = new MockLlmTransport([{ deltas: [], turn: endTurn("ok") }]);
      setTransportForTesting(accepted);
      const forty = Array.from({ length: 40 }, () => ({
        role: "user" as const,
        content: "x",
      }));
      const acceptedResponse = await POST(
        makeRequest({ mode: "chat", messages: forty, tasteContext: "" }),
      );
      await readSse(acceptedResponse);
      expect(acceptedResponse.status).toBe(200);
      expect(accepted.requests).toHaveLength(1);

      const rejected = new MockLlmTransport([]);
      setTransportForTesting(rejected);
      const response = await POST(
        makeRequest({
          mode: "chat",
          messages: [...forty, { role: "user", content: "x" }],
          tasteContext: "",
        }),
      );
      expect(response.status).toBe(400);
      expect(rejected.requests).toHaveLength(0);
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

    it("fixes every model turn at no more than 2,048 configured output tokens", async () => {
      const mock = new MockLlmTransport([{ deltas: [], turn: endTurn("ok") }]);
      setTransportForTesting(mock);
      await readSse(await POST(makeRequest(handBody)));
      expect(LLM_MODELS.hand.maxTokens).toBe(2_048);
      expect(LLM_MODELS.chat.maxTokens).toBe(2_048);
      expect(mock.requests[0].maxTokens).toBe(2_048);
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

      const response = await POST(makeRequest({
        ...handBody,
        availabilityContext: [{
          ref: { medium: "movie", tmdbId: 603 },
          offers: [{
            kind: "subscription",
            providerId: "netflix",
            region: "US",
            fetchedAt: "2026-08-01T16:00:00.000Z",
          }],
        }],
      }));
      const events = await readSse(response);
      expect(events).toEqual([
        { event: "text", data: { delta: "Checking availability…" } },
        { event: "tool", data: { name: "check_availability", phase: "start" } },
        {
          event: "tool",
          data: { name: "check_availability", phase: "result", status: "ok" },
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
      expect(JSON.parse(resultBlock.content)).toMatchObject({
        status: "ok",
        result: [{
          checked: true,
          offers: [{ providerId: "netflix", kind: "subscription" }],
        }],
      });
    });

    it("stops after four total model turns with text plus a machine reason", async () => {
      const toolTurn: LlmTurn = {
        stopReason: "tool_use",
        content: [
          { type: "tool_use", id: "toolu_n", name: "search_catalog", input: { query: "x" } },
        ],
      };
      const mock = new MockLlmTransport(
        Array.from({ length: 5 }, () => ({ deltas: [], turn: toolTurn })),
      );
      setTransportForTesting(mock);

      const response = await POST(makeRequest(handBody));
      const events = await readSse(response);
      expect(events.at(-1)).toEqual({
        event: "done",
        data: { stopReason: "tool-rounds-exhausted" },
      });
      expect(events.at(-2)).toMatchObject({ event: "text", data: { delta: expect.any(String) } });
      expect(mock.requests).toHaveLength(4);
      expect(mock.requests.every((request) => request.maxTokens === 2_048)).toBe(true);
    });

    it("executes at most eight tool calls in one round", async () => {
      const tooMany: LlmTurn = {
        stopReason: "tool_use",
        content: Array.from({ length: 9 }, (_, index) => ({
          type: "tool_use" as const,
          id: `toolu_${index}`,
          name: "search_catalog",
          input: { query: "x" },
        })),
      };
      const mock = new MockLlmTransport([{ deltas: [], turn: tooMany }]);
      setTransportForTesting(mock);

      const events = await readSse(await POST(makeRequest(handBody)));
      expect(events.filter((event) => event.event === "tool")).toHaveLength(0);
      expect(events.at(-2)).toMatchObject({ event: "text" });
      expect(events.at(-1)).toEqual({
        event: "done",
        data: { stopReason: "tool-calls-exhausted" },
      });
    });

    it("executes at most sixteen tool calls across the request", async () => {
      const toolTurn = (count: number, prefix: string): LlmTurn => ({
        stopReason: "tool_use",
        content: Array.from({ length: count }, (_, index) => ({
          type: "tool_use" as const,
          id: `${prefix}_${index}`,
          name: "unknown_tool",
          input: {},
        })),
      });
      const mock = new MockLlmTransport([
        { deltas: [], turn: toolTurn(8, "a") },
        { deltas: [], turn: toolTurn(8, "b") },
        { deltas: [], turn: toolTurn(1, "c") },
      ]);
      setTransportForTesting(mock);

      const events = await readSse(await POST(makeRequest(handBody)));
      expect(
        events.filter(
          (event) => event.event === "tool" && event.data.phase === "start",
        ),
      ).toHaveLength(16);
      expect(events.at(-2)).toMatchObject({ event: "text" });
      expect(events.at(-1)).toEqual({
        event: "done",
        data: { stopReason: "tool-calls-exhausted" },
      });
      expect(mock.requests).toHaveLength(3);
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
