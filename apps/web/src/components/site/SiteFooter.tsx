import Link from 'next/link';
import { Logo } from './Logo';
import { APP_LEGAL_NAME } from '@/lib/app-config';

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="container-page grid gap-10 py-14 md:grid-cols-4">
        <div className="md:col-span-2">
          <Logo />
          <p className="mt-4 max-w-sm text-sm text-muted-foreground">
            The AI customer support platform for modern websites. Resolve faster, scale calmer.
          </p>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Product</div>
          <ul className="mt-4 space-y-2 text-sm">
            <li>
              <Link href="/features" className="text-muted-foreground hover:text-foreground">
                Features
              </Link>
            </li>
            <li>
              <Link href="/pricing" className="text-muted-foreground hover:text-foreground">
                Pricing
              </Link>
            </li>
            <li>
              <Link href="/customers" className="text-muted-foreground hover:text-foreground">
                Customers
              </Link>
            </li>
            <li>
              <Link href="/app" className="text-muted-foreground hover:text-foreground">
                Dashboard demo
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Company</div>
          <ul className="mt-4 space-y-2 text-sm">
            <li>
              <Link href="/contact" className="text-muted-foreground hover:text-foreground">
                Contact
              </Link>
            </li>
            <li>
              <span className="text-muted-foreground">Privacy</span>
            </li>
            <li>
              <span className="text-muted-foreground">Terms</span>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="container-page flex flex-col items-start justify-between gap-2 py-5 text-xs text-muted-foreground md:flex-row md:items-center">
          <span suppressHydrationWarning>© {new Date().getFullYear()} {APP_LEGAL_NAME} All rights reserved.</span>
          <span>SOC 2 Type II · GDPR · ISO 27001</span>
        </div>
      </div>
    </footer>
  );
}
