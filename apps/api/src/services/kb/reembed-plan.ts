// The decisions `scripts/reembed.ts` makes per source, kept here so they are
// testable without running the script.

/**
 * Whether `--resume` may skip a source. Complete means the mirror holds every
 * chunk AND the vectors came from the model a re-embed would use now. Checking
 * the mirror alone skipped every source on a model change, which is the one
 * run that most needs to touch all of them.
 */
export function isAlreadyCurrent(
  s: { mirrored: number; chunkCount?: number | null; embeddingModel?: string | null },
  currentModel: string,
): boolean {
  return s.mirrored > 0 && s.mirrored === (s.chunkCount ?? -1) && s.embeddingModel === currentModel;
}
