import { PublicWidget } from '@/components/public-widget';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <PublicWidget />
    </>
  );
}
