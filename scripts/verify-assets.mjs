#!/usr/bin/env node
// Walks apps/web/public/images and fails if any file is not referenced from the source tree.
// Per __specs/17-template-asset-inventory.md §5.2 — orphaned assets should not be checked in.
import { readdir, stat, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUBLIC = path.join(ROOT, "apps/web/public/images");
const SOURCE_DIRS = [
  "apps/web/src",
  "packages/ui/src",
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(p)));
    else files.push(p);
  }
  return files;
}

async function readSources() {
  const all = [];
  for (const d of SOURCE_DIRS) {
    const root = path.join(ROOT, d);
    try {
      const files = await walk(root);
      const tsx = files.filter((f) => /\.(tsx?|css|mdx?)$/.test(f));
      for (const f of tsx) all.push(await readFile(f, "utf8"));
    } catch {
      // dir missing — skip
    }
  }
  return all.join("\n");
}

const sources = await readSources();
const assets = await walk(PUBLIC);
const orphans = [];
for (const a of assets) {
  const rel = path.relative(path.join(ROOT, "apps/web/public"), a).replace(/\\/g, "/");
  const basename = path.basename(a);
  if (!sources.includes(rel) && !sources.includes(basename) && !sources.includes("/" + rel)) {
    orphans.push(rel);
  }
}

if (orphans.length > 0) {
  console.error("Orphaned public assets (not referenced from source):");
  for (const o of orphans) console.error("  " + o);
  process.exit(1);
}

console.log(`OK — ${assets.length} public assets all referenced.`);
