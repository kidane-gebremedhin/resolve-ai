// Org role-based authorization for tenant (non-admin) API routes.
//
// Membership roles rank owner > admin > agent > viewer. Tenant isolation is
// enforced everywhere by scoping queries to `req.orgId`; this adds the *within*
// -org dimension so a low-privilege member can't mutate resources above their
// level. Historically only member-management and API keys checked the role, so a
// "viewer" (meant to be read-only) could create websites, rename the org, edit
// knowledge, etc. This closes that gap.
//
// `requireOrgRole(min)` is method-aware: safe reads (GET/HEAD/OPTIONS) always
// pass, writes require rank >= min. Mount it once per router (after
// requireAuth/requireOrg populate `req.auth.membershipRole`), or drop it into a
// single route's middleware chain.
import type { NextFunction, Request, Response } from "express";
import { ForbiddenError } from "../utils/errors.js";

export const ORG_ROLE_RANK = { owner: 4, admin: 3, agent: 2, viewer: 1 } as const;
export type OrgRole = keyof typeof ORG_ROLE_RANK;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function label(min: OrgRole): string {
  switch (min) {
    case "admin":
      return "Owner or admin role required.";
    case "agent":
      return "This action requires agent access or higher (viewers are read-only).";
    case "owner":
      return "Owner role required.";
    default:
      return "Insufficient role for this action.";
  }
}

export function requireOrgRole(min: OrgRole) {
  const threshold = ORG_ROLE_RANK[min];
  return function orgRoleGuard(req: Request, _res: Response, next: NextFunction): void {
    if (SAFE_METHODS.has(req.method)) return next();
    const role = req.auth?.membershipRole as OrgRole | undefined;
    if (!role || ORG_ROLE_RANK[role] === undefined || ORG_ROLE_RANK[role] < threshold) {
      return next(new ForbiddenError(label(min)));
    }
    next();
  };
}
