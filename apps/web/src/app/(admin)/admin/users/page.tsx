// Platform-admin users page. Server component: fetches a fresh page of users
// from /admin/users on every request (cache: no-store via api.get) and hands
// off filter/pagination to the <UsersTable /> client component.
//
// Backend gaps:
//   - /admin/users currently caps at 200 rows and has no server-side pagination
//     cursor — UsersTable slices the in-memory list. Wire a cursor/skip param
//     once the dataset outgrows that.

import { api, ApiError } from "@/lib/api";
import { UsersTable } from "@/components/admin/users-table";
import type { AdminUser } from "@/components/admin/utils";
import { formatNumber } from "@/components/admin/utils";

async function loadUsers(): Promise<{ users: AdminUser[]; error: string | null }> {
  try {
    const users = await api.get<AdminUser[]>("/admin/users?limit=200");
    return { users, error: null };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Failed to load users";
    return { users: [], error: message };
  }
}

export default async function AdminUsersPage() {
  const { users, error } = await loadUsers();

  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatNumber(users.length)} loaded · search and paginate below
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="mt-6">
        <UsersTable users={users} />
      </div>
    </div>
  );
}
