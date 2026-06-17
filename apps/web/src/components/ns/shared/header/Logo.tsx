import Link from 'next/link';
import { NAVBAR_BRAND_NAME } from '@/lib/app-config';

// Heroicons `chat-bubble-left-right` (24/solid) inlined — same visual as
// importing from @heroicons/react, no extra dependency.
const ChatBubbleLeftRightIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden
    className={className}
  >
    <path
      fillRule="evenodd"
      d="M4.848 2.771A49.144 49.144 0 0 1 12 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 0 1-3.476.383.39.39 0 0 0-.297.17l-2.755 4.133a.75.75 0 0 1-1.248 0l-2.755-4.133a.39.39 0 0 0-.297-.17 48.9 48.9 0 0 1-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.945 1.37-3.678 3.348-3.97ZM6.75 8.25a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9a.75.75 0 0 1-.75-.75Zm.75 2.25a.75.75 0 0 0 0 1.5H12a.75.75 0 0 0 0-1.5H7.5Z"
      clipRule="evenodd"
    />
    <path d="M19.967 17.93a1.5 1.5 0 0 1 .07.345c.099 1.04.49 2 1.115 2.804a.75.75 0 0 1-.587 1.213c-1.64 0-3.146-.561-4.34-1.502-.226-.166-.498-.255-.781-.255-.04 0-.077.002-.115.007a40.61 40.61 0 0 1-2.41.34.75.75 0 0 1-.75-.75v-.13l1.91-2.866a1.89 1.89 0 0 1 1.418-.825c1.05-.061 2.085-.18 3.103-.358Z" />
  </svg>
);

const Logo = () => {
  return (
    <div>
      <Link href="/" className="inline-flex items-center gap-2.5">
        <span className="sr-only">Home</span>
        <ChatBubbleLeftRightIcon className="h-7 w-7 text-primary-500" />
        <span className="font-display text-[15px] font-semibold tracking-tight text-[#1a1a1c] dark:text-[#fcfcfc]">
          {NAVBAR_BRAND_NAME}
        </span>
      </Link>
    </div>
  );
};

export default Logo;
