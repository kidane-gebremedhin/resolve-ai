// Client-side mirror of the API's org-role authorization.
//
// The API is and stays the source of truth — `requireOrgRole(min)` in
// apps/api/src/middleware/org-role.middleware.ts, plus the inline
// `assertCanManageMembers` / `assertCanManageKeys` checks in org.routes.ts and
// api-keys.routes.ts. Nothing here grants access; it only lets the dashboard
// avoid *offering* an action the API is going to reject with 403, which is what
// used to happen (an agent saw "Add website", clicked it, and got
// "Owner or admin role required.").
//
// Rule of thumb, matching the middleware: reads (GET) are open to every active
// member, writes require rank >= the route's minimum. So gate BUTTONS, not
// pages — a viewer is meant to browse the whole dashboard read-only.
//
// When you add or change a `requireOrgRole` on the API, update the matching
// capability here in the same change.

export const ORG_ROLE_RANK = { owner: 4, admin: 3, agent: 2, viewer: 1 } as const;

export type OrgRole = keyof typeof ORG_ROLE_RANK;

/** Minimum role each capability requires, mirroring the API route guards. */
export const CAPABILITY_MIN_ROLE = {
  // requireOrgRole("admin") — website.routes, agent.routes, widget-settings.routes,
  // section.routes, triggers.routes, integrations.routes, PATCH /orgs/current
  manageWebsites: "admin",
  manageAgents: "admin",
  manageWidget: "admin",
  manageSections: "admin",
  manageTriggers: "admin",
  manageIntegrations: "admin",
  manageOrgProfile: "admin",
  // assertCanManageMembers / assertCanManageKeys (org.routes, api-keys.routes)
  manageMembers: "admin",
  manageApiKeys: "admin",
  // POST /billing/portal + checkout. Reads (GET /billing/*) stay open — the
  // guard lets safe methods through, and /app itself needs the plan lookup.
  manageBilling: "admin",
  // requireOrgRole("agent") — conversation.routes, message.routes, kb.routes
  handleConversations: "agent",
  manageKnowledge: "agent",
  // DELETE /orgs/current explicitly requires the owner role
  deleteOrganization: "owner",
} as const satisfies Record<string, OrgRole>;

export type Capability = keyof typeof CAPABILITY_MIN_ROLE;

/**
 * Whether `role` clears the minimum rank for `capability`.
 *
 * An undefined role (no membership in the active org — e.g. a platform admin
 * signed into a workspace it does not belong to) is denied everything, which is
 * exactly how the API's guard treats a missing `membershipRole`.
 */
export function can(role: OrgRole | undefined | null, capability: Capability): boolean {
  if (!role || ORG_ROLE_RANK[role] === undefined) return false;
  return ORG_ROLE_RANK[role] >= ORG_ROLE_RANK[CAPABILITY_MIN_ROLE[capability]];
}

/** Human-readable role name for badges and read-only notices. */
export const ORG_ROLE_LABEL: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  agent: "Agent",
  viewer: "Viewer",
};

/**
 * Tooltip/explanation for a denied action. Deliberately worded like the API's
 * own error strings so the UI and a hand-rolled API call tell the same story.
 */
export function deniedReason(capability: Capability): string {
  const min = CAPABILITY_MIN_ROLE[capability];
  switch (min) {
    case "owner":
      return "Only the organization owner can do this.";
    case "admin":
      return "Owner or admin role required.";
    case "agent":
      return "This action requires agent access or higher (viewers are read-only).";
    default:
      return "Your role does not allow this action.";
  }
}
