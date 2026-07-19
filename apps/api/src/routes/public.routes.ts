// Public, unauthenticated platform endpoints. Only non-sensitive, cosmetic data.
import { Router, type Request, type Response } from "express";
import { PlatformSetting, Agent } from "../models/index.js";

const router = Router();

// Demo agent for the marketing pages' embedded widget. Returns the most recently
// created active agent so the marketing site always embeds a LIVE agent — the id
// is resolved dynamically instead of hardcoded, so wiping/recreating data never
// leaves the marketing widget pointing at a dead agent (which 404s /widget/init).
// Only exposes the public agent id (already used as the embed's public key).
router.get("/demo-agent", async (_req: Request, res: Response) => {
  const agent = await Agent.findOne({ isActive: true })
    .sort({ createdAt: -1 })
    .select("_id")
    .lean();
  // Short cache: fresh enough to pick up a re-seed within a minute, cheap enough
  // to not hit the DB on every marketing page view.
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json({ agentId: agent ? String(agent._id) : null });
});

// Global app typography, consumed by the web root layout (server-side) so the
// chosen font applies across /app, /admin, and public marketing pages. Cached.
router.get("/theming", async (_req: Request, res: Response) => {
  const s = await PlatformSetting.findOne({ singleton: "global" });
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json({
    fontSans: s?.theming?.fontSans ?? "inter",
    fontDisplay: s?.theming?.fontDisplay ?? "inter-tight",
  });
});

export default router;
