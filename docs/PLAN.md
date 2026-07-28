# Mediamogul — Product & Build Plan

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
| 4 | No Goodreads CSV to import from; seed another way | ✅ agreed — see §7 |
| 5 | Pairwise "ladder" ranking instead of stars | 🔵 needs call |
| 6 | No social features of any kind | ✅ agreed |

---

## 1. The thesis

Goodreads is a *database with a social network bolted on*. The content is genuinely good —
the metadata, the descriptions, the aggregate ratings. The product wrapped around it is
fifteen years stale, and it gives you almost nothing back for what you put in.

Mediamogul inverts that. **The log is not the product. The log is the training data.**

Everything you capture feeds one asset: a living, legible model of your taste. Every
surface is a view into that model:

| Surface | Question it answers |
|---|---|
| **Now** | "What should I do *right now*, given my mood, my time, and what I can actually access?" |
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

### 4.2 Ratings: the ladder, not the stars 🔵

Five stars is lossy and drifts — your 4-star from 2019 isn't your 4-star today.

Rate fast (*loved / liked / fine / no*), and then the app occasionally asks the only
question that produces clean signal:

> **"*Inside the Tornado* or *Blue Ocean Strategy* — which one stays?"**

Pairwise, Elo-style, against a title of adjacent rating. Ten seconds, weirdly addictive,
and it produces a real **ranked ladder** per medium instead of a pile of 4-star ties.

**Plus taste tags** — after rating, 3–4 contextual one-tap chips (*pacing / ending /
density / voice / world / performances*). This is what turns "you liked it" into "you
liked it *because*," and it's what stops the recommender being generic.

### 4.3 Rejection is the real signal

Every recommendation is dismissible **with a reason**: *seen it · too long · not the mood ·
wrong vibe · bounced off it · can't get it*. One tap.

Nobody collects negative signal, and it's worth more than positive because it's where the
model is wrong. This is the flywheel.

### 4.4 Situations as first-class objects

The Now tab opens with tappable situation chips plus a freeform field:

> `45 min before bed` · `background while cooking` · `long flight` · `with M` ·
> `need to cry` · `want to feel smart` · `nothing heavy`

Situations are saved objects that learn. And critically — **Now searches your own queue
first.** If something you already saved fits the moment, that's the answer, not a new thing
to feel guilty about.

### 4.5 The Taste Portrait

The accretive payoff: axes (plot-driven ↔ vibe-driven, comfort ↔ challenge), recurring
obsessions, blind spots stated as observation and never as a scold, seasonality. **Every
claim is editable** — thumbs-down corrects the model.

Semantic search over your own notes falls out nearly free: *"what was the book where the
narrator was a lighthouse keeper?"*

---

## 5. "Get it" — commerce and availability

New requirement, and it's a bigger deal than it first looks. Every detail page and every
recommendation card carries an action row.

**Books** — Kindle (ISBN → ASIN, deep link straight into the Kindle store), Audible,
**Libby/OverDrive** for your library (free, and shows real-time hold status), Bookshop.org,
physical.

**Movies & TV** — TMDB's watch-provider data gives per-region availability, distinguishing
*included with your subscription* from *rent $3.99* from *not available*. Each provider
gets a button that deep-links to the title in that app.

**Podcasts** — deep links to Spotify / Apple Podcasts / Overcast.

### The honest limitation on "add to My List"

**Netflix, Max, Disney+, and Prime Video have no public write APIs.** There is no
sanctioned way for any third-party app to add a title to your Netflix My List — this isn't
a Mediamogul limitation, it's why no app anywhere offers it. Anyone claiming otherwise is
scraping with your password, which I'm not going to build.

What we *can* do, and what I'd build: a button that **deep-links directly to that title
inside the Netflix app**, where "+ My List" is one tap away. So it's two taps instead of
one, it's reliable, and it doesn't require handing over credentials. For books it's better
— Kindle and Libby deep links land you on a real buy/borrow button.

I want that caveat on the record now rather than discovered in Phase 5.

### The accretive win: availability-aware recommendations

This is where your commerce request stops being a buy button and becomes a *feature*. Tell
the app once which services you subscribe to and which library card you hold, and the
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

## 7. Seeding the taste model (no CSV)

You said Goodreads has no CSV export, so the import path changes. Worth one check:
Goodreads *does* have an export on desktop web (My Books → Import and Export → Export
Library) that isn't exposed in the mobile app at all — if it's still there, that's the
cheapest possible seed by a wide margin. If it's gone or broken, we do this instead:

1. **Screenshot importer.** You screenshot your shelves, the app reads the titles out of
   the images with vision, resolves each against the metadata providers, and bulk-adds
   them. You just proved this works — the three screenshots you sent were parsed cleanly
   enough to pull every title, author, and rating off them.
2. **Conversational cold start.** *"Name ten things you loved and three you hated."* Three
   minutes of chat, and combined with a few ladder duels you have a ranked spine
   immediately.
3. **Amazon / Audible / Kindle library** — your own purchase history is a strong signal.

The screenshot importer is my favorite of these. It's a genuinely good answer to a closed
platform, it's fun, and it turns the constraint into a feature.

---

## 8. Architecture

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js (App Router) + TypeScript + Tailwind** | Best PWA story, one language |
| Host | **Vercel** | Zero-config deploys |
| Data | **Supabase** (Postgres + Auth + pgvector) | Free tier is plenty, RLS keeps it private |
| Intelligence | **Anthropic API** | Opus for portrait synthesis, Sonnet for chat and parsing |
| Offline | Service worker + IndexedDB mirror, optimistic writes | Subway-proof |

**Metadata sources** — Open Library + Google Books (books); **TMDB** (movies/TV, including
watch providers); Podcast Index or iTunes Search (podcasts); **OverDrive/Libby** for
library availability.

```
items          canonical title: medium, external ids, art, runtime/length, metadata
entries        my log: item_id, status, started/finished, score, gradient, tags[], note
comparisons    pairwise ladder results (winner, loser, medium)
queue          shortlist: item_id, context_tags[], added_reason
situations     saved contexts ("with M", "flight"), learned preferences
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

## 11. Open questions 🔵

1. **Which services do you actually subscribe to?** Netflix, Max, Prime, Hulu, Apple TV+,
   Spotify, Audible, Kindle Unlimited — plus a library card if you have one. This directly
   powers §5 and I need it before Phase 3.
2. **Region?** Streaming availability is region-locked; TMDB needs a country code.
3. **Is the ladder in?** (§4.2) My favorite idea, and the riskiest.
4. **"With M"** — is shared viewing real for you? It adds a lightweight second profile but
   it's the most common real-world recommendation problem.
5. **Amazon affiliate tagging** on Kindle links — worth setting up, or just clean links?
6. **The name.** `mediamogul` is a fine repo name; it's jokey for something this quiet.
