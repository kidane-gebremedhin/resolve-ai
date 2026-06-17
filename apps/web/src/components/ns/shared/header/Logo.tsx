import Link from 'next/link';
import { NAVBAR_BRAND_NAME } from '@/lib/app-config';

const Logo = () => {
  return (
    <div>
      <Link href="/" className="inline-flex items-center gap-2.5">
        <span className="sr-only">Home</span>
        <img src="/images/shared/logo-green.svg" alt="" className="h-8 w-8" />
        <span className="font-display text-[15px] font-semibold tracking-tight text-[#1a1a1c] dark:text-[#fcfcfc]">
          {NAVBAR_BRAND_NAME}
        </span>
      </Link>
    </div>
  );
};

export default Logo;
