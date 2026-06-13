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

// Called fire-and-forget after each generateAiReply invocation.
// Fetches cost data for all LLM calls in the turn, aggregates them, persists a
// UsageRecord, then triggers budget alert checks.
export async function recordConversationUsage(opts: {
  generationIds: string[];
  organizationId: string | mongoose.Types.ObjectId;
  websiteId?: string | mongoose.Types.ObjectId | null;
  conversationId?: string | mongoose.Types.ObjectId | null;
  model: string;
}): Promise<void> {
  const { generationIds, organizationId, websiteId, conversationId, model } = opts;

  if (generationIds.length === 0) return;

  // Fetch cost for each generation in parallel.
  const results = await Promise.all(generationIds.map((id) => fetchGeneration(id)));

  let promptTokens = 0;
  let completionTokens = 0;
  let costUsd = 0;
  for (const data of results) {
    if (!data) continue;
    promptTokens += data.tokens_prompt ?? 0;
    completionTokens += data.tokens_completion ?? 0;
    costUsd += data.total_cost ?? 0;
  }

  const period = currentPeriod();

  try {
    await UsageRecord.create({
      organizationId,
      websiteId: websiteId ?? null,
      conversationId: conversationId ?? null,
      generationIds,
      model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd,
      period,
    });
  } catch (err) {
    logger.error("[usage] failed to save UsageRecord", { err: (err as Error).message });
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
