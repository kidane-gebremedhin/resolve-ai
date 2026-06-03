// Resolve a website's icon for use as the agent's default widget avatar.
// Best-effort: prefers an icon already surfaced in the Firecrawl page metadata
// (favicon / ogImage), then falls back to Google's favicon service derived from
// the source host. Returns null when nothing resolvable.

type CrawlPage = { metadata?: Record<string, unknown> | null };

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
  }
  return undefined;
}

export function resolveFaviconUrl(pages: CrawlPage[], sourceUrl?: string | null): string | null {
  for (const p of pages) {
    const m = p.metadata ?? {};
    const fav = firstString(m.favicon, m["favicon"], m.ogImage, m["og:image"]);
    if (fav) return fav;
  }
  if (sourceUrl) {
    try {
      const host = new URL(sourceUrl).host;
      if (host) return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
    } catch {
      /* invalid URL — ignore */
    }
  }
  return null;
}
