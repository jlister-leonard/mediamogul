import { z } from "zod";
import { searchAudibleCatalog } from "../../../../../lib/availability/audible";
import { itemSchema } from "../../../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  title: z.string().trim().min(1).max(500),
  creators: z.array(z.string().trim().min(1).max(300)).min(1).max(20),
});
const RESPONSE_HEADERS = { "cache-control": "private, no-store" } as const;

/** Server-side catalog proxy: receives title identity only, never library data. */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, code: "catalog-invalid", message: "Body must be JSON." },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, code: "catalog-invalid", message: "Title and creators are required." },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }
  const book = itemSchema.parse({
    id: "audible-proxy-item",
    medium: "book",
    title: parsed.data.title,
    creators: parsed.data.creators,
    ref: { medium: "book", openLibraryId: "audible-proxy" },
  });
  if (book.medium !== "book") {
    return Response.json(
      { ok: false, code: "catalog-invalid", message: "Invalid book identity." },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }
  const result = await searchAudibleCatalog(book);
  return Response.json(result, {
    status: result.ok ? 200 : 502,
    headers: RESPONSE_HEADERS,
  });
}
