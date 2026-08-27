/**
 * Cost settle pass.
 *
 * There is no local price table in this repo. `recordConversationUsage` fires
 * and forgets, then asks OpenRouter's `/generation?id=` endpoint for the price;
 * that endpoint 404s until the generation record lands and may answer before the
 * cost is finalised. `fetchGeneration` retries and, when it gives up, returns
 * null — and `recordUsage` writes the `UsageRecord` anyway with zeros.
 *
 * So a naive read at the end of a run reports 0.00 for calls that actually cost
 * money, and those zeros are indistinguishable from free ones. This module's
 * whole job is to keep that distinction: a case is either resolved with a real
 * figure, or reported as unknown. It never reports an unresolved case as zero.
 */
import { UsageRecord } from "@api/models/index.js";
import { fetchGeneration } from "@api/services/openrouter-usage.service.js";

export type ResolvedCost = {
  costUsd: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  resolved: boolean;
};

const UNRESOLVED: ResolvedCost = {
  costUsd: null,
  promptTokens: null,
  completionTokens: null,
  resolved: false,
};

/**
 * Decide whether a usage row actually carries a price.
 *
 * Tokens are the tell. `fetchGeneration` fills tokens and cost from the same
 * response, so a row that names generations but reports zero tokens is one where
 * every fetch gave up, not one that genuinely consumed nothing. A row with
 * tokens is trustworthy even if its cost rounds to zero.
 */
export function interpretUsageRow(row: {
  generationIds?: string[];
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
} | null): ResolvedCost {
  if (!row) return UNRESOLVED;
  const prompt = row.promptTokens ?? 0;
  const completion = row.completionTokens ?? 0;
  const named = (row.generationIds ?? []).length;

  if (named > 0 && prompt === 0 && completion === 0) return UNRESOLVED;
  if (named === 0 && prompt === 0 && completion === 0) return UNRESOLVED;

  return {
    costUsd: row.costUsd ?? 0,
    promptTokens: prompt,
    completionTokens: completion,
    resolved: true,
  };
}

/**
 * Poll for the usage rows the run's conversations produced.
 *
 * The recorder runs fire-and-forget with its own retry budget, so the row lands
 * some seconds after the reply. Polling is bounded: whatever has not resolved by
 * the deadline is reported as unknown rather than waited on forever.
 */
export async function settleCosts(args: {
  conversationIds: string[];
  timeoutMs?: number;
  intervalMs?: number;
  log?: (msg: string) => void;
}): Promise<Map<string, ResolvedCost>> {
  const timeoutMs = args.timeoutMs ?? 90_000;
  const intervalMs = args.intervalMs ?? 3_000;
  const log = args.log ?? (() => {});
  const out = new Map<string, ResolvedCost>();
  for (const id of args.conversationIds) out.set(id, UNRESOLVED);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pending = [...out.entries()].filter(([, v]) => !v.resolved).map(([k]) => k);
    if (pending.length === 0) break;

    const rows = await UsageRecord.find({ conversationId: { $in: pending } })
      .select("conversationId generationIds promptTokens completionTokens costUsd")
      .lean();

    for (const row of rows) {
      const key = String(row.conversationId);
      const interpreted = interpretUsageRow(row);
      if (interpreted.resolved) out.set(key, interpreted);
    }

    const stillPending = [...out.values()].filter((v) => !v.resolved).length;
    if (stillPending === 0) break;
    log(`  waiting on ${stillPending} unresolved cost(s)…`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return out;
}

/**
 * Sum the resolved costs, and count what never resolved.
 *
 * The total is null when nothing resolved at all: a run that priced nothing
 * should print a blank, not a confident $0.00.
 */
export function totalCost(costs: readonly ResolvedCost[]): {
  totalUsd: number | null;
  unresolved: number;
} {
  const resolved = costs.filter((c) => c.resolved);
  return {
    totalUsd: resolved.length === 0 ? null : resolved.reduce((s, c) => s + (c.costUsd ?? 0), 0),
    unresolved: costs.length - resolved.length,
  };
}

/**
 * Price the judge's own calls.
 *
 * Judge tokens are the harness's only inherent spend, so this number is what a
 * decision about eval budget actually rests on. It goes through the same
 * `fetchGeneration` retry path production uses: reimplementing the
 * 404-until-the-record-lands behaviour here would get it subtly wrong in
 * exactly the direction that under-reports cost.
 *
 * Returns null when nothing priced, never 0. A judge that ran 19 times did not
 * cost nothing, and printing $0.00 would invite budgeting against a fiction.
 */
export async function priceJudgeCalls(generationIds: readonly string[]): Promise<{
  totalUsd: number | null;
  resolved: number;
  unresolved: number;
}> {
  if (generationIds.length === 0) return { totalUsd: null, resolved: 0, unresolved: 0 };

  const results = await Promise.all(generationIds.map((id) => fetchGeneration(id)));
  const priced = results.filter((r): r is NonNullable<typeof r> => r !== null);

  return {
    totalUsd: priced.length === 0 ? null : priced.reduce((s, r) => s + (r.total_cost ?? 0), 0),
    resolved: priced.length,
    unresolved: results.length - priced.length,
  };
}
