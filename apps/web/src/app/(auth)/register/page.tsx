import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import SignupPageContent from '@/components/ns/pages/signup-page-content';

export const metadata: Metadata = {
  title: 'Sign up',
};

const VALID_PLANS = new Set(['pro', 'business', 'enterprise']);

// Signup requires choosing a plan first: visitors reach /register?plan=<tier>
// from the pricing CTAs. A direct visit with no (valid) plan goes to /pricing.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = sp.plan;
  const plan = Array.isArray(raw) ? raw[0] : raw;
  if (!plan || !VALID_PLANS.has(plan)) {
    redirect('/pricing');
  }
  return <SignupPageContent />;
}
