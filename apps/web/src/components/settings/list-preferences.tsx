"use client";

// Org-level list display preference: how many rows per page across the
// dashboard's record lists (inbox, leads, knowledge, …). Persisted in
// Organization.settings.pagination.pageSize via PATCH /orgs/current; the API
// clamps to 1–200 and defaults to 10.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, Input } from "@csb/ui";
import { clientApi, ApiError } from "@/lib/api";
import type { Org } from "./tab-inlines";

export function ListPreferences({ org }: { org: Org | null }): React.ReactElement {
  const router = useRouter();
  const [pageSize, setPageSize] = useState<number>(org?.settings?.pagination?.pageSize ?? 10);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await clientApi.patch("/orgs/current", {
        settings: {
          ...(org?.settings ?? {}),
          pagination: { pageSize },
        },
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h2 className="font-display text-base font-semibold">List display</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        How many records to show per page in lists across the dashboard.
      </p>
      <div className="mt-4 flex items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Results per page
          <Input
            type="number"
            min={1}
            max={200}
            className="h-9 w-28"
            value={pageSize}
            onChange={(e) => {
              const n = Number(e.target.value);
              setPageSize(Number.isFinite(n) ? Math.min(200, Math.max(1, Math.trunc(n))) : 10);
              setSaved(false);
            }}
          />
        </label>
        <Button type="button" size="sm" onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
        {saved && <span className="pb-2 text-xs text-emerald-600">Saved</span>}
      </div>
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
    </div>
  );
}
