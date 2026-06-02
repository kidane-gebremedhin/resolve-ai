'use client';

// Leads / contact-sessions browser. Receives a server-fetched list and applies
// pill filters + free-text search on the client. CSV export runs entirely in the
// browser via a Blob download — no extra API round-trip needed.

import { useMemo, useState } from "react";
import { Download, Mail, Phone, Search, Copy, MessageSquare } from "lucide-react";
import { Button, Input, Badge } from "@csb/ui";

export type Lead = {
  _id: string;
  websiteId?: string;
  email?: string;
  phone?: string;
  name?: string;
  metadata?: Record<string, unknown> | null;
  lastActiveAt?: string;
  createdAt?: string;
};

export type Website = { _id: string; domain: string };

type Filter = "all" | "email" | "phone" | "none";

const filterPills: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "email", label: "Has email" },
  { id: "phone", label: "Has phone" },
  { id: "none", label: "No contact info" },
];

function matchesFilter(lead: Lead, filter: Filter): boolean {
  switch (filter) {
    case "email":
      return Boolean(lead.email);
    case "phone":
      return Boolean(lead.phone);
    case "none":
      return !lead.email && !lead.phone;
    default:
      return true;
  }
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function downloadCsv(rows: Lead[], websites: Website[]): void {
  const domainById = new Map(websites.map((w) => [w._id, w.domain]));
  const header = ["email", "phone", "name", "website", "lastActiveAt", "createdAt", "sessionId"];
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.email ?? "",
        r.phone ?? "",
        r.name ?? "",
        r.websiteId ? domainById.get(r.websiteId) ?? r.websiteId : "",
        r.lastActiveAt ?? "",
        r.createdAt ?? "",
        r._id,
      ]
        .map(escape)
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function LeadsClient({
  initialLeads,
  websites,
}: {
  initialLeads: Lead[];
  websites: Website[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const domainById = useMemo(
    () => new Map(websites.map((w) => [w._id, w.domain])),
    [websites],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return initialLeads.filter((lead) => {
      if (!matchesFilter(lead, filter)) return false;
      if (!q) return true;
      return (
        (lead.email ?? "").toLowerCase().includes(q) ||
        (lead.phone ?? "").toLowerCase().includes(q) ||
        (lead.name ?? "").toLowerCase().includes(q)
      );
    });
  }, [initialLeads, filter, query]);

  const stats = useMemo(() => {
    const total = initialLeads.length;
    const withEmail = initialLeads.filter((l) => l.email).length;
    const withPhone = initialLeads.filter((l) => l.phone).length;
    const week = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const thisWeek = initialLeads.filter(
      (l) => l.createdAt && new Date(l.createdAt).getTime() > week,
    ).length;
    return { total, withEmail, withPhone, thisWeek };
  }, [initialLeads]);

  async function copySessionId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // clipboard may be unavailable on insecure contexts; fail quietly.
    }
  }

  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Contact sessions captured by your widget. Filter, search and export to CSV.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => downloadCsv(filtered, websites)}
            disabled={filtered.length === 0}
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        {[
          ["Total", stats.total],
          ["With email", stats.withEmail],
          ["With phone", stats.withPhone],
          ["This week", stats.thisWeek],
        ].map(([k, v]) => (
          <div key={String(k)} className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className="mt-1 font-display text-2xl font-semibold">{v}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {filterPills.map((p) => (
          <button
            key={p.id}
            onClick={() => setFilter(p.id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              filter === p.id
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background hover:bg-muted"
            }`}
          >
            {p.label}
          </button>
        ))}
        <div className="ml-auto w-full sm:w-64">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by email / phone / name…"
              className="h-9 pl-8"
            />
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Contact</th>
              <th className="hidden px-5 py-3 font-medium md:table-cell">Website</th>
              <th className="hidden px-5 py-3 font-medium lg:table-cell">Last active</th>
              <th className="px-5 py-3 font-medium">Created</th>
              <th className="px-5 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-muted-foreground">
                  No leads match the current filters yet.
                </td>
              </tr>
            )}
            {filtered.map((l) => {
              const initial =
                (l.name?.[0] ?? l.email?.[0] ?? l.phone?.[0] ?? "?").toUpperCase();
              const domain = l.websiteId ? domainById.get(l.websiteId) ?? "—" : "—";
              return (
                <tr key={l._id} className="hover:bg-surface">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-8 w-8 place-items-center rounded-full bg-muted text-[11px] font-semibold">
                        {initial}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {l.name ?? l.email ?? l.phone ?? `Anonymous · ${l._id.slice(-6)}`}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          {l.email && (
                            <span className="inline-flex items-center gap-1">
                              <Mail className="h-3 w-3" /> {l.email}
                            </span>
                          )}
                          {l.phone && (
                            <span className="inline-flex items-center gap-1">
                              <Phone className="h-3 w-3" /> {l.phone}
                            </span>
                          )}
                          {!l.email && !l.phone && (
                            <Badge variant="secondary" className="text-[10px]">
                              No contact info
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-5 py-3 text-muted-foreground md:table-cell">{domain}</td>
                  <td className="hidden px-5 py-3 text-muted-foreground lg:table-cell">
                    {formatDate(l.lastActiveAt)}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{formatDate(l.createdAt)}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1.5"
                        onClick={() => copySessionId(l._id)}
                        title="Copy session id"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {copiedId === l._id ? "Copied" : "ID"}
                      </Button>
                      <a
                        href={`/app/inbox?contactSessionId=${encodeURIComponent(l._id)}`}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted"
                      >
                        <MessageSquare className="h-3.5 w-3.5" /> Open
                      </a>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs text-muted-foreground">
        Showing {filtered.length} of {initialLeads.length} sessions.
      </div>
    </div>
  );
}
