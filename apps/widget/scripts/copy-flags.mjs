#!/usr/bin/env node
// Vendors country-flag SVGs from node_modules into public/flags/.
//
// react-phone-number-input defaults `flagUrl` to
// https://purecatamphetamine.github.io/country-flag-icons/3x2/{XX}.svg — a
// third-party GitHub Pages host. The widget is embedded on OUR CUSTOMERS'
// websites, so every visitor that opens it would hand their IP and referrer to
// that host, the widget would depend on its uptime, and any customer with a
// strict img-src CSP would see broken flags.
//
// The files are copied at build time rather than committed: they stay in sync
// with the installed country-flag-icons version, and 1.4 MB of generated assets
// stays out of git (see .gitignore).
import { createRequire } from "node:module";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, "..", "public", "flags");

let srcDir;
try {
  // Resolve through the package so pnpm's symlinked store layout is handled.
  srcDir = join(dirname(require.resolve("country-flag-icons/package.json")), "3x2");
} catch {
  console.error(
    "[flags] country-flag-icons is not installed. It ships as a dependency of " +
      "react-phone-number-input — run `pnpm install` first.",
  );
  process.exit(1);
}

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(srcDir, dest, { recursive: true });

const count = (await readdir(dest)).filter((f) => f.endsWith(".svg")).length;
console.log(`[flags] vendored ${count} flag SVGs → public/flags/`);
