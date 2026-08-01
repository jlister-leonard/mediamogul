import type { Genre } from "../../types";

/**
 * Human-reviewed audit of the 225 Goodreads rows, in source order. Labels
 * were assigned from the titles/authors and TASTE-BASELINE's eight proposed
 * ladders before exercising the classifier. The Book-ID sequence hash makes
 * a source reorder fail instead of silently misaligning this evidence.
 */
export const GOODREADS_BOOK_ID_SHA256 =
  "59c6324b5f6503f046d6e6c675e4b407cae453a21921d0c55e359b23cde9e943";

const genreByCode = {
  B: "business-strategy",
  M: "money-markets",
  L: "lives",
  P: "mind-mastery",
  G: "grit-wilderness",
  F: "literary-fiction",
  N: "genre-fiction",
  C: "comfort-childhood",
} as const satisfies Record<string, Genre>;

const codes = `
P P B B B B B P P P B B P P P P P P P P M P P M L
B P P M B B M M P P P M L P P B B P G P M M M B M
P P B M P P P M M M B P M L L B P M L F P F P M P
B B M L L F P M L P B P L B M M P M P P G P F P B
L P B L L M P M B M N N N F N F F F F C B P F L F
M M F P B P M P B P B B P M M P F M P N F N F N N
F C F C M B G P B B P L N G P P L L F N P M L B M
P F F F F L C C C C C C C F F C C C C C C C F F F
F G F G G F F F F F F F P G F N P F F L M F F F P
`.trim().split(/\s+/);

export const GOODREADS_EXPECTED_GENRES: readonly Genre[] = codes.map((code) => {
  const genre = genreByCode[code as keyof typeof genreByCode];
  if (genre === undefined) throw new Error(`Unknown genre audit code: ${code}`);
  return genre;
});

