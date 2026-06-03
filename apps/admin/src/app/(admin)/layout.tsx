import { notFound, redirect } from 'next/navigation';
import { SessionProvider } from 'next-auth/react';
import { auth } from '@/lib/auth';
import { AdminShell } from '@/components/admin-app-shell';

// Gate the whole portal: must be signed in AND a platform admin. Non-admins get
// a 404 (don't reveal the portal exists).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login');
  if (session.user?.role !== 'platform_admin') notFound();

  return (
    <SessionProvider session={session}>
      <AdminShell>{children}</AdminShell>
    </SessionProvider>
  );
}
