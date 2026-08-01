/**
 * The app-wide database handle (E1.1). UI and feature beads never import this
 * directly — all reads and writes go through the repo layer (E1.2), which
 * owns validation and exposes live queries. Constructing a Dexie instance
 * touches no browser API until the first operation opens it, so this module
 * is safe to import during SSR/prerender.
 */
import { NightstandDB } from "./schema";

export { DB_NAME, NightstandDB, schemaV1, schemaV2, schemaV3 } from "./schema";

export const db = new NightstandDB();
