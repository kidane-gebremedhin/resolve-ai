// Operator "website scope" — the dashboard switcher lets an operator view data
// across All websites in their org, or filter to one. The selection is stored
// in a cookie so server components can read it and scope their API queries.
//
// NOTE: server-only (imports next/headers). Client code uses the WEBSITE_COOKIE
// literal directly (see app-shell WebsiteScopeSwitcher).
import { cookies } from "next/headers";

export const WEBSITE_COOKIE = "csb_website";

/** The selected websiteId, or null for "All websites". */
export async function getActiveWebsiteId(): Promise<string | null> {
  const v = (await cookies()).get(WEBSITE_COOKIE)?.value;
  return v && v !== "all" ? v : null;
}
