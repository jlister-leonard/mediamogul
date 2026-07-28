// @vitest-environment node
import { describe, expect, it } from "vitest";
import { LLM_MODELS } from "./config";
import { AnthropicTransport } from "./transport";

const apiKey = process.env.ANTHROPIC_API_KEY;

/**
 * The one test that touches the network. Auto-skips when ANTHROPIC_API_KEY is
 * absent (the default in CI and this build environment); run locally with the
 * key set to smoke the real SDK path.
 */
describe.runIf(apiKey !== undefined && apiKey !== "")("AnthropicTransport (live smoke)", () => {
  it(
    "streams a real turn and resolves with end_turn",
    { timeout: 60_000 },
    async () => {
      const transport = new AnthropicTransport(apiKey as string);
      const deltas: string[] = [];
      const turn = await transport.streamTurn(
        {
          model: LLM_MODELS.chat.model,
          maxTokens: 64,
          messages: [{ role: "user", content: [{ type: "text", text: "Say OK." }] }],
          tools: [],
        },
        (delta) => deltas.push(delta),
      );
      expect(turn.stopReason).toBe("end_turn");
      expect(deltas.join("").length).toBeGreaterThan(0);
      expect(turn.content.some((block) => block.type === "text")).toBe(true);
    },
  );
});
