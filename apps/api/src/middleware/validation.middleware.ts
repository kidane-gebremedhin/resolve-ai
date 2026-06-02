import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodSchema } from "zod";
import { ValidationError } from "../utils/errors.js";

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (e) {
      if (e instanceof ZodError) {
        throw new ValidationError("Invalid request body.", { issues: e.issues });
      }
      throw e;
    }
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      // Zod's parse mutates types — we cast on req.query downstream.
      schema.parse(req.query);
      next();
    } catch (e) {
      if (e instanceof ZodError) {
        throw new ValidationError("Invalid query string.", { issues: e.issues });
      }
      throw e;
    }
  };
}
