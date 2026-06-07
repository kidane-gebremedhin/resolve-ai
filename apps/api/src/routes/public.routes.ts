// Public, unauthenticated platform endpoints. Only non-sensitive, cosmetic data.
import { Router, type Request, type Response } from "express";
import { PlatformSetting } from "../models/index.js";

const router = Router();

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
