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
        'dark:bg-background-7 scroll-bar fixed top-0 right-0 z-[999] h-screen w-full bg-white transition-transform duration-300 ease-in-out sm:w-1/2 xl:hidden',
        isOpen ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <div className="space-y-4 p-5 sm:p-8 lg:p-9">
        <div className="flex items-center justify-between">
          <Link href="/" onClick={closeMenu} className="inline-flex items-center gap-2.5">
            <span className="sr-only">Home</span>
            <img src="/images/shared/logo-green.svg" alt="" className="h-9 w-9" />
            <span className="font-display text-[17px] font-semibold tracking-tight text-secondary dark:text-accent">
              {NAVBAR_BRAND_NAME}
            </span>
          </Link>
          <button
            onClick={closeMenu}
            className="bg-background-4 dark:bg-background-9 hover:bg-background-5 dark:hover:bg-background-8 relative flex size-10 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-full transition-all duration-200 hover:scale-105 group"
            aria-label="Close mobile menu"
          >
            <span className="sr-only">Close Menu</span>
            <span className="bg-secondary/60 dark:bg-stroke-1 absolute block h-0.5 w-4 rotate-45 transition-all duration-200 group-hover:bg-secondary dark:group-hover:bg-stroke-1" />
            <span className="bg-secondary/60 dark:bg-stroke-1 absolute block h-0.5 w-4 -rotate-45 transition-all duration-200 group-hover:bg-secondary dark:group-hover:bg-stroke-1" />
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
