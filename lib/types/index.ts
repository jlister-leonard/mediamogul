/**
 * Nightstand's shared contracts — the product's grammar (E0.3).
 *
 * Schema-first: every type is `z.infer`red from its Zod schema, so runtime
 * validation and static types can never drift. Every other bead imports from
 * this barrel; no bead outside E0.3 edits `lib/types/*` (COORDINATION.md).
 */
export * from "./ids";
export * from "./media";
export * from "./genre";
export * from "./item";
export * from "./entry";
export * from "./ladder";
export * from "./queue";
export * from "./situation";
export * from "./availability";
export * from "./rec";
export * from "./portrait";
