'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button, Input, Label } from '@csb/ui';
import { clientApi, ApiError } from '@/lib/api';

type Campaign = {
  _id: string;
  name: string;
  code: string;
  channel: string;
  status: 'active' | 'paused' | 'ended';
  description?: string;
  metrics: { signups: number; conversions: number; conversionRate: number };
};

const CHANNELS = ['email', 'social', 'ads', 'referral', 'content', 'other'];
const STATUSES: Campaign['status'][] = ['active', 'paused', 'ended'];

export function CampaignsManager() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', channel: 'other', description: '' });
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      const { items } = await clientApi.get<{ items: Campaign[] }>('/admin/campaigns');
      setCampaigns(items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load campaigns');
    }
  }
  useEffect(() => {
    reload();
  }, []);

  async function create() {
    if (!form.name.trim() || !form.code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await clientApi.post('/admin/campaigns', {
        name: form.name.trim(),
        code: form.code.trim().toLowerCase(),
        channel: form.channel,
        description: form.description.trim() || undefined,
      });
      setForm({ name: '', code: '', channel: 'other', description: '' });
      setCreating(false);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create campaign');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: Campaign['status']) {
    await clientApi.patch(`/admin/campaigns/${id}`, { status });
    await reload();
  }
  async function remove(id: string) {
    await clientApi.delete(`/admin/campaigns/${id}`);
    await reload();
  }

  return (
    <div className="mt-6 space-y-6">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating((v) => !v)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> New campaign
        </Button>
      </div>

      {creating ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Name</Label>
              <Input className="mt-1.5" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Spring launch" />
            </div>
            <div>
              <Label>Tracking code (?campaign=)</Label>
              <Input className="mt-1.5" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="spring25" />
            </div>
            <div>
              <Label>Channel</Label>
              <select
                className="mt-1.5 h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={form.channel}
                onChange={(e) => setForm({ ...form, channel: e.target.value })}
              >
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Description</Label>
              <Input className="mt-1.5" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" onClick={create} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Create
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {!campaigns ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Campaign</th>
                <th className="px-4 py-2.5 font-medium">Channel</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium text-right">Signups</th>
                <th className="px-4 py-2.5 font-medium text-right">Conversions</th>
                <th className="px-4 py-2.5 font-medium text-right">Rate</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {campaigns.map((c) => (
                <tr key={c._id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">?campaign={c.code}</div>
                  </td>
                  <td className="px-4 py-2.5 capitalize text-muted-foreground">{c.channel}</td>
                  <td className="px-4 py-2.5">
                    <select
                      className="h-7 rounded-md border border-border bg-background px-2 text-xs capitalize"
                      value={c.status}
                      onChange={(e) => setStatus(c._id, e.target.value as Campaign['status'])}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-right">{c.metrics.signups}</td>
                  <td className="px-4 py-2.5 text-right">{c.metrics.conversions}</td>
                  <td className="px-4 py-2.5 text-right">{Math.round(c.metrics.conversionRate * 100)}%</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => remove(c._id)} aria-label="Delete" className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {campaigns.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No campaigns yet — create one to start attributing signups.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
