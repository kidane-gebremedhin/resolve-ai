"use client";

// Client-side filter + pagination for the platform-admin users table. The
// /admin/users endpoint doesn't paginate yet, so we slice in-memory.

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge, Button, Input } from "@csb/ui";
import type { AdminUser } from "./utils";
import { formatDate, relativeTime } from "./utils";

type Props = {
  users: AdminUser[];
  pageSize?: number;
};

export function UsersTable({ users, pageSize = 25 }: Props) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.name ?? "").toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q),
    );
  }, [users, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * pageSize;
  const slice = filtered.slice(start, start + pageSize);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search users…"
            className="h-9 pl-8"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <div className="text-xs text-muted-foreground">
          {filtered.length.toLocaleString()} result{filtered.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">User</th>
              <th className="px-5 py-3 font-medium">Role</th>
              <th className="hidden px-5 py-3 font-medium md:table-cell">Provider</th>
              <th className="hidden px-5 py-3 font-medium md:table-cell">Joined</th>
              <th className="px-5 py-3 font-medium text-right">Last login</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {slice.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-sm text-muted-foreground">
                  No users match this search.
                </td>
              </tr>
            ) : (
              slice.map((u) => (
                <tr key={u._id} className="hover:bg-surface">
                  <td className="px-5 py-3">
                    <div className="font-medium">{u.name || "(no name)"}</div>
                    <div className="text-[11px] text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-5 py-3">
                    <Badge
                      variant="outline"
                      className={u.role === "platform_admin" ? "border-destructive/30 text-destructive" : ""}
                    >
                      {u.role === "platform_admin" ? "Platform admin" : "User"}
                    </Badge>
                  </td>
                  <td className="hidden px-5 py-3 text-muted-foreground md:table-cell capitalize">
                    {u.provider}
                  </td>
                  <td className="hidden px-5 py-3 text-muted-foreground md:table-cell">
                    {formatDate(u.createdAt)}
                  </td>
                  <td className="px-5 py-3 text-right text-muted-foreground">
                    {u.lastLoginAt ? `${relativeTime(u.lastLoginAt)} ago` : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <div>
            Page {safePage + 1} of {totalPages}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
