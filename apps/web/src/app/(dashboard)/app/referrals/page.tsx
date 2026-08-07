"use client";

// Referrals / affiliate dashboard: share link + copy, funnel counts, earnings,
// and the referral list. Data comes from GET /referrals/me.

import { useEffect, useState } from "react";
import { Button } from "@csb/ui";
import { Check, Copy, Loader2 } from "lucide-react";
import { clientApi, ApiError } from "@/lib/api";

type ReferralRow = {
  _id: string;
  status: "pending" | "earned" | "paid" | "void";
  plan: string | null;
  commissionCents: number;
  createdAt: string;
  earnedAt: string | null;
};

type ReferralData = {
  code: string;
  counts: Record<string, number>;
  earnedCents: number;
  paidCents: number;
  referrals: ReferralRow[];
};

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function ReferralsPage() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    clientApi
      .get<ReferralData>("/referrals/me")
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load referrals"));
  }, []);

  const shareUrl =
    data && typeof window !== "undefined"
      ? `${window.location.origin}/register?ref=${data.code}`
      : "";

  // navigator.clipboard is undefined on insecure origins (plain http on a LAN
  // host) and can reject when the document isn't focused. Both used to surface
  // as an unhandled rejection and a button that silently did nothing, so fall
  // back to a hidden textarea + execCommand and only then report failure.
  async function copy() {
    if (!shareUrl) return;
    setCopyError(null);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const ta = document.createElement("textarea");
        ta.value = shareUrl;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("copy rejected");
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError("Couldn't copy automatically — select the link and copy it manually.");
    }
  }

  if (error) {
    return (
      <div className="container-page py-8">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="container-page flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="container-page space-y-8 py-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Referrals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Share your link — earn a commission when a team you refer subscribes.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="text-sm font-medium">Your referral link</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="flex-1 truncate rounded-md border border-border bg-muted px-3 py-2 text-xs">
            {shareUrl}
          </code>
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        {copyError && <p className="mt-2 text-xs text-destructive">{copyError}</p>}
        <p className="mt-3 text-xs text-muted-foreground">
          Your code is <code className="rounded bg-muted px-1 py-0.5">{data.code}</code>. Anyone who
          signs up through this link is attributed to you — the referral appears below as{" "}
          <strong>Pending</strong> straight away, and flips to <strong>Earned</strong> with a
          commission once they start a paid plan.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Pending" value={String(data.counts.pending ?? 0)} />
        <Stat label="Earned" value={String(data.counts.earned ?? 0)} />
        <Stat label="Earnings" value={money(data.earnedCents)} />
        <Stat label="Paid out" value={money(data.paidCents)} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Date</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Plan</th>
              <th className="px-4 py-2.5 font-medium text-right">Commission</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.referrals.map((r) => (
              <tr key={r._id} className="hover:bg-muted/30">
                <td className="px-4 py-2.5">{new Date(r.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-2.5 capitalize">{r.status}</td>
                <td className="px-4 py-2.5 capitalize text-muted-foreground">{r.plan ?? "—"}</td>
                <td className="px-4 py-2.5 text-right">{money(r.commissionCents)}</td>
              </tr>
            ))}
            {data.referrals.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  No referrals yet — share your link to get started.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold">{value}</div>
    </div>
  );
}
