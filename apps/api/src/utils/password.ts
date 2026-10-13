import { z } from "zod";

// Password-strength policy. The API is the source of truth: it mirrors the
// rules the signup UI shows (>=8 chars, one lower, one upper, one number, one
// special) so a client calling the API directly can't set a weaker password.
export const strongPassword = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(200)
  .regex(/[a-z]/, "Password must contain a lowercase letter.")
  .regex(/[A-Z]/, "Password must contain an uppercase letter.")
  .regex(/[0-9]/, "Password must contain a number.")
  .regex(/[^A-Za-z0-9]/, "Password must contain a special character.");
