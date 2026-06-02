#!/usr/bin/env node
// Compares .env against .env.example and prints any keys missing or unset.
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

function parse(text) {
  const map = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    map.set(key, value);
  }
  return map;
}

const example = parse(await readFile(path.join(ROOT, ".env.example"), "utf8"));
let envText = "";
try {
  envText = await readFile(path.join(ROOT, ".env"), "utf8");
} catch {
  console.error("No .env file present — copy .env.example to .env and fill in values.");
  process.exit(1);
}
const env = parse(envText);

const missing = [];
for (const key of example.keys()) {
  if (!env.has(key) || env.get(key) === "") missing.push(key);
}
if (missing.length > 0) {
  console.error("Missing or empty env keys:");
  for (const k of missing) console.error("  " + k);
  process.exit(1);
}
console.log(`OK — all ${example.size} required env keys present.`);
