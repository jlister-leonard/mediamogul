import { describe, expect, it, vi } from "vitest";
import { itemSchema, type Item } from "../types";
import fixture from "./fixtures/audible-bad-blood.json";
import { searchAudibleCatalog } from "./audible";

const book = itemSchema.parse({
  id: "item-bad-blood",
  medium: "book",
  title: "Bad Blood",
  creators: ["John Carreyrou"],
  ref: { medium: "book", isbn13: "9781524731656" },
}) as Extract<Item, { medium: "book" }>;

describe("Audible catalog evidence", () => {
  it("accepts the one strict title+complete-author match in the captured live response", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => Response.json(fixture));

    const result = await searchAudibleCatalog(book, fetchFn);

    expect(result).toMatchObject({
      ok: true,
      product: { asin: "B07C8GVTB5", title: "Bad Blood" },
    });
    const url = new URL(String(fetchFn.mock.calls[0][0]));
    expect(url.hostname).toBe("api.audible.com");
    expect(url.searchParams.get("title")).toBe("Bad Blood");
    expect(url.searchParams.get("author")).toBe("John Carreyrou");
    // The live endpoint ignored this filter, so it must never be sent as proof.
    expect(url.searchParams.has("isbn")).toBe(false);
  });

  it("rejects an unrelated result and refuses two equally exact matches", async () => {
    const unrelated = {
      products: [{
        asin: "WRONG",
        title: "Bad Blood",
        authors: [{ name: "Someone Else" }],
      }],
    };
    expect(
      await searchAudibleCatalog(book, async () => Response.json(unrelated)),
    ).toEqual({ ok: true });

    const duplicate = { products: [fixture.products[0], fixture.products[0]] };
    expect(
      await searchAudibleCatalog(book, async () => Response.json(duplicate)),
    ).toEqual({ ok: true });
  });

  it("reports transport and malformed-payload failures without inferring availability", async () => {
    expect(
      await searchAudibleCatalog(book, async () => { throw new Error("offline"); }),
    ).toMatchObject({ ok: false, code: "catalog-unavailable" });
    expect(
      await searchAudibleCatalog(book, async () => Response.json({ nope: [] })),
    ).toMatchObject({ ok: false, code: "catalog-invalid" });
  });
});
