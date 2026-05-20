import { useEffect, useRef, useState } from 'react';

type MarqueeProps = {
  children?: React.ReactNode;
  className?: string;
  speed?: number;
  gradient?: boolean;
  direction?: 'left' | 'right' | 'up' | 'down';
  [key: string]: unknown;
};

let cachedModule: ((_props: MarqueeProps) => React.ReactElement) | null = null;

const ClientMarquee = (props: MarqueeProps) => {
  const [Marquee, setMarquee] = useState<((_props: MarqueeProps) => React.ReactElement) | null>(() => cachedModule);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    if (cachedModule) { setMarquee(() => cachedModule); return; }
    import('react-fast-marquee').then((m) => {
      cachedModule = ((m as any).default ?? m) as typeof cachedModule;
      setMarquee(() => cachedModule);
    });
  }, []);

  if (!Marquee) {
    return (
      <div style={{ display: 'flex', overflow: 'hidden' }}>
        <div className={`flex gap-8 ${props.className ?? ''}`}>{props.children}</div>
      </div>
    );
  }

  return <Marquee {...props} />;
};

export default ClientMarquee;
