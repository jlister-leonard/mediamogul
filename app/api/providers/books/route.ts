import {
  bookQuerySchema,
  getBooksProvider,
  type BooksError,
  type BooksResult,
} from "../../../../lib/providers/books";
import { z } from "zod";

/**
 * E2.1 — stateless book-search proxy. `GET ?q=`/`?title=`/`?author=` for
 * search, `?isbn=` for the 0-or-1 ISBN-13 lookup (E1.4). All logic lives in
 * lib/providers/books.ts; this handler only parses params, picks a status
 * code, and sets cache headers. Every response — including every failure —
 * is a typed JSON envelope, never an HTML error page.
 */

/**
 * Results are shareable public metadata. Edge/CDN may hold them for a day
 * and revalidate in the background for a week; clients re-check after 5
 * minutes. Identical queries also short-circuit in the provider's own LRU,
 * so even revalidations rarely reach the upstreams.
 */
const SUCCESS_CACHE_CONTROL =
  "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800";

function json(result: BooksResult, status: number): Response {
  return Response.json(result, {
    status,
    headers: {
      "cache-control": result.ok ? SUCCESS_CACHE_CONTROL : "no-store",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const parsed = bookQuerySchema.safeParse({
      q: params.get("q") ?? undefined,
      title: params.get("title") ?? undefined,
      author: params.get("author") ?? undefined,
      isbn: params.get("isbn") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      const error: BooksError = {
        ok: false,
        error: {
          code: "bad_request",
          message: z.prettifyError(parsed.error),
        },
      };
      return json(error, 400);
    }

    const result = await getBooksProvider().search(parsed.data);
    if (result.ok) return json(result, 200);
    return json(result, result.error.code === "bad_request" ? 400 : 502);
  } catch (error) {
    // Unreachable by design (the provider never throws) — but if it ever
    // does, degrade to the typed envelope rather than a framework 500 page.
    const envelope: BooksError = {
      ok: false,
      error: {
        code: "upstream_unavailable",
        message: error instanceof Error ? error.message : String(error),
      },
    };
    return json(envelope, 502);
  }
}
