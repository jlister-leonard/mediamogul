# Nightstand

A personal media companion for books, movies, TV, and podcasts. One library, one taste
model, one place to ask *"what should I do with the next 90 minutes?"* — and then actually
get it.

No social features. No ads. No streaks. Just yours.

## Status

Planning. Nothing built yet.

- [`docs/PLAN.md`](docs/PLAN.md) — product thesis, design principles, architecture, and
  the phased build order
- [`docs/TASTE-BASELINE.md`](docs/TASTE-BASELINE.md) — analysis of the 225-book Goodreads
  export that seeds the taste model
- [`docs/EPICS.md`](docs/EPICS.md) — epics broken into beads: dependency graphs,
  acceptance criteria, file footprints, sequencing waves
- [`docs/COORDINATION.md`](docs/COORDINATION.md) — how parallel subagents build without
  colliding

## The idea

The log is not the product. The log is the training data.

Everything you capture feeds one asset: a living, legible model of your taste — across all
four media, which is the thing no incumbent will ever build, because they're organized
around catalogs and this is organized around a person.

Three surfaces:

| | |
|---|---|
| **Tonight** | What should I do right now, given my mood, my time, and what I can actually watch? |
| **Library** | What have I consumed, and what did I think? |
| **Portrait** | Who am I, as a consumer of stories? |
