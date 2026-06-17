'use client';

import { useMobileMenuContext } from '@/context/MobileMenuContext';
import { cn } from '@/utils/ns-cn';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { NAVBAR_BRAND_NAME } from '@/lib/app-config';
import type { NavigationItem } from '@/components/ns/shared/header/NavItemLink';

interface MobileMenuProps {
  items: NavigationItem[];
}

const MobileMenu = ({ items }: MobileMenuProps) => {
  const { isOpen, closeMenu } = useMobileMenuContext();
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isOpen && sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, closeMenu]);

  return (
    <aside
      ref={sidebarRef}
      className={cn(
        'dark:bg-background-7 scroll-bar fixed top-0 right-0 z-999 h-screen w-full bg-white transition-transform duration-300 ease-in-out sm:w-1/2 xl:hidden',
        isOpen ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <div className="space-y-4 p-5 sm:p-8 lg:p-9">
        <div className="flex items-center justify-between">
          <Link href="/" onClick={closeMenu} className="inline-flex items-center gap-2.5">
            <span className="sr-only">Home</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
              className="h-7 w-7 text-primary-500"
            >
              <path
                fillRule="evenodd"
                d="M4.848 2.771A49.144 49.144 0 0 1 12 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 0 1-3.476.383.39.39 0 0 0-.297.17l-2.755 4.133a.75.75 0 0 1-1.248 0l-2.755-4.133a.39.39 0 0 0-.297-.17 48.9 48.9 0 0 1-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.945 1.37-3.678 3.348-3.97ZM6.75 8.25a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9a.75.75 0 0 1-.75-.75Zm.75 2.25a.75.75 0 0 0 0 1.5H12a.75.75 0 0 0 0-1.5H7.5Z"
                clipRule="evenodd"
              />
              <path d="M19.967 17.93a1.5 1.5 0 0 1 .07.345c.099 1.04.49 2 1.115 2.804a.75.75 0 0 1-.587 1.213c-1.64 0-3.146-.561-4.34-1.502-.226-.166-.498-.255-.781-.255-.04 0-.077.002-.115.007a40.61 40.61 0 0 1-2.41.34.75.75 0 0 1-.75-.75v-.13l1.91-2.866a1.89 1.89 0 0 1 1.418-.825c1.05-.061 2.085-.18 3.103-.358Z" />
            </svg>
            <span className="font-display text-[15px] font-semibold tracking-tight text-[#1a1a1c] dark:text-[#fcfcfc]">
              {NAVBAR_BRAND_NAME}
            </span>
          </Link>
          <button
            onClick={closeMenu}
            className="bg-background-4 dark:bg-background-9 hover:bg-background-5 dark:hover:bg-background-8 flex size-10 cursor-pointer items-center justify-center rounded-full transition-all duration-200 hover:scale-105 group"
            aria-label="Close mobile menu"
          >
            <span className="sr-only">Close Menu</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              aria-hidden
              className="size-5 text-secondary/70 dark:text-stroke-1 group-hover:text-secondary dark:group-hover:text-white"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="scroll-bar h-[85vh] w-full overflow-x-hidden overflow-y-auto pb-10">
          <ul className="space-y-1 pt-4">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  onClick={closeMenu}
                  className="block px-4 py-3 rounded-xl text-[1rem] font-medium text-secondary dark:text-accent hover:bg-background-4 dark:hover:bg-background-9 transition-colors"
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li className="pt-4 px-4">
              <Link
                href="/signup"
                onClick={closeMenu}
                className="btn btn-primary btn-md w-full"
              >
                <span>Get started</span>
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </aside>
  );
};

export default MobileMenu;
