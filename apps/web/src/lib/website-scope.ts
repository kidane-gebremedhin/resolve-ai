// Operator "website scope" — the dashboard switcher lets an operator view data
// across All websites in their org, or filter to one. The selection is stored
// in a cookie so server components can read it and scope their API queries.
//
// NOTE: server-only (imports next/headers). Client code uses the WEBSITE_COOKIE
// literal directly (see app-shell WebsiteScopeSwitcher).
import { cache } from "react";
import { cookies } from "next/headers";
import { api } from "./api";

export const WEBSITE_COOKIE = "csb_website";

// De-duplicated per request: getActiveWebsiteId is called by the layout AND the
// page on the same render, so wrap the lookup in React cache to avoid firing the
// /websites request multiple times.
const fetchWebsites = cache(async (): Promise<{ _id: string }[]> => {
  try {
    const sites = await api.get<{ _id: string }[]>("/websites");
    return Array.isArray(sites) ? sites : [];
  } catch {
    return [];
  }
});

/**
 * The website the workspace is scoped to.
 * - An explicit "all" cookie means the operator chose the All-websites view.
 * - A cookie pointing at a website that STILL EXISTS wins (validated against the
 *   live list — a stale id left over from a deleted website / different org would
 *   otherwise make the switcher render "All websites" and scope pages to nothing).
 * - Otherwise, when the org has exactly ONE website, that website is used by
 *   default so the whole workspace (switcher + every page) reflects it.
 * - Returns null only for a multi-website org with no valid explicit selection.
 */
export async function getActiveWebsiteId(): Promise<string | null> {
  const v = (await cookies()).get(WEBSITE_COOKIE)?.value;
  if (v === "all") return null; // operator explicitly chose the All-websites view
  const sites = await fetchWebsites();
  if (v && sites.some((s) => s._id === v)) return v; // valid explicit selection
  return sites.length === 1 ? sites[0]!._id : null; // lone website → auto-select
}

/**
 * For pages that REQUIRE a single website (AI agent, Widget studio). Now that
 * getActiveWebsiteId already auto-selects a lone website, this is a thin alias
 * kept for call-site clarity.
 */
export async function getEffectiveWebsiteId(): Promise<string | null> {
  return getActiveWebsiteId();
}
