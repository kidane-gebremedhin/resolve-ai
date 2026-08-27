/**
 * Backfill the payment ledger from Paddle, so billing history is not empty for
 * organizations that were already subscribed before the ledger existed.
 *
 * Usage (from apps/api):
 *   pnpm tsx scripts/backfill-paddle-payments.ts --dry-run   # count only, no writes
 *   pnpm tsx scripts/backfill-paddle-payments.ts             # backfill every org
 *   pnpm tsx scripts/backfill-paddle-payments.ts --org <id>  # one organization
 *   pnpm tsx scripts/backfill-paddle-payments.ts --after 2025-01-01
 *
 * Safe to re-run. Every write goes through the same upsert-by-transaction-id
 * path the webhook uses, so a second run converges on the same rows rather than
 * duplicating them, and a run interrupted halfway can simply be started again.
 *
 * Rate limiting: Paddle allows a burst then throttles. We page at 50 per
 * request and sleep between pages, and back off on a 429 rather than hammering.
 */
import { connectDb, disconnectDb } from "../src/config/db.js";
import { Payment, Subscription } from "../src/models/index.js";
import { logger } from "../src/config/logger.js";
import { applyTransactionEvent } from "../src/services/payment.service.js";

const PADDLE_API_BASE =
  (process.env.PADDLE_ENVIRONMENT ?? "sandbox") === "production"
    ? "https://api.paddle.com"
    : "https://sandbox-api.paddle.com";

const PAGE_SIZE = 50;
const PAGE_DELAY_MS = 350;
const MAX_RETRIES = 5;

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function paddleGet(path: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.PADDLE_API_KEY;
  if (!apiKey) throw new Error("PADDLE_API_KEY not set");

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${PADDLE_API_BASE}${path}`, {
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    });
    if (res.status === 429) {
      // Honour Paddle's own backoff hint when it sends one; otherwise widen
      // exponentially. Retrying immediately just burns the next window too.
      const retryAfter = Number(res.headers.get("retry-after") ?? "0");
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500;
      logger.warn(`[backfill] rate limited, waiting ${waitMs}ms`, { path, attempt });
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) throw new Error(`Paddle ${path} ${res.status}: ${await res.text()}`);
    return (await res.json()) as Record<string, unknown>;
  }
  throw new Error(`Paddle ${path}: still rate limited after ${MAX_RETRIES} attempts`);
}

type Txn = Record<string, unknown>;

async function fetchTransactions(subscriptionId: string, after?: string): Promise<Txn[]> {
  const out: Txn[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      subscription_id: subscriptionId,
      per_page: String(PAGE_SIZE),
    });
    if (after) params.set("billed_at[GT]", `${after}T00:00:00Z`);
    if (cursor) params.set("after", cursor);

    const body = await paddleGet(`/transactions?${params.toString()}`);
    const data = (body.data as Txn[] | undefined) ?? [];
    out.push(...data);

    const meta = body.meta as { pagination?: { has_more?: boolean; next?: string } } | undefined;
    const hasMore = Boolean(meta?.pagination?.has_more) && data.length > 0;
    // Paddle returns `next` as a full URL; the cursor is its `after` parameter.
    cursor = hasMore ? new URL(meta!.pagination!.next!).searchParams.get("after") ?? undefined : undefined;
    if (cursor) await sleep(PAGE_DELAY_MS);
  } while (cursor);

  return out;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const orgId = arg("--org");
  const after = arg("--after");

  await connectDb();

  const filter: Record<string, unknown> = {
    source: "paddle",
    paddleSubscriptionId: { $ne: null },
  };
  if (orgId) filter.organizationId = orgId;

  const subs = await Subscription.find(filter)
    .select({ _id: 1, organizationId: 1, paddleSubscriptionId: 1 })
    .lean();

  console.log(
    `[backfill] ${subs.length} Paddle subscription(s) to scan${dryRun ? " (dry run, no writes)" : ""}`,
  );

  let fetched = 0;
  let written = 0;
  let skipped = 0;
  let failed = 0;

  for (const sub of subs) {
    const paddleId = sub.paddleSubscriptionId as string;
    try {
      const txns = await fetchTransactions(paddleId, after);
      fetched += txns.length;

      for (const txn of txns) {
        const txnId = typeof txn.id === "string" ? txn.id : null;
        if (!txnId) continue;

        if (dryRun) {
          const exists = await Payment.exists({ providerTransactionId: txnId });
          if (exists) skipped += 1;
          else written += 1;
          continue;
        }

        // Reuse the webhook's own handler so backfilled rows are byte-identical
        // to live ones. `occurred_at` comes from the transaction itself, which
        // keeps the out-of-order guard meaningful: a later live webhook for the
        // same transaction still wins.
        await applyTransactionEvent({
          event_type: "transaction.completed",
          occurred_at: (txn.billed_at as string | undefined) ?? (txn.created_at as string | undefined),
          data: txn,
        });
        written += 1;
      }
      await sleep(PAGE_DELAY_MS);
    } catch (err) {
      failed += 1;
      logger.error("[backfill] subscription failed", {
        paddleSubscriptionId: paddleId,
        err: (err as Error).message,
      });
    }
  }

  console.log(
    `[backfill] done. transactions fetched=${fetched} ${dryRun ? "would write" : "written"}=${written} already-present=${skipped} subscriptions-failed=${failed}`,
  );
  if (failed > 0) {
    console.log("[backfill] re-run to retry the failed subscriptions; the run is idempotent.");
  }

  await disconnectDb();
}

main().catch((err) => {
  logger.error("[backfill] fatal", { err: (err as Error).message });
  process.exit(1);
});
