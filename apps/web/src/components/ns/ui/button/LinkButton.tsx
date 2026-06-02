import { cn } from '@/utils/ns-cn';
import { AnchorHTMLAttributes } from 'react';

interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  children: React.ReactNode;
  href: string;
  className?: string;
  insideSpan?: boolean;
}

const LinkButton = ({ children, href, className, insideSpan = true, ...props }: LinkButtonProps) => {
  return (
    <a href={href} className={cn('btn btn-md', className)} {...props}>
      {insideSpan ? <span>{children}</span> : children}
    </a>
  );
};

LinkButton.displayName = 'LinkButton';
export default LinkButton;
