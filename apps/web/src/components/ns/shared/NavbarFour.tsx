'use client';

import { MobileMenuProvider } from '@/context/MobileMenuContext';
import { useNavbarScroll } from '@/hooks/useNavbarScroll';
import { cn } from '@/utils/ns-cn';
import { FC } from 'react';
import Logo from './header/Logo';
import MobileMenuButton from './header/MobileMenuButton';
import NavCTAButton from './header/NavCTAButton';
import NavItemLink, { type NavigationItem } from './header/NavItemLink';
import MobileMenu from './MobileMenu';

interface NavbarFourProps {
  className?: string;
  btnClassName?: string;
}

const navigationItems: NavigationItem[] = [
  { id: 'features', label: 'Features', href: '/features', hasDropdown: false },
  { id: 'pricing', label: 'Pricing', href: '/pricing', hasDropdown: false },
  { id: 'affiliates', label: 'Affiliates', href: '/affiliates', hasDropdown: false },
  { id: 'contact', label: 'Contact Us', href: '/contact', hasDropdown: false },
];

const NavbarFour: FC<NavbarFourProps> = ({
  className = 'border-stroke-2 dark:border-stroke-6 bg-accent dark:bg-background-9 border',
  btnClassName = 'btn-primary hover:btn-white-dark dark:hover:btn-white',
}) => {
  const { isScrolled } = useNavbarScroll(100);

  return (
    <MobileMenuProvider>
      <header>
        <div
          className={cn(
            'fixed top-5 left-1/2 z-50 mx-auto flex w-full max-w-[320px] -translate-x-1/2 items-center justify-between rounded-full px-2.5 py-2.5 transition-all duration-500 ease-in-out min-[425px]:max-w-[375px] min-[500px]:max-w-[450px] sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1140px] xl:py-0 min-[1440px]:max-w-[1290px]!',
            className,
            isScrolled && 'lg:top-2 top-2 transition-all duration-500 ease-in-out',
          )}
        >
          <Logo />

          <nav className="hidden items-center xl:flex">
            <ul className="flex items-center">
              {navigationItems.map((item) => (
                <li key={item.id} className="py-2.5 group/nav relative">
                  <NavItemLink item={item} />
                </li>
              ))}
            </ul>
          </nav>

          <NavCTAButton href="/login" btnClassName={btnClassName} label="Login" />

          <MobileMenuButton />
        </div>

        <MobileMenu items={navigationItems} />
      </header>
    </MobileMenuProvider>
  );
};

NavbarFour.displayName = 'NavbarFour';
export default NavbarFour;
