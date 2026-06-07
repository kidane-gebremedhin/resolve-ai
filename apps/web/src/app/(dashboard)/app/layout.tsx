import { Fragment } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AppShell, type ScopeWebsite } from '@/components/layouts/app-shell';
import { ClearCheckoutPlan } from '@/components/billing/clear-checkout-plan';
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
  // Hard subscription gate: no dashboard access without an active paid plan.
  // Unpaid orgs are sent to checkout (the only post-signup destination).
  const sub = await safeGet<{ active?: boolean; plan?: string }>('/billing/subscription');
  if (!sub?.active) {
    redirect('/checkout');
  }

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
      plan={sub?.plan ?? undefined}
    >
      {/* Checkout is complete (this route is subscription-gated) — clear any
          plan stashed during pricing → checkout. */}
      <ClearCheckoutPlan />
      {/* Key the page subtree by the active website so switching workspaces
          remounts every /app page. Server components already re-fetch on the
          switcher's router.refresh(); remounting also resets client components
          that seed useState from server props (Widget Studio, AI agent editor,
          etc.), so their forms reflect the newly selected website. */}
      <Fragment key={activeWebsiteId ?? 'all'}>{children}</Fragment>
    </AppShell>
  );
}
