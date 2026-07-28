// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicTransport, type LlmRequest, toSdkMessage } from "./transport";

describe("toSdkMessage (SDK boundary conversion)", () => {
  it("maps user text and tool_result blocks to SDK params", () => {
    expect(
      toSdkMessage({
        role: "user",
        content: [
          { type: "text", text: "hello" },
          { type: "tool_result", toolUseId: "toolu_1", content: '{"status":"ok"}' },
        ],
      }),
    ).toEqual({
      role: "user",
      content: [
        { type: "text", text: "hello" },
        { type: "tool_result", tool_use_id: "toolu_1", content: '{"status":"ok"}' },
      ],
    });
  });

  it("maps assistant text and tool_use blocks to SDK params", () => {
    expect(
      toSdkMessage({
        role: "assistant",
        content: [
          { type: "text", text: "checking" },
          { type: "tool_use", id: "toolu_1", name: "search_catalog", input: { query: "x" } },
        ],
      }),
    ).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "checking" },
        { type: "tool_use", id: "toolu_1", name: "search_catalog", input: { query: "x" } },
      ],
    });
  });

  it("echoes opaque model blocks (e.g. thinking) back verbatim, by reference", () => {
    const raw = { type: "thinking", thinking: "", signature: "sig-1" };
    const sdkMessage = toSdkMessage({
      role: "assistant",
      content: [
        { type: "opaque", raw },
        { type: "text", text: "after thinking" },
      ],
    });
    expect(sdkMessage).toEqual({
      role: "assistant",
      content: [raw, { type: "text", text: "after thinking" }],
    });
    // Verbatim means the very same object — no clone, no reshaping.
    expect((sdkMessage.content as unknown[])[0]).toBe(raw);
  });
});

describe("AnthropicTransport (abort propagation)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const request = (signal: AbortSignal): LlmRequest => ({
    model: "claude-sonnet-5",
    maxTokens: 8192,
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    tools: [],
    signal,
  });

  it("hands the caller's signal to the SDK, which aborts the live HTTP request", async () => {
    // The SDK resolves `fetch` from the global at construction time, so this
    // stub IS the network for the transport below. The response never settles
    // on its own — the only way out is an abort, exactly like a long-running
    // streaming completion that would otherwise bill to maxTokens.
    let upstream: AbortSignal | null = null;
    const fetchStub = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          upstream = init?.signal ?? null;
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchStub);

    const controller = new AbortController();
    const turn = new AnthropicTransport("test-key").streamTurn(
      request(controller.signal),
      () => {},
    );
    const settled = expect(turn).rejects.toThrowError();

    // The request is in flight and holding an abort signal.
    await vi.waitFor(() => expect(fetchStub).toHaveBeenCalledTimes(1));
    expect(upstream).toBeInstanceOf(AbortSignal);
    expect(upstream!.aborted).toBe(false);

    controller.abort();

    // The client disconnect reached the socket, and the turn unwound instead of
    // streaming on. One attempt only — an aborted request is never retried.
    expect(upstream!.aborted).toBe(true);
    await settled;
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});
