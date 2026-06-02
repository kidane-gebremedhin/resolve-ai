import Link from 'next/link';
import { APP_NAME } from '@/lib/app-config';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2 ${className}`}>
      <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background">
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
          <path d="M4 6h16M4 12h10M4 18h7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
      </span>
      <span className="font-display text-[15px] font-semibold tracking-tight">{APP_NAME}</span>
      <span className="rounded border border-border px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
        AI
      </span>
    </Link>
  );
}
