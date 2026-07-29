# Session Handoff — Nightstand

**Written:** 2026-07-28 · **Repo:** `jlister-leonard/mediamogul` · **Owner:** Jeremy Lister
**Branch:** `claude/media-tracking-app-design-p7fapy` (currently == `origin/main` @ `f303466`)

Read this file, then `docs/PLAN.md` → `docs/EPICS.md` → `docs/COORDINATION.md`. You can resume
with zero prior context. Everything below is verified state, not recollection.

---

## 1. What this is

**Nightstand** — a personal, local-first PWA that tracks books, movies, TV and podcasts and
recommends across all four from one taste model. Built for one user (Jeremy). No social
features, no ads, no accounts, $0/month.

The full product argument is in `docs/PLAN.md`. The one-line thesis: **the log is not the
product, the log is the training data.** Read `docs/PLAN.md` §0 (decisions log) first — 18
decisions are locked and must not be silently relitigated.

## 2. Where the work stands

**PR #1 is MERGED** (do not reopen it). Sixteen beads are on `main`:

| Epic | Merged beads |
|---|---|
| E0 Foundation | scaffold · tokens · contracts · primitives · pwa-shell · deploy |
| E1 Data | db-schema · repo-layer |
| E2 Metadata | provider-books · provider-tmdb · provider-podcasts · resolver |
| E5 Get It | provider-registry |
| E6 Recommendations | llm-route |

Green on `main`: **380 unit tests, 11 e2e, lint/typecheck/build clean.**

Stack: Next.js 16.2.12 · TS 5.9.3 strict · Tailwind v4 · Dexie 4.4.4 (IndexedDB is the
source of truth) · zod 4.4.3 · @anthropic-ai/sdk 0.115.0 · Vitest + Playwright 1.56.1.

### In flight when the session ended

The session ended on a **weekly usage limit (resets Jul 31, 08:00 UTC)**. Five builders were
killed mid-flight and **committed nothing** — their worktrees are empty of work. Two beads have
real work committed locally in worktrees but **never pushed**.

| Bead | Remote branch (pushed — safe) | SHA | State on resume |
|---|---|---|---|
| **E0.7 style-tile** | **`wip/e0.7-style-tile`** | **`8dbe493`** | Rewritten after a FAIL. Delta-verify was in flight and never returned. **Re-review, then take to Jeremy (§3).** |
| **E5.3 branded-buttons** | **`wip/e5.3-branded-buttons`** | **`9c198f1`** | Fixed after a FAIL. Delta-verify was in flight and never returned. **Re-review, then merge.** |
| E1.4 goodreads-import | `agent-a8a71adde6dc73235` | — | Killed at research. Relaunch from scratch. |
| E4.1 genre-assign | `agent-a2a2c587d12403c97` | — | Killed at research. Relaunch from scratch. |
| E5.1 availability | `agent-a337ed7d962f593ca` | — | Killed while writing. Relaunch from scratch. |
| E1.3 export-import | `agent-a4782376f20a96a64` | — | Killed at research. Relaunch from scratch. |
| E4.2 ladder-engine | `agent-a85dd558e30b415c1` | — | Killed at research. Relaunch from scratch. |

**First action on resume, in order:**
1. `git fetch origin` — both beads are on the remote, so nothing depends on the container
   surviving. Cherry-pick with `git cherry-pick 8dbe493` / `9c198f1`, or work from the
   `wip/*` branches directly. Delete the `wip/*` branches once merged.
2. Blind-review those two (they have never been verified in their current form), merge on pass.
3. Relaunch the five killed beads. Their full briefs are reconstructible from `docs/EPICS.md`
   plus the constraints in §7 — nothing about them was lost except the agents' working time.

## 3. 🚦 THE BLOCKING DECISION — ask Jeremy first

**The E0.7 style tile needs Jeremy's approve/veto before ANY wave-6 UI bead is built.**
Blocked behind it: E2.5 omnibox, E3.1–E3.4 (log flow, library views, detail page, library
search), E4.3 duel-ui, E4.5 ladder-screen. That is the largest remaining chunk of the app.

He was shown an earlier version and **has not answered**. That version FAILED review for
fabricated copy (details in §7); the rewritten `8dbe493` is honest but **unverified and
unseen by him**. Do not treat "approve and merge all open PRs" (his instruction about PR #1)
as a design verdict — it wasn't one.

Screenshots regenerate via the bead's own e2e spec; write them to `style-tile-shots/`
(gitignored). Show dark + light + dismiss-open at 390px.

### Three other open questions (non-blocking, asked but unanswered)

1. **Deploy timing** — live on Vercel as soon as the library is browsable, or only once
   recommendations work end to end? He must paste two env vars himself: `ANTHROPIC_API_KEY`
   and `TMDB_API_KEY` (both free). See `.env.example`.
2. **Comfort titles** — excluded from rec *signal* by design; should they also be *rankable*
   on their own ladder, or is ranking childhood favourites missing the point?
3. **Onboarding calibration** — 10 of his 13 lowest ratings are assigned high-school English.
   Ask him once whether that was the books or the circumstance, or just assume the latter?

## 4. How work gets done — the protocol that produced the quality

Full text in `docs/COORDINATION.md`. The short version, and **do not skip the gate** — it has
caught a data-loss bug, a billing leak, and a fabricated-copy incident that all passed their
own bead's tests:

1. **Hub and spoke.** One orchestrator (you). Subagents never talk to each other; everything
   routes through you. You are the only actor with global context.
2. **One bead per subagent**, with an **exclusive file footprint** (`owns` in EPICS). A bead's
   footprint is a lease: while it's in flight, nobody else writes those paths.
3. **Blind review, always.** A *fresh* agent that has seen none of the builder's reasoning
   gets only the spec + the diff. It judges: correctness · absolute perfection · total
   essentialism · **delight, against a "10× better than Goodreads/Letterboxd" bar** ("fine" is
   a failing grade). It must re-run every AC itself and probe adversarially rather than read.
4. **Fail → fix → delta-verify** by the *same* reviewer, which re-probes rather than re-reads.
5. **Serial merge queue.** Cherry-pick one bead at a time; full suite green between merges.

### Hard-won operational rules (each cost a real incident)

- **NEVER `git stash` in a worktree** — the stash stack is shared repo-wide and two agents'
  work got crossed. Use a WIP commit instead.
- **E2E on a dedicated port** via a temp config deleted before commit. Port 3000 is contended.
  To kill only your own server, match `readlink /proc/<pid>/cwd`; **never `pkill -f next`**.
  A stale server serving an overwritten `.next` produces phantom axe violations.
- **Worktrees can be provisioned on a stale base.** Every builder prompt must start with
  `git fetch origin main && git reset --hard <tip>` and a HEAD check.
- **Builder amend commits trip the security classifier.** That's expected; the reviewer's
  interdiff check is the real safeguard. Always instruct the reviewer to verify the interdiff
  is confined to the footprint.
- **Egress is heavily restricted.** Only `www.googleapis.com` is reachable (and its keyless
  quota is exhausted). Open Library, TMDB, iTunes, Spotify, brand-asset hosts: all blocked.
  Providers are therefore **fixture-first** with `describe.skipIf` live smokes that auto-skip.
  npm and pypi ARE reachable.
- **Ask builders to mutation-test.** Break the fix, confirm a specific test dies. This is how
  the gate distinguishes real coverage from decorative coverage — a claimed-but-absent test
  was caught exactly this way.

## 5. Merge procedure

```bash
git cherry-pick <bead-sha>                    # resolve package.json dep conflicts by union
npm ci && npm run lint && npm run typecheck
npx vitest run && npm run build && npx playwright test
git push -u origin claude/media-tracking-app-design-p7fapy
```
Then update the **status board** at the top of `docs/EPICS.md` (bead → done, with the review
verdict and any constraint it recorded for later beads).

**PR #1 is merged. Open a NEW PR** for this branch once the first bead lands. Include the
attribution footer on GitHub comments; subscribe to PR activity after opening.

## 6. What to build next, in order

Non-UI beads (unblocked, safe to fan out now): **E5.4** theaters/Fandango · **E5.5**
getit-order (re-scoped — see EPICS; the *layout* shipped in E5.3, this bead owns ordering
logic) · **E6.2** taste-context · **E2.6** books-union.

UI beads (blocked on §3): **E2.5** omnibox · **E3.1–E3.4** · **E4.3** · **E4.5**.

Then: **E6.3** recs-hand → **E6.4** chat → **E6.5** situations · **E6.6** rejection →
**E7** portrait → **E8** polish. Second human gate at **E7.2** (portrait design).

## 7. Constraints and traps that will bite you

These were each discovered by a review. They are recorded in EPICS against the beads they
affect, but they're worth reading before you write anything.

- **`now_playing` is capped at 5 pages: presence implies in-theaters, absence implies
  NOTHING.** No negative inference (E5.1, E5.4).
- **Availability `kind` must come from the TMDB payload array** (flatrate/rent/buy), never
  from provider id — the registry folds storefront ids into subscription brands, so inferring
  from identity would show rentals as "included with your subscription".
- **`openLibraryId` names a *work*; `isbn13`/`googleBooksId` name an *edition*.** Vetoing
  dedupe on edition ids splits Dune's printings; not vetoing on work ids deletes Caro's LBJ
  volumes. Only work ids veto.
- **`Into Thin Air` is `grit-wilderness`, not `lives`.** It looks like biography by shape and
  isn't by taxonomy. E4.1's classifier will hit this class of error at scale.
- **The dynamic-accent idea inverts elevation in light mode** unless the card tints the
  *brighter* token — a dark light-mode accent pulls a "raised" surface below the ground.
  E8.4 owns this rule.
- **`scroll-margin`/`scroll-padding` are inert against Chromium's focus scrolling.** Any
  horizontal rail needs an explicit `scrollIntoView` handler or it slices focus rings
  (`RingScroller` in E5.3 is the working pattern; lift it if a second caller appears).
- **Two kinds of five-star.** The nostalgia cluster (Alex Rider ×7, Harry Potter ×6, Dr.
  Seuss) must be `comfort` mode and excluded from rec signal, or the recommender concludes
  "loves YA spy thrillers". See `docs/TASTE-BASELINE.md` Finding 3.
- **Negative ratings are context-contaminated.** 10 of 13 lowest are assigned school reading;
  *The Road* is on his to-read shelf, which disproves the naive "excludes literary fiction"
  inference. Finding 4.
- **Behavioural evidence rules things out:** 1 review written in 225 books (don't build
  review-writing), unused shelves (auto-derive genre, never ask), 43% date coverage (no
  date-dependent features). Finding 5.
- **A bead's exclusive lease means a missing verb is a verb nobody may add later.** Judge
  data-layer completeness against what the lease makes reachable, not against today's
  consumers. This is why E1.2 initially failed.

## 8. Repo-side TODOs only Jeremy can do

- Mark the `ci` check **required on `main`** (branch protection) — the workflow exists but
  nothing enforces it (recorded in `.github/workflows/ci.yml` header).
- Link the **Vercel project** and paste `ANTHROPIC_API_KEY`, `TMDB_API_KEY`,
  `NIGHTSTAND_PASSPHRASE`.
- Optional: enable commit signing or switch to squash-merge — the PR #1 merge commit shows as
  "Unverified" because GitHub authored it under his account. **Do not rewrite it**; it is
  merged public history.
- Device pass for iOS deep links (E5.3's "(iOS tested)" AC is deliberately unticked), which
  also covers the registry's `UNVERIFIED` search-URL flags on HBO Max, Peacock, Disney+.

## 9. Tone and standard

Jeremy asked for a subagent "blindly reviewing each submission for absolute perfection, total
essentialism, and total delight," passing only when it genuinely believes the result is **at
least 10× better than Goodreads and Letterboxd**. Hold that bar literally — reviewers have
failed beads for a two-line ragged tab label and a sliced focus ring, and both were right to.

Report to him in plain language: what merged, what failed and why it mattered, what you need
from him. He is a product designer and reads the design reasoning, not just the status.
