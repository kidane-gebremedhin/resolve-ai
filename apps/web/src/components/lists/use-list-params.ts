"use client";

// Shared URL-query state for list pages. The server page reads these params
// (page, pageSize, q, from, to, plus per-page filters) and fetches accordingly;
// the toolbar + filter controls just push updates into the URL. Any change other
// than `page` itself resets to page 1.
import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useListParams() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const get = useCallback((key: string) => sp.get(key) ?? "", [sp]);

  const set = useCallback(
    (updates: Record<string, string | undefined>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === undefined || v === "") next.delete(k);
        else next.set(k, v);
      }
      // Filter/search/page-size changes invalidate the current page offset.
      if (!("page" in updates)) next.delete("page");
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, sp],
  );

  return { get, set };
}
