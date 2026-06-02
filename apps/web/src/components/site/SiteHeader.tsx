'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Logo } from './Logo';
import { Button } from '@csb/ui';
import { ThemeToggle } from '@/components/theme-toggle';

const links = [
  { href: '/features', label: 'Features' },
  { href: '/customers', label: 'Customers' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/contact', label: 'Contact' },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="container-page flex h-14 items-center justify-between">
        <Logo />
        <nav className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`text-sm transition hover:text-foreground ${
                pathname === l.href ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/app">Open dashboard</Link>
          </Button>
        </div>
        <button
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
      </div>
      {open && (
        <div className="border-t border-border bg-background md:hidden">
          <div className="container-page flex flex-col gap-1 py-3">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-md px-2 py-2 text-sm text-foreground hover:bg-muted"
                onClick={() => setOpen(false)}
              >
                {l.label}
              </Link>
            ))}
            <Link
              href="/app"
              className="mt-2 rounded-md bg-foreground px-3 py-2 text-center text-sm text-background"
              onClick={() => setOpen(false)}
            >
              Open dashboard
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
