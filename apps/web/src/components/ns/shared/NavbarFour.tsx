'use client';

import { cn } from '@/utils/ns-cn';
import { useEffect, useState } from 'react';
import { NAVBAR_BRAND_NAME } from '@/lib/app-config';

const navItems = [
  { id: 'features', label: 'Features', href: '/features' },
  { id: 'pricing', label: 'Pricing', href: '/pricing' },
  { id: 'blog', label: 'Blog', href: '/blog' },
  { id: 'affiliates', label: 'Affiliates', href: '/affiliates' },
  { id: 'contact', label: 'Contact Us', href: '/contact' },
];

const NavbarFour = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 100);
    window.addEventListener('scroll', handleScroll);
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <>
      <header>
        <div
          className={cn(
            'fixed top-5 left-1/2 z-50 mx-auto flex w-full max-w-[320px] -translate-x-1/2 items-center justify-between rounded-full px-2.5 py-2.5 transition-all duration-500 ease-in-out min-[425px]:max-w-[375px] min-[500px]:max-w-[450px] sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1140px] xl:py-0',
            'border border-stroke-2 bg-accent dark:border-stroke-6 dark:bg-background-9',
            isScrolled && 'lg:top-2 top-2',
          )}
        >
          <a href="/" className="inline-flex items-center gap-2.5 pl-2">
            <span className="sr-only">Home</span>
            <img src="/images/shared/logo-green.svg" alt="" className="h-8 w-8" />
            <span className="font-display text-[17px] font-semibold tracking-tight text-secondary dark:text-accent">
              {NAVBAR_BRAND_NAME}
            </span>
          </a>

          <nav className="hidden items-center xl:flex">
            <ul className="flex items-center gap-7">
              {navItems.map((item) => (
                <li key={item.id} className="py-2.5">
                  <a
                    href={item.href}
                    className="text-secondary/80 hover:text-secondary dark:text-accent/80 dark:hover:text-accent transition-colors duration-200 text-[0.875rem] font-normal"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex items-center gap-2 pr-1">
            <a
              href="/signup"
              className="btn btn-primary hover:btn-white-dark dark:hover:btn-white btn-md hidden sm:inline-block"
            >
              <span>Get started</span>
            </a>
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="xl:hidden flex flex-col gap-1.5 p-2"
              aria-label="Toggle mobile menu"
            >
              <span
                className={cn(
                  'block h-0.5 w-5 bg-secondary dark:bg-accent transition-all duration-300',
                  mobileOpen && 'rotate-45 translate-y-2',
                )}
              />
              <span
                className={cn(
                  'block h-0.5 w-5 bg-secondary dark:bg-accent transition-all duration-300',
                  mobileOpen && 'opacity-0',
                )}
              />
              <span
                className={cn(
                  'block h-0.5 w-5 bg-secondary dark:bg-accent transition-all duration-300',
                  mobileOpen && '-rotate-45 -translate-y-2',
                )}
              />
            </button>
          </div>
        </div>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 xl:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <aside
            className="absolute top-0 right-0 h-full w-80 bg-accent dark:bg-background-9 p-8 space-y-6 scroll-bar overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <a
                href="/"
                onClick={() => setMobileOpen(false)}
                className="inline-flex items-center gap-2.5"
              >
                <img src="/images/shared/logo-green.svg" alt="" className="h-8 w-8" />
                <span className="font-display text-[17px] font-semibold tracking-tight text-secondary dark:text-accent">
                  {NAVBAR_BRAND_NAME}
                </span>
              </a>
              <button
                onClick={() => setMobileOpen(false)}
                className="text-secondary/60 dark:text-accent/60 hover:text-secondary dark:hover:text-accent text-2xl"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <nav>
              <ul className="space-y-4">
                {navItems.map((item) => (
                  <li key={item.id}>
                    <a
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className="text-secondary dark:text-accent text-[1rem] font-normal block py-2 border-b border-stroke-2 dark:border-stroke-6 hover:text-primary-500 transition-colors"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <a href="/signup" className="btn btn-primary btn-md w-full">
              <span>Get started</span>
            </a>
          </aside>
        </div>
      )}
    </>
  );
};

export default NavbarFour;
