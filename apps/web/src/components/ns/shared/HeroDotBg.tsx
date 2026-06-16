import { cn } from '@/utils/ns-cn';
import Image from 'next/image';

export interface HeroDotBgProps {
  className?: string;
}

const HeroDotBg = ({ className }: HeroDotBgProps) => {
  return (
    <div
      className={cn(
        'absolute top-[10%] left-1/2 -z-0 -translate-x-1/2 animate-pulse max-md:w-full lg:top-[12%]',
        className,
      )}
    >
      <Image
        src="/images/gradient/hero-dot-bg.png"
        alt=""
        aria-hidden
        width={1365}
        height={800}
        priority
        className="size-full object-cover"
      />
    </div>
  );
};

export default HeroDotBg;
