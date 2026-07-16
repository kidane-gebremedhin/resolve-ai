import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// Ledger of applied data migrations, so `db:migrate` runs each one EXACTLY once and a
// re-run only applies what's new. Index sync (Mongoose `syncIndexes`) is idempotent and
// runs every time; DATA migrations are recorded here by id.
const schemaMigrationSchema = new Schema(
  {
    migrationId: { type: String, required: true, unique: true },
    appliedAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

export type SchemaMigrationDocType = InferSchemaType<typeof schemaMigrationSchema>;
export const SchemaMigration: Model<SchemaMigrationDocType> =
  mongoose.models.SchemaMigration ?? mongoose.model("SchemaMigration", schemaMigrationSchema);
