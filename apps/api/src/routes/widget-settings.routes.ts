// Operator-facing CRUD on WidgetSettings. The public widget endpoints in
// widget.routes.ts read WidgetSettings via /widget/init or /widget/settings;
// this router lets a logged-in operator edit them for their own org.
//
// Routes are keyed by `agentId` since a single org may eventually run multiple
// agents — the unique index on (organizationId, agentId) makes the upsert safe.

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Agent, WidgetSettings } from "../models/index.js";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { NotFoundError } from "../utils/errors.js";

const router = Router();
router.use(requireAuth, requireOrg);

// Whitelist: anything outside these keys is silently dropped. Every field here
// is persisted by the WidgetSettings schema and surfaced to the widget via the
// public /widget/init payload, so studio changes apply on embedded sites.
const widgetSettingsSchema = z.object({
  welcomeMessage: z.string().max(1000).optional(),
  suggestedQuestions: z.array(z.string().min(1).max(200)).max(20).optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{3,8}$/, "primaryColor must be a hex color (e.g. #1e40af)")
    .optional(),
  // Header treatment: the lavender/blue pinstripe pattern (default) or a solid accent header.
  headerStyle: z.enum(["pinstripe", "solid"]).optional(),
  position: z.enum(["bottom-right", "bottom-left", "centered"]).optional(),
  theme: z.enum(["light", "dark", "auto"]).optional(),
  showBranding: z.boolean().optional(),
  // The studio always sends `avatarUrl` (defaulting to "" when none is set), so
  // accept "" as "clear the avatar" — `z.string().url()` alone rejects "" and
  // 400s every save that didn't set an avatar.
  avatarUrl: z.union([z.string().url(), z.literal("")]).optional(),
  offlineMessage: z.string().max(500).optional(),
  requireContactBeforeChat: z.boolean().optional(),
});

router.get("/:agentId", async (req: Request, res: Response) => {
  // Confirm the agent belongs to this org before exposing settings.
  const agent = await Agent.findOne({
    _id: req.params.agentId,
    organizationId: req.orgId,
  });
  if (!agent) throw new NotFoundError("Agent not found.");

  const settings = await WidgetSettings.findOne({
    organizationId: req.orgId,
    agentId: agent._id,
  });
  if (!settings) throw new NotFoundError("WidgetSettings not found.");
  res.json(settings);
});

router.put(
  "/:agentId",
  validateBody(widgetSettingsSchema),
  async (req: Request, res: Response) => {
    const agent = await Agent.findOne({
      _id: req.params.agentId,
      organizationId: req.orgId,
    });
    if (!agent) throw new NotFoundError("Agent not found.");

    // Every field (including `theme` and `position: "centered"`) is persisted by
    // the schema, so the stored document is the source of truth for both the
    // studio preview and the embedded widget — no coercion or echo needed.
    const body = req.body as z.infer<typeof widgetSettingsSchema>;

    const settings = await WidgetSettings.findOneAndUpdate(
      { organizationId: req.orgId, agentId: agent._id },
      { $set: body },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    res.json(settings);
  },
);

export default router;
