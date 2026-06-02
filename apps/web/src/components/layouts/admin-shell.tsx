'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { LayoutDashboard, Users, CreditCard, Settings, Menu, BarChart3, Receipt } from 'lucide-react';
import { Logo } from '@/components/site/Logo';
import { ThemeToggle } from '@/components/theme-toggle';

type AdminNav = {
  href:
    | '/admin'
    | '/admin/users'
    | '/admin/subscribers'
    | '/admin/subscriptions'
    | '/admin/analytics'
    | '/admin/settings';
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
};

const nav: AdminNav[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/subscribers', label: 'Subscribers', icon: CreditCard },
  { href: '/admin/subscriptions', label: 'Subscriptions', icon: Receipt },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const SidebarContent = (onNavigate?: () => void) => (
    <>
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <Logo />
        <span className="rounded-md bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-destructive">
          Admin
        </span>
      </div>
      <nav className="flex-1 space-y-0.5 p-3">
        {nav.map((n) => {
          const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNavigate}
              className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition ${
                active ? 'bg-foreground text-background' : 'text-foreground/80 hover:bg-muted'
              }`}
            >
              <n.icon className="h-4 w-4" strokeWidth={1.75} />
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border p-3">
        <Link href="/app" className="text-xs text-muted-foreground hover:text-foreground">
          ← Back to app
        </Link>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen w-full bg-surface">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-background lg:flex">
        {SidebarContent()}
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-background">
            {SidebarContent(() => setOpen(false))}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/85 px-3 backdrop-blur sm:px-5">
          <button
            onClick={() => setOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-md border border-border lg:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="text-sm font-semibold">Platform admin</div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-background text-[10px] font-semibold">
              A
            </div>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
