import { z } from "zod";
import { isoTimestampSchema } from "./ids";

/**
 * One claim the model makes about your taste (PLAN §4.6) — stated as
 * observation, never as a scold (E7.2). Axis claims position you between two
 * poles: -1 is fully `left`, 1 is fully `right`.
 */
export const axisClaimSchema = z.object({
  kind: z.literal("axis"),
  /** e.g. "plot-driven" */
  left: z.string().min(1),
  /** e.g. "vibe-driven" */
  right: z.string().min(1),
  position: z.number().min(-1).max(1),
});
export type AxisClaim = z.infer<typeof axisClaimSchema>;

export const textClaimSchema = z.object({
  kind: z.enum(["obsession", "blind-spot", "seasonality"]),
  text: z.string().min(1),
});
export type TextClaim = z.infer<typeof textClaimSchema>;

export const portraitClaimSchema = z.discriminatedUnion("kind", [
  axisClaimSchema,
  textClaimSchema,
]);
export type PortraitClaim = z.infer<typeof portraitClaimSchema>;

/**
 * A thumbs-down on a claim. `claim` snapshots the rejected claim object
 * itself, so corrections outlive the synthesis that provoked them and axis
 * claims need no invented serialization. Every future synthesis receives all
 * corrections (E7.1) — an arguable model is a trusted model (PLAN §3).
 */
export const portraitCorrectionSchema = z.object({
  claim: portraitClaimSchema,
  note: z.string().min(1).optional(),
  at: isoTimestampSchema,
});
export type PortraitCorrection = z.infer<typeof portraitCorrectionSchema>;

/**
 * The taste model, written down. `version` is the key — monotonically
 * increasing, one row per synthesis (E7.1). `assignedCanon` records the
 * one-time calibration answer to "was it the books, or being made to read
 * them at sixteen?" (TASTE-BASELINE Finding 4) — asked exactly once, carried
 * forward across versions, respected by every synthesis.
 */
export const portraitSchema = z.object({
  version: z.number().int().min(1),
  synthesizedAt: isoTimestampSchema,
  claims: z.array(portraitClaimSchema),
  corrections: z.array(portraitCorrectionSchema),
  assignedCanon: z.enum(["the-books", "the-circumstance"]).optional(),
});
export type Portrait = z.infer<typeof portraitSchema>;
