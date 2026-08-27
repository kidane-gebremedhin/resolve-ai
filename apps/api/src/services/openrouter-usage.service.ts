import { logger } from "../config/logger.js";
import { UsageRecord } from "../models/index.js";
import { checkAndSendBudgetAlerts } from "./budget-alert.service.js";
import type mongoose from "mongoose";

const OPENROUTER_URL =
  process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

type GenerationData = {
  id: string;
  model: string;
  total_cost: number;
  tokens_prompt: number;
  tokens_completion: number;
};

// A generation that OpenRouter has not finished billing yet is not queryable
// yet either: /generation answers 404 until the record lands, typically a few
// seconds after the call returns. That is the normal "not ready" signal, so it
// must be retried — a 404 here says nothing about whether the generation exists.
//
// Anything the caller cannot fix by waiting (bad key, malformed id) is final and
// ends the loop immediately.
function isRetryableGenerationStatus(status: number): boolean {
  return status === 404 || status === 408 || status === 429 || status >= 500;
}

// Fetch the cost for a single OpenRouter generation.
// Retries up to maxAttempts times with `delayMs` between attempts because
// OpenRouter may not have finalized billing immediately after a call.
// Exported so the offline eval harness can price its judge calls through the
// same fetch-and-retry path production uses, rather than reimplementing the
// 404-until-it-lands behaviour and getting it subtly wrong.
export async function fetchGeneration(
  generationId: string,
  maxAttempts = 5,
  delayMs = 2000,
): Promise<GenerationData | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${OPENROUTER_URL}/generation?id=${encodeURIComponent(generationId)}`, {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const retryable = isRetryableGenerationStatus(res.status);
        // Only log the give-up case at warn — a 404 on an early attempt is the
        // expected path, not an incident.
        if (!retryable || attempt === maxAttempts) {
          logger.warn(`[usage] /generation fetch failed: ${res.status}`, { generationId, attempt });
        }
        if (!retryable) break;
      } else {
        const json = (await res.json()) as { data?: GenerationData };
        const data = json.data;
        if (data && typeof data.total_cost === "number") {
          return data;
        }
        // Queryable, but the cost is not finalised yet — retry.
      }
    } catch (err) {
      logger.warn("[usage] /generation fetch error", { generationId, attempt, err: (err as Error).message });
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  logger.warn("[usage] giving up on generation cost — recording zero", { generationId, maxAttempts });
  return null;
}

function currentPeriod(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${mm}`;
}

export type UsageFeature =
  | "widget_reply"
  | "suggestions"
  | "enhance"
  | "ticket_summary"
  | "embedding";

// General usage recorder — meters EVERY AI/token spend, whatever the feature. Two ways to supply
// cost: (1) `generationIds` (chat calls) → per-generation cost fetched from OpenRouter's
// /generation endpoint; (2) direct `promptTokens`/`completionTokens`/`costUsd` (e.g. embeddings,
// which OpenRouter's /generation endpoint doesn't price). Persists a UsageRecord tagged with the
// feature, then runs budget-alert checks. Fire-and-forget; never throws to the caller.
/**
 * What a turn actually cost, once OpenRouter has resolved every generation.
 *
 * Returned rather than only written to `UsageRecord` because online RAG
 * telemetry needs the same numbers on its own document, and re-fetching the
 * generations there would mean paying for the lookup twice and asking OpenRouter
 * the same question twice per turn.
 *
 * `null` means UNRESOLVED, not free. See the give-up rule below.
 */
export type UsageTotals = {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
};

export async function recordUsage(opts: {
  feature: UsageFeature;
  organizationId: string | mongoose.Types.ObjectId;
  websiteId?: string | mongoose.Types.ObjectId | null;
  conversationId?: string | mongoose.Types.ObjectId | null;
  model: string;
  generationIds?: string[];
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
}): Promise<UsageTotals | null> {
  const { feature, organizationId, websiteId, conversationId, model } = opts;
  const generationIds = opts.generationIds ?? [];

  let promptTokens = opts.promptTokens ?? 0;
  let completionTokens = opts.completionTokens ?? 0;
  let costUsd = opts.costUsd ?? 0;

  if (generationIds.length > 0) {
    // Fetch cost for each generation in parallel (OpenRouter chat calls).
    const results = await Promise.all(generationIds.map((id) => fetchGeneration(id)));
    for (const data of results) {
      if (!data) continue;
      promptTokens += data.tokens_prompt ?? 0;
      completionTokens += data.tokens_completion ?? 0;
      costUsd += data.total_cost ?? 0;
    }
  }

  // Nothing to record (no generations, no tokens) — skip.
  if (generationIds.length === 0 && promptTokens === 0 && completionTokens === 0 && costUsd === 0) {
    return null;
  }

  /**
   * A row that NAMES generations but reports zero tokens is a give-up, not a
   * measurement (__specs/39, "Cost is the trap").
   *
   * OpenRouter's `/generation?id=` endpoint 404s until the record lands, and
   * `fetchGeneration` eventually stops retrying and returns null — at which
   * point these three numbers are still their initial zeros. The `UsageRecord`
   * is written with them anyway, deliberately, so the row exists for
   * reconciliation. What must NOT happen is those zeros being handed back to a
   * caller as though they were resolved: RAG telemetry writes them onto the
   * turn, the dashboard counts the turn as priced, and an operator reads
   * "$0.0000 per conversation" for an assistant that is costing real money.
   *
   * So: written as zero, returned as unknown.
   */
  const gaveUp = generationIds.length > 0 && promptTokens === 0 && completionTokens === 0;
  if (gaveUp) {
    logger.warn("[usage] generation costs never resolved — reporting unknown", {
      feature,
      generationIds: generationIds.length,
    });
  }

  const period = currentPeriod();

  try {
    await UsageRecord.create({
      organizationId,
      websiteId: websiteId ?? null,
      conversationId: conversationId ?? null,
      feature,
      generationIds,
      model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd,
      period,
    });
  } catch (err) {
    logger.error("[usage] failed to save UsageRecord", { feature, err: (err as Error).message });
    return null;
  }

  // Trigger alert checks after persisting. Errors here must not propagate.
  try {
    await checkAndSendBudgetAlerts({
      organizationId: String(organizationId),
      websiteId: websiteId ? String(websiteId) : null,
      period,
    });
  } catch (err) {
    logger.error("[usage] budget alert check failed", { err: (err as Error).message });
  }

  return gaveUp ? null : { promptTokens, completionTokens, costUsd };
}

// Back-compat wrapper for the widget agent turn (tool-loop + final reply combined).
export async function recordConversationUsage(opts: {
  generationIds: string[];
  organizationId: string | mongoose.Types.ObjectId;
  websiteId?: string | mongoose.Types.ObjectId | null;
  conversationId?: string | mongoose.Types.ObjectId | null;
  model: string;
}): Promise<UsageTotals | null> {
  if (opts.generationIds.length === 0) return null;
  return recordUsage({ feature: "widget_reply", ...opts });
}
