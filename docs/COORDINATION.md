# Subagent Coordination Protocol

How parallel subagents build Nightstand without colliding. This is the working agreement
every spawned agent receives; the orchestrator (the main session) enforces it.

## The model: hub and spokes

Subagents in this harness do not talk peer-to-peer; all communication routes through the
orchestrator, which can message any running agent mid-flight (`SendMessage`) and receives
each agent's completion report. That constraint is used as a feature — the orchestrator is
the single scheduler, merge point, and conflict resolver. "Real-time" coordination means:

1. **Contract-first.** `E0.3 contracts` lands before parallel work begins. Every bead
   builds against `lib/types/*` — agents integrate through types, not through reading
   each other's diffs.
2. **Exclusive file footprints.** A bead's `owns` list in `EPICS.md` is a lease: while a
   bead is in flight, no other agent may write those paths. Footprints were drawn to be
   disjoint per wave, so two agents wanting the same file is a planning bug — surfaced
   immediately, not merged around.
3. **Interface-change broadcast.** An agent that must alter a shared contract stops,
   reports the needed change, and the orchestrator applies it and messages every affected
   in-flight agent before work resumes. No agent ever edits `lib/types/*` from a feature
   bead.
4. **Worktree isolation + serialized merges.** Same-wave agents run in isolated git
   worktrees; the orchestrator merges completed beads one at a time onto the feature
   branch, running the full check suite between merges. Conflicts get caught at the only
   place they can exist — the merge queue — by the only actor with global context.
5. **Status ledger.** `EPICS.md` bead statuses are the single source of truth, updated
   only by the orchestrator at claim/land time, so the graph always reflects reality.

## The bead lifecycle

```
todo → claimed (orchestrator assigns, records agent + worktree)
     → in-progress (agent builds; may message orchestrator with questions/blockers)
     → review (BLIND REVIEW GATE — see below)
     → done (merged; dependent beads unblock)          — or —
     → back to todo (gate failed; findings attached to the bead)
```

## The blind review gate

Every bead submission is judged by a **fresh reviewer subagent that has seen none of the
builder's reasoning** — only the spec (PLAN, EPICS bead definition) and the diff. Blind,
so the reviewer can't inherit the builder's rationalizations. The reviewer verdicts on
four axes, and the orchestrator merges nothing without a pass:

1. **Correctness** — every AC verified against the actual code, not the builder's claims.
2. **Absolute perfection** — no sloppiness: no dead code, no TODO stubs, no "works on my
   machine," no unhandled edge the AC implies.
3. **Total essentialism** — everything present is necessary; anything speculative,
   decorative, or "while I was in there" gets the bead sent back. The reviewer asks of
   every file: *would the product be worse without this?*
4. **Product delight** — for user-facing beads: is this experience genuinely delightful?

**The 10× bar.** For every user-facing bead, the reviewer must answer one final question:
*does this surface, as built, make Nightstand at least 10× better than the equivalent
surface in Goodreads or Letterboxd?* — measured against the real teardowns in PLAN §2 and
TASTE-BASELINE Finding 7 (postage-stamp art, buried ratings, ads in your own library,
DATE ADDED as the only order, no reasons, no availability). The reviewer must *genuinely
believe it*, and say why in one paragraph. "Better" is not the bar. Infra beads instead
answer: *does this enable the 10× surfaces with zero compromise?*

A failed verdict returns the bead with specific findings. There is no arguing with the
gate; the builder fixes and resubmits. Two consecutive failures escalate to the
orchestrator for a spec-level decision.

An agent's completion report must state: which ACs pass and how each was verified, any
files touched outside its footprint (expected: none), and anything discovered that
changes another bead (fed back into `EPICS.md` before dependents launch).

## Standing rules for every subagent

- Build only your bead. Adjacent problems get reported, not fixed.
- Your ACs are the definition of done — all of them, verified, not "should work."
- Tests live inside your footprint and run green before you report.
- Never edit: `lib/types/*`, `EPICS.md`, another bead's footprint, or merge anything.
- Blocked or surprised → message the orchestrator immediately; don't improvise around a
  contract.
- Match the codebase's existing idiom; no new dependencies without orchestrator sign-off.
- **Never `git stash` in a worktree.** The stash stack is shared repo-wide across all
  worktrees; parallel stash/pop WILL cross agents' work (this happened — wave 3). Need a
  clean tree? Make a WIP commit on your worktree branch and amend it later.
- E2E tests in a shared container: run on your own dedicated port via a temp config
  outside your commit; never rely on port 3000 and never kill another agent's server.

## Human gates

Two beads stop the line for Jeremy: **E0.7 style tile** (before any wave-6 UI) and
**E7.2 portrait design**. Everything else proceeds autonomously, with phase-boundary
check-ins per `PLAN.md` §9.
