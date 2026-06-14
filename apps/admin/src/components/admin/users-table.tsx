// Presentational users table. Search, filters, date range, and pagination are
// handled server-side (the /admin/users endpoint + <ListToolbar>); this just
// renders the current page of rows.

import { Badge } from "@csb/ui";
import type { AdminUser } from "./utils";
import { formatDate, relativeTime } from "./utils";

export function UsersTable({ users }: { users: AdminUser[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
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
          {users.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-5 py-12 text-center text-sm text-muted-foreground">
                No users match these filters.
              </td>
            </tr>
          ) : (
            users.map((u) => (
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
                <td className="hidden px-5 py-3 capitalize text-muted-foreground md:table-cell">
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
  );
}
