"use client";

import { useState } from "react";
import { ExternalLink, Loader2, Receipt } from "lucide-react";
import { clientApi } from "@/lib/api";

/**
 * Paddle's invoice links expire an hour after they are minted, so there is
 * nothing useful to store on the payment row: a cached URL would be dead by the
 * time anyone clicked it. This asks for a fresh one per click and opens it.
 *
 * The window is opened synchronously, before the await, because a popup opened
 * from inside a resolved promise is blocked by every browser. We open a blank
 * tab first and point it at the URL once we have it.
 */
export function InvoiceLink({ paymentId }: { paymentId: string }) {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function open() {
    if (loading) return;
    setLoading(true);
    setFailed(false);
    const tab = window.open("", "_blank", "noopener,noreferrer");
    try {
      const res = await clientApi.get<{ url: string }>(
        `/billing/payments/${paymentId}/invoice`,
      );
      if (tab) tab.location.href = res.url;
      else window.location.href = res.url;
    } catch {
      tab?.close();
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={loading}
      className="inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-60"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Receipt className="h-3.5 w-3.5" />
      )}
      {failed ? "Try again" : "Invoice"}
      {!loading && <ExternalLink className="h-3 w-3" />}
    </button>
  );
}
