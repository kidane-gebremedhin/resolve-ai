'use client';

import { cn } from '@/utils/ns-cn';
import { useEffect, useState } from 'react';
import { APP_NAME } from '@/lib/app-config';

const navItems = [
  { id: 'features', label: 'Features', href: '/features' },
  { id: 'pricing', label: 'Pricing', href: '/pricing' },
  { id: 'blog', label: 'Blog', href: '/blog' },
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
      <header
        className={cn(
          'fixed top-3 left-0 z-50 flex w-full items-center px-12 transition-all duration-500 ease-in-out md:top-0 backdrop-blur-3xl',
          isScrolled && 'bg-black/40 px-5 dark:bg-transparent',
        )}
      >
        <div className="mx-auto flex w-full max-w-[1920px] items-center justify-between">
          <div>
            <a href="/">
              <span className="sr-only">Home</span>
              <img src="/images/shared/logo-green.svg" alt={APP_NAME} className="h-8" />
            </a>
          </div>
          <div className="flex items-center gap-[76px]">
            <nav className="hidden items-center xl:flex">
              <ul className="flex items-center gap-6">
                {navItems.map((item) => (
                  <li key={item.id} className="py-6">
                    <a href={item.href} className="text-white/80 hover:text-white transition-colors duration-200 text-[0.875rem] font-normal">
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="flex items-center gap-2">
              <a href="/login" className="btn btn-primary hover:btn-white-dark btn-md hidden sm:inline-block">
                <span>Login</span>
              </a>
              {/* Mobile menu button */}
              <button
                onClick={() => setMobileOpen(!mobileOpen)}
                className="xl:hidden flex flex-col gap-1.5 p-2"
                aria-label="Toggle mobile menu"
              >
                <span className={cn('block h-0.5 w-5 bg-white transition-all duration-300', mobileOpen && 'rotate-45 translate-y-2')} />
                <span className={cn('block h-0.5 w-5 bg-white transition-all duration-300', mobileOpen && 'opacity-0')} />
                <span className={cn('block h-0.5 w-5 bg-white transition-all duration-300', mobileOpen && '-rotate-45 -translate-y-2')} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 xl:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <aside className="absolute top-0 right-0 h-full w-80 bg-background-7 dark:bg-background-6 p-8 space-y-6 scroll-bar overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <a href="/" onClick={() => setMobileOpen(false)}>
                <img src="/images/shared/logo-green.svg" alt={APP_NAME} className="h-8" />
              </a>
              <button onClick={() => setMobileOpen(false)} className="text-accent/60 hover:text-accent text-2xl" aria-label="Close">✕</button>
            </div>
            <nav>
              <ul className="space-y-4">
                {navItems.map((item) => (
                  <li key={item.id}>
                    <a href={item.href} onClick={() => setMobileOpen(false)} className="text-accent text-[1rem] font-normal block py-2 border-b border-stroke-7 hover:text-primary-400 transition-colors">
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <a href="/login" className="btn btn-primary btn-md w-full">
              <span>Login</span>
            </a>
          </aside>
        </div>
      )}
    </>
  );
};

export default NavbarFour;
