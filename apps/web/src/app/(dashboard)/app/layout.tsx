import { Fragment } from 'react';
import type { Metadata } from 'next';
import { AppShell, type ScopeWebsite } from '@/components/layouts/app-shell';
import { APP_NAME, APP_TAGLINE } from '@/lib/app-config';
import { api, ApiError } from '@/lib/api';
import { getActiveWebsiteId } from '@/lib/website-scope';

export const metadata: Metadata = {
  title: `Dashboard — ${APP_NAME}`,
  description: `${APP_NAME} — ${APP_TAGLINE}.`,
};

async function safeGet<T>(path: string): Promise<T | null> {
  try {
    return await api.get<T>(path);
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The org name is a fixed label; websites drive the scope switcher. Both come
  // from the API; the operator's current scope comes from the cookie.
  const [org, websites] = await Promise.all([
    safeGet<{ name?: string }>('/orgs/current'),
    safeGet<ScopeWebsite[]>('/websites'),
  ]);
  const activeWebsiteId = await getActiveWebsiteId();

  return (
    <AppShell
      orgName={org?.name ?? 'Workspace'}
      websites={websites ?? []}
      activeWebsiteId={activeWebsiteId}
    >
      {/* Key the page subtree by the active website so switching workspaces
          remounts every /app page. Server components already re-fetch on the
          switcher's router.refresh(); remounting also resets client components
          that seed useState from server props (Widget Studio, AI agent editor,
          etc.), so their forms reflect the newly selected website. */}
      <Fragment key={activeWebsiteId ?? 'all'}>{children}</Fragment>
    </AppShell>
  );
}
