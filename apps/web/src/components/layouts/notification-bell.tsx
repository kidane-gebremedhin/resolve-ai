'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, AlertTriangle, CircleAlert, Info, Check } from 'lucide-react';
import { clientApi } from '@/lib/api';
import { getOperatorSocket } from '@/lib/socket';

type Notification = {
  id: string;
  type: string;
  level: 'info' | 'warning' | 'error';
  title: string;
  body: string;
  link: string | null;
  agentId: string | null;
  websiteId: string | null;
  read: boolean;
  createdAt: string;
};

// Mirror the sidebar switcher: scope the workspace to a website so a link to
// `/app/ai` opens the corresponding agent (the AI page reads this cookie).
function setWebsiteScopeCookie(websiteId: string): void {
  document.cookie = `csb_website=${websiteId}; path=/; max-age=31536000; samesite=lax`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function LevelIcon({ level }: { level: Notification['level'] }) {
  if (level === 'error') return <CircleAlert className="h-4 w-4 shrink-0 text-destructive" />;
  if (level === 'warning') return <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />;
  return <Info className="h-4 w-4 shrink-0 text-primary" />;
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    clientApi
      .get<{ notifications: Notification[]; unreadCount: number }>('/notifications')
      .then((data) => {
        if (cancelled) return;
        setItems(data.notifications);
        setUnread(data.unreadCount);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Live updates over the operator socket.
  useEffect(() => {
    let cancelled = false;
    let socket: ReturnType<typeof getOperatorSocket> | null = null;
    const handleNew = (n: Notification) => {
      setItems((prev) => [n, ...prev].slice(0, 50));
      setUnread((c) => c + 1);
    };
    (async () => {
      const tokenRes = await fetch('/api/session-token', { cache: 'no-store' });
      const { accessToken } = (await tokenRes.json()) as { accessToken?: string };
      if (cancelled || !accessToken) return;
      socket = getOperatorSocket(accessToken);
      socket.on('notification:new', handleNew);
    })();
    return () => {
      cancelled = true;
      socket?.off('notification:new', handleNew);
    };
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const markRead = useCallback((id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((c) => Math.max(0, c - 1));
    clientApi.post(`/notifications/${id}/read`).catch(() => undefined);
  }, []);

  const markAllRead = useCallback(() => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    clientApi.post('/notifications/read-all').catch(() => undefined);
  }, []);

  const onItemClick = useCallback(
    (n: Notification) => {
      if (!n.read) markRead(n.id);
      if (n.link) {
        // Scope to the notification's website first so `/app/ai` resolves to the
        // corresponding agent, then navigate.
        if (n.websiteId) setWebsiteScopeCookie(n.websiteId);
        setOpen(false);
        router.push(n.link);
        // A cookie change doesn't re-run server components on its own; refresh so
        // the AI page (and switcher) pick up the new website scope.
        if (n.websiteId) router.refresh();
      }
    },
    [markRead, router],
  );

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative grid h-9 w-9 place-items-center rounded-md border border-border bg-background hover:bg-muted"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-border bg-background shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Check className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                You&apos;re all caught up.
              </p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onItemClick(n)}
                  className={`flex w-full items-start gap-2.5 border-b border-border px-4 py-3 text-left transition hover:bg-muted ${
                    n.read ? '' : 'bg-primary/5'
                  }`}
                >
                  <LevelIcon level={n.level} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{n.title}</p>
                      {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                    </div>
                    {n.body && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
