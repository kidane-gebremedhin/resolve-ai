"use client";

// General settings: rename the organization, and the "danger zone" that deletes
// the whole account (all org data) after the operator types the org name to
// confirm.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Button, Input, Label } from "@csb/ui";
import { clientApi, ApiError } from "@/lib/api";
import type { Org } from "./tab-inlines";

export function GeneralInline({ org }: { org: Org | null }): React.ReactElement {
  const router = useRouter();
  const [name, setName] = useState(org?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const canDelete = org?.name != null && confirm.trim() === org.name;

  async function saveName(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Organization name can't be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await clientApi.patch("/orgs/current", { name: trimmed });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount(): Promise<void> {
    setDeleting(true);
    setError(null);
    try {
      await clientApi.delete("/orgs/current");
      await signOut({ redirect: false });
      window.location.href = "/login";
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete account.");
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-8">
      <form onSubmit={saveName} className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-display text-base font-semibold">Organization</h2>
        <p className="mt-1 text-sm text-muted-foreground">Your workspace name.</p>
        <div className="mt-4 max-w-md space-y-1.5">
          <Label htmlFor="org-name">Name</Label>
          <Input
            id="org-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
          />
        </div>
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" size="sm" disabled={saving || name.trim() === (org?.name ?? "")}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
          {saved && <span className="text-xs text-emerald-600">Saved</span>}
        </div>
      </form>

      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6">
        <h2 className="font-display text-base font-semibold text-destructive">Danger zone</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Delete this account and <strong>all</strong> of its data — websites, agents,
          knowledge base, conversations, leads, and settings. This cannot be undone.
        </p>
        <div className="mt-4 max-w-md space-y-1.5">
          <Label htmlFor="confirm-delete">
            Type <span className="font-mono text-foreground">{org?.name ?? "the org name"}</span> to confirm
          </Label>
          <Input
            id="confirm-delete"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={org?.name ?? ""}
            autoComplete="off"
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="mt-4"
          disabled={!canDelete || deleting}
          onClick={deleteAccount}
        >
          {deleting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Delete my account
        </Button>
      </div>
    </div>
  );
}
