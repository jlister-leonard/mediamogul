import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  comparisonIdSchema,
  comparisonSchema,
  itemIdSchema,
  type Comparison,
  type Genre,
  type ItemId,
} from "../types";
import {
  DEFAULT_ELO_SCORE,
  MAX_ELO_SCORE,
  MIN_ELO_SCORE,
  isComfortLadder,
  replayGenreLadder,
  selectNextDuel,
  updateElo,
  type DuelCandidate,
  type LadderMember,
} from ".";

const fcOptions = { numRuns: 120, seed: 0x4e495445 } as const;

function itemId(value: string): ItemId {
  return itemIdSchema.parse(`item-${value}`);
}

function comparison(
  id: string,
  genre: Genre,
  winnerId: ItemId,
  loserId: ItemId,
  second: number,
): Comparison {
  return comparisonSchema.parse({
    id: comparisonIdSchema.parse(`comparison-${id}`),
    genre,
    winnerId,
    loserId,
    comparedAt: `2026-08-01T00:00:${String(second).padStart(2, "0")}.000Z`,
  });
}

describe("pairwise Elo", () => {
  it("updates a fair duel symmetrically", () => {
    expect(updateElo(DEFAULT_ELO_SCORE, DEFAULT_ELO_SCORE)).toEqual({
      winner: 1516,
      loser: 1484,
    });
  });

  it("moves a favorite less for an expected win and more for an upset", () => {
    const favoriteWins = updateElo(1800, 1200);
    const underdogWins = updateElo(1200, 1800);

    expect(favoriteWins.winner - 1800).toBeLessThan(
      underdogWins.winner - 1200,
    );
    expect(favoriteWins.winner - 1800).toBeCloseTo(0.981, 3);
    expect(underdogWins.winner - 1200).toBeCloseTo(31.019, 3);
  });

  it("preserves favorite-versus-upset information for generated unequal scores", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 400, max: 1400 }),
        fc.integer({ min: 1, max: 800 }),
        (underdog, gap) => {
          const favorite = underdog + gap;
          const expectedWin = updateElo(favorite, underdog);
          const upset = updateElo(underdog, favorite);

          expect(expectedWin.winner - favorite).toBeLessThan(
            upset.winner - underdog,
          );
        },
      ),
      fcOptions,
    );
  });

  it("keeps every generated finite result inside the product bounds", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true }),
        fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true }),
        (winner, loser) => {
          const result = updateElo(winner, loser);
          expect(result.winner).toBeGreaterThanOrEqual(MIN_ELO_SCORE);
          expect(result.winner).toBeLessThanOrEqual(MAX_ELO_SCORE);
          expect(result.loser).toBeGreaterThanOrEqual(MIN_ELO_SCORE);
          expect(result.loser).toBeLessThanOrEqual(MAX_ELO_SCORE);
        },
      ),
      fcOptions,
    );
  });

  it("rejects non-finite scores and invalid K factors", () => {
    expect(() => updateElo(Number.NaN, 1500)).toThrow(RangeError);
    expect(() => updateElo(1500, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => updateElo(1500, 1500, 0)).toThrow(RangeError);
  });
});

describe("genre replay", () => {
  const genre: Genre = "business-strategy";
  const a = itemId("a");
  const b = itemId("b");
  const c = itemId("c");
  const members: LadderMember[] = [a, b, c].map((id) => ({
    itemId: id,
    genre,
  }));

  it("develops the expected transitive tendency under repeated evidence", () => {
    fc.assert(
      fc.property(fc.integer({ min: 8, max: 25 }), (rounds) => {
        const log: Comparison[] = [];
        for (let round = 0; round < rounds; round += 1) {
          log.push(comparison(`${round}-ab`, genre, a, b, round * 2));
          log.push(comparison(`${round}-bc`, genre, b, c, round * 2 + 1));
        }
        const scores = replayGenreLadder(genre, members, log);
        expect(scores.get(a)).toBeGreaterThan(scores.get(b)!);
        expect(scores.get(b)).toBeGreaterThan(scores.get(c)!);
      }),
      fcOptions,
    );
  });

  it("is deterministic even when the supplied log arrives out of order", () => {
    const log = [
      comparison("later", genre, b, a, 2),
      comparison("earlier", genre, a, b, 1),
    ];
    expect(replayGenreLadder(genre, members, log)).toEqual(
      replayGenreLadder(genre, members, [...log].reverse()),
    );
  });

  it("fails closed for cross-genre, unknown, and duplicate participants", () => {
    expect(() =>
      replayGenreLadder(genre, members, [
        comparison("wrong", "money-markets", a, b, 1),
      ]),
    ).toThrow(/Cannot replay money-markets/);
    expect(() =>
      replayGenreLadder(genre, members, [
        comparison("unknown", genre, a, itemId("unknown"), 1),
      ]),
    ).toThrow(/outside its genre pool/);
    expect(() => replayGenreLadder(genre, [...members, members[0]], [])).toThrow(
      /Duplicate ladder member/,
    );
  });

  it("handles empty and one-title pools without inventing evidence", () => {
    expect(replayGenreLadder(genre, [], [])).toEqual(new Map());
    expect(replayGenreLadder(genre, [members[0]], [])).toEqual(
      new Map([[a, DEFAULT_ELO_SCORE]]),
    );
  });
});

describe("next-duel selection", () => {
  const genre: Genre = "literary-fiction";
  const candidate = (
    id: string,
    score: number,
    priorRating?: number,
    candidateGenre: Genre = genre,
  ): DuelCandidate => ({
    itemId: itemId(id),
    genre: candidateGenre,
    score,
    priorRating,
  });

  it("resolves the crowded 4-5 band before lower-rated titles", () => {
    const chosen = selectNextDuel(genre, [
      candidate("three", 1500, 3),
      candidate("five-a", 1400, 5),
      candidate("five-b", 1600, 5),
      candidate("three-close", 1501, 3),
    ]);
    expect(chosen).toEqual({
      genre,
      leftId: itemId("five-a"),
      rightId: itemId("five-b"),
    });
  });

  it("chooses adjacent close scores, then avoids repeats only at equal closeness", () => {
    const candidates = [
      candidate("a", 1400),
      candidate("b", 1499),
      candidate("c", 1500),
      candidate("d", 1501),
    ];
    expect(selectNextDuel(genre, candidates)).toMatchObject({
      leftId: itemId("b"),
      rightId: itemId("c"),
    });

    const history = [comparison("bc", genre, itemId("b"), itemId("c"), 1)];
    expect(selectNextDuel(genre, candidates, history)).toMatchObject({
      leftId: itemId("c"),
      rightId: itemId("d"),
    });
  });

  it("keeps a repeated near pair ahead of an uninformative distant pair", () => {
    const candidates = [
      candidate("near-a", 1000),
      candidate("near-b", 1001),
      candidate("distant", 2000),
    ];
    const history = [
      comparison("near", genre, itemId("near-a"), itemId("near-b"), 1),
    ];

    expect(selectNextDuel(genre, candidates, history)).toEqual({
      genre,
      leftId: itemId("near-a"),
      rightId: itemId("near-b"),
    });
  });

  it("uses stable ids to break arbitrary input-order ties", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray(["c", "a", "b"], { minLength: 3 }), (ids) => {
        const candidates = ids.map((id) => candidate(id, 1500, 5));
        expect(selectNextDuel(genre, candidates)).toEqual({
          genre,
          leftId: itemId("a"),
          rightId: itemId("b"),
        });
      }),
      fcOptions,
    );
  });

  it("never crosses genres or either comfort decision pool", () => {
    const chosen = selectNextDuel("comfort-childhood", [
      candidate("child-a", 1500, 5, "comfort-childhood"),
      candidate("child-b", 1501, 5, "comfort-childhood"),
      candidate("rewatch", 1500, 5, "comfort-rewatch"),
      candidate("serious", 1500, 5, "literary-fiction"),
    ]);
    expect(chosen).toEqual({
      genre: "comfort-childhood",
      leftId: itemId("child-a"),
      rightId: itemId("child-b"),
    });
    expect(isComfortLadder("comfort-childhood")).toBe(true);
    expect(isComfortLadder("comfort-rewatch")).toBe(true);
    expect(isComfortLadder("literary-fiction")).toBe(false);
  });

  it("keeps every generated mixed-corpus decision inside its requested genre", () => {
    const genres = [
      "literary-fiction",
      "money-markets",
      "comfort-childhood",
      "comfort-rewatch",
    ] as const satisfies readonly Genre[];
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: genres.length - 1 }), {
          minLength: 2,
          maxLength: 30,
        }),
        (genreIndexes) => {
          const target: Genre = "literary-fiction";
          const candidates = genreIndexes.map((genreIndex, index) =>
            candidate(
              `generated-${index}`,
              1200 + index * 7,
              index % 5 + 1,
              genres[genreIndex],
            ),
          );
          // Guarantee a selectable target pool while retaining arbitrary
          // noise from other regular and comfort ladders.
          candidates.push(candidate("target-a", 1500, 5, target));
          candidates.push(candidate("target-b", 1501, 4, target));

          const selected = selectNextDuel(target, candidates);
          const byId = new Map(candidates.map((value) => [value.itemId, value]));
          expect(byId.get(selected!.leftId)?.genre).toBe(target);
          expect(byId.get(selected!.rightId)?.genre).toBe(target);
        },
      ),
      fcOptions,
    );
  });

  it("returns no duel for empty and one-title pools", () => {
    expect(selectNextDuel(genre, [])).toBeNull();
    expect(selectNextDuel(genre, [candidate("only", 1500)])).toBeNull();
  });

  it("rejects invalid candidate evidence and duplicate ids", () => {
    expect(() => selectNextDuel(genre, [candidate("a", Number.NaN), candidate("b", 1)])).toThrow(
      RangeError,
    );
    expect(() => selectNextDuel(genre, [candidate("a", 1, 6), candidate("b", 2)])).toThrow(
      RangeError,
    );
    expect(() => selectNextDuel(genre, [candidate("a", 1), candidate("a", 2)])).toThrow(
      /Duplicate duel candidate/,
    );

    for (const duelCount of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expect(() =>
        selectNextDuel(genre, [
          { ...candidate("a", 1), duelCount },
          candidate("b", 2),
        ]),
      ).toThrow(/duelCount.*nonnegative integer/);
    }
  });
});
