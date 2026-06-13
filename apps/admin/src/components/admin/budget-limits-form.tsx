"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";

type BudgetEntry = {
  plan: "pro" | "business" | "enterprise";
  orgMonthlyLimitUsd: number;
  websiteMonthlyLimitUsd: number;
};

const DEFAULTS: BudgetEntry[] = [
  { plan: "pro", orgMonthlyLimitUsd: 50, websiteMonthlyLimitUsd: 10 },
  { plan: "business", orgMonthlyLimitUsd: 200, websiteMonthlyLimitUsd: 25 },
  { plan: "enterprise", orgMonthlyLimitUsd: 0, websiteMonthlyLimitUsd: 0 },
];

const PLAN_LABELS: Record<string, string> = {
  pro: "Pro",
  business: "Business",
  enterprise: "Enterprise",
};

export function BudgetLimitsForm({ initial }: { initial?: BudgetEntry[] }) {
  const [entries, setEntries] = useState<BudgetEntry[]>(
    initial && initial.length > 0 ? initial : DEFAULTS,
  );
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(plan: string, field: keyof Omit<BudgetEntry, "plan">, value: string) {
    const num = parseFloat(value);
    setEntries((prev) =>
      prev.map((e) =>
        e.plan === plan ? { ...e, [field]: Number.isFinite(num) ? num : 0 } : e,
      ),
    );
    setSuccess(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await api.patch("/admin/settings", { budgetLimits: entries });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save budget limits.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-6">
      <h2 className="font-display text-base font-semibold">Budget &amp; Limits</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Monthly USD spending caps per plan. Set to <strong>0</strong> for unlimited.
        Orgs on a plan that hit their org or website cap will receive error responses and email
        notifications at 75% and 100%.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
              <th className="pb-2 pr-4">Plan</th>
              <th className="pb-2 pr-4">Org budget / month (USD)</th>
              <th className="pb-2">Per-website budget / month (USD)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.map((e) => (
              <tr key={e.plan}>
                <td className="py-3 pr-4 font-medium">{PLAN_LABELS[e.plan]}</td>
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">$</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={e.orgMonthlyLimitUsd}
                      onChange={(ev) => update(e.plan, "orgMonthlyLimitUsd", ev.target.value)}
                      className="w-28 rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    {e.orgMonthlyLimitUsd === 0 && (
                      <span className="text-xs text-muted-foreground">unlimited</span>
                    )}
                  </div>
                </td>
                <td className="py-3">
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">$</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={e.websiteMonthlyLimitUsd}
                      onChange={(ev) => update(e.plan, "websiteMonthlyLimitUsd", ev.target.value)}
                      className="w-28 rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    {e.websiteMonthlyLimitUsd === 0 && (
                      <span className="text-xs text-muted-foreground">unlimited</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      )}
      {success && (
        <p className="mt-3 text-sm text-success">Budget limits saved.</p>
      )}

      <button
        onClick={save}
        disabled={saving}
        className="mt-4 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save budget limits"}
      </button>
    </div>
  );
}
