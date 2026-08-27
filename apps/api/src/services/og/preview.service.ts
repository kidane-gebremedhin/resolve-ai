import { parse as parseHtml } from "node-html-parser";
import { LRUCache } from "lru-cache";
import { assertSafeUrl } from "../integrations/ssrf.js";
import { logger } from "../../config/logger.js";
import type { LinkPreviewBlock } from "../../types/messageBlocks.js";

type OgData = Omit<LinkPreviewBlock, "type">;

// Wrap null as an object so LRUCache's `{}` constraint is satisfied.
type CachedOg = { data: OgData | null };

// In-memory LRU cache (max 500 entries, 24-hour TTL). Shared process-lifetime.
const cache = new LRUCache<string, CachedOg>({ max: 500, ttl: 24 * 60 * 60 * 1000 });

// Extract up to 2 HTTPS URLs from a text string.
const URL_RE = /https:\/\/[^\s<>"{}|\\^`[\]]+/g;
export function extractUrls(text: string): string[] {
  return [...new Set((text.match(URL_RE) ?? []).slice(0, 2))];
}

export async function fetchOgPreview(url: string): Promise<OgData | null> {
  const cached = cache.get(url);
  if (cached !== undefined) return cached.data;

  try {
    await assertSafeUrl(url);
  } catch {
    cache.set(url, { data: null });
    return null;
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": "CSBotPreviewBot/1.0", Accept: "text/html" },
      signal: AbortSignal.timeout(5000),
      redirect: "follow",
    });
    if (!res.ok) {
      cache.set(url, { data: null });
      return null;
    }
    // Only parse HTML; skip binary responses (images, PDFs, etc.)
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("text/html")) {
      cache.set(url, { data: null });
      return null;
    }
    const html = await res.text();
    const root = parseHtml(html);

    const getMeta = (prop: string): string | null =>
      root.querySelector(`meta[property="${prop}"]`)?.getAttribute("content") ??
      root.querySelector(`meta[name="${prop}"]`)?.getAttribute("content") ??
      null;

    const title = getMeta("og:title") ?? root.querySelector("title")?.text?.trim() ?? url;
    const result: OgData = {
      url,
      title,
      description: getMeta("og:description") ?? getMeta("description") ?? undefined,
      imageUrl: getMeta("og:image") ?? undefined,
      siteName: getMeta("og:site_name") ?? undefined,
      favicon: `${new URL(url).origin}/favicon.ico`,
    };
    cache.set(url, { data: result });
    return result;
  } catch (err) {
    logger.debug("[og] preview fetch failed", { url, err: (err as Error).message });
    cache.set(url, { data: null });
    return null;
  }
}
