import type { Genre } from "../../types";

/**
 * Every unique film named in TASTE-BASELINE Finding 7, classified from title
 * and the prose's stated clusters. The document says 32 films, but names only
 * 30 and the source screenshots are not checked in. Keep this at the honest
 * 30/30 until those two missing titles can be recovered; never invent them.
 */
export const TASTE_FILMS = [
  ["One Battle After Another", "auteur-prestige"],
  ["Knives Out", "crime-tension"],
  ["Once Upon a Time in Hollywood", "auteur-prestige"],
  ["Black Panther", "auteur-prestige"],
  ["Sicario", "crime-tension"],
  ["The Wolf of Wall Street", "ambition-institutions"],
  ["Django Unchained", "auteur-prestige"],
  ["The Social Network", "ambition-institutions"],
  ["Inception", "auteur-prestige"],
  ["Inglourious Basterds", "auteur-prestige"],
  ["There Will Be Blood", "ambition-institutions"],
  ["Little Miss Sunshine", "auteur-prestige"],
  ["Glass Onion", "crime-tension"],
  ["Joker", "crime-tension"],
  ["Baby Driver", "crime-tension"],
  ["Wind River", "crime-tension"],
  ["14 Peaks", "auteur-prestige"],
  ["Frances Ha", "auteur-prestige"],
  ["Midnight in Paris", "auteur-prestige"],
  ["The Devil Wears Prada", "comfort-rewatch"],
  ["The Devil Wears Prada 2", "comfort-rewatch"],
  ["Mean Girls", "comfort-rewatch"],
  ["13 Going on 30", "comfort-rewatch"],
  ["Everything Everywhere All at Once", "auteur-prestige"],
  ["Hereditary", "auteur-prestige"],
  ["Don't Look Up", "auteur-prestige"],
  ["Jojo Rabbit", "auteur-prestige"],
  ["Marty Supreme", "ambition-institutions"],
  ["Gone Girl", "crime-tension"],
  ["Kung Fu Panda", "comfort-rewatch"],
] as const satisfies readonly (readonly [title: string, genre: Genre])[];
