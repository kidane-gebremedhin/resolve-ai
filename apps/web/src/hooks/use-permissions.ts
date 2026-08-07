"use client";

// Reads the caller's org membership role out of the NextAuth session and
// exposes the capability checks from lib/permissions. Client components inside
// /app are already wrapped in the dashboard SessionProvider, so this needs no
// extra plumbing.

import { useSession } from "next-auth/react";
import { can, type Capability, type OrgRole } from "@/lib/permissions";

export function useMembershipRole(): OrgRole | undefined {
  const { data: session } = useSession();
  return session?.user?.membershipRole;
}

export function usePermissions(): {
  role: OrgRole | undefined;
  can: (capability: Capability) => boolean;
} {
  const role = useMembershipRole();
  return { role, can: (capability: Capability) => can(role, capability) };
}

/** Convenience for the common single-capability case. */
export function useCan(capability: Capability): boolean {
  return can(useMembershipRole(), capability);
}
