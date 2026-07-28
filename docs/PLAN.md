# Nightstand — Product & Build Plan

A personal media companion: books, movies, TV, podcasts. One library, one taste model,
one place to ask "what should I do with the next 90 minutes?" — and then actually get it.

Status: **draft for discussion.** Nothing is built yet. Decisions marked 🔵 need your call.

---

## 0. Decisions log

| # | Decision | Status |
|---|---|---|
| 1 | Three tabs: Now / Library / Portrait | proposed |
| 2 | Podcasts tracked at **show** level, not episode | ✅ agreed |
| 3 | Every item carries a **"Get it"** action row (buy / stream / borrow) | ✅ agreed — see §5 |
| 4 | Seed from the Goodreads CSV export — 225 books, in hand | ✅ agreed — see §7 |
| 5 | Pairwise "ladder" ranking instead of stars, **scoped per genre** | ✅ agreed — see §4.2 |
| 6 | No social features of any kind | ✅ agreed |
| 7 | Deep-link to titles; no credential-scraping for "My List" | ✅ agreed |
| 8 | Region **US**; 10 subscriptions on file | ✅ agreed — see §5 |
| 9 | Named **Nightstand** | ✅ agreed — see §12 |
| 10 | Clean Amazon links, no affiliate tagging | ✅ agreed |
| 11 | No Libby/OverDrive integration | ✅ agreed — dropped |
| 12 | No co-viewing profile; group-watch parked as a future idea | ✅ agreed — see §13 |
| 13 | **No Supabase / no database service.** Local-first: IndexedDB on device, stateless API routes, JSON export backup | ✅ agreed — see §8 |
| 14 | **In theaters** as an availability state + Fandango showtimes deep link | ✅ agreed — see §5 |
| 15 | Spotify deep links for podcasts; **branded provider buttons** per official brand kits | ✅ agreed — see §5 |
| 16 | Natural-language situation chat and two-scope search are core surfaces | ✅ agreed — see §4.4–4.5 |
| 18 | **Recommendations** is the tab and the engine; the engine *offers* by default, and chat/situations are ways to *ask* it | ✅ agreed — see §4.4 |
| 17 | Work tracked as **epics → beads** with explicit dependencies and acceptance criteria | ✅ agreed — see `EPICS.md` |

**All questions are resolved. Execution structure lives in [`EPICS.md`](./EPICS.md) and
[`COORDINATION.md`](./COORDINATION.md).**

---

## 1. The thesis

Goodreads is a *database with a social network bolted on*. The content is genuinely good —
the metadata, the descriptions, the aggregate ratings. The product wrapped around it is
fifteen years stale, and it gives you almost nothing back for what you put in.

Nightstand inverts that. **The log is not the product. The log is the training data.**

Everything you capture feeds one asset: a living, legible model of your taste. Every
surface is a view into that model:

| Surface | Question it answers |
|---|---|
| **Recommendations** | "What should I read / watch / listen to?" — an engine that offers, and that you can also *ask* (situations, chat) |
| **Library** | "What have I consumed, and what did I think?" |
| **Portrait** | "Who am I, as a consumer of stories?" |

Three tabs. No feed, no friends, no streaks.

### The creative wedge: cross-media taste

Nobody does this. Goodreads knows books, Letterboxd knows film, neither knows that the
thing you love is *slow-burn investigative structure* — and that it shows up in a podcast,
a novel, and a limited series. A single taste model across four media is the one thing a
personal app can do that no incumbent will ever ship, because incumbents are organized
around catalogs and we're organized around a person.

---

## 2. Teardown: what the Goodreads screenshots actually show

Direct observations from the three screens, and what we do instead. This is the design
brief, stated as corrections.

| Goodreads does | We do |
|---|---|
| Cover thumbnail is ~1/6 of the row | **Art is the hero.** Cover-forward grid; the artwork is the largest element on screen |
| Title shows the full subtitle — *"Strategies for Developing, Leveraging, and Surviving…"* — wraps 5 lines, still truncates | **Short title, demoted subtitle.** Subtitle is small, grey, one line, or hidden entirely |
| Detail page shows **no cover at all** | Cover opens the detail page, full-bleed, with the accent color extracted from it |
| Community rating (3.98 · 1,562) is prominent; **your own rating never appears in list view** | **Your rating is primary and always visible.** Community rating is secondary, and optional |
| "Date Added: Jul 5, 2026" gets prime position | Replaced by **why it's there** — the context tag you saved it with ("flight", "with M") |
| `PREVIEW` is the only action | **"Get it"** — buy, stream, or borrow, in one tap (§5) |
| Ads interleaved in your own shelf; a full-page gambling ad on a book page | No ads. Ever. It's your app |
| Floating tab bar occludes content — a cover is visibly cut off behind it | Correct safe-area insets and scroll padding |
| "You marked this as want to read on Jul 5" as filler content | Personal history kept, but compact and secondary |
| Rate = five empty stars, no context | Gradient tap → taste tags → occasional ladder duel (§4.2) |

**The one thing worth stealing:** the rating-distribution histogram. A flat 3.98 and a
bimodal 3.98 are completely different books. Goodreads has that signal and buries it under
an ad. We surface it as a one-line verdict — **"this one splits people"** — which is
genuinely useful when you're deciding, and nobody else says it out loud.

---

## 3. Design principles

1. **Capture must be sub-five-seconds.** Every tracker dies at the add step. If logging is
   work, the library rots, the model starves, and the app is dead.
2. **Give back more than you take.** Every field you fill must visibly improve something
   you can see. No write-only data.
3. **The model is legible and arguable.** You can read what the app thinks of your taste
   and tell it it's wrong. An editable model is a trusted model.
4. **A hand, not a haystack.** 3–5 recommendations at a time, each with a reason that cites
   *your* history. Never an infinite grid.
5. **Beautiful because of the art.** Covers, posters, and podcast art are the best assets
   in your life. Frame them and get out of the way.
6. **No guilt mechanics.** No streaks, no "12 books behind schedule," no badges.
7. **Never a dead end.** Every item ends in an action — get it, queue it, or dismiss it
   with a reason. Nothing is just *displayed*.
8. **Offline-first.** It's a phone. Subways exist.

---

## 4. Core mechanics

### 4.1 Capture: four doors

- **Omnibox** — one search field across all four media, results grouped by type.
- **Share target** — installed PWAs can register as a share target. Share from Kindle,
  Netflix, Spotify, Libby → lands in your Inbox, auto-resolved. This will be how most
  logging actually happens.
- **Just say it** — *"finished Bear s3, four stars, the fork episode wrecked me"* → parsed
  by the LLM into a full entry with rating and note.
- **Barcode scan** — camera on a physical book jacket.

### 4.2 Ratings: the genre-scoped ladder ✅

Five stars is lossy and drifts. Your export proves it: **108 of your 152 ratings are a 4
or a 5** — 71% of your library is effectively unranked.

Rate fast (*loved / liked / fine / no*), and then the app occasionally asks the only
question that produces clean signal:

> **"*Inside the Tornado* or *Blue Ocean Strategy* — which one stays?"**

Pairwise, Elo-style. Ten seconds, weirdly addictive, and it produces a real **ranked
ladder** instead of a pile of 4-star ties.

**Ladders are per-genre, not per-medium.** Your data makes the case better than any
argument could: *Green Eggs and Ham* and *The House of Morgan* both hold five stars.
Asking you to compare them would be meaningless and would discredit the mechanic on
first use. Eight proposed genre ladders are listed in `TASTE-BASELINE.md` §Proposed genre
ladders — and per Finding 5, genre is **auto-assigned from metadata**, never a shelf you
have to maintain.

**Two traps the export exposed**, both handled here rather than discovered later:

- **Two kinds of five-star.** A large nostalgia cluster (Alex Rider ×7, Harry Potter ×6,
  Dr. Seuss) is rated 5 — that's *comfort*, not *admiration*. Untreated, the recommender
  concludes "loves YA spy thrillers." We capture **mode** (admired / enjoyed / loved-since-
  childhood), inferred by default and always correctable. Comfort titles rank on their own
  ladder and are excluded from rec signal unless a situation asks for comfort.
- **Context-contaminated negatives.** Ten of your thirteen lowest ratings are assigned
  high-school canon. That rates the circumstance, not the book — and *The Road* sitting on
  your to-read shelf proves the naive inference wrong. Onboarding asks about it once.

**Plus taste tags** — after rating, 3–4 contextual one-tap chips (*pacing / ending /
density / voice / world / performances*). This is what turns "you liked it" into "you
liked it *because*."

### 4.3 Rejection is the real signal

Every recommendation is dismissible **with a reason**: *seen it · too long · not the mood ·
wrong vibe · bounced off it · can't get it*. One tap.

Nobody collects negative signal, and it's worth more than positive because it's where the
model is wrong. This is the flywheel.

### 4.4 The Recommendations engine

**Recommendations is a tab and an engine.** The engine's job: given everything Nightstand
knows — ladder standings, taste tags, rejection history, what's on your stack, what you
can actually access tonight — produce a small, considered hand of picks across all four
media. It has two faces:

**It offers.** Open the tab and the engine has already dealt: 3–5 picks spanning books,
movies, TV, and podcasts, each with a one-line reason citing *your* history ("you ranked
*Bad Blood* top of Money & Markets; this is the same reporter"), each carrying its Get-it
row, each dismissible with a reason. Queue-first — if something on your stack fits, it
leads. Refreshed when the model learns something, not on a dopamine schedule.

**You ask.** Two ways to steer the same engine, one tap away:

- **Situation chips** — saved openings: `45 min before bed` · `background while cooking` ·
  `long flight` · `movies in theaters now` · `need to cry` · `want to feel smart` ·
  `nothing heavy`. Situations are objects that learn what worked.
- **Chat** — the freeform option within Recommendations. Describe the situation in your
  own words — mood, time, company, energy, what you just finished, what you can't face —
  and the engine answers like someone who has read your whole file, because it has:

  > *"Flight tomorrow, 5 hours, want something absorbing but I'm burned out on business
  > books"* → it knows you just logged three strategy books, sees *American Prometheus*
  > and *The Road* on your stack, checks length and availability, and hands you a
  > considered answer with reasons — not a grid.

  Follow-ups refine in context ("shorter", "funnier", "fine, but on Audible?").

One engine, three entry points — the default hand, the chips, the chat. Same taste model,
same availability constraints, same rejection capture behind all three.

### 4.5 Search

Two different questions share one field, and the app must never confuse them:

- **"Find it"** — the omnibox (§4.1): search the world across all four media to add,
  log, or check availability.
- **"Where is it?"** — search *your own* library, stack, notes, and history: by title,
  by half-remembered detail (*"the one with the lighthouse keeper"* — semantic, §4.6), or
  by what you said about it.

One search surface, two clearly-labeled scopes — **Your library** first when results exist
there, **Everything** below. Search is a top-level control on every tab, not a buried
utility: for a library of hundreds of items, recall *is* a core feature.

### 4.6 The Taste Portrait

The accretive payoff: axes (plot-driven ↔ vibe-driven, comfort ↔ challenge), recurring
obsessions, blind spots stated as observation and never as a scold, seasonality. **Every
claim is editable** — thumbs-down corrects the model.

Semantic search over your own notes falls out nearly free: *"what was the book where the
narrator was a lighthouse keeper?"* (surfaced through the §4.5 search field).

---

## 5. "Get it" — commerce and availability

New requirement, and it's a bigger deal than it first looks. Every detail page and every
recommendation card carries an action row.

**Books** — Kindle (ISBN → ASIN, deep link straight into the Kindle store; clean links,
no affiliate tags), Audible, Bookshop.org, physical. (Libby/OverDrive: dropped by
decision #11.)

**Movies & TV** — TMDB's watch-provider data gives per-region availability, distinguishing
*included with your subscription* from *rent $3.99* from *not available*. Each provider
gets a button that deep-links to the title in that app.

**In theaters** — a first-class availability state, not an afterthought. TMDB's
`now_playing` feed (region US) marks current theatrical releases, Recommendations gets a
**"movies in theaters now"** situation chip, and every theatrical title carries a
**Fandango** button that deep-links to its showtimes page — with your zip (stored once, or
read from device location with permission) so "showtimes near me" is one tap. This also
gives the recommender a new move: *"anything actually worth leaving the house for this
week?"* is a question it can now answer.

**Podcasts** — **Spotify deep links first** (`open.spotify.com/show/…`, resolved via
Spotify's public search API — no login needed for lookup), then Apple Podcasts and
Overcast.

### Branded buttons

The action row uses each service's **official brand kit** — real logos, real brand colors,
correct clear-space, from each service's published brand/developer guidelines (Netflix,
Prime Video, Hulu, Max, Apple TV+, Disney+, Peacock, Paramount+, Spotify, Audible, Amazon,
Fandango). A Netflix button should be instantly recognizable as Netflix, not a grey chip
that says "Netflix."

Assets are bundled locally (no hotlinking), one component (`ProviderButton`) renders all
of them, and a single registry file maps provider → logo, colors, and deep-link template —
so adding a service later is a one-entry change. Brand-guideline compliance is an
acceptance criterion, not a nice-to-have: these are the most-tapped elements in the app,
and off-brand marks are the fastest way to make the whole thing feel homemade.

### The honest limitation on "add to My List"

**Netflix, Max, Disney+, and Prime Video have no public write APIs.** There is no
sanctioned way for any third-party app to add a title to your Netflix My List — this isn't
a Nightstand limitation, it's why no app anywhere offers it. Anyone claiming otherwise is
scraping with your password, which I'm not going to build.

What we *can* do, and what I'd build: a button that **deep-links directly to that title
inside the Netflix app**, where "+ My List" is one tap away. So it's two taps instead of
one, it's reliable, and it doesn't require handing over credentials. For books it's better
— Kindle and Libby deep links land you on a real buy/borrow button.

I want that caveat on the record now rather than discovered in Phase 5.

### Subscriptions on file (US)

Netflix · HBO Max · Prime Video · Hulu · Apple TV+ · Peacock · Paramount+ · Disney+ ·
Spotify · Audible.

Ten services is a lot of surface, and it makes the availability filter *more* valuable
rather than less: with this much coverage, "can I watch it tonight for free" is almost
always answerable, and the rare "no" is worth knowing before you get attached. Region is
**US** for all TMDB provider lookups.

### The accretive win: availability-aware recommendations

This is where your commerce request stops being a buy button and becomes a *feature*. The
recommender treats availability as a **constraint**:

> *"45 minutes, on something I already pay for, nothing heavy"*

No more falling in love with a recommendation you can't watch. `can't get it` also becomes
a rejection reason that feeds the model. This is the single best thing to come out of the
screenshots, and it's the reason §5 is a core section and not a polish item.

---

## 6. Design language

**Editorial, warm, literary — a well-made paperback, not a streaming dashboard.**
Explicitly the opposite of the screenshots: art-forward, uncluttered, no ads, no chrome.

- **Type.** High-contrast serif for titles, clean neutral sans for UI. Goodreads' serif
  instinct is right; its *scale* is wrong — we use serif for emphasis, not for walls.
- **Color.** Warm neutral paper ground. Dark mode is warm — ink and lamplight, not
  blue-black. The accent color is **extracted from the artwork you're looking at**, so the
  app takes on the color of what you're consuming.
- **Layout.** Generous margins, big art, few borders. Separation by space and weight, not
  by rules and boxes. Tab bar respects safe areas.
- **Motion.** Restrained and physical. Shared-element transition cover → detail.

🔵 **Phase 0 ends with a style tile** — a real screen, so we agree on a look rather than on
adjectives.

---

## 7. Seeding the taste model

**We have the CSV: 225 books, 152 of them rated.** Full analysis in
[`TASTE-BASELINE.md`](./TASTE-BASELINE.md). This is a strong cold start — the app ships
already knowing you, which is the difference between a recommender that's useful in week
one and one that's useful in month three.

Import path:

1. **Parse the export** — 225 rows, 80% carrying ISBN13 (auto-resolves to Kindle/Audible);
   the remaining 20% fall back to title + author matching.
2. **Auto-assign genre** to every title from metadata, seeding the eight ladders.
3. **Infer rating mode** (admired / enjoyed / comfort) from publication date, re-read
   count, and cluster membership — then confirm the handful it's unsure about.
4. **Onboarding calibration** — the assigned-canon question (§4.2), then ~15 ladder duels
   concentrated in the crowded 4–5 band, which is where all the ambiguity lives. Fifteen
   comparisons across 108 tied books is enough to establish a usable spine.
5. **Order the to-read shelf** — 17 books, coherent, and answering "which of these first?"
   is the app's easiest first win. Goodreads answers it with `DATE ADDED`.

Movies, TV, and podcasts still cold-start conversationally (*"name ten you loved"*), but
the book model will already be carrying real cross-media signal by then — which is exactly
the wedge in §1.

**Still worth building later:** a screenshot importer (vision → titles → bulk resolve) for
Letterboxd, Trakt, or anything else with no export. Proven viable — the three screenshots
you sent parsed cleanly enough to pull every title, author, and rating. Phase 6, not now.

---

## 8. Architecture — local-first, no database service

Supabase is out (it would ride on the Leonard org's account, and this app shouldn't
depend on anyone's org). The replacement is not a different database vendor — it's **no
database service at all**, and for a single-user phone app that's the honest architecture,
not a compromise:

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js (App Router) + TypeScript + Tailwind** | Best PWA story, one language |
| Host | **Vercel Hobby (free)** | Deployed and managed via the Vercel connector in this workspace |
| Data | **On-device: IndexedDB via Dexie** | The phone is the source of truth. Zero hosting cost, zero accounts, works offline by construction |
| Backup | **One-tap JSON export** via the share sheet; import to restore | Device migration and disaster recovery without a server |
| Server | **Stateless API routes only** — metadata proxies + LLM calls | No user data is ever stored server-side |
| Secrets | Vercel env vars; a passphrase header (set once on your phone) guards the LLM route | Keeps the proxy from being abusable if the URL leaks |
| Intelligence | **Anthropic API** | Opus for portrait synthesis, Sonnet for chat and parsing |

What this buys, beyond "free":

- **Privacy by construction.** Your taste data lives on your phone. The server sees it
  only transiently, inside prompts, and stores nothing.
- **Offline-first stops being a feature and becomes the default** — reads and writes hit
  IndexedDB directly; only search, availability, and chat need the network.
- **Nothing for anyone to administer.** No migrations against a remote DB, no auth
  system, no row-level security to get wrong.
- **No embeddings service needed.** At a few-hundred-item scale, the recommender passes a
  compact library summary directly in the prompt — simpler and better than a vector DB at
  this size.

Trade-offs, stated plainly: **no cross-device sync in v1** (export/import covers moving
phones; a free Turso/libSQL sync layer can be added later without reworking the schema),
and the periodic portrait refresh runs on app-open rather than on a server cron.

The two things only you can do, both one-time, both in the Vercel dashboard: paste in an
**Anthropic API key** and a **TMDB API key** (free) as env vars. Everything else — build,
deploy, domains, env plumbing — I manage through the connector.

**Metadata sources** — Open Library + Google Books (books); **TMDB** (movies/TV: art,
watch providers, and `now_playing` for theaters, region US); iTunes Search + Podcast
Index (podcasts).

```
items          canonical title: medium, external ids, art, runtime/length, metadata
entries        my log: item_id, status, started/finished, score, gradient, tags[], note
comparisons    pairwise ladder results (winner, loser, medium)
queue          shortlist: item_id, context_tags[], added_reason
situations     saved contexts ("flight", "before bed", "in theaters"), learned preferences
availability   per-item, per-provider: type (sub/rent/buy/borrow), price, deep link, region
services       which subscriptions and library cards I actually hold
recs           what was suggested, why, and the rejection reason
portrait       versioned taste model + my manual corrections
embeddings     pgvector over items and over my own notes
```

**Cost:** Vercel + Supabase free tiers cover one user. LLM spend is realistically a few
dollars a month.

---

## 9. Build phases

**Phase 0 — Foundation.** Schema, auth, design tokens, component primitives, PWA shell,
deploy pipeline. **Ends with a style tile we both look at.**

**Phase 1 — Capture & Library.** Omnibox across all four providers, detail pages, logging,
Library tab. This is the phase that has to feel fast.

**Phase 2 — Rate & Rank.** Gradient rating, taste tags, the ladder, the queue.

**Phase 3 — Get It.** Availability resolution, the action row, service preferences,
deep links. Pulled early because it changes the recommender's inputs.

**Phase 4 — Ask.** Now tab, situations, rec cards with personal reasons, queue-first and
availability-aware logic, rejection capture.

**Phase 5 — Portrait & Memory.** Embeddings, the Portrait page, editable claims, semantic
search.

**Phase 6 — Seed & Polish.** Screenshot importer, share target, barcode, voice, dynamic
color, offline hardening, Wrapped.

Phases 0–1 are sequential. From Phase 2 on, subagents can parallelize across mostly
disjoint files. Review at phase boundaries.

---

## 10. Non-goals

No social graph, friends, feed, sharing, or public profile. No reading challenges or
streaks. No multi-user. No native app. No ads, obviously. No "because others liked" —
recommendations cite *your* history or they don't ship. No credential-scraping to
automate anything a platform doesn't sanction.

---

## 11. Open questions

None outstanding. See the decisions log in §0.

One standing default worth stating: **comfort titles stay fully visible.** The childhood
fives are excluded from *recommendation signal* (§4.2) but remain in Library and hold
their own ladder — they're a real part of the collection, not noise to be hidden.

---

## 12. The name

**Nightstand.**

It earns its keep beyond sounding good — it's the one surface in a house where all four
media already coexist. The book you're mid-way through, the remote, the phone with the
podcast on it, and the lamp. That's the product, described by a piece of furniture.

It also gives us a vocabulary that makes the interface easier to write, with no invented
jargon:

| Concept | Nightstand word |
|---|---|
| Recommendations tab (display name) | **Tonight** |
| In progress | **On the nightstand** |
| Queue / shortlist | **The stack** |
| Finished | **The drawer** |
| Comfort re-reads | **Well-worn** |
| The between-heavy-things pick | **Lamplight** — short, easy, undemanding |

And it retroactively justifies the palette in §6: a **warm dark mode of ink and lamplight**
was the right instinct before we had the name, and now it's the literal subject. Dark mode
is the default; the lamp is the accent.

**The discipline:** the metaphor lives in the vocabulary and the palette, never in the
pixels. No wood-grain textures, no skeuomorphic drawers, no lamp illustration. Themed apps
turn twee fast, and this one is meant to feel like a well-made object, not a cartoon of
one.

---

## 13. Parked for later

Good ideas, deliberately not in scope now:

- **Group watch.** More than two people, each with a taste profile, converging on one
  thing everyone will actually enjoy — a real problem nobody has solved well. It needs
  multi-user, which every other decision here rules out, so it's a v2 conversation rather
  than a feature to leave hooks for. Noted because it's genuinely the best expansion path
  this design has.
- **Screenshot importer** — vision → titles → bulk resolve, for Letterboxd/Trakt and
  anything else without an export. Proven viable; Phase 6.
- **A shareable Taste Portrait.** Private by default and staying that way. But the Portrait
  is the one artifact in this app anyone would ever want to show someone, so it should be
  designed as though it might be — which costs nothing now and keeps the option open.
