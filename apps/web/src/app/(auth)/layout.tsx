import { PublicWidget } from '@/components/public-widget';

// Auth pages (login, register, forgot-password, …) are public-facing, so they
// carry the same demo widget as the marketing pages.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <PublicWidget />
    </>
  );
}
