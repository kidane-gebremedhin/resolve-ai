import { cn } from '@/utils/ns-cn';
import React from 'react';

interface NSLandingShellProps {
  children: React.ReactNode;
  className?: string;
}

const NSLandingShell = ({ children, className }: NSLandingShellProps) => {
  return (
    <div className={cn('ns-theme', className)}>
      {children}
    </div>
  );
};

export default NSLandingShell;
