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

// Fetch the cost for a single OpenRouter generation.
// Retries up to maxAttempts times with `delayMs` between attempts because
// OpenRouter may not have finalized billing immediately after a call.
async function fetchGeneration(
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
        logger.warn(`[usage] /generation fetch failed: ${res.status}`, { generationId, attempt });
        break;
      }
      const json = (await res.json()) as { data?: GenerationData };
      const data = json.data;
      if (data && typeof data.total_cost === "number") {
        return data;
      }
      // Cost not finalised yet — retry.
    } catch (err) {
      logger.warn("[usage] /generation fetch error", { generationId, attempt, err: (err as Error).message });
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
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
}): Promise<void> {
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
    return;
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
    return;
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
}

// Back-compat wrapper for the widget agent turn (tool-loop + final reply combined).
export async function recordConversationUsage(opts: {
  generationIds: string[];
  organizationId: string | mongoose.Types.ObjectId;
  websiteId?: string | mongoose.Types.ObjectId | null;
  conversationId?: string | mongoose.Types.ObjectId | null;
  model: string;
}): Promise<void> {
  if (opts.generationIds.length === 0) return;
  await recordUsage({ feature: "widget_reply", ...opts });
}
