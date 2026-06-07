import { api, ApiError } from '@/lib/api';
import { UsersTable } from '@/components/admin/users-table';
import { ListToolbar, FilterSelect } from '@/components/admin/list-toolbar';
import type { AdminUser } from '@/components/admin/utils';

type Page = {
  items: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const LIST_KEYS = ['q', 'from', 'to', 'role', 'page', 'pageSize'] as const;

function buildQuery(sp: Record<string, string | string[] | undefined>): string {
  const p = new URLSearchParams();
  for (const k of LIST_KEYS) {
    const raw = sp[k];
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (v) p.set(k, v);
  }
  return p.toString();
}

async function load(qs: string): Promise<Page & { error: string | null }> {
  try {
    const d = await api.get<Page>(`/admin/users${qs ? `?${qs}` : ''}`);
    return { ...d, error: null };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err; // propagate the /logout redirect on 401/403
    return { items: [], total: 0, page: 1, pageSize: 10, totalPages: 1, error: err.message };
  }
}

export const dynamic = 'force-dynamic';

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const data = await load(buildQuery(sp));

  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Users</h1>
      <p className="mt-1 text-sm text-muted-foreground">Platform-wide user accounts</p>
      {data.error ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {data.error}
        </div>
      ) : null}
      <div className="mt-6 space-y-4">
        <ListToolbar
          total={data.total}
          page={data.page}
          pageSize={data.pageSize}
          totalPages={data.totalPages}
          searchPlaceholder="Search email or name…"
          dateField="Joined"
        >
          <FilterSelect
            param="role"
            label="Role"
            options={[
              { value: 'user', label: 'User' },
              { value: 'platform_admin', label: 'Platform admin' },
            ]}
          />
        </ListToolbar>
        <UsersTable users={data.items} />
      </div>
    </div>
  );
}
