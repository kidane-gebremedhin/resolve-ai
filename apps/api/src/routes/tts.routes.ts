import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { synthesize } from "../services/ai/tts.service.js";

const router = Router();
router.use(requireAuth, requireOrg);

// 10 syntheses per minute per authenticated user. Mirrors the message-enhance
// limiter pattern in message.routes.ts.
const ttsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req: Request) => `${req.auth?.userId ?? "anon"}:tts`,
  message: { error: { code: "rate_limited", message: "TTS limit: 10/minute per user." } },
});

const ttsSchema = z.object({
  text: z.string().min(1).max(4096),
  voice: z.string().min(1).max(64).optional(),
});

router.post(
  "/",
  ttsLimiter,
  validateBody(ttsSchema),
  async (req: Request, res: Response) => {
    const audio = await synthesize(req.body.text, { voice: req.body.voice });
    res.setHeader("content-type", "audio/mpeg");
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-length", String(audio.length));
    res.status(200).end(audio);
  },
);

export default router;
