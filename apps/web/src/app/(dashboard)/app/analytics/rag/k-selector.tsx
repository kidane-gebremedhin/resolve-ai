"use client";

// K for the retrieval panel. In the URL rather than component state so a
// particular view is a link an operator can paste into a ticket.

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function KSelector({ ks, active }: { ks: number[]; active: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function select(k: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("k", String(k));
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex gap-1 rounded-lg border border-border bg-muted p-1" role="group" aria-label="Cut-off K">
      {ks.map((k) => (
        <button
          key={k}
          onClick={() => select(k)}
          aria-pressed={k === active}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
            k === active
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          K={k}
        </button>
      ))}
    </div>
  );
}
