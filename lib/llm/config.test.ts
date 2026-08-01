// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  LLM_MODELS,
  MAX_AVAILABILITY_REFS,
  MAX_CATALOG_QUERY_CHARS,
  MAX_MODEL_TURNS,
  MAX_REQUEST_MESSAGES,
  MAX_REQUEST_TEXT_CHARS,
  MAX_SERIALIZED_TOOL_RESULT_CHARS,
  MAX_TOOL_CALLS_PER_REQUEST,
  MAX_TOOL_CALLS_PER_ROUND,
  MAX_TOOL_ROUNDS,
  REQUEST_BUDGET,
} from "./config";

describe("fixed personal-app safety policy", () => {
  it("pins request and model ceilings to literal reviewed boundaries", () => {
    expect(MAX_REQUEST_TEXT_CHARS).toBe(256_000);
    expect(MAX_REQUEST_MESSAGES).toBe(40);
    expect(MAX_MODEL_TURNS).toBe(4);
    expect(MAX_TOOL_ROUNDS).toBe(3);
    expect(LLM_MODELS.hand.maxTokens).toBe(2_048);
    expect(LLM_MODELS.chat.maxTokens).toBe(2_048);
    expect(MAX_MODEL_TURNS * LLM_MODELS.hand.maxTokens).toBe(8_192);
    expect(REQUEST_BUDGET.maxRequestsPerWindow).toBe(60);
    expect(REQUEST_BUDGET.windowMs).toBe(3_600_000);
  });

  it("pins tool input, call-count, and serialized-result ceilings", () => {
    expect(MAX_TOOL_CALLS_PER_ROUND).toBe(8);
    expect(MAX_TOOL_CALLS_PER_REQUEST).toBe(16);
    expect(MAX_CATALOG_QUERY_CHARS).toBe(500);
    expect(MAX_AVAILABILITY_REFS).toBe(50);
    expect(MAX_SERIALIZED_TOOL_RESULT_CHARS).toBe(64_000);
  });
});
