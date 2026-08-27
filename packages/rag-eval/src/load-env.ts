/**
 * Load the repository-root `.env` before anything from `@api/*` is evaluated.
 *
 * This is a module rather than two lines in the CLI because of ESM evaluation
 * order: imports are hoisted and run before the importing module's body, so a
 * `dotenv.config({ path })` call in `cli.ts` would execute *after*
 * `@api/config/env.js` had already thrown on its first missing variable. Being
 * the CLI's first import is what makes it work.
 *
 * `apps/api/.env` is a symlink to the root file, which is why the API finds it
 * when run from its own directory and this package does not.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../../../.env") });
