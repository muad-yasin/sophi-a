#!/usr/bin/env node
// Phase 2 Step 3 of the long-horizon build plan
// (~/Projects/relay/runs/2026-09-10T20-03-03-692Z/revise-1.md) - "Export a run as markdown",
// acceptance test. src/exportMarkdown.ts is pure and DOM-free by design specifically so this
// script can exercise the real shipped module directly with Node, without a live Tauri window
// (see that module's own top comment). esbuild (already a devDependency, used the same way by
// package.json's own package:orchestrator script) compiles the TS module to a temp ESM file for
// direct import - no new dependency added for this.
import esbuild from 'esbuild';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), 'sophia-verify-phase2-step3-'));
let allOk = true;
const lines = [];

function check(name, fn) {
  try {
    const detail = fn();
    lines.push(`VERIFIED - ${name}${detail ? ` - ${detail}` : ''}`);
  } catch (err) {
    allOk = false;
    lines.push(`FAILED - ${name} - ${err.message}`);
  }
}

await esbuild.build({
  entryPoints: [join(root, 'src/exportMarkdown.ts')],
  bundle: false,
  format: 'esm',
  outfile: join(tmp, 'exportMarkdown.mjs'),
});
const mod = await import(join(tmp, 'exportMarkdown.mjs'));
const { buildSeatMarkdown, buildDebateMarkdown, applyExportTruncation, exportFilename, EXPORT_MAX_CHARS } = mod;

// AT1: "Copy as Markdown" output matches the Debate panel's rendered content exactly - same
// signoff marks, same objections attributed to the same critic, same scoreboard, same verdict -
// against a DebateReportDetail shaped exactly like a real relay run's report.json produces
// (relayChainSubprocess.js's debate.report event, which renderDebatePanel in main.ts consumes).
check('Debate markdown includes every signoff, its objections, scoreboard and verdict', () => {
  const report = {
    runId: 'run-test-1',
    passed: false,
    signoff: [
      { provider: 'together', model: 'llama-4', signedOff: true },
      { provider: 'zai', model: 'glm-5', signedOff: false },
      { provider: 'cohere', model: 'command-r', signedOff: null },
    ],
    scoreboard: { labs: [{ lab: 'zai', accepted: 2, proposed: 5 }] },
    failures: [{ lab: 'zai', problem: 'the migration is not reversible' }],
  };
  const md = buildDebateMarkdown('Planner 1', 'do the thing', report);
  const musts = [
    '> do the thing',
    'together (llama-4) — signed off',
    'zai (glm-5) — objected',
    'cohere (command-r) — abstained',
    'the migration is not reversible',
    'zai: 2/5',
    '**FAILED**',
  ];
  for (const m of musts) {
    if (!md.includes(m)) throw new Error(`missing expected fragment: ${JSON.stringify(m)}`);
  }
  if (md.includes('undefined') || md.includes('NaN')) throw new Error('fabricated/placeholder value leaked into export');
  return 'all fields from DebateReportDetail present, verbatim, none invented';
});

// AT1b: no report yet -> an honest empty state, never a fabricated debate (the same
// never-fabricate-usage-style rule Phase 2 Step 2 names for cost, applied here to content).
check('Debate markdown with no report yet says so honestly', () => {
  const md = buildDebateMarkdown('Planner 2', null, null);
  if (!md.includes('No relay run finished for this seat yet')) throw new Error('missing empty-state text');
  return 'ok';
});

// AT2: "Export" writes the same content to disk and it reopens identically - a round-trip
// proxy for export_run_markdown/read_export_file in src-tauri/src/lib.rs (same fs::write /
// fs::read_to_string semantics), exercised here without a live Tauri window.
check('Export round-trips byte-for-byte through disk', () => {
  const md = buildSeatMarkdown('Advisor', 'hello', 'world');
  const file = join(tmp, exportFilename('advisor', 'seat'));
  writeFileSync(file, md);
  const reopened = readFileSync(file, 'utf8');
  if (reopened !== md) throw new Error('reopened content does not match what Export wrote');
  return file;
});

// AT3: an oversized run's file contains a visible TRUNCATED line - never silent truncation
// (the honesty rule PLAN.md's Phase 2 Step 3 names explicitly).
check('Oversized export gets a visible TRUNCATED marker, not silent truncation', () => {
  const huge = 'x'.repeat(EXPORT_MAX_CHARS + 500);
  const md = applyExportTruncation(huge);
  if (!md.includes('**TRUNCATED**')) throw new Error('no visible TRUNCATED marker on an oversized export');
  if (md.length === huge.length) throw new Error('content was not actually capped');
  return 'TRUNCATED marker present and content actually capped';
});

check('Normal-sized export is never truncated', () => {
  const md = buildSeatMarkdown('Build 1', 'a small task', 'a small reply');
  if (md.includes('TRUNCATED')) throw new Error('small export was truncated unnecessarily');
  return 'ok';
});

rmSync(tmp, { recursive: true, force: true });

console.log(lines.join('\n'));
process.exit(allOk ? 0 : 1);
