/**
 * All model ids and cost knobs for the intelligence endpoint live here — one
 * place to change (E6.1). The route is a conduit: prompts are E6.2/E6.3
 * property, but *which model, how many tokens, how many requests* is config.
 */

/**
 * Per-mode model configuration. Both engine faces run Sonnet (PLAN §8).
 * maxTokens is 8192 because Sonnet 5's adaptive thinking (on by default)
 * spends from the same max_tokens budget as the visible reply — 4096 risks
 * truncating a full 5-pick hand mid-answer.
 */
export const LLM_MODELS = {
  /** One-shot hand generation. */
  hand: { model: "claude-sonnet-5", maxTokens: 8192 },
  /** Multi-turn chat. */
  chat: { model: "claude-sonnet-5", maxTokens: 8192 },
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
export const MAX_TOOL_ROUNDS = 4;
