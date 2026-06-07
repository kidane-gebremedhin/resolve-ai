// Clears the NextAuth session cookie, then bounces to /login. Used when the API
// rejects our token (deleted/wiped account, or platform-admin rights revoked).
// A plain redirect to /login would leave the stale cookie in place; signing out
// here actually clears it so the user lands on a clean login.
import { signOut } from "@/lib/auth";

export async function GET() {
  await signOut({ redirectTo: "/login?session=expired" });
}
