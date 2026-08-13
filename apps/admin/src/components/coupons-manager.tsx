'use client';

// Platform-admin LTD coupon management: browse/filter, create one, bulk-generate
// a batch for a partner, toggle active, and drill into redemption history.
//
// Bulk results are copyable and downloadable as CSV — that is the actual
// hand-off mechanism to AppSumo/PitchGround, so it has to survive a page
// refresh being hit by accident: the batch stays on screen until dismissed.

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Ticket, Download, Copy, Check, History, X } from 'lucide-react';
import { Button, Input, Label } from '@csb/ui';
import { clientApi, ApiError } from '@/lib/api';

const TIERS = ['pro', 'business', 'enterprise'] as const;
type Tier = (typeof TIERS)[number];

type Coupon = {
  _id: string;
  code: string;
  grantsTier: Tier;
  maxRedemptions: number;
  redemptionsCount: number;
  actualRedemptions?: number;
  maxPerUser: number;
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
  partner?: string;
  campaign?: string;
  description?: string;
  internalNotes?: string;
  createdAt: string;
};

type Redemption = {
  _id: string;
  couponCode: string;
  userEmail: string;
  tierGranted: Tier;
  redeemedAt: string;
  ipAddress?: string;
  userAgent?: string;
};

type Page<T> = { items: T[]; total: number; page: number; pageSize: number; totalPages: number };

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** RFC-4180-ish escaping so codes with commas/quotes survive Excel. */
function toCsv(rows: string[][]): string {
  return rows
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
}

function downloadCsv(filename: string, csv: string): void {
  // BOM so Excel reads it as UTF-8 rather than mangling non-ASCII partner names.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function CouponsManager() {
  const [page, setPage] = useState<Page<Coupon> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Filters
  const [filterActive, setFilterActive] = useState<'' | 'true' | 'false'>('');
  const [filterTier, setFilterTier] = useState<'' | Tier>('');
  const [filterPartner, setFilterPartner] = useState('');
  const [pageNum, setPageNum] = useState(1);

  // Create form
  const [form, setForm] = useState({
    code: '',
    grantsTier: 'business' as Tier,
    maxRedemptions: 1,
    maxPerUser: 1,
    partner: '',
    campaign: '',
    description: '',
    internalNotes: '',
    validUntil: '',
  });
  const [bulkCount, setBulkCount] = useState(100);
  const [creating, setCreating] = useState(false);

  // Last bulk batch — kept on screen until explicitly dismissed.
  const [batch, setBatch] = useState<{ codes: string[]; requested: number } | null>(null);
  const [copied, setCopied] = useState(false);

  // Redemption drill-down
  const [historyFor, setHistoryFor] = useState<Coupon | null>(null);
  const [history, setHistory] = useState<Page<Redemption> | null>(null);

  // Bumped to force a refetch after a mutation. Modelling reload as an input to
  // the effect keeps every setState inside an async callback — an effect body
  // that calls setState synchronously triggers cascading renders
  // (react-hooks/set-state-in-effect).
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ page: String(pageNum), pageSize: '25' });
        if (filterActive) params.set('isActive', filterActive);
        if (filterTier) params.set('grantsTier', filterTier);
        if (filterPartner.trim()) params.set('partner', filterPartner.trim());
        const data = await clientApi.get<Page<Coupon>>(`/admin/coupons?${params}`);
        if (!cancelled) setPage(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load coupons');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pageNum, filterActive, filterTier, filterPartner, reloadKey]);

  function basePayload() {
    return {
      grantsTier: form.grantsTier,
      maxRedemptions: Number(form.maxRedemptions),
      maxPerUser: Number(form.maxPerUser),
      partner: form.partner.trim() || undefined,
      campaign: form.campaign.trim() || undefined,
      description: form.description.trim() || undefined,
      internalNotes: form.internalNotes.trim() || undefined,
      validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : undefined,
    };
  }

  async function createOne() {
    setCreating(true);
    setError(null);
    try {
      await clientApi.post('/admin/coupons', {
        ...basePayload(),
        code: form.code.trim() || undefined,
      });
      setForm((f) => ({ ...f, code: '' }));
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create coupon');
    } finally {
      setCreating(false);
    }
  }

  async function createBulk() {
    setCreating(true);
    setError(null);
    try {
      const res = await clientApi.post<{ codes: string[]; requested: number; created: number }>(
        '/admin/coupons',
        { ...basePayload(), bulk: true, count: Number(bulkCount) },
      );
      setBatch({ codes: res.codes, requested: res.requested });
      // Surface a shortfall rather than letting it pass as success — these get
      // handed to the LTD platform and the count is contractual.
      if (res.created < res.requested) {
        setError(`Only ${res.created} of ${res.requested} codes could be generated.`);
      }
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate coupons');
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(c: Coupon) {
    setBusyId(c._id);
    setError(null);
    try {
      await clientApi.patch(`/admin/coupons/${c._id}`, { isActive: !c.isActive });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update coupon');
    } finally {
      setBusyId(null);
    }
  }

  async function openHistory(c: Coupon) {
    setHistoryFor(c);
    setHistory(null);
    try {
      setHistory(await clientApi.get<Page<Redemption>>(`/admin/coupons/${c._id}/redemptions?pageSize=50`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load redemptions');
    }
  }

  return (
    <div className="mt-6 space-y-6">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* ---------------- create ---------------- */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-primary" />
          <h2 className="font-display text-base font-semibold">Create coupons</h2>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor="c-tier">Grants tier</Label>
            <select
              id="c-tier"
              value={form.grantsTier}
              onChange={(e) => setForm({ ...form, grantsTier: e.target.value as Tier })}
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            >
              {TIERS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="c-partner">Partner</Label>
            <Input
              id="c-partner"
              value={form.partner}
              onChange={(e) => setForm({ ...form, partner: e.target.value })}
              placeholder="AppSumo"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="c-campaign">Campaign</Label>
            <Input
              id="c-campaign"
              value={form.campaign}
              onChange={(e) => setForm({ ...form, campaign: e.target.value })}
              placeholder="ltd-launch"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="c-until">Valid until (optional)</Label>
            <Input
              id="c-until"
              type="date"
              value={form.validUntil}
              onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="c-max">Max redemptions</Label>
            <Input
              id="c-max"
              type="number"
              min={1}
              value={form.maxRedemptions}
              onChange={(e) => setForm({ ...form, maxRedemptions: Number(e.target.value) })}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="c-peruser">Max per user</Label>
            <Input
              id="c-peruser"
              type="number"
              min={1}
              value={form.maxPerUser}
              onChange={(e) => setForm({ ...form, maxPerUser: Number(e.target.value) })}
              className="mt-1"
            />
          </div>
          <div className="lg:col-span-2">
            <Label htmlFor="c-desc">Description (shown to the redeemer)</Label>
            <Input
              id="c-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="AppSumo Tier 2 — Business, lifetime"
              className="mt-1"
            />
          </div>
          <div className="lg:col-span-4">
            <Label htmlFor="c-notes">Internal notes (never shown to customers)</Label>
            <Input
              id="c-notes"
              value={form.internalNotes}
              onChange={(e) => setForm({ ...form, internalNotes: e.target.value })}
              className="mt-1"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <div className="min-w-[200px] flex-1">
            <Label htmlFor="c-code">Single coupon — code (blank = auto-generate)</Label>
            <Input
              id="c-code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="APPSUMO-XXXX-XXXX"
              className="mt-1 font-mono uppercase"
            />
          </div>
          <Button onClick={() => void createOne()} disabled={creating}>
            {creating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Create one
          </Button>

          <div className="w-32">
            <Label htmlFor="c-bulk">Bulk count</Label>
            <Input
              id="c-bulk"
              type="number"
              min={1}
              max={1000}
              value={bulkCount}
              onChange={(e) => setBulkCount(Number(e.target.value))}
              className="mt-1"
            />
          </div>
          <Button variant="outline" onClick={() => void createBulk()} disabled={creating}>
            {creating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Generate batch
          </Button>
        </div>
      </div>

      {/* ---------------- bulk result ---------------- */}
      {batch && (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold">
              {batch.codes.length} code{batch.codes.length === 1 ? '' : 's'} generated
            </h2>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(batch.codes.join('\n'));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy all'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadCsv(
                    `coupons-${form.partner.trim() || 'batch'}-${new Date().toISOString().slice(0, 10)}.csv`,
                    toCsv([['code', 'grantsTier', 'partner', 'campaign'], ...batch.codes.map((c) => [c, form.grantsTier, form.partner, form.campaign])]),
                  )
                }
              >
                <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setBatch(null)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <textarea
            readOnly
            value={batch.codes.join('\n')}
            className="mt-3 h-40 w-full rounded-md border border-border bg-background p-3 font-mono text-xs"
          />
        </div>
      )}

      {/* ---------------- filters + table ---------------- */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Ticket className="h-4 w-4 text-primary" />
          <h2 className="font-display text-base font-semibold">Coupons</h2>
          <div className="ml-auto flex flex-wrap gap-2">
            <select
              value={filterActive}
              onChange={(e) => { setFilterActive(e.target.value as '' | 'true' | 'false'); setPageNum(1); }}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">All states</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
            <select
              value={filterTier}
              onChange={(e) => { setFilterTier(e.target.value as '' | Tier); setPageNum(1); }}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">All tiers</option>
              {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Input
              value={filterPartner}
              onChange={(e) => { setFilterPartner(e.target.value); setPageNum(1); }}
              placeholder="Filter by partner"
              className="h-9 w-44"
            />
          </div>
        </div>

        {!page ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading coupons…
          </div>
        ) : page.items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No coupons match these filters.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-3">Code</th>
                  <th className="py-2 pr-3">Tier</th>
                  <th className="py-2 pr-3">Partner</th>
                  <th className="py-2 pr-3">Used</th>
                  <th className="py-2 pr-3">Valid</th>
                  <th className="py-2 pr-3">State</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {page.items.map((c) => (
                  <tr key={c._id}>
                    <td className="py-2.5 pr-3 font-mono text-xs">{c.code}</td>
                    <td className="py-2.5 pr-3 capitalize">{c.grantsTier}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{c.partner ?? '—'}</td>
                    <td className="py-2.5 pr-3 tabular-nums">
                      {c.redemptionsCount} / {c.maxRedemptions}
                      {/* A gap means a slot was claimed but the grant failed — worth showing. */}
                      {c.actualRedemptions !== undefined && c.actualRedemptions !== c.redemptionsCount && (
                        <span className="ml-1 text-xs text-warning" title="Claimed slots differ from logged redemptions">
                          ({c.actualRedemptions} logged)
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                      {fmtDate(c.validFrom)} → {c.validUntil ? fmtDate(c.validUntil) : 'never'}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${c.isActive ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'}`}
                      >
                        {c.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => void openHistory(c)}>
                        <History className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === c._id}
                        onClick={() => void toggleActive(c)}
                      >
                        {busyId === c._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : c.isActive ? 'Disable' : 'Enable'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {page.totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Page {page.page} of {page.totalPages} · {page.total} total
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page.page <= 1} onClick={() => setPageNum((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button size="sm" variant="outline" disabled={page.page >= page.totalPages} onClick={() => setPageNum((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---------------- redemption history ---------------- */}
      {historyFor && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold">
              Redemptions of <span className="font-mono text-sm">{historyFor.code}</span>
            </h2>
            <Button size="sm" variant="ghost" onClick={() => { setHistoryFor(null); setHistory(null); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          {!history ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : history.items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Not redeemed yet.</p>
          ) : (
            <>
              <div className="mt-3 flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    downloadCsv(
                      `redemptions-${historyFor.code}.csv`,
                      toCsv([
                        ['redeemedAt', 'userEmail', 'tierGranted', 'ipAddress', 'userAgent'],
                        ...history.items.map((r) => [r.redeemedAt, r.userEmail, r.tierGranted, r.ipAddress ?? '', r.userAgent ?? '']),
                      ]),
                    )
                  }
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
                </Button>
              </div>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-3">When</th>
                    <th className="py-2 pr-3">User</th>
                    <th className="py-2 pr-3">Tier</th>
                    <th className="py-2 pr-3">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.items.map((r) => (
                    <tr key={r._id}>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {new Date(r.redeemedAt).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3">{r.userEmail}</td>
                      <td className="py-2 pr-3 capitalize">{r.tierGranted}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">{r.ipAddress ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
