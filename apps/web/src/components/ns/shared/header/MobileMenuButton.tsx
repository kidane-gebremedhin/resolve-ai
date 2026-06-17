'use client';

import { useMobileMenuContext } from '@/context/MobileMenuContext';

const MobileMenuButton = () => {
  const { openMenu } = useMobileMenuContext();

  return (
    <div className="block xl:hidden">
      <button
        onClick={openMenu}
        className="bg-background-4 dark:bg-background-6 hover:bg-background-5 dark:hover:bg-background-7 flex size-12 cursor-pointer items-center justify-center rounded-full transition-all duration-200 hover:scale-105 group"
        aria-label="Open mobile menu"
      >
        <span className="sr-only">Menu</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.75}
          stroke="currentColor"
          aria-hidden
          className="size-6 text-secondary dark:text-stroke-1 group-hover:text-secondary/80 dark:group-hover:text-white"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>
    </div>
  );
};

export default MobileMenuButton;
