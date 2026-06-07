import Link from 'next/link';
import { APP_NAME } from '@/lib/app-config';

// Brand mark: a rounded gradient tile with a chat bubble + typing dots — a
// cleaner, more professional take than a flat glyph, and unmistakably a
// customer-support chat product.
export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link href="/" className={`group inline-flex items-center gap-2.5 ${className}`}>
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-white shadow-sm ring-1 ring-black/5 transition-transform group-hover:scale-[1.03]">
        <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" aria-hidden>
          <path
            d="M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-4 3.5V16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
            fill="currentColor"
          />
          <circle cx="8.5" cy="10" r="1.1" fill="white" />
          <circle cx="12" cy="10" r="1.1" fill="white" />
          <circle cx="15.5" cy="10" r="1.1" fill="white" />
        </svg>
      </span>
      <span className="font-display text-[15px] font-semibold tracking-tight">{APP_NAME}</span>
    </Link>
  );
}
