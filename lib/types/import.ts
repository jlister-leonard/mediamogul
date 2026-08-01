import { z } from "zod";
import { isoTimestampSchema } from "./ids";

/** A Goodreads row retained verbatim enough to finish a failed catalog match. */
export const goodreadsImportSourceSchema = z.object({
  rowNumber: z.number().int().positive(),
  bookId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  authors: z.array(z.string().trim().min(1)).min(1),
  isbn10: z.string().optional(),
  isbn13: z.string().optional(),
  invalidIsbns: z.array(z.string()),
  rating: z.union([
    z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5),
  ]).optional(),
  pages: z.number().int().positive().optional(),
  yearPublished: z.number().int().optional(),
  originalPublicationYear: z.number().int().optional(),
  dateRead: isoTimestampSchema.optional(),
  dateAdded: isoTimestampSchema,
  shelves: z.array(z.string()),
  shelfPositions: z.record(z.string(), z.number().int().nonnegative()),
  exclusiveShelf: z.string().min(1),
  review: z.string().optional(),
  privateNotes: z.string().optional(),
  readCount: z.number().int().nonnegative(),
});
export type GoodreadsImportSource = z.infer<typeof goodreadsImportSourceSchema>;

export const goodreadsSuggestedQuerySchema = z
  .object({
    q: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).optional(),
    author: z.string().trim().min(1).optional(),
    isbn: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .refine((query) => Object.keys(query).some((key) => key !== "limit"), {
    message: "a suggested query needs a search term",
  });

export const goodreadsManualMatchReasonSchema = z.enum([
  "no-match",
  "ambiguous-match",
  "missing-cover",
  "provider-error",
]);

/** Durable manual work created by E1.4; `id` is `goodreads:<bookId>`. */
export const goodreadsManualMatchSchema = z
  .object({
    id: z.string().startsWith("goodreads:").min(11),
    source: goodreadsImportSourceSchema,
    reason: goodreadsManualMatchReasonSchema,
    detail: z.string().min(1),
    suggestedQuery: goodreadsSuggestedQuerySchema,
  })
  .refine((match) => match.id === `goodreads:${match.source.bookId}`, {
    path: ["id"],
    message: "manual match id must correspond to its Goodreads book id",
  });
export type GoodreadsManualMatch = z.infer<typeof goodreadsManualMatchSchema>;
export type GoodreadsManualMatchReason = z.infer<
  typeof goodreadsManualMatchReasonSchema
>;
