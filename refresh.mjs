#!/usr/bin/env node
/* eslint-disable no-console */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE =
  "https://raw.githubusercontent.com/disposable/disposable-email-domains/master/domains.txt";

const here = dirname(fileURLToPath(import.meta.url));
const customPath = join(here, "custom.json");
const whitelistPath = join(here, "whitelist.json");
const dest = join(here, "domains.json");

const res = await fetch(SOURCE);
if (!res.ok) {
  console.error(`fetch failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}

const upstream = (await res.text())
  .split("\n")
  .map((line) => line.trim().toLowerCase())
  .filter(Boolean);

const custom = JSON.parse(readFileSync(customPath, "utf8")).map((d) =>
  String(d).trim().toLowerCase(),
);

const whitelist = new Set(
  JSON.parse(readFileSync(whitelistPath, "utf8")).map((entry) =>
    String(entry.domain).trim().toLowerCase(),
  ),
);

const beforeWhitelist = new Set([...upstream, ...custom]);
const removedByWhitelist = [...whitelist].filter((d) => beforeWhitelist.has(d));
const merged = [...beforeWhitelist].filter((d) => !whitelist.has(d)).sort();

writeFileSync(dest, `${JSON.stringify(merged, null, 2)}\n`);

console.log(
  `wrote ${merged.length} domains (upstream ${upstream.length} + custom ${custom.length}, ${removedByWhitelist.length} removed by whitelist) → ${dest}`,
);
