'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  LayoutDashboard,
  Building2,
  Bot,
  Users,
  Receipt,
  BarChart3,
  Megaphone,
  Settings,
  Menu,
  LogOut,
  DollarSign,
} from 'lucide-react';
import { Logo } from '@/components/site/Logo';
import { ThemeToggle } from '@/components/theme-toggle';

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; group: string; exact?: boolean };

const NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview', exact: true },
  { href: '/analytics', label: 'Analytics', icon: BarChart3, group: 'Overview' },
  { href: '/organizations', label: 'Organizations', icon: Building2, group: 'Tenants' },
  { href: '/agents', label: 'Agents', icon: Bot, group: 'Tenants' },
  { href: '/users', label: 'Users', icon: Users, group: 'Tenants' },
  { href: '/subscriptions', label: 'Subscriptions', icon: Receipt, group: 'Revenue' },
  { href: '/usage', label: 'AI Usage', icon: DollarSign, group: 'Revenue' },
  { href: '/campaigns', label: 'Campaigns', icon: Megaphone, group: 'Marketing' },
  { href: '/settings', label: 'System Preferences', icon: Settings, group: 'Platform' },
];

const GROUPS = ['Overview', 'Tenants', 'Revenue', 'Marketing', 'Platform'];

function Sidebar({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <Logo />
        <span className="rounded-md bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-destructive">
          Admin
        </span>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto p-3">
        {GROUPS.map((group) => (
          <div key={group}>
            <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group}
            </div>
            <div className="space-y-0.5">
              {NAV.filter((n) => n.group === group).map((n) => {
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
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-border p-3">
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground/80 transition hover:bg-muted"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full bg-surface">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-background lg:flex">
        <Sidebar pathname={pathname} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-background">
            <Sidebar pathname={pathname} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/85 px-3 backdrop-blur sm:px-5">
          <button
            onClick={() => setOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-md border border-border bg-background lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="text-sm font-semibold">Platform administration</div>
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
