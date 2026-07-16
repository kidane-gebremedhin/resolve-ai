import type { Migration } from "./types.js";
import { migration as m001 } from "./001-integration-defaults.js";

// Ordered registry of data migrations. `db:migrate` runs any not yet recorded in the
// SchemaMigration ledger, in this order. Append new migrations at the end with the next
// zero-padded id; never reorder or reuse an id.
export const migrations: Migration[] = [m001];

export type { Migration } from "./types.js";
