import type { Metadata } from 'next';
import SignupPageContent from '@/components/ns/pages/signup-page-content';

export const metadata: Metadata = {
  title: 'Sign up',
};

// Registration is reachable directly — /register works with or without a plan.
//
// This page used to redirect a plan-less visit to /pricing, which made the
// "Create an Account" link on /login appear broken: you clicked sign-up and
// landed on a pricing table with no account created. Plan selection still
// happens, just after signup rather than before: SignupHero sends new accounts
// to /checkout, which shows the plans grid when no `?plan=` was carried through
// (and opens that plan's overlay directly when one was).
export default function Page() {
  return <SignupPageContent />;
}
