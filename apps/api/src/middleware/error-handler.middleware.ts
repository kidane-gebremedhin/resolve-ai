import type { NextFunction, Request, Response } from "express";
import * as Sentry from "@sentry/node";
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
  // Mongoose CastError — a malformed path param (e.g. a non-ObjectId `:id` like
  // `/knowledge/not-an-id`) reached a `findById`. That's bad client input, not a
  // server fault: answer 400 instead of a 500 + Sentry event.
  if ((err as { name?: string }).name === "CastError") {
    const cast = err as unknown as { path?: string; kind?: string };
    const field = cast.path ?? "id";
    res.status(400).json({
      error: {
        code: "invalid_id",
        message:
          cast.kind === "ObjectId"
            ? `Invalid ${field}: not a valid id.`
            : `Invalid value for ${field}.`,
      },
    });
    return;
  }
  // Sentry's express handler ran just before this one and left an event id on
  // `res.sentry`. Returning it lets a user quote a single id to support, which
  // resolves straight to the Sentry issue — but only when the SDK is actually
  // initialised: without a DSN it still generates an id for an event it never
  // sends, and handing that out would send people hunting for an issue that
  // does not exist.
  const eventId = Sentry.isInitialized()
    ? (res as Response & { sentry?: string }).sentry
    : undefined;
  logger.error("unhandled error", { message: err.message, stack: err.stack, eventId });
  res.status(500).json({
    error: { code: "internal_error", message: "Internal server error.", eventId },
  });
}
