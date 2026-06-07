// Contact session CRUD — for the operator-facing leads/CRM view.
import { Router, type Request, type Response } from "express";
import { ContactSession, Organization } from "../models/index.js";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { NotFoundError } from "../utils/errors.js";
import {
  dateRangeFilter,
  getOrgPageSize,
  mergeFilters,
  paginate,
  parseListParams,
  searchFilter,
} from "../utils/list-query.js";

const router = Router();
router.use(requireAuth, requireOrg);

// Leads list: server-side search (email/phone/name), createdAt UTC date range,
// website + has-contact filters, and pagination sized by the org's preference
// (settings.pagination.pageSize, default 10). Returns the paginated envelope
// plus `stats` computed over the website scope (not just the page).
router.get("/", async (req: Request, res: Response) => {
  const org = await Organization.findById(req.orgId).select("settings").lean();
  const params = parseListParams(req.query, { defaultPageSize: getOrgPageSize(org) });
  const { websiteId, has } = req.query as Record<string, string | undefined>;

  const scope = mergeFilters<Record<string, unknown>>(
    { organizationId: req.orgId },
    websiteId ? { websiteId } : {},
  );
  const hasFilter =
    has === "email"
      ? { email: { $nin: [null, ""] } }
      : has === "phone"
        ? { phone: { $nin: [null, ""] } }
        : has === "none"
          ? { email: { $in: [null, ""] }, phone: { $in: [null, ""] } }
          : {};
  const listFilter = mergeFilters(
    scope,
    searchFilter(params.q, ["email", "phone", "name"]),
    dateRangeFilter("createdAt", params.from, params.to),
    hasFilter,
  );

  const page = await paginate(ContactSession, listFilter, { params, sort: { lastActiveAt: -1 } });

  // Stats over the website scope (stable regardless of search/has/date narrowing).
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [withEmail, withPhone, thisWeek] = await Promise.all([
    ContactSession.countDocuments(mergeFilters(scope, { email: { $nin: [null, ""] } })),
    ContactSession.countDocuments(mergeFilters(scope, { phone: { $nin: [null, ""] } })),
    ContactSession.countDocuments(mergeFilters(scope, { createdAt: { $gte: weekAgo } })),
  ]);
  const total = await ContactSession.countDocuments(scope);

  res.json({ ...page, stats: { total, withEmail, withPhone, thisWeek } });
});

router.get("/:id", async (req: Request, res: Response) => {
  const session = await ContactSession.findOne({ _id: req.params.id, organizationId: req.orgId });
  if (!session) throw new NotFoundError("Contact session not found.");
  res.json(session);
});

export default router;
