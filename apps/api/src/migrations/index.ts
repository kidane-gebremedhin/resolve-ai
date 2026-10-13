import type { Migration } from "./types.js";
import { migration as m001 } from "./001-integration-defaults.js";
import { migration as m002 } from "./002-purge-orphan-kb-chunks.js";
import { migration as m003 } from "./003-grandfather-email-verification.js";
import { migration as m004 } from "./004-otp-default-get-subscription.js";

// Ordered registry of data migrations. `db:migrate` runs any not yet recorded in the
// SchemaMigration ledger, in this order. Append new migrations at the end with the next
// zero-padded id; never reorder or reuse an id.
export const migrations: Migration[] = [m001, m002, m003, m004];

export type { Migration } from "./types.js";
