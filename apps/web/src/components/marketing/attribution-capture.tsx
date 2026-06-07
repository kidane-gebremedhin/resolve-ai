"use client";

// Persists marketing attribution (?ref= affiliate, ?campaign= marketing) into
// cookies on first landing, so it survives the user browsing (pricing →
// features → register) before signing up. Since "Get Started" now routes through
// /pricing, the campaign/ref param would otherwise be lost by the time they hit
// /register. SignupHero reads the URL params first, then falls back to these
// cookies. Mounted once in the root layout.
import { useEffect } from "react";

const PARAMS: { q: string; cookie: string }[] = [
  { q: "ref", cookie: "csb_ref" },
  { q: "campaign", cookie: "csb_campaign" },
];
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function AttributionCapture() {
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      for (const { q, cookie } of PARAMS) {
        const v = sp.get(q)?.trim();
        if (v) {
          document.cookie = `${cookie}=${encodeURIComponent(v)}; path=/; max-age=${MAX_AGE}; samesite=lax`;
        }
      }
    } catch {
      /* no-op: attribution is best-effort */
    }
  }, []);
  return null;
}
