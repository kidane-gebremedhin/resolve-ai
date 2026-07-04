"use client";

// General settings: rename the organization, privacy/compliance toggles,
// and the "danger zone" that deletes the whole account.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Check, Loader2 } from "lucide-react";
import { Button, Input, Label } from "@csb/ui";
import { clientApi, ApiError } from "@/lib/api";
import type { Org } from "./tab-inlines";

export function GeneralInline({ org }: { org: Org | null }): React.ReactElement {
  const router = useRouter();
  const [name, setName] = useState(org?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [piiRedaction, setPiiRedaction] = useState(org?.settings?.piiRedaction ?? true);
  const [savingPii, setSavingPii] = useState(false);
  const [savedPii, setSavedPii] = useState(false);

  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const canDelete = org?.name != null && confirm.trim() === org.name;

  async function savePiiRedaction(enabled: boolean): Promise<void> {
    setSavingPii(true);
    setSavedPii(false);
    setPiiRedaction(enabled);
    try {
      await clientApi.patch("/orgs/current", {
        settings: { ...(org?.settings ?? {}), piiRedaction: enabled },
      });
      setSavedPii(true);
      setTimeout(() => setSavedPii(false), 2000);
      router.refresh();
    } catch {
      setPiiRedaction(!enabled); // revert on error
    } finally {
      setSavingPii(false);
    }
  }

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

      {/* Privacy & Compliance */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-display text-base font-semibold">Privacy &amp; Compliance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Control how sensitive customer data is handled before it reaches the AI model.
        </p>

        <div className="mt-5 space-y-5">
          {/* PII Redaction toggle */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">PII redaction</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Mask emails, phone numbers, credit cards, SSNs, and NI numbers before sending
                customer messages to the AI model. Stored conversation history is not affected.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {savedPii && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                  <Check className="h-3 w-3" /> Saved
                </span>
              )}
              <button
                type="button"
                role="switch"
                aria-checked={piiRedaction}
                disabled={savingPii}
                onClick={() => void savePiiRedaction(!piiRedaction)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 ${piiRedaction ? "bg-primary" : "bg-muted-foreground/30"}`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${piiRedaction ? "translate-x-4" : "translate-x-0.5"}`}
                />
              </button>
            </div>
          </div>

          {/* Data Region (read-only) */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Data region</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                The geographic region where your conversation data is stored.
                Contact us to migrate to a different region.
              </p>
            </div>
            <span
              title="Contact us to change region"
              className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              {org?.settings?.dataRegion ?? "us"}
            </span>
          </div>
        </div>
      </div>

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
