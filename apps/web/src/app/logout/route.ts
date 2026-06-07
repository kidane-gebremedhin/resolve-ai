// Clears the NextAuth session cookie, then bounces to /login. Used when the API
// rejects our bearer token because the account no longer exists (e.g. after a
// `db:wipe` or account deletion). A plain `redirect("/login")` would leave the
// stale session cookie in place — so the ghost user would just be re-gated to
// /checkout. Signing out here actually clears the cookie.
import { signOut } from "@/lib/auth";

export async function GET() {
  await signOut({ redirectTo: "/login?session=expired" });
}
