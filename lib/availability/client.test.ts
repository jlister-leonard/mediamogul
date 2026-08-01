import { describe, expect, it, vi } from "vitest";
import { itemSchema, type BookItem } from "../types";
import { fetchAudibleCatalog } from "./client";

const badBlood = itemSchema.parse({
  id: "book-bad-blood",
  medium: "book",
  title: "Bad Blood",
  creators: ["John Carreyrou"],
  ref: { medium: "book", isbn13: "9781524731656" },
}) as BookItem;
const empireOfPain = itemSchema.parse({
  id: "book-empire-of-pain",
  medium: "book",
  title: "Empire of Pain",
  creators: ["Patrick Radden Keefe"],
  ref: { medium: "book", isbn13: "9780385545686" },
}) as BookItem;

describe("browser Audible proxy adapter", () => {
  it("POSTs every title independently and rejects a response for the previous title", async () => {
    const requestBodies: unknown[] = [];
    const requestMethods: Array<string | undefined> = [];
    const requestCaches: Array<RequestCache | undefined> = [];
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      requestMethods.push(init?.method);
      requestCaches.push(init?.cache);
      return Response.json({
      ok: true,
      product: {
        asin: "B07C8GVTB5",
        title: "Bad Blood",
        authors: [{ name: "John Carreyrou" }],
      },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAudibleCatalog(badBlood)).resolves.toMatchObject({
      ok: true,
      product: { title: "Bad Blood" },
    });
    await expect(fetchAudibleCatalog(empireOfPain)).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBodies).toEqual([
      { title: "Bad Blood", creators: ["John Carreyrou"] },
      { title: "Empire of Pain", creators: ["Patrick Radden Keefe"] },
    ]);
    expect(requestMethods).toEqual(["POST", "POST"]);
    expect(requestCaches).toEqual(["no-store", "no-store"]);
  });
});
