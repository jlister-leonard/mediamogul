import { z } from "zod";
import { isoTimestampSchema, situationIdSchema } from "./ids";

/**
 * A saved opening for the Recommendations engine (PLAN §4.4) — either a
 * built-in chip ("45 min before bed", "movies in theaters now") or saved from
 * a chat answer that worked (E6.4 → E6.5). What "worked" is not stored here:
 * it is derived from Recs carrying this situation's id, so the situation
 * learns without duplicating state.
 */
export const situationSourceSchema = z.enum(["built-in", "chat"]);
export type SituationSource = z.infer<typeof situationSourceSchema>;

export const situationSchema = z.object({
  id: situationIdSchema,
  /** Chip text — short enough to tap. */
  label: z.string().min(1),
  /** The full ask handed to the engine; for chat-saved situations, richer than the label. */
  prompt: z.string().min(1),
  source: situationSourceSchema,
  createdAt: isoTimestampSchema,
});
export type Situation = z.infer<typeof situationSchema>;
