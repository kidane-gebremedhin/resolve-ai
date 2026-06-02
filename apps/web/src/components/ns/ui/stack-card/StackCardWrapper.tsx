'use client';

import React, { useEffect, useRef } from 'react';
import { initStackCards } from '@/utils/stackCards';
import { cn } from '@/utils/ns-cn';

interface StackCardsProps {
  children: React.ReactNode;
  className?: string;
  topOffset?: string;
  gap?: string;
  initDelay?: number;
  disabled?: boolean;
}

const StackCardWrapper: React.FC<StackCardsProps> = ({
  children,
  className,
  topOffset = '50vh',
  gap = '20px',
  initDelay = 100,
  disabled = false,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || disabled) return;
    const timer = setTimeout(() => { initStackCards(); }, initDelay);
    return () => clearTimeout(timer);
  }, [initDelay, disabled]);

  return (
    <div
      ref={ref}
      className={cn('js-stack-cards', className)}
      style={{ '--stack-cards-top-offset': topOffset, '--stack-cards-gap': gap } as React.CSSProperties}
    >
      {children}
    </div>
  );
};

StackCardWrapper.displayName = 'StackCardWrapper';
export default StackCardWrapper;
