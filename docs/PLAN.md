# Mediamogul — Product & Build Plan

A personal media companion: books, movies, TV, podcasts. One library, one taste model,
one place to ask "what should I do with the next 90 minutes?"

Status: **draft for discussion.** Nothing is built yet. Decisions marked 🔵 need your call.

---

## 1. The thesis

Goodreads is a *database with a social network bolted on*. You log things into it and it
gives you almost nothing back. The shelf grows, the guilt grows, and when you actually
want something to read it's useless — you end up on Reddit.

Mediamogul inverts that. **The log is not the product. The log is the training data.**

Everything you capture feeds one asset: a living, legible model of your taste. Every
surface in the app is a view into that model:

| Surface | Question it answers |
|---|---|
| **Now** | "What should I do *right now*, given my mood, my time, my company?" |
| **Library** | "What have I consumed, and what did I think?" |
| **Portrait** | "Who am I, as a consumer of stories?" |

Three tabs. That's the whole app. No feed, no friends, no streaks.

### The creative wedge: cross-media taste

Nobody does this. Goodreads knows books. Letterboxd knows film. Neither knows that the
thing you love is *slow-burn investigative structure* — and that it shows up in a podcast,
a novel, and a limited series. A single taste model across four media is the one thing a
personal app can do that no incumbent will ever ship, because incumbents are organized
around catalogs, not around a person.

That's the whole reason this is worth building.

---

## 2. Design principles (the constitution)

1. **Capture must be sub-five-seconds.** Every tracker dies at the add step. If logging
   is work, the library rots, the model starves, and the app is dead. This is priority #1
   and it gets the most engineering.
2. **Give back more than you take.** Every piece of data you enter must visibly improve
   something you can see. No write-only fields.
3. **The model is legible and arguable.** You can read what the app thinks of your taste
   and tell it that it's wrong. An editable model is a trusted model.
4. **A hand, not a haystack.** Recommendations come 3–5 at a time, each with a reason
   that references *your* history. Never an infinite grid.
5. **Beautiful because of the art, not despite it.** Covers, posters, and podcast art are
   the most beautiful assets in your life. The UI's job is to frame them and get out of
   the way.
6. **No guilt mechanics.** No streaks, no "you're 12 books behind schedule," no badges.
   The queue is a shortlist, not a debt.
7. **Offline-first.** It's a phone app. Subways exist. Every read works offline, every
   write is optimistic.

---

## 3. The five ideas that make it good

These are the parts I'd fight for. Everything else is table stakes.

### 3.1 Capture: four doors, all fast

- **Omnibox.** One search field across all four media. Type "severance" → get the show,
  the novel, and the podcast about it, grouped. One tap to log.
- **Share target.** Installed PWAs can register as a share target. Share from Spotify,
  Netflix, Libby, Amazon, Apple Podcasts → it lands in your Inbox and auto-resolves to a
  real title. This is how 60% of your logging will actually happen.
- **Just say it.** A single text/voice field: *"finished Bear s3, four stars, the fork
  episode wrecked me."* Parsed by the LLM into a logged entry with a rating and a note.
  This is the fastest possible path and it's basically free to build.
- **Barcode scan.** Camera API on a physical book jacket. Delightful, ~half a day of work.

### 3.2 Ratings: the ladder, not the stars

Five stars is a lossy, drifting, mood-contaminated instrument. Your 4-star from 2019 is
not your 4-star from today, and you know it.

So: you rate fast (a three-tap gradient — *loved / liked / fine / no*), and then the app
occasionally asks the only question that produces clean signal:

> **"*Station Eleven* or *The Overstory* — which one stays?"**

Pairwise comparison against a title of adjacent rating. Elo-style. It's ten seconds, it's
weirdly addictive, and it produces a genuinely **ranked ladder** per medium instead of a
pile of 4-star ties. The ladder is also a gorgeous screen in its own right.

We store both: a `score` (0–100, derived from the ladder) and the fast `gradient` tap.

**Plus: taste tags, contextual and optional.** After rating, 3–4 one-tap chips chosen for
that title — *pacing / ending / density / voice / world / performances*. This is what
turns "you liked it" into "you liked it *because*", and it's what makes the recommender
non-generic.

### 3.3 Rejection is the real signal

Every recommendation card can be dismissed **with a reason**: *seen it · too long · not
the mood · wrong vibe · tried it, bounced*. One tap.

Nobody collects negative signal, and it's worth more than positive signal because it's
where the model is actually wrong. This makes the app get sharply better over weeks
rather than asymptotically better over years.

### 3.4 Situations as first-class objects

"Chat with an AI" is a blank page problem — you open it and don't know what to type. So
the Now tab opens with **situation chips** you can tap, plus a freeform field:

> `45 min before bed` · `background while cooking` · `long flight` · `with M` ·
> `need to cry` · `want to feel smart` · `nothing heavy`

Tapping composes a query; typing refines it. Situations are saved objects, so
`with M` learns over time (things you both rated well). Freeform handles the rest:
*"something like Severance but funnier, under 40-minute episodes."*

**Crucially: the Now tab searches your own queue first.** If you already saved something
that fits the moment, the answer is that — not a new thing to feel guilty about. Only when
your queue has nothing appropriate does it reach for the catalog.

### 3.5 The Taste Portrait

The accretive payoff. A slow-building, beautiful page that says who you are:

- **Axes** — plot-driven ↔ vibe-driven, comfort ↔ challenge, tight ↔ sprawling,
  interior ↔ external. Positioned from your ratings and tags.
- **Obsessions** — the themes you keep returning to without noticing.
- **Blind spots** — "you've rated 40 things this year; two were translated, none were
  pre-1970." Stated as observation, never as a scold.
- **Seasonality** — you read differently in November.
- **Editable.** Every claim has a thumbs-down that corrects the model.

Year-in-review ("Wrapped") falls out of this for free and is a nice annual moment.

**Bonus that costs almost nothing once we have embeddings:** semantic search over your own
notes. *"What was the book I read where the narrator was a lighthouse keeper?"* Finding
your own memories is a genuine delight and no incumbent offers it.

---

## 4. Design language

**Editorial, warm, literary — a well-made paperback, not a streaming dashboard.**

- **Type.** A high-contrast serif for titles and numbers (editorial authority), a clean
  neutral sans for UI. Real typographic hierarchy — this is the single biggest lever on
  "feels expensive."
- **Color.** Warm neutral paper ground. Dark mode is a *warm* dark (ink and lamplight),
  not blue-black. The app's accent color is **extracted from the artwork of whatever
  you're looking at** — the app takes on the color of what you're consuming. Cheap to do,
  and it makes every detail page feel bespoke.
- **Layout.** Generous margins, big art, few borders. Separation by space and weight,
  not by lines and boxes.
- **Motion.** Restrained and physical. Shared-element transitions from cover → detail.
  Nothing bounces.
- **Density.** Library is browsable at a glance (grid of art), and scannable in depth
  (list with ratings). Toggle, remembered per medium.

🔵 **I'd like to build a visual style tile / mini design-system screen first**, so we're
agreeing on a look rather than on adjectives. Fast to produce, and it de-risks everything
downstream.

---

## 5. Architecture

Single-user, cheap, boring where boring is correct.

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js (App Router) + TypeScript + Tailwind** | Best PWA story, one language, instant deploys |
| Host | **Vercel** | Zero-config, and we have tooling wired for it |
| Data | **Supabase** (Postgres + Auth + pgvector) | Free tier is plenty, RLS keeps it private, vectors included |
| Intelligence | **Anthropic API** (Opus 5 for the portrait, Sonnet 5 for chat/parsing) | Cost-tiered by task |
| Offline | Service worker + IndexedDB mirror, optimistic writes, background sync | Subway-proof |

**Metadata sources** (all free or free-tier):
- Books — **Open Library** primary, **Google Books** fallback (covers, ISBN, page count)
- Movies & TV — **TMDB** (art, runtime, seasons, and streaming-availability providers)
- Podcasts — **Podcast Index** or the iTunes Search API (show + episode feeds)

Everything gets normalized into one `items` table with a `medium` discriminator, so
cross-media queries are trivial — which is the entire point of the app.

**Data model sketch**

```
items          canonical title: medium, external ids, art, runtime/length, metadata
entries        my log: item_id, status, started/finished, score, gradient, tags[], note
comparisons    pairwise ladder results (winner, loser, medium, timestamp)
queue          shortlist: item_id, context_tags[], added_reason
situations     saved contexts ("with M", "flight"), learned preferences
recs           what was suggested, why, and — critically — the rejection reason
portrait       versioned synthesized taste model + your manual corrections
embeddings     pgvector over items and over my own notes
```

The `recs` table with rejection reasons is the flywheel. Don't skip it.

**Cost check:** Vercel + Supabase free tiers cover this comfortably. LLM spend for one
person is realistically a few dollars a month — chat is the only hot path, and the
portrait synthesis runs weekly, not per-request.

---

## 6. Build phases

Each phase is independently useful. You could stop after Phase 2 and already have
something better than Goodreads.

**Phase 0 — Foundation** *(the design system is the real deliverable)*
Repo scaffold, Supabase schema, auth, design tokens, component primitives, PWA shell,
deploy pipeline. Ends with a style-tile screen we both look at and agree on.

**Phase 1 — Capture & Library**
Omnibox search across all four providers, item detail pages, log an entry, Library tab
with grid/list, status tracking. **This is the phase that has to feel fast.**

**Phase 2 — Rate & Rank**
Gradient rating, contextual taste tags, the pairwise ladder, the ranked-ladder screen,
the Queue with context tags.

**Phase 3 — Ask**
Now tab: situation chips, freeform chat, rec cards with personal reasons, queue-first
logic, rejection capture. This is where it stops being a tracker.

**Phase 4 — Portrait & Memory**
Embeddings, the Taste Portrait page, editable/correctable claims, semantic search over
your own notes.

**Phase 5 — Delight & Polish**
Share target, barcode scan, voice capture, dynamic color extraction, offline hardening,
shared-element transitions, install prompt, Wrapped.

**Parallelization:** Phases 0–1 are mostly sequential (everything depends on the schema
and the design system). From Phase 2 on, subagents can run in parallel — rating system,
recommendation engine, portrait, and polish touch mostly disjoint files. I'd suggest we
review at the end of each phase rather than continuously.

---

## 7. Explicit non-goals

No social graph, no friends, no feed, no sharing, no public profile. No reading
challenges or streaks. No multi-user. No native app. No monetization surface. No
"because others liked" — recommendations reference *your* history or they don't ship.

---

## 8. Open questions 🔵

1. **Seed the model.** Do you have exports from Goodreads / Letterboxd / Trakt / Spotify?
   Importing history makes the recommender good on day one instead of month three. Worth
   a lot — this is my top question.
2. **Podcasts: shows or episodes?** Episodes are the real unit but logging every episode
   is a treadmill. My proposal: **follow shows, log only standout episodes.** Agree?
3. **Streaming availability.** TMDB can tell us where a title is watchable. Useful, or
   noise?
4. **"With M."** Is shared-viewing a real situation for you? It changes the queue model
   slightly (a second, lightweight taste profile) but it's the single most common real
   recommendation problem people have.
5. **Ambition on the ladder.** Pairwise ranking is my favorite idea here but it's the most
   novel and therefore the riskiest. In or out?
6. **The name.** `mediamogul` is a fine repo name; it's a slightly jokey product name for
   something this personal and quiet. Keep, or rename?

---

## 9. One blocker on my side

I could not view the Goodreads recording. All four routes are closed:

- `drive.google.com` is **blocked by this environment's egress policy** (the proxy
  returned 403 on CONNECT — I'm not going to route around an org policy).
- The Drive connector's file download returns content **inline as base64**; at 300 MB
  that's ~400 MB of text, which no context window can hold.
- The connector's text-extraction endpoint doesn't support `video/quicktime`.
- There's no `ffmpeg` in this container to sample frames even if I had the bytes.

Easiest unblocks, in order of preference: **drop 5–10 screenshots** of the screens you
care about into Drive (PNG/JPG I can read directly), or export a handful of frames, or
just tell me in a sentence what specifically you wanted me to take from it. My plan above
is written from general knowledge of Goodreads' patterns — and mostly as a reaction
*against* them — so I don't think it's blocked, but if there was a specific interaction
you liked, I'm currently missing it.

---

## 10. What I need from you to start

A yes/no on the three tabs, a call on the ladder (Q5), and answers to Q1 and Q2. That's
enough to start Phase 0. Everything else can be decided in flight.
