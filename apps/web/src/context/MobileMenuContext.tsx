'use client';

import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

interface MobileMenuContextValue {
  isOpen: boolean;
  openMenu: () => void;
  closeMenu: () => void;
  toggleMenu: () => void;
}

const MobileMenuContext = createContext<MobileMenuContextValue | null>(null);

export const MobileMenuProvider = ({ children }: { children: ReactNode }) => {
  const [isOpen, setIsOpen] = useState(false);

  const openMenu = useCallback(() => setIsOpen(true), []);
  const closeMenu = useCallback(() => setIsOpen(false), []);
  const toggleMenu = useCallback(() => setIsOpen((prev) => !prev), []);

  return (
    <MobileMenuContext.Provider value={{ isOpen, openMenu, closeMenu, toggleMenu }}>
      {children}
    </MobileMenuContext.Provider>
  );
};

export const useMobileMenuContext = () => {
  const ctx = useContext(MobileMenuContext);
  if (!ctx) throw new Error('useMobileMenuContext must be used within MobileMenuProvider');
  return ctx;
};
