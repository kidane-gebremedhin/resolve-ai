import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
// NextAuth runs server-side only, so it uses the internal API base (which falls
// back to the public URL when no internal host is configured).
import { API_INTERNAL_URL as apiUrl } from "./app-urls";

type Role = "owner" | "admin" | "agent" | "viewer" | "platform_admin";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      organizationId?: string;
      role?: Role;
    } & DefaultSession["user"];
    accessToken?: string;
    error?: "RefreshAccessTokenError";
  }
  interface User {
    organizationId?: string;
    role?: Role;
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
  }
}


// Refresh slightly BEFORE the access token actually expires so an in-flight
// request never races the boundary and 401s.
const EXPIRY_SKEW_MS = 60_000;

function expiresAtFrom(expiresIn?: number): number {
  // API access tokens are 15m (`expiresIn: 900`); fall back to that if absent.
  return Date.now() + (expiresIn ?? 900) * 1000;
}

// Exchange the long-lived (7d) refresh token for a fresh 15m access token via
// the API's POST /auth/refresh. On any failure we mark the token so the session
// surfaces an error and the dashboard falls back to its existing auto-logout.
async function refreshAccessToken(
  token: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const refreshToken = token.refreshToken as string | undefined;
  if (!refreshToken) {
    return { ...token, accessToken: undefined, error: "RefreshAccessTokenError" };
  }
  try {
    const res = await fetch(`${apiUrl}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) throw new Error(`refresh failed (${res.status})`);
    const body = (await res.json()) as { accessToken: string; expiresIn?: number };
    return {
      ...token,
      accessToken: body.accessToken,
      accessTokenExpires: expiresAtFrom(body.expiresIn),
      error: undefined,
    };
  } catch {
    // Refresh token expired/invalid — let the access token stay stale; the
    // next protected call 401s and the client auto-logs-out to /login.
    return { ...token, accessToken: undefined, error: "RefreshAccessTokenError" };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: "/login", error: "/login" },
  trustHost: true,
  // Distinct cookie names prevent session collision with the web app when both
  // run on localhost (browsers share cookies by domain, not by port).
  cookies: {
    sessionToken: { name: "admin-authjs.session-token" },
    callbackUrl: { name: "admin-authjs.callback-url" },
    csrfToken: { name: "admin-authjs.csrf-token" },
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    Credentials({
      name: "credentials",
      credentials: {
        email: { type: "email" },
        password: { type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const res = await fetch(`${apiUrl}/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: credentials.email,
            password: credentials.password,
          }),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as {
          user: {
            id: string;
            email: string;
            name: string;
            image?: string;
            role?: Role;
            organizationId?: string;
          };
          accessToken: string;
          refreshToken?: string;
          expiresIn?: number;
        };
        // Only platform admins may access this portal.
        if (body.user.role !== "platform_admin") return null;
        return {
          id: body.user.id,
          email: body.user.email,
          name: body.user.name,
          image: body.user.image ?? null,
          organizationId: body.user.organizationId,
          role: body.user.role,
          accessToken: body.accessToken,
          refreshToken: body.refreshToken,
          expiresIn: body.expiresIn,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      // For credentials: authorize() already set user.role — reject here as a
      // belt-and-suspenders gate if somehow a non-admin slipped through.
      // For Google OAuth: user.role is undefined at signIn time (it gets set
      // in the jwt callback AFTER this runs). The jwt callback throws if the
      // Google user isn't a platform_admin, so no additional check is needed here.
      if (account?.provider === "credentials") {
        if ((user as { role?: Role }).role !== "platform_admin") return false;
      }
      return true;
    },
    async jwt({ token, user, account, profile }) {
      const t = token as Record<string, unknown>;
      if (user) {
        token.sub = user.id ?? token.sub;
        t.organizationId = user.organizationId;
        t.role = user.role;
        t.accessToken = user.accessToken;
        t.refreshToken = user.refreshToken;
        t.accessTokenExpires = expiresAtFrom(user.expiresIn);
      }

      // Google SSO: exchange the id_token for API tokens. Only existing users
      // with role=platform_admin are permitted — no new accounts are created via
      // the admin portal's Google flow (the API upserts the user; we check the
      // returned role immediately and throw if it's not platform_admin).
      if (account?.provider === "google" && account.id_token) {
        const email = profile?.email ?? user?.email;
        const name = profile?.name ?? user?.name ?? email;
        let res: Response;
        try {
          res = await fetch(`${apiUrl}/auth/google`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ idToken: account.id_token, email, name }),
          });
        } catch (err) {
          console.error(`[admin/auth] Google exchange could not reach API:`, (err as Error).message);
          throw new Error("Google sign-in failed: the API is unreachable.");
        }
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.error(`[admin/auth] Google exchange failed (${res.status}): ${detail}`);
          throw new Error(`Google sign-in exchange failed (${res.status})`);
        }
        const body = (await res.json()) as {
          user: { id: string; role?: string; organizationId?: string };
          accessToken: string;
          refreshToken?: string;
          expiresIn?: number;
        };
        // Reject Google sign-in if the user is not an existing platform admin.
        if (body.user.role !== "platform_admin") {
          throw new Error("Access denied: not a platform administrator.");
        }
        token.sub = body.user.id;
        t.organizationId = body.user.organizationId;
        t.role = body.user.role as Role;
        t.accessToken = body.accessToken;
        t.refreshToken = body.refreshToken;
        t.accessTokenExpires = expiresAtFrom(body.expiresIn);
        return token;
      }

      // Not a fresh sign-in: rotate the access token before it expires so the
      // 7d NextAuth session never outlives the 15m API token.
      const expiresAt = t.accessTokenExpires as number | undefined;
      if (expiresAt && Date.now() < expiresAt - EXPIRY_SKEW_MS) {
        return token;
      }
      if (!user) {
        return (await refreshAccessToken(t)) as typeof token;
      }
      return token;
    },
    async session({ session, token }) {
      const t = token as Record<string, unknown>;
      if (token.sub) session.user.id = token.sub;
      session.user.organizationId = (t.organizationId as string | undefined) ?? undefined;
      session.user.role = (t.role as Role | undefined) ?? undefined;
      session.accessToken = (t.accessToken as string | undefined) ?? undefined;
      session.error = (t.error as "RefreshAccessTokenError" | undefined) ?? undefined;
      return session;
    },
  },
});
