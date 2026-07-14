'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Inbox,
  BarChart3,
  BookOpen,
  Settings,
  Bot,
  Search,
  Bell,
  LayoutDashboard,
  Globe,
  Sparkles,
  Paintbrush,
  Users,
  Gauge,
  CreditCard,
  Menu,
  Code2,
  Plug,
  Share2,
  ChevronsUpDown,
  Check,
  Plus,
  LogOut,
  User,
  CreditCard as Billing,
  HelpCircle,
  Zap,
  ClipboardList,
  MessageSquareHeart,
  ThumbsDown,
} from 'lucide-react';
import { Logo } from '@/components/site/Logo';
import { Input } from '@csb/ui';
import { ThemeToggle } from '@/components/theme-toggle';
import { useSession, signOut } from 'next-auth/react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
} from '@csb/ui';

type NavItem = {
  href:
    | '/app'
    | '/app/inbox'
    | '/app/analytics'
    | '/app/feeds'
    | '/app/feeds/low-rated'
    | '/app/activity'
    | '/app/knowledge'
    | '/app/settings'
    | '/app/websites'
    | '/app/ai'
    | '/app/widget'
    | '/app/leads'
    | '/app/usage'
    | '/app/billing'
    | '/app/referrals'
    | '/app/developers'
    | '/app/integrations'
    | '/app/triggers';
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  badge?: number;
  group?: string;
};

const nav: NavItem[] = [
  { href: '/app', label: 'Overview', icon: LayoutDashboard, exact: true, group: 'Workspace' },
  { href: '/app/websites', label: 'Websites', icon: Globe, group: 'Workspace' },
  // Badges intentionally absent — wire them to live counts (e.g. unread inbox
  // threads, new leads in last 7 days) instead of hard-coded mock numbers.
  { href: '/app/inbox', label: 'Inbox', icon: Inbox, group: 'Workspace' },
  { href: '/app/leads', label: 'Leads', icon: Users, group: 'Workspace' },
  { href: '/app/ai', label: 'AI agent', icon: Sparkles, group: 'Configure' },
  { href: '/app/widget', label: 'Widget', icon: Paintbrush, group: 'Configure' },
  { href: '/app/knowledge', label: 'Knowledge', icon: BookOpen, group: 'Configure' },
  { href: '/app/developers', label: 'Developers', icon: Code2, group: 'Configure' },
  { href: '/app/integrations', label: 'Integrations', icon: Plug, group: 'Configure' },
  { href: '/app/triggers', label: 'Proactive Triggers', icon: Zap, group: 'Configure' },
  { href: '/app/analytics', label: 'Analytics', icon: BarChart3, group: 'Account' },
  { href: '/app/feeds', label: 'User Feedback', icon: MessageSquareHeart, exact: true, group: 'Account' },
  { href: '/app/feeds/low-rated', label: 'Low-Rated Answers', icon: ThumbsDown, group: 'Account' },
  { href: '/app/activity', label: 'Agent activity', icon: ClipboardList, group: 'Account' },
  { href: '/app/usage', label: 'Usage', icon: Gauge, group: 'Account' },
  { href: '/app/billing', label: 'Billing', icon: CreditCard, group: 'Account' },
  { href: '/app/referrals', label: 'Referrals', icon: Share2, group: 'Account' },
  { href: '/app/settings', label: 'Settings', icon: Settings, group: 'Account' },
];

export type ScopeWebsite = { _id: string; name: string; domain: string };

// The org has ONE workspace; the switcher does NOT change orgs (that label is
// fixed). Instead it sets the "website scope" — All websites, or one website —
// which server components read from the cookie to filter inbox/overview data.
function setWebsiteScopeCookie(value: string): void {
  document.cookie = `csb_website=${value}; path=/; max-age=31536000; samesite=lax`;
}

function WebsiteScopeSwitcher({
  orgName,
  websites,
  activeWebsiteId,
}: {
  orgName: string;
  websites: ScopeWebsite[];
  activeWebsiteId: string | null;
}) {
  const router = useRouter();
  const active = websites.find((w) => w._id === activeWebsiteId) ?? null;
  const currentLabel = active ? active.domain : 'All websites';

  function select(value: string): void {
    setWebsiteScopeCookie(value);
    // Re-run server components so the new scope filters the data.
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface/60 p-2 text-left transition hover:bg-muted">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground text-background">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            {/* Org name is a fixed label; the sub-line shows the active website scope. */}
            <div className="truncate text-xs font-semibold">{orgName}</div>
            <div className="truncate text-[10px] text-muted-foreground">{currentLabel}</div>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[15rem]">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {orgName} · Website
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={() => select('all')} className="gap-2">
          <div className="grid h-6 w-6 place-items-center rounded-md bg-muted text-foreground">
            <Globe className="h-3 w-3" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium">All websites</div>
            <div className="text-[10px] text-muted-foreground">
              {websites.length} site{websites.length === 1 ? '' : 's'}
            </div>
          </div>
          {!activeWebsiteId && <Check className="h-3.5 w-3.5" />}
        </DropdownMenuItem>
        {websites.length > 0 && <DropdownMenuSeparator />}
        {websites.map((w) => (
          <DropdownMenuItem key={w._id} onClick={() => select(w._id)} className="gap-2">
            <div className="grid h-6 w-6 place-items-center rounded-md bg-muted text-foreground">
              <Globe className="h-3 w-3" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{w.name}</div>
              <div className="truncate text-[10px] text-muted-foreground">{w.domain}</div>
            </div>
            {activeWebsiteId === w._id && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="gap-2 text-xs">
          <Link href="/app/websites">
            <Plus className="h-3.5 w-3.5" /> Manage websites
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { data: session } = useSession();
  const name = session?.user?.name ?? session?.user?.email ?? 'Account';
  const email = session?.user?.email ?? '';
  const initial = (name?.[0] ?? '?').toUpperCase();
  const firstName = name.split(' ')[0] ?? name;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="hidden h-9 items-center gap-2 rounded-md border border-border bg-background px-2 pr-3 transition hover:bg-muted sm:flex">
          <div className="grid h-6 w-6 place-items-center rounded-full bg-foreground text-background text-[10px] font-semibold">
            {initial}
          </div>
          <span className="text-xs font-medium">{firstName}</span>
          <ChevronsUpDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="flex items-center gap-2 p-2">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-background text-xs font-semibold">
            {initial}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{name}</div>
            <div className="truncate text-[11px] text-muted-foreground">{email}</div>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href="/app/settings" className="gap-2 text-xs">
              <User className="h-3.5 w-3.5" /> Profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/app/billing" className="gap-2 text-xs">
              <Billing className="h-3.5 w-3.5" /> Billing
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/app/settings" className="gap-2 text-xs">
              <Settings className="h-3.5 w-3.5" /> Settings
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2 text-xs">
          <HelpCircle className="h-3.5 w-3.5" /> Support
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="gap-2 text-xs text-destructive focus:text-destructive"
        >
          <LogOut className="h-3.5 w-3.5" /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Sidebar({
  pathname,
  onNavigate,
  orgName,
  websites,
  activeWebsiteId,
}: {
  pathname: string;
  onNavigate?: () => void;
  orgName: string;
  websites: ScopeWebsite[];
  activeWebsiteId: string | null;
}) {
  const groups = Array.from(new Set(nav.map((n) => n.group ?? '')));
  return (
    <>
      <div className="flex h-14 items-center border-b border-border px-4">
        <Logo />
      </div>
      <div className="px-3 py-3">
        <WebsiteScopeSwitcher
          orgName={orgName}
          websites={websites}
          activeWebsiteId={activeWebsiteId}
        />
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {groups.map((g) => (
          <div key={g}>
            <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {g}
            </div>
            <div className="space-y-0.5">
              {nav
                .filter((n) => (n.group ?? '') === g)
                .map((n) => {
                  const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      onClick={onNavigate}
                      className={`group flex items-center justify-between rounded-md px-2.5 py-2 text-sm transition ${
                        active ? 'bg-foreground text-background' : 'text-foreground/80 hover:bg-muted'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <n.icon className="h-4 w-4" strokeWidth={1.75} />
                        {n.label}
                      </span>
                      {n.badge ? (
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${active ? 'bg-background/20 text-background' : 'bg-muted text-muted-foreground'}`}
                        >
                          {n.badge}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-border p-3">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          ← Back to website
        </Link>
      </div>
    </>
  );
}

export function AppShell({
  children,
  orgName = 'Workspace',
  websites = [],
  activeWebsiteId = null,
  plan,
}: {
  children: React.ReactNode;
  orgName?: string;
  websites?: ScopeWebsite[];
  activeWebsiteId?: string | null;
  plan?: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full bg-surface">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-background lg:flex">
        <Sidebar
          pathname={pathname}
          orgName={orgName}
          websites={websites}
          activeWebsiteId={activeWebsiteId}
        />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-background">
            <Sidebar
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
              orgName={orgName}
              websites={websites}
              activeWebsiteId={activeWebsiteId}
            />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 min-w-0 items-center justify-between gap-2 border-b border-border bg-background/85 px-3 backdrop-blur sm:gap-3 sm:px-5">
          <button
            onClick={() => setMobileOpen(true)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-background lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="relative min-w-0 flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search…" className="h-9 w-full pl-8 text-sm" />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {plan ? (
              <Link
                href="/app/billing"
                title="Manage your plan"
                className="hidden items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs hover:bg-muted sm:inline-flex"
              >
                <span className="font-medium capitalize">{plan}</span>
                <span className="text-muted-foreground">· Change plan</span>
              </Link>
            ) : null}
            <ThemeToggle />
            <button className="relative grid h-9 w-9 place-items-center rounded-md border border-border bg-background hover:bg-muted">
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" />
            </button>
            <UserMenu />
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
