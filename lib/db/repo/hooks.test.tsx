// `fake-indexeddb/auto` MUST be the first import — see repo.test.ts.
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ItemId, ItemSeed } from "../../types";
import { db } from "../index";
import {
  addItem,
  addToQueue,
  finishEntry,
  refreshAvailabilityForItem,
  removeFromQueue,
  setItemGenre,
  startEntry,
} from "./index";
import {
  useAvailabilityByItemId,
  useEntriesByItemId,
  useEntriesByStatus,
  useItem,
  useItems,
  useItemsByGenre,
  useItemsByMedium,
  useOpenEntry,
  useQueue,
  useQueueItem,
} from "./hooks";

/**
 * The hooks are thin `useLiveQuery` wrappers, so each test asserts the two
 * things that are actually theirs: the value matches the repo function, and a
 * write made anywhere else repaints it without a re-render from the caller.
 */

// Vitest globals are off, so testing-library's automatic cleanup never hooks in.
afterEach(cleanup);

const bookSeed = {
  medium: "book",
  title: "Bad Blood",
  creators: ["John Carreyrou"],
  ref: { medium: "book", isbn13: "9781524731656" },
} satisfies ItemSeed;

const movieSeed = {
  medium: "movie",
  title: "The Social Network",
  creators: ["David Fincher"],
  ref: { medium: "movie", tmdbId: 37799 },
} satisfies ItemSeed;

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

afterAll(() => {
  db.close();
});

describe("useItem", () => {
  it("resolves the item and repaints when it changes", async () => {
    const book = await addItem(bookSeed);
    const { result } = renderHook(() => useItem(book.id));

    expect(result.current).toBeUndefined(); // first query not resolved yet
    await waitFor(() => expect(result.current).toEqual(book));

    await act(async () => {
      await setItemGenre(book.id, { genre: "money-markets", source: "auto" });
    });
    await waitFor(() =>
      expect(result.current?.genre).toEqual({
        genre: "money-markets",
        source: "auto",
      }),
    );
  });

  it("resolves to null — not a permanent undefined — for an id that is not there", async () => {
    const { result } = renderHook(() => useItem("item-nope" as ItemId));

    // `undefined` is the loading tick; `null` is the answer. E3.3 renders a
    // skeleton on the first and "no such item" on the second, so a deleted id
    // can never spin forever.
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBeNull());
  });
});

describe("useItems / useItemsByMedium / useItemsByGenre", () => {
  it("tracks the whole library (E3.4 search, E6.2 briefing)", async () => {
    const { result } = renderHook(() => useItems());
    await waitFor(() => expect(result.current).toEqual([]));

    await act(async () => {
      await addItem(bookSeed);
      await addItem(movieSeed);
    });

    await waitFor(() => expect(result.current).toHaveLength(2));
  });

  it("tracks additions to one medium's shelf", async () => {
    const { result } = renderHook(() => useItemsByMedium("book"));
    await waitFor(() => expect(result.current).toEqual([]));

    let book!: Awaited<ReturnType<typeof addItem>>;
    await act(async () => {
      book = await addItem(bookSeed);
      await addItem(movieSeed);
    });

    await waitFor(() => expect(result.current).toEqual([book]));
  });

  it("tracks a ladder's pool as items are assigned", async () => {
    const book = await addItem(bookSeed);
    const { result } = renderHook(() => useItemsByGenre("money-markets"));
    await waitFor(() => expect(result.current).toEqual([]));

    await act(async () => {
      await setItemGenre(book.id, { genre: "money-markets", source: "auto" });
    });

    await waitFor(() => expect(result.current).toHaveLength(1));
  });
});

describe("useEntriesByStatus / useEntriesByItemId / useOpenEntry", () => {
  it("moves an entry from the nightstand to the drawer as it is finished", async () => {
    const book = await addItem(bookSeed);
    const open = renderHook(() => useEntriesByStatus("in-progress"));
    const drawer = renderHook(() => useEntriesByStatus("finished"));
    await waitFor(() => expect(open.result.current).toEqual([]));

    let entry!: Awaited<ReturnType<typeof startEntry>>;
    await act(async () => {
      entry = await startEntry(book.id);
    });
    await waitFor(() => expect(open.result.current).toHaveLength(1));
    expect(drawer.result.current).toEqual([]);

    await act(async () => {
      await finishEntry(entry.id);
    });
    await waitFor(() => expect(drawer.result.current).toHaveLength(1));
    expect(open.result.current).toEqual([]);
  });

  it("lists an item's entries and tracks whether one is open", async () => {
    const book = await addItem(bookSeed);
    const all = renderHook(() => useEntriesByItemId(book.id));
    const openOne = renderHook(() => useOpenEntry(book.id));
    await waitFor(() => expect(all.result.current).toEqual([]));
    await waitFor(() => expect(openOne.result.current).toBeNull());

    let entry!: Awaited<ReturnType<typeof startEntry>>;
    await act(async () => {
      entry = await startEntry(book.id);
    });
    await waitFor(() => expect(openOne.result.current?.id).toBe(entry.id));
    expect(all.result.current).toHaveLength(1);

    await act(async () => {
      await finishEntry(entry.id);
    });
    // The log survives; only the "open" read goes empty.
    await waitFor(() => expect(openOne.result.current).toBeNull());
    expect(all.result.current).toHaveLength(1);
  });
});

describe("useAvailabilityByItemId", () => {
  it("repaints when a refresh lands", async () => {
    const movie = await addItem(movieSeed);
    const { result } = renderHook(() => useAvailabilityByItemId(movie.id));
    await waitFor(() => expect(result.current).toEqual([]));

    await act(async () => {
      await refreshAvailabilityForItem(movie.id, [
        {
          itemId: movie.id,
          region: "US",
          kind: "theater",
          fetchedAt: new Date().toISOString(),
        },
      ]);
    });

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current?.[0].kind).toBe("theater");
  });
});

describe("useQueue / useQueueItem", () => {
  it("tracks the stack and one item's place on it", async () => {
    const book = await addItem(bookSeed);
    const stack = renderHook(() => useQueue());
    const one = renderHook(() => useQueueItem(book.id));
    await waitFor(() => expect(stack.result.current).toEqual([]));
    await waitFor(() => expect(one.result.current).toBeNull());

    let row!: Awaited<ReturnType<typeof addToQueue>>;
    await act(async () => {
      row = await addToQueue({ itemId: book.id, contextTags: ["flight"] });
    });
    await waitFor(() => expect(stack.result.current).toEqual([row]));
    expect(one.result.current).toEqual(row);

    await act(async () => {
      await removeFromQueue(row.id);
    });
    await waitFor(() => expect(stack.result.current).toEqual([]));
    await waitFor(() => expect(one.result.current).toBeNull());
  });
});
