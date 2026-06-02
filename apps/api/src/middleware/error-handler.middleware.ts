import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/errors.js";
import { logger } from "../config/logger.js";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  logger.error("unhandled error", { message: err.message, stack: err.stack });
  res.status(500).json({ error: { code: "internal_error", message: "Internal server error." } });
}
