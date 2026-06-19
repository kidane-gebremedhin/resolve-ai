import React, { type ReactElement } from 'react';

interface RevealAnimationProps {
  children: ReactElement;
  [key: string]: unknown;
}

const RevealAnimation = ({ children }: RevealAnimationProps) => {
  if (!children) return null;
  return <>{children}</>;
};

export default RevealAnimation;
