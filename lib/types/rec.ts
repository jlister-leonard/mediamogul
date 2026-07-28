import { z } from "zod";
import {
  isoTimestampSchema,
  itemIdSchema,
  recIdSchema,
  situationIdSchema,
} from "./ids";

/**
 * The one-tap dismissal reasons (PLAN §4.3). Negative signal is the flywheel
 * — worth more than positive because it's where the model is wrong.
 * 'cant-get-it' is what makes recommendations availability-aware (PLAN §5).
 */
export const rejectionReasonSchema = z.enum([
  "seen-it",
  "too-long",
  "not-the-mood",
  "wrong-vibe",
  "bounced",
  "cant-get-it",
]);
export type RejectionReason = z.infer<typeof rejectionReasonSchema>;

/**
 * Which of the engine's three entry points dealt this rec (PLAN §4.4): the
 * default hand, a situation chip, or chat.
 */
export const recSourceSchema = z.discriminatedUnion("entry", [
  z.object({ entry: z.literal("hand") }),
  z.object({ entry: z.literal("situation"), situationId: situationIdSchema }),
  z.object({ entry: z.literal("chat") }),
]);
export type RecSource = z.infer<typeof recSourceSchema>;

/**
 * A dealt recommendation. `reason` is non-empty by contract: recommendations
 * cite *your* history or they don't ship (PLAN §10). A rejection persists
 * here with its reason and demonstrably alters the next taste-context (E6.6).
 */
export const recSchema = z.object({
  id: recIdSchema,
  itemId: itemIdSchema,
  /** One line, citing your history — "you ranked Bad Blood top of Money & Markets; this is the same reporter". */
  reason: z.string().min(1),
  source: recSourceSchema,
  dealtAt: isoTimestampSchema,
  rejection: z
    .object({
      reason: rejectionReasonSchema,
      at: isoTimestampSchema,
    })
    .optional(),
});
export type Rec = z.infer<typeof recSchema>;
