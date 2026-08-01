import { z } from "zod";
import type { BookItem } from "../types";

const audibleProductSchema = z.object({
  asin: z.string().min(1),
  title: z.string().min(1),
  authors: z.array(z.object({ name: z.string().min(1) })),
});

const audibleCatalogSchema = z.object({
  products: z.array(z.unknown()),
});

export interface AudibleProduct {
  asin: string;
  title: string;
  authors: readonly { name: string }[];
}

export type AudibleCatalogResult =
  | { ok: true; product?: AudibleProduct }
  | { ok: false; code: "catalog-unavailable" | "catalog-invalid"; message: string };

/**
 * Query Audible's own public catalog host and accept exactly one strict
 * title+complete-author-set match. The live endpoint ignored ISBN filters,
 * so ISBN is deliberately not sent or trusted as evidence.
 */
export async function searchAudibleCatalog(
  book: BookItem,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<AudibleCatalogResult> {
  const url = new URL("https://api.audible.com/1.0/catalog/products");
  url.searchParams.set("num_results", "10");
  url.searchParams.set("title", book.title);
  if (book.creators[0] !== undefined) {
    url.searchParams.set("author", book.creators[0]);
  }
  url.searchParams.set(
    "response_groups",
    "contributors,product_desc,product_extended_attrs",
  );

  let response: Response;
  try {
    response = await fetchFn(url, { signal: AbortSignal.timeout(8_000) });
  } catch {
    return {
      ok: false,
      code: "catalog-unavailable",
      message: "Audible catalog did not respond.",
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      code: "catalog-unavailable",
      message: `Audible catalog responded with status ${response.status}.`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: "catalog-invalid", message: "Audible returned non-JSON." };
  }
  const parsed = audibleCatalogSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      code: "catalog-invalid",
      message: "Audible returned an unexpected catalog payload.",
    };
  }

  const matches = parsed.data.products.flatMap((raw) => {
    const product = audibleProductSchema.safeParse(raw);
    return product.success && matchesAudibleIdentity(book, product.data)
      ? [product.data]
      : [];
  });
  return matches.length === 1 ? { ok: true, product: matches[0] } : { ok: true };
}

export function matchesAudibleIdentity(
  book: BookItem,
  product: AudibleProduct,
): boolean {
  const expectedTitles = new Set([
    normalize(book.title),
    ...(book.subtitle ? [normalize(`${book.title}: ${book.subtitle}`)] : []),
  ]);
  if (!expectedTitles.has(normalize(product.title))) return false;
  const expectedAuthors = [...new Set(book.creators.map(normalize))].sort();
  const actualAuthors = [...new Set(product.authors.map((author) => normalize(author.name)))].sort();
  return (
    expectedAuthors.length > 0 &&
    expectedAuthors.length === actualAuthors.length &&
    expectedAuthors.every((author, index) => author === actualAuthors[index])
  );
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
