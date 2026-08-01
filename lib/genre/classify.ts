import { genreSchema, type Genre, type GenreAssignment } from "../types";

export const BOOK_GENRES = [
  "business-strategy",
  "money-markets",
  "lives",
  "mind-mastery",
  "grit-wilderness",
  "literary-fiction",
  "genre-fiction",
  "comfort-childhood",
] as const satisfies readonly Genre[];

export interface GenreMetadata {
  medium: "book" | "movie" | "tv" | "podcast";
  title: string;
  subtitle?: string;
  creators: readonly string[];
  description?: string;
}

export interface GenreDecision {
  assignment: GenreAssignment;
  /** Stable, inspectable rule identifier for UI/debugging. */
  rule: string;
  /** Metadata fragments that caused the rule to fire. */
  evidence: readonly string[];
}

interface Rule {
  genre: Genre;
  rule: string;
  patterns: readonly RegExp[];
}

/** Specific known evidence precedes broad metadata words by design. */
const bookRules: readonly Rule[] = [
  {
    genre: "comfort-childhood",
    rule: "known-comfort-title-or-series",
    patterns: [
      /\balex rider\b|\bharry potter\b|\bsamurai shortstop\b/,
      /\bgreen eggs and ham\b|\bcat in the hat\b/,
    ],
  },
  {
    genre: "grit-wilderness",
    rule: "known-grit-title",
    patterns: [
      /\binto thin air\b|\binto the wild\b|\bunbroken\b|\bborn to run\b/,
      /\bextreme ownership\b|\bbomber mafia\b|\bbeyond belief\b/,
    ],
  },
  {
    genre: "business-strategy",
    rule: "documented-business-queue-title",
    patterns: [
      /\b7 powers\b|\bblue ocean strategy\b|\bpositioning\b/,
      /\bthe innovator's solution\b|\binside the tornado\b/,
      /\bthe founder's dilemmas\b|\bunscalable\b/,
    ],
  },
  {
    genre: "lives",
    rule: "documented-life-title-or-subject",
    patterns: [
      /\bsteve jobs\b|\belon musk\b|\bamerican prometheus\b/,
      /\btitan\b|\bthe power broker\b|\bmy early life\b|\bmy losing season\b/,
      /\bfounders at work\b|\bleadership:? in turbulent times\b/,
      /\bleading with the heart\b/,
      /\bwalter isaacson\b.*\b(?:jobs|musk)\b|\bashlee vance\b.*\belon musk\b/,
    ],
  },
  {
    genre: "literary-fiction",
    rule: "literary-and-assigned-canon",
    patterns: [
      /\bcatch-22\b|\bcanterbury tales\b|\bheart of darkness\b|\bmacbeth\b/,
      /\bromeo and juliet\b|\bstreetcar named desire\b|\binvisible man\b/,
      /\bscarlet letter\b|\bbrave new world\b|\bflowers for algernon\b/,
      /\bbonfire of the vanities\b|\bthe road\b|\bgentleman in moscow\b/,
      /\bin cold blood\b|\bfrankenstein\b|\btom sawyer\b|\bhuckleberry finn\b/,
      /\bof mice and men\b|\blord of the flies\b|\banimal farm\b/,
      /\bold man and the sea\b|\bfountainhead\b|\bsiddhartha\b|\bthe odyssey\b/,
      /\b1984\b|\bsound and the fury\b|\bcatcher in the rye\b|\bthings they carried\b/,
      /\bjulius caesar\b|\bfarewell to arms\b|\blolita\b|\bdeath of a salesman\b/,
      /\bhamlet\b|\bto kill a mockingbird\b|\bglass menagerie\b|\bgreat gatsby\b/,
      /\bseparate peace\b|\breluctant fundamentalist\b|\bsouthland\b|\ball the way\b/,
      /tom wolfe|amor towles|truman capote|mark twain|john steinbeck/,
      /george orwell|ernest hemingway|hermann hesse|ayn rand|homer/,
      /william shakespeare|tennessee williams|ralph ellison|william faulkner/,
      /f\. scott fitzgerald|vladimir nabokov|j\.?d\.? salinger|harper lee/,
    ],
  },
  {
    genre: "money-markets",
    rule: "known-finance-title",
    patterns: [
      /\bbad blood\b|\bgoing infinite\b|\bwhen genius failed\b|\bmoneyball\b/,
      /\bbarbarians at the gate\b|\bblack edge\b|\bdark towers\b|\bred notice\b/,
      /\bhouse of morgan\b|\bblue blood (?:and|&) mutiny\b|\bbitter brew\b/,
      /\bsecurity analysis\b|\bbridgewater\b|\bbuffett\b|\bmunger\b|\benron\b/,
    ],
  },
  {
    genre: "business-strategy",
    rule: "company-building-and-strategy",
    patterns: [
      /\bbusiness\b|\bstrategy\b|\bstartup\b|\bentrepreneur(?:ship)?\b/,
      /\bmanagement\b|\bmanager\b|\bcompany\b|\bceo\b|\bfounder(?:s)?\b/,
      /\binnovation\b|\bmarketing\b|\bproduct\b|\bsubscription\b|\bleadership\b/,
      /\bworking backwards\b|\bzero to one\b|\bgood to great\b/,
      /\bvalue proposition\b|\bbusiness model\b|\bdisciplined entrepreneurship\b/,
      /\bnever split the difference\b|\bmckinsey\b|\bcontagious\b|\bsmart brevity\b/,
      /\bthinking in systems\b|\bart of war\b|\breboot\b|\blean startup\b/,
    ],
  },
  {
    genre: "money-markets",
    rule: "finance-and-markets-metadata",
    patterns: [
      /\bmoney\b|\bfinance\b|\bfinancial\b|\bfintech\b|\bcrypto\b/,
      /\bmarket(?:s)?\b|\binvest(?:ing|ment|or)?\b|\bvaluation\b|\bbond\b/,
      /\bcapitalism\b|\beconom(?:y|ics|ist)\b|\bwall street\b|\bfund\b/,
      /\bbank(?:ing)?\b/,
    ],
  },
  {
    genre: "lives",
    rule: "biography-memoir-and-profile",
    patterns: [
      /\bbiograph(?:y|ical)\b|\bmemoir\b|\blife of\b/,
      /\beverything store\b|\bwooden\b/,
      /\bthree cups of tea\b|\bthe choice\b/,
      /\bbetween the world and me\b|\bwaking up white\b|\bisland at the center\b/,
      /\bquality of madness\b|\bjohn wooden\b/,
    ],
  },
  {
    genre: "grit-wilderness",
    rule: "survival-and-endurance-metadata",
    patterns: [/\bsurvival\b|\bwilderness\b|\beverest\b|\bnavy seal\b/],
  },
  {
    genre: "genre-fiction",
    rule: "plot-and-speculative-fiction",
    patterns: [
      /\btuck everlasting\b|\bwrinkle in time\b|\bcharlotte's web\b/,
      /\bgolden compass\b|\btwilight\b|\balienist\b|\brosie project\b/,
      /\bgoodnight moon\b|\bwhere the wild things are\b|\blong walk to water\b/,
      /\boh,? the places you'll go\b/,
      /\bthriller\b|\bmystery\b|\bfantasy\b/,
    ],
  },
  {
    genre: "mind-mastery",
    rule: "mind-philosophy-and-self-mastery-default",
    patterns: [/.*/],
  },
];

/**
 * Podcasts temporarily share the film ladders because the contract has no
 * podcast-specific taxonomy yet. We use explicit crime, ambition, or comfort
 * evidence and otherwise choose the neutral auteur/prestige bucket until a
 * user podcast seed exists to justify something more specific.
 */
const screenRules: readonly Rule[] = [
  {
    genre: "comfort-rewatch",
    rule: "known-screen-comfort-title",
    patterns: [
      /\bmean girls\b|\b13 going on 30\b|\bdevil wears prada\b|\bkung fu panda\b/,
    ],
  },
  {
    genre: "crime-tension",
    rule: "known-screen-crime-title",
    patterns: [
      /\bknives out\b|\bglass onion\b|\bsicario\b|\bwind river\b|\bgone girl\b/,
      /\bjoker\b|\bbaby driver\b/,
    ],
  },
  {
    genre: "ambition-institutions",
    rule: "known-screen-ambition-title",
    patterns: [
      /\bthe wolf of wall street\b|\bthe social network\b|\bthere will be blood\b/,
      /\bmarty supreme\b/,
    ],
  },
  {
    genre: "comfort-rewatch",
    rule: "screen-comfort-metadata",
    patterns: [/\bcomfort\b|\brewatch\b|\bfamily\b|\bromance\b|\bcomedy\b/],
  },
  {
    genre: "crime-tension",
    rule: "screen-crime-metadata",
    patterns: [/\bcrime\b|\bmurder\b|\bdetective\b|\bthriller\b|\bcartel\b|\bpolice\b/],
  },
  {
    genre: "ambition-institutions",
    rule: "screen-ambition-metadata",
    patterns: [/\bbusiness\b|\bfinance\b|\bpolitic\b|\bfounder\b|\bempire\b|\binstitution\b/],
  },
  {
    genre: "auteur-prestige",
    rule: "screen-conservative-default",
    patterns: [/.*/],
  },
];

export function normalizeGenreText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function searchable(item: GenreMetadata): string {
  return normalizeGenreText(
    [item.title, item.subtitle, ...item.creators, item.description]
      .filter((value): value is string => value !== undefined)
      .join(" "),
  );
}

export function classifyGenre(item: GenreMetadata): GenreDecision {
  const text = searchable(item);
  const rules = item.medium === "book" ? bookRules : screenRules;
  for (const rule of rules) {
    const evidence = rule.patterns
      .filter((pattern) => pattern.test(text))
      .map((pattern) => pattern.source);
    if (evidence.length > 0) {
      return {
        assignment: { genre: genreSchema.parse(rule.genre), source: "auto" },
        rule: rule.rule,
        evidence,
      };
    }
  }
  throw new Error("Genre rules must include a fallback");
}
