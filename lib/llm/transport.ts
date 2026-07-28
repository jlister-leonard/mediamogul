import Anthropic from "@anthropic-ai/sdk";

/**
 * The transport abstraction: everything the route knows about talking to a
 * model. The real implementation wraps the Anthropic SDK; the mock replays a
 * script. ALL route tests run against the mock — the live smoke test
 * (lib/llm/live-smoke.test.ts) is the only thing that touches the network,
 * and it auto-skips without ANTHROPIC_API_KEY.
 */

export interface LlmToolDefinition {
  name: string;
  description: string;
  /** JSON Schema (from z.toJSONSchema) for the tool's input. */
  inputSchema: Record<string, unknown>;
}

export type LlmAssistantBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  /**
   * Any other block the model produced (e.g. thinking). Held verbatim and
   * echoed back unchanged on the tool round-trip, per the API's replay rules.
   */
  | { type: "opaque"; raw: unknown };

export type LlmUserBlock =
  | { type: "text"; text: string }
  | { type: "tool_result"; toolUseId: string; content: string };

export type LlmMessage =
  | { role: "user"; content: LlmUserBlock[] }
  | { role: "assistant"; content: LlmAssistantBlock[] };

export interface LlmRequest {
  model: string;
  maxTokens: number;
  /** Opaque taste context built client-side by E6.2 — passed through verbatim. */
  system?: string;
  messages: LlmMessage[];
  tools: readonly LlmToolDefinition[];
  /**
   * Aborted when the client disconnects: the real transport cancels the
   * upstream SDK stream so a dropped connection stops billing immediately.
   */
  signal?: AbortSignal;
}

export type LlmStopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "refusal"
  | "other";

export interface LlmTurn {
  stopReason: LlmStopReason;
  content: LlmAssistantBlock[];
}

export interface LlmTransport {
  /**
   * Run one model turn: text deltas stream through `onTextDelta` as they
   * arrive; the resolved value is the complete turn (needed for the tool
   * round-trip).
   */
  streamTurn(request: LlmRequest, onTextDelta: (delta: string) => void): Promise<LlmTurn>;
}

/** Thrown when the real transport is needed but ANTHROPIC_API_KEY is unset. */
export class TransportUnconfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not configured");
    this.name = "TransportUnconfiguredError";
  }
}

/** Real implementation over the Anthropic SDK (streaming Messages API). */
export class AnthropicTransport implements LlmTransport {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async streamTurn(
    request: LlmRequest,
    onTextDelta: (delta: string) => void,
  ): Promise<LlmTurn> {
    const stream = this.client.messages.stream(
      {
        model: request.model,
        max_tokens: request.maxTokens,
        ...(request.system !== undefined && request.system !== ""
          ? { system: request.system }
          : {}),
        messages: request.messages.map(toSdkMessage),
        tools: request.tools.map(toSdkTool),
      },
      { signal: request.signal },
    );
    stream.on("text", onTextDelta);
    const message = await stream.finalMessage();
    return {
      stopReason: fromSdkStopReason(message.stop_reason),
      content: message.content.map(fromSdkBlock),
    };
  }
}

function toSdkTool(tool: LlmToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  };
}

/** Exported for unit tests — the SDK-boundary conversion, incl. opaque replay. */
export function toSdkMessage(message: LlmMessage): Anthropic.MessageParam {
  if (message.role === "user") {
    return {
      role: "user",
      content: message.content.map((block): Anthropic.ContentBlockParam => {
        if (block.type === "text") {
          return { type: "text", text: block.text };
        }
        return {
          type: "tool_result",
          tool_use_id: block.toolUseId,
          content: block.content,
        };
      }),
    };
  }
  return {
    role: "assistant",
    content: message.content.map((block): Anthropic.ContentBlockParam => {
      if (block.type === "text") {
        return { type: "text", text: block.text };
      }
      if (block.type === "tool_use") {
        return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input,
        };
      }
      // Echo model-produced blocks (thinking etc.) back verbatim.
      return block.raw as Anthropic.ContentBlockParam;
    }),
  };
}

function fromSdkBlock(block: Anthropic.ContentBlock): LlmAssistantBlock {
  if (block.type === "text") {
    return { type: "text", text: block.text };
  }
  if (block.type === "tool_use") {
    return { type: "tool_use", id: block.id, name: block.name, input: block.input };
  }
  return { type: "opaque", raw: block };
}

function fromSdkStopReason(stopReason: Anthropic.Message["stop_reason"]): LlmStopReason {
  switch (stopReason) {
    case "end_turn":
    case "tool_use":
    case "max_tokens":
    case "refusal":
      return stopReason;
    default:
      return "other";
  }
}

/**
 * Mock implementation: replays a script of turns and records every request it
 * was given, so tests can assert on the exact conduit behavior (streaming
 * chunks, tool round-trips, message construction) with zero network.
 */
export interface MockTurn {
  /** Text deltas to stream before resolving the turn. */
  deltas: string[];
  turn: LlmTurn;
}

export class MockLlmTransport implements LlmTransport {
  readonly requests: LlmRequest[] = [];
  private cursor = 0;

  constructor(private readonly script: MockTurn[]) {}

  async streamTurn(
    request: LlmRequest,
    onTextDelta: (delta: string) => void,
  ): Promise<LlmTurn> {
    this.requests.push(request);
    const scripted = this.script[this.cursor];
    if (scripted === undefined) {
      throw new Error(`MockLlmTransport: no scripted turn at index ${this.cursor}`);
    }
    this.cursor += 1;
    for (const delta of scripted.deltas) {
      onTextDelta(delta);
    }
    return scripted.turn;
  }
}

let transportOverride: LlmTransport | null = null;

/** Test seam: route all traffic through the given transport (null to clear). */
export function setTransportForTesting(transport: LlmTransport | null): void {
  transportOverride = transport;
}

/**
 * The transport the route uses. Tests install a mock; production constructs
 * the SDK transport from the server-side key. Throws
 * `TransportUnconfiguredError` when neither is possible.
 */
export function getTransport(): LlmTransport {
  if (transportOverride !== null) {
    return transportOverride;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new TransportUnconfiguredError();
  }
  return new AnthropicTransport(apiKey);
}
