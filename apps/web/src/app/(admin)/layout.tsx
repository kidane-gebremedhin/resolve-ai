import { notFound, redirect } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/lib/auth";

export default async function AdminGroupLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) {
    redirect("/login");
  }
  // Per spec: non-platform-admins receive a 404 to avoid revealing the route.
  if (session.user.role !== "platform_admin") {
    notFound();
  }
  return <SessionProvider session={session}>{children}</SessionProvider>;
}
