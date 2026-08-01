import {
  COMFORT_GENRES,
  type Comparison,
  type Genre,
  type ItemId,
} from "../types";

export const DEFAULT_ELO_SCORE = 1500;
export const MIN_ELO_SCORE = 0;
export const MAX_ELO_SCORE = 3000;
export const DEFAULT_K_FACTOR = 32;

export interface EloResult {
  winner: number;
  loser: number;
}

export interface LadderMember {
  itemId: ItemId;
  genre: Genre;
}

export interface DuelCandidate extends LadderMember {
  /** Current replayed standing. An untested title begins at 1500. */
  score?: number;
  /** Imported 1-5 rating, used only to resolve the crowded 4-5 cold start. */
  priorRating?: number;
  /** Total prior decisions involving this title, for under-tested tie breaks. */
  duelCount?: number;
}

export interface DuelPair {
  genre: Genre;
  leftId: ItemId;
  rightId: ItemId;
}

function assertFiniteScore(score: number, label: string): void {
  if (!Number.isFinite(score)) {
    throw new RangeError(`${label} must be a finite Elo score`);
  }
}

function clampScore(score: number): number {
  return Math.min(MAX_ELO_SCORE, Math.max(MIN_ELO_SCORE, score));
}

/**
 * Apply one decisive Elo result. Bounds keep corrupt or very long histories
 * from producing Infinity while preserving standard 400-point Elo odds.
 */
export function updateElo(
  winnerScore: number,
  loserScore: number,
  kFactor = DEFAULT_K_FACTOR,
): EloResult {
  assertFiniteScore(winnerScore, "winnerScore");
  assertFiniteScore(loserScore, "loserScore");
  if (!Number.isFinite(kFactor) || kFactor <= 0) {
    throw new RangeError("kFactor must be finite and greater than zero");
  }

  const boundedWinner = clampScore(winnerScore);
  const boundedLoser = clampScore(loserScore);
  const expectedWinner =
    1 / (1 + 10 ** ((boundedLoser - boundedWinner) / 400));
  const change = kFactor * (1 - expectedWinner);

  return {
    winner: clampScore(boundedWinner + change),
    loser: clampScore(boundedLoser - change),
  };
}

/**
 * Replay the append-only comparison log for exactly one genre. Bad history
 * fails closed: a comparison cannot silently borrow a title from another
 * ladder, including either comfort ladder.
 */
export function replayGenreLadder(
  genre: Genre,
  members: readonly LadderMember[],
  comparisons: readonly Comparison[],
): ReadonlyMap<ItemId, number> {
  const memberIds = new Set<ItemId>();
  for (const member of members) {
    if (member.genre !== genre) {
      throw new Error(
        `Cannot replay ${genre} with ${member.itemId} from ${member.genre}`,
      );
    }
    if (memberIds.has(member.itemId)) {
      throw new Error(`Duplicate ladder member: ${member.itemId}`);
    }
    memberIds.add(member.itemId);
  }

  const scores = new Map<ItemId, number>();
  for (const itemId of memberIds) scores.set(itemId, DEFAULT_ELO_SCORE);

  const ordered = [...comparisons].sort(
    (a, b) =>
      a.comparedAt.localeCompare(b.comparedAt) || a.id.localeCompare(b.id),
  );
  for (const comparison of ordered) {
    if (comparison.genre !== genre) {
      throw new Error(
        `Cannot replay ${comparison.genre} comparison on ${genre} ladder`,
      );
    }
    const winnerScore = scores.get(comparison.winnerId);
    const loserScore = scores.get(comparison.loserId);
    if (winnerScore === undefined || loserScore === undefined) {
      throw new Error("Comparison references an item outside its genre pool");
    }
    const updated = updateElo(winnerScore, loserScore);
    scores.set(comparison.winnerId, updated.winner);
    scores.set(comparison.loserId, updated.loser);
  }

  return scores;
}

function pairKey(a: ItemId, b: ItemId): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function validCandidateScore(candidate: DuelCandidate): number {
  const score = candidate.score ?? DEFAULT_ELO_SCORE;
  assertFiniteScore(score, `score for ${candidate.itemId}`);
  return clampScore(score);
}

function assertValidDuelCount(candidate: DuelCandidate): void {
  if (
    candidate.duelCount !== undefined &&
    (!Number.isFinite(candidate.duelCount) ||
      !Number.isInteger(candidate.duelCount) ||
      candidate.duelCount < 0)
  ) {
    throw new RangeError(
      `duelCount for ${candidate.itemId} must be a nonnegative integer`,
    );
  }
}

function isCrowdedBand(candidate: DuelCandidate): boolean {
  return candidate.priorRating !== undefined && candidate.priorRating >= 4;
}

/**
 * Choose the next high-information decision for one ladder. During imported
 * cold start, two 4-5 rated titles win priority. Within that pool only
 * adjacent scores are eligible; the least-repeated closest pair wins, with
 * stable item ids providing deterministic final tie-breaking.
 */
export function selectNextDuel(
  genre: Genre,
  candidates: readonly DuelCandidate[],
  history: readonly Comparison[] = [],
): DuelPair | null {
  const inGenre = candidates.filter((candidate) => candidate.genre === genre);
  const ids = new Set<ItemId>();
  for (const candidate of inGenre) {
    if (ids.has(candidate.itemId)) {
      throw new Error(`Duplicate duel candidate: ${candidate.itemId}`);
    }
    ids.add(candidate.itemId);
    validCandidateScore(candidate);
    assertValidDuelCount(candidate);
    if (
      candidate.priorRating !== undefined &&
      (!Number.isFinite(candidate.priorRating) ||
        candidate.priorRating < 1 ||
        candidate.priorRating > 5)
    ) {
      throw new RangeError(`priorRating for ${candidate.itemId} must be 1-5`);
    }
  }
  if (inGenre.length < 2) return null;

  const crowded = inGenre.filter(isCrowdedBand);
  const pool = crowded.length >= 2 ? crowded : inGenre;
  const ordered = [...pool].sort(
    (a, b) =>
      validCandidateScore(a) - validCandidateScore(b) ||
      a.itemId.localeCompare(b.itemId),
  );

  const repeatCounts = new Map<string, number>();
  for (const comparison of history) {
    if (comparison.genre !== genre) continue;
    const key = pairKey(comparison.winnerId, comparison.loserId);
    repeatCounts.set(key, (repeatCounts.get(key) ?? 0) + 1);
  }

  const adjacent = ordered.slice(0, -1).map((left, index) => {
    const right = ordered[index + 1];
    return {
      left,
      right,
      repeats: repeatCounts.get(pairKey(left.itemId, right.itemId)) ?? 0,
      gap: Math.abs(validCandidateScore(left) - validCandidateScore(right)),
      exposure: (left.duelCount ?? 0) + (right.duelCount ?? 0),
    };
  });
  adjacent.sort(
    (a, b) =>
      a.gap - b.gap ||
      a.repeats - b.repeats ||
      a.exposure - b.exposure ||
      a.left.itemId.localeCompare(b.left.itemId) ||
      a.right.itemId.localeCompare(b.right.itemId),
  );

  const best = adjacent[0];
  return { genre, leftId: best.left.itemId, rightId: best.right.itemId };
}

export function isComfortLadder(genre: Genre): boolean {
  return (COMFORT_GENRES as readonly Genre[]).includes(genre);
}
