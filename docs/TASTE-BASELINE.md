# Taste Baseline — analysis of the Goodreads export

Source: `goodreads_library_export.csv`, 225 books. This is the seed corpus and the
evidence base for several design decisions in `PLAN.md`. Findings here are drawn from the
data, not assumed.

## Corpus shape

| | |
|---|---|
| Total books | 225 |
| Read | 199 |
| Rated | 152 |
| To-read | 17 |
| Currently reading | 3 |
| Re-reads (read count > 1) | 5 |
| Median page count | 299 |
| Reading pace | ~10/year, steady since 2017 |

## Finding 1 — Star compression is severe, and it justifies the ladder

| Rating | Count |
|---|---|
| ★★★★★ | 53 |
| ★★★★ | 55 |
| ★★★ | 31 |
| ★★ | 8 |
| ★ | 5 |

**108 of 152 ratings (71%) are a 4 or a 5.** Those 108 books are effectively unranked —
the five-star scale has told us they're all "good" and nothing else. This is the
quantified case for pairwise ranking: there are 108 books here whose relative order we
currently cannot recover by any means except asking.

## Finding 2 — The taste signature is unusually legible

**Consistently loved:**

- **Narrative nonfiction with a protagonist and real stakes** — *Into Thin Air*,
  *Unbroken*, *Bad Blood*, *When Genius Failed*, *Moneyball*, *Born to Run*,
  *The House of Morgan*
- **Builder biography** — Isaacson's *Steve Jobs* and *Elon Musk*, Vance's *Elon Musk*
- **Business frameworks with an operating thesis** — *Zero to One*, *Good to Great*,
  *Disciplined Entrepreneurship* (both volumes), *Never Split the Difference*
- **Stoicism and self-mastery** — *Meditations*, *How to Think Like a Roman Emperor*,
  *Man's Search for Meaning*, Tolle ×2, *Mindset*, *The Inner Game of Tennis*

**Consistently disliked — and the pattern is almost too clean:**

*Catch-22*, *The Canterbury Tales*, *Heart of Darkness*, *Macbeth*, *Romeo and Juliet*,
*A Streetcar Named Desire*, *Invisible Man*, *The Scarlet Letter*, *Brave New World*,
*Flowers for Algernon*.

**Ten of the thirteen lowest-rated books are assigned high-school English canon.**

The through-line: works rewarded for symbolism and interiority score low; works with a
protagonist, stakes, and a transferable lesson score high.

## Finding 3 ⚠️ — There are two different kinds of five-star

A large nostalgia cluster is rated 5: **Alex Rider ×7, Harry Potter ×6, Dr. Seuss ×2,
*Samurai Shortstop***.

*Green Eggs and Ham* and *The House of Morgan* both hold five stars, and they are not the
same statement. One is **admiration**, the other is **comfort**.

**Consequence if we ignore this:** the recommender concludes "loves YA spy thrillers" and
serves more of them. That single inference would discredit the app in its first week.

**Fix:** rate on a single scale, but capture *mode* — was this **admired**, **enjoyed**, or
**loved-since-childhood**? One tap, inferable by default from publication date and
re-read behavior, always correctable. Comfort titles rank on their own ladder and are
excluded from recommendation signal unless the situation explicitly asks for comfort.

## Finding 4 ⚠️ — The negative ratings are context-contaminated

Those ten low-rated classics were almost certainly read on assignment, as a teenager, to a
deadline. That's a rating of **the circumstance**, not the book.

Taken at face value, the model learns "excludes literary fiction permanently." But
**Cormac McCarthy's *The Road* is on the to-read shelf right now** — so that conclusion is
demonstrably wrong.

**Fix:** during onboarding, the app asks once — *"You rated ten assigned classics 1–2
stars. Was that the books, or was it being made to read them at sixteen?"* Whichever way
it's answered, the model gets materially smarter, and it's a moment that proves the app is
paying attention. This is the Taste Portrait earning trust on day one.

## Finding 5 — Behavioral evidence about what will actually get used

This is the most valuable part of the export, and it's all in what's *missing*:

| Signal | Value | Design consequence |
|---|---|---|
| Reviews written | **1 of 225** | **Do not build review-writing as a primary path.** Ratings and one-tap tags only; free text is optional and voice-first |
| Private notes | **0** | Same |
| Custom shelves used | 7 books in the only real one (`mindfulness-and-stoicism`) | **Genre must be auto-derived.** A taxonomy requiring maintenance will not be maintained |
| Books with a Date Read | 96 of 225 (43%) | Dates are unreliable — no feature may depend on them. Rules out most "reading stats" |
| Books with ISBN13 | 179 of 225 (80%) | ~80% will auto-resolve to Kindle/Audible; the rest need title+author fallback |

Four of the five rows above are arguments *against* building something. That's what makes
them worth having before Phase 0 rather than after Phase 3.

## Finding 6 — The forward queue is coherent and orderable

The 17 to-read books cluster tightly:

- **Business strategy** — *7 Powers*, *Blue Ocean Strategy*, *Positioning*,
  *The Innovator's Solution*, *Inside the Tornado*, *The Founder's Dilemmas*, *Unscalable*
- **Classical philosophy & economics** — *The Prince*, Schopenhauer, Gracián, Adam Smith ×2
- **Finance** — *Security Analysis*
- **Biography** — *American Prometheus*
- **One literary outlier** — *The Road*

Ordering this list is the app's easiest first win: seventeen items, a known taste model,
and a real question ("which of these first?") that Goodreads answers with `DATE ADDED`.

## Proposed genre ladders

Derived from the corpus, auto-assigned from metadata — never user-maintained (Finding 5):

1. **Business & Strategy**
2. **Money & Markets** — narrative finance
3. **Lives** — biography and profile
4. **Mind & Mastery** — stoicism, psychology, self-improvement
5. **Grit & Wilderness** — survival and adventure nonfiction
6. **Literary Fiction**
7. **Genre Fiction** — thriller, fantasy, YA
8. **Comfort & Childhood** — ranked separately, excluded from rec signal by default

Ladders are per-genre, so the app never asks *Meditations* vs *Green Eggs and Ham*. Cross-
genre comparison is meaningless and asking for it would destroy trust in the mechanic.
