/**
 * The repo layer (E1.2) — Nightstand's data verbs.
 *
 * Every read and write in the app goes through here: no bead outside
 * `lib/db/` imports Dexie or the `db` singleton (COORDINATION.md footprints;
 * E1.1's schema layer deliberately does not validate, so this is the single
 * gate every record passes on its way into IndexedDB).
 *
 * Reactive reads live one module over, in `./hooks` — that file is
 * `"use client"`, so it is imported directly by the components that need it
 * rather than re-exported here, keeping these verbs usable from anywhere.
 */
export {
  RepoConflictError,
  RepoError,
  RepoNotFoundError,
  RepoValidationError,
  type RepoErrorCode,
  type RepoTable,
} from "./errors";

export {
  addItem,
  getItem,
  itemsByGenre,
  itemsByMedium,
  listItems,
  setAutoItemGenreIfAllowed,
  setItemGenre,
} from "./items";

export {
  abandonEntry,
  entriesByItemId,
  entriesByStatus,
  finishEntry,
  listEntries,
  openEntryByItemId,
  rateEntry,
  setEntryScore,
  startEntry,
  type EntryRating,
} from "./entries";

export {
  appendComparison,
  replayComparisonsByGenre,
  type ComparisonInput,
} from "./comparisons";

export {
  addToQueue,
  listQueue,
  queueItemByItemId,
  removeFromQueue,
  type QueueAddInput,
} from "./queue";

export {
  createSituation,
  deleteSituation,
  getSituation,
  listSituations,
  updateSituation,
  type SituationInput,
  type SituationPatch,
} from "./situations";

export {
  availabilityByItemId,
  availabilityRefreshByItemId,
  availabilityStaleBefore,
  refreshAvailabilityForItem,
  refreshAvailabilityState,
  readAvailabilityState,
  type AvailabilityState,
} from "./availability";

export {
  markRecRejected,
  recHistoryByRecency,
  recordRec,
  recsBySituationId,
  type RecInput,
} from "./recs";

export {
  appendPortraitVersion,
  latestPortrait,
  type PortraitInput,
} from "./portrait";

export {
  readSnapshot,
  resolveManualMatch,
  restoreSnapshot,
  restoreSnapshotIfEmpty,
  type RepoSnapshot,
} from "./snapshot";
