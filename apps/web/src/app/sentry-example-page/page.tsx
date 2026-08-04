import type { Metadata } from 'next';
import SentryTestPanel from './sentry-test-panel';

// Deliberately outside the (marketing) and (dashboard) route groups: this page
// needs no nav, no auth and no data — it must stay reachable right after a
// deploy, when everything else may still be broken.
export const metadata: Metadata = {
  title: 'Sentry test',
  description: 'Trigger test errors to verify Sentry reporting for the web app and the API.',
  // Never index it; it exists purely as a production smoke test.
  robots: { index: false, follow: false },
};

export default function Page() {
  return <SentryTestPanel />;
}
