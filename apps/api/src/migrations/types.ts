// A single data migration. `up` applies it directly (the runner tracks applied ids in
// SchemaMigration so it runs once). `up` should ALSO be internally idempotent where cheap,
// so a partial/interrupted run can be safely re-driven.
export interface Migration {
  id: string; // stable, sortable, unique — e.g. "001-integration-defaults"
  description: string;
  up: () => Promise<void>;
}
