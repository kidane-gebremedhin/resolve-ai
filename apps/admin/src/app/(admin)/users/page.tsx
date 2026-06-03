import { api, ApiError } from '@/lib/api';
import { UsersTable } from '@/components/admin/users-table';
import type { AdminUser } from '@/components/admin/utils';
import { formatNumber } from '@/components/admin/utils';

async function load(): Promise<{ users: AdminUser[]; error: string | null }> {
  try {
    return { users: await api.get<AdminUser[]>('/admin/users?limit=200'), error: null };
  } catch (err) {
    return { users: [], error: err instanceof ApiError ? err.message : 'Failed to load users' };
  }
}

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const { users, error } = await load();
  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Users</h1>
      <p className="mt-1 text-sm text-muted-foreground">{formatNumber(users.length)} loaded · search + paginate</p>
      {error ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>
      ) : null}
      <div className="mt-6">
        <UsersTable users={users} />
      </div>
    </div>
  );
}
