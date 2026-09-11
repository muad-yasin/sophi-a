#!/usr/bin/env node
// Backlog item 3's own acceptance test (relay run 2026-09-10T23-20-49-005Z/deliverable.md):
// "a static-site linter/link checker run against marketing/index.html reports zero broken local
// asset paths and every required OG/meta tag present. No acceptance test may perform an actual
// deploy." Deliberately dependency-free - this is a small, stable check, not worth a new package.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const marketingDir = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(marketingDir, 'index.html');
const html = readFileSync(htmlPath, 'utf8');

let failures = [];

// --- Local asset paths: every href/src attribute and every CSS url(...), excluding external
// (http/https/mailto) links, in-page anchors (#...), and the deliberately-unfilled OG placeholder
// domain (that one is a real, honestly-marked gap named in DECISIONS.md, not a broken link this
// check should fail on). ---
const isLocal = (p) =>
  p &&
  !p.startsWith('http://') &&
  !p.startsWith('https://') &&
  !p.startsWith('mailto:') &&
  !p.startsWith('#') &&
  !p.startsWith('PLACEHOLDER-deploy-url');

const attrRefs = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
const cssUrlRefs = [...html.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
const localRefs = [...new Set([...attrRefs, ...cssUrlRefs])].filter(isLocal);

for (const ref of localRefs) {
  const resolved = resolve(marketingDir, ref);
  if (!existsSync(resolved)) failures.push(`broken local asset path: "${ref}" -> ${resolved}`);
}

// --- Required OG/meta tags ---
const requiredTags = [
  ['og:type', /<meta property="og:type" content="[^"]+"/],
  ['og:site_name', /<meta property="og:site_name" content="[^"]+"/],
  ['og:title', /<meta property="og:title" content="[^"]+"/],
  ['og:description', /<meta property="og:description" content="[^"]+"/],
  ['og:image', /<meta property="og:image" content="[^"]+"/],
  ['og:url', /<meta property="og:url" content="[^"]+"/],
  ['twitter:card', /<meta name="twitter:card" content="[^"]+"/],
  ['twitter:title', /<meta name="twitter:title" content="[^"]+"/],
  ['twitter:image', /<meta name="twitter:image" content="[^"]+"/],
  ['favicon <link rel="icon">', /<link rel="icon"[^>]*href="[^"]+"/],
];
for (const [name, pattern] of requiredTags) {
  if (!pattern.test(html)) failures.push(`missing required tag: ${name}`);
}

if (failures.length) {
  console.error(`FAIL - ${failures.length} issue(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`PASS - ${localRefs.length} local asset path(s) resolved, all required OG/meta tags present.`);
