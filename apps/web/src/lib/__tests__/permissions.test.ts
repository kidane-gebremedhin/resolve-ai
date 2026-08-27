// The dashboard's mirror of the API's role guards.
//
// Nothing here grants access — the API's `requireOrgRole` remains the only
// enforcement point, and hiding a button gives nobody anything. What this map
// prevents is the dashboard OFFERING an action the API will refuse, which is
// what used to happen: an agent saw "Add website", clicked it, and got
// "Owner or admin role required."
//
// The interesting test is the last one. A mirror is only useful while it
// matches, and the comment in permissions.ts asking future authors to update it
// "in the same change" is a request, not a guarantee. The drift test turns it
// into one.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_MIN_ROLE,
  ORG_ROLE_LABEL,
  ORG_ROLE_RANK,
  can,
  deniedReason,
  type Capability,
  type OrgRole,
} from "../permissions";

const ROLES: OrgRole[] = ["owner", "admin", "agent", "viewer"];

describe("role ranking", () => {
  it("ranks owner above admin above agent above viewer", () => {
    expect(ORG_ROLE_RANK.owner).toBeGreaterThan(ORG_ROLE_RANK.admin);
    expect(ORG_ROLE_RANK.admin).toBeGreaterThan(ORG_ROLE_RANK.agent);
    expect(ORG_ROLE_RANK.agent).toBeGreaterThan(ORG_ROLE_RANK.viewer);
  });

  it("labels every role", () => {
    for (const r of ROLES) expect(ORG_ROLE_LABEL[r]).toBeTruthy();
  });
});

describe("can()", () => {
  it("lets the owner do everything", () => {
    for (const c of Object.keys(CAPABILITY_MIN_ROLE) as Capability[]) {
      expect(can("owner", c), c).toBe(true);
    }
  });

  it("lets a viewer do nothing that writes", () => {
    // Viewers are read-only by design; reads are not gated by this map at all.
    for (const c of Object.keys(CAPABILITY_MIN_ROLE) as Capability[]) {
      expect(can("viewer", c), c).toBe(false);
    }
  });

  it("gives an agent conversations and knowledge, but not configuration", () => {
    expect(can("agent", "handleConversations")).toBe(true);
    expect(can("agent", "manageKnowledge")).toBe(true);
    expect(can("agent", "manageWebsites")).toBe(false);
    expect(can("agent", "manageBilling")).toBe(false);
  });

  it("reserves organization deletion for the owner alone", () => {
    expect(can("admin", "deleteOrganization")).toBe(false);
    expect(can("owner", "deleteOrganization")).toBe(true);
  });

  it("denies everything to a missing or unknown role", () => {
    // A platform admin signed into a workspace it has no membership in has no
    // org role, and the API's guard treats that as denied. So must this.
    for (const bad of [undefined, null, "" as unknown as OrgRole, "superuser" as OrgRole]) {
      expect(can(bad, "manageWebsites")).toBe(false);
    }
  });

  it("is monotonic: a higher rank never loses a capability", () => {
    for (const c of Object.keys(CAPABILITY_MIN_ROLE) as Capability[]) {
      const allowed = ROLES.filter((r) => can(r, c));
      const ranks = allowed.map((r) => ORG_ROLE_RANK[r]);
      const min = Math.min(...ranks, Infinity);
      // Everyone at or above the lowest permitted rank must also be permitted.
      for (const r of ROLES) {
        if (ORG_ROLE_RANK[r] >= min) expect(can(r, c), `${r}/${c}`).toBe(true);
      }
    }
  });

  it("explains a denial in the API's own words", () => {
    expect(deniedReason("deleteOrganization")).toMatch(/owner/i);
    expect(deniedReason("manageWebsites")).toBe("Owner or admin role required.");
    expect(deniedReason("manageKnowledge")).toMatch(/viewers are read-only/i);
  });
});

describe("the mirror has not drifted from the API", () => {
  const API_ROUTES = path.resolve(process.cwd(), "../../apps/api/src/routes");

  /** Every distinct role named in a `requireOrgRole("…")` across the API. */
  function rolesGuardingTheApi(): Set<string> {
    const found = new Set<string>();
    for (const file of readdirSync(API_ROUTES)) {
      if (!file.endsWith(".routes.ts")) continue;
      const src = readFileSync(path.join(API_ROUTES, file), "utf8");
      for (const m of src.matchAll(/requireOrgRole\(\s*"(\w+)"\s*\)/g)) found.add(m[1]!);
    }
    return found;
  }

  it("can actually read the API routes", () => {
    // A parser that silently finds nothing would make the test below vacuous.
    const roles = rolesGuardingTheApi();
    expect(roles.size).toBeGreaterThan(0);
    expect(roles.has("admin")).toBe(true);
  });

  it("uses only roles the API's guard understands", () => {
    for (const role of rolesGuardingTheApi()) {
      expect(ROLES, `API guards on "${role}", which the dashboard has no rank for`).toContain(role);
    }
  });

  it("maps every capability to a role the API actually guards with", () => {
    const guarded = rolesGuardingTheApi();
    for (const [capability, min] of Object.entries(CAPABILITY_MIN_ROLE)) {
      // `owner` is enforced by explicit inline checks rather than the middleware
      // (DELETE /orgs/current), so it will not appear in the grep.
      if (min === "owner") continue;
      expect(guarded, `${capability} claims "${min}", which no API route uses`).toContain(min);
    }
  });
});
