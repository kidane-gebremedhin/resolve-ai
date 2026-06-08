"use client";

// Org-level conversation behavior: whether the AI may hand off to a human, and
// whether it must ask the visitor before resolving. Persisted in
// Organization.settings.conversation via PATCH /orgs/current. Lives in the AI
// Agent section.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, Switch } from "@csb/ui";
import { clientApi, ApiError } from "@/lib/api";
import type { Org } from "./tab-inlines";

export function ConversationSettings({ org }: { org: Org | null }): React.ReactElement {
  const router = useRouter();
  const initial = org?.settings?.conversation;
  // Human escalation is OFF by default — only on when explicitly enabled.
  const [allowEscalation, setAllowEscalation] = useState(
    initial?.allowHumanEscalation === true,
  );
  const [askBeforeResolve, setAskBeforeResolve] = useState(
    initial?.requireResolveConfirmation !== false,
  );
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
          conversation: {
            allowHumanEscalation: allowEscalation,
            requireResolveConfirmation: askBeforeResolve,
          },
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
      <h2 className="font-display text-base font-semibold">Conversation behavior</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Control how the AI agent hands off and closes conversations.
      </p>
      <div className="mt-4 max-w-xl space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Allow human escalation</div>
            <div className="text-xs text-muted-foreground">
              Let visitors be handed off to a human operator. When off, the AI never offers a handoff.
            </div>
          </div>
          <Switch checked={allowEscalation} onCheckedChange={(v) => setAllowEscalation(Boolean(v))} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Ask before resolving</div>
            <div className="text-xs text-muted-foreground">
              The AI must ask the visitor to confirm before it marks a conversation resolved.
            </div>
          </div>
          <Switch checked={askBeforeResolve} onCheckedChange={(v) => setAskBeforeResolve(Boolean(v))} />
        </div>
      </div>
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      <div className="mt-4 flex items-center gap-3">
        <Button type="button" size="sm" onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
        {saved && <span className="text-xs text-emerald-600">Saved</span>}
      </div>
    </div>
  );
}
