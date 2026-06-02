import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import HomePageContent from '@/components/ns/home-page-content';
import { auth } from '@/lib/auth';
import { APP_NAME, APP_TAGLINE } from '@/lib/app-config';

export const metadata: Metadata = {
  // Root layout sets title.template = "%s — ${APP_NAME}", but the home page
  // wants its full marketing tagline, so we override the default here.
  title: { absolute: `${APP_NAME} — ${APP_TAGLINE}` },
  description: `${APP_NAME} — AI agent, unified inbox and analytics that resolve 68% of tickets automatically.`,
};

// Authenticated visitors land on the marketing home only by accident (typed URL,
// stale bookmark, click on the logo). Bounce them straight into the dashboard
// so they don't see the unauthenticated CTA copy. Spec 11 / spec 16.
export default async function Home() {
  const session = await auth();
  if (session) redirect('/app');
  return <HomePageContent />;
}
