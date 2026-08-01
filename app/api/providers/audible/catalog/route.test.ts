// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));
vi.mock("../../../../../lib/availability/audible", () => ({
  searchAudibleCatalog: searchMock,
}));
import { POST } from "./route";

describe("POST /api/providers/audible/catalog", () => {
  beforeEach(() => searchMock.mockReset());

  it("passes only validated title identity to the server-side catalog lookup", async () => {
    searchMock.mockResolvedValue({ ok: true, product: {
      asin: "B07C8GVTB5",
      title: "Bad Blood",
      authors: [{ name: "John Carreyrou" }],
    } });
    const response = await POST(new Request("http://test/api/providers/audible/catalog", {
      method: "POST",
      body: JSON.stringify({
        title: "Bad Blood",
        creators: ["John Carreyrou"],
        library: ["must be stripped"],
        notes: "must be stripped",
      }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(searchMock).toHaveBeenCalledOnce();
    expect(searchMock.mock.calls[0][0]).toMatchObject({
      title: "Bad Blood",
      creators: ["John Carreyrou"],
    });
    expect(searchMock.mock.calls[0][0]).not.toHaveProperty("library");
    expect(searchMock.mock.calls[0][0]).not.toHaveProperty("notes");
  });

  it("rejects invalid input before any upstream work", async () => {
    const response = await POST(new Request("http://test/api/providers/audible/catalog", {
      method: "POST",
      body: JSON.stringify({ title: "", creators: [] }),
    }));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(searchMock).not.toHaveBeenCalled();
  });
});
