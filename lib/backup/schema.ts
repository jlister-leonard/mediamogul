import { z } from "zod";
import {
  availabilitySchema,
  comparisonSchema,
  entrySchema,
  isoTimestampSchema,
  itemSchema,
  portraitSchema,
  queueItemSchema,
  recSchema,
  situationSchema,
} from "../types";

export const BACKUP_VERSION = 1 as const;

/**
 * The portable, versioned representation of Nightstand's entire local store.
 * Zod objects strip unknown keys by default. Keeping that default here and in
 * every nested contract lets a newer app add fields without making its backup
 * unreadable by an older app.
 */
export const backupSchema = z.object({
  version: z.literal(BACKUP_VERSION),
  exportedAt: isoTimestampSchema,
  data: z.object({
    items: z.array(itemSchema),
    entries: z.array(entrySchema),
    comparisons: z.array(comparisonSchema),
    queue: z.array(queueItemSchema),
    situations: z.array(situationSchema),
    availability: z.array(availabilitySchema),
    recs: z.array(recSchema),
    portrait: z.array(portraitSchema),
  }),
});

export type Backup = z.infer<typeof backupSchema>;

