/**
 * All model ids and cost knobs for the intelligence endpoint live here — one
 * place to change (E6.1). The route is a conduit: prompts are E6.2/E6.3
 * property, but *which model, how many tokens, how many requests* is config.
 */

/**
 * Per-mode model configuration. Both engine faces run Sonnet (PLAN §8).
 * Each turn is capped at 2,048 output tokens. With at most four model turns
 * below, one request can configure no more than 8,192 output tokens total.
 */
export const LLM_MODELS = {
  /** One-shot hand generation. */
  hand: { model: "claude-sonnet-5", maxTokens: 2048 },
  /** Multi-turn chat. */
  chat: { model: "claude-sonnet-5", maxTokens: 2048 },
} as const;

export type RecommendMode = keyof typeof LLM_MODELS;

/**
 * Cost guard: rolling per-hour request budget. In-memory and therefore
 * PER-INSTANCE — on Vercel each warm lambda counts separately. For a
 * single-user app that is the honest, zero-infrastructure ceiling; it exists
 * to stop a leaked URL + passphrase from becoming a runaway bill, not to be
 * precise accounting.
 */
export const REQUEST_BUDGET = {
  maxRequestsPerWindow: 60,
  windowMs: 60 * 60 * 1000,
} as const;

/**
 * Cap on model→tool→model round trips within one request, so a tool-happy
 * turn can't loop the meter.
 */
export const MAX_MODEL_TURNS = 4;
export const MAX_TOOL_ROUNDS = 3;
export const MAX_TOOL_CALLS_PER_ROUND = 8;
export const MAX_TOOL_CALLS_PER_REQUEST = 16;

/** Model-bound text and conversation limits, enforced before transport use. */
export const MAX_REQUEST_TEXT_CHARS = 256_000;
export const MAX_REQUEST_MESSAGES = 40;

/** Tool input and output circuit breakers. */
export const MAX_CATALOG_QUERY_CHARS = 500;
export const MAX_AVAILABILITY_REFS = 50;
export const MAX_SERIALIZED_TOOL_RESULT_CHARS = 64_000;
