#!/usr/bin/env node
// Phase 0 of the long-horizon build plan
// (~/Projects/relay/runs/2026-09-10T20-03-03-692Z/revise-1.md). Checks the codebase AS IT EXISTS
// TODAY - never a field a later phase creates (requires/timeout_ms/chainConfig/usageHook). Two
// checks below were corrected from the plan's original wording during this very script's
// authoring, against real ground truth, not left to fail on day one - see DECISIONS.md's first
// entry for why. Node only, no new deps.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const lines = [];
let allOk = true;

function check(name, fn) {
  try {
    const detail = fn();
    lines.push(`VERIFIED - ${name}${detail ? ` - ${detail}` : ''}`);
  } catch (err) {
    allOk = false;
    lines.push(`MISMATCH - ${name} - ${err.message}`);
  }
}

// 1. Core files exist.
const coreFiles = [
  'src/main.ts', 'src/orchestrator/index.js', 'src/orchestrator/seats.json',
  'src-tauri/src/lib.rs', 'src/mcp/server.js',
];
check('core files exist', () => {
  for (const f of coreFiles) {
    if (!existsSync(join(root, f))) throw new Error(`missing ${f}`);
  }
  return coreFiles.join(', ');
});
check('adapters directory exists', () => {
  if (!existsSync(join(root, 'src/orchestrator/adapters'))) throw new Error('missing src/orchestrator/adapters/');
});

// 2. seats.json has exactly 8 named seats with the fields the plan's later steps will extend.
check('seats.json has 8 seats with command/args/cwd or provider-based config', () => {
  const seats = JSON.parse(readFileSync(join(root, 'src/orchestrator/seats.json'), 'utf8'));
  const expected = ['cnc', 'advisor', 'plan-1', 'plan-2', 'plan-3', 'build-1', 'build-2', 'build-3'];
  const actual = Object.keys(seats);
  for (const name of expected) {
    if (!actual.includes(name)) throw new Error(`seats.json missing seat "${name}"`);
  }
  if (actual.length !== 8) throw new Error(`expected exactly 8 seats, found ${actual.length}: ${actual.join(', ')}`);
  return `seats: ${actual.join(', ')}`;
});

// 3. CORRECTED from the plan's original wording ("each adapter exports a spawn function"):
// adapters actually export named start<X>Seat functions, not a generic `spawn`. Discovered live
// while writing this script (grep for `export.*spawn` found zero matches) - see DECISIONS.md.
check('each adapter file exports a start*Seat function (corrected from "spawn")', () => {
  const dir = join(root, 'src/orchestrator/adapters');
  const files = ['claudeCodeSubprocess.js', 'messagesApi.js', 'relayChainSubprocess.js'];
  const found = [];
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    const m = text.match(/export\s+(async\s+)?function\s+(start\w*Seat)\b/);
    if (!m) throw new Error(`${f} has no export function start*Seat(...)`);
    found.push(`${f}:${m[2]}`);
  }
  return found.join(', ');
});

// 4. CORRECTED from the plan's original wording ("plan-cheap.json has a stages array"): the real
// top-level shape has no `stages` key at all - critics live under `seats.critics`. Discovered
// live while writing this script - see DECISIONS.md.
check('relay/chains/plan-cheap.json exists with seats.critics (corrected from "stages array")', () => {
  const relayRoot = process.env.GP_RELAY_ROOT || join(root, '..', 'relay');
  const p = join(relayRoot, 'chains', 'plan-cheap.json');
  if (!existsSync(p)) throw new Error(`missing ${p}`);
  const chain = JSON.parse(readFileSync(p, 'utf8'));
  if (!chain.seats || !Array.isArray(chain.seats.critics)) {
    throw new Error('plan-cheap.json has no seats.critics array');
  }
  return `${chain.seats.critics.length} critics`;
});

// 5. CORRECTED from the plan's original wording ("a sample report.json has signoff and usage
// fields"): `signoff` is real and top-level; `usage` is NOT a top-level field - usage lives per
// stage (`stages[].usage`) and aggregated in `totals`. This matters directly for Phase 2 Step 2
// (cost meter): its adapter hooks must read `report.totals` / `report.stages[].usage`, not a
// flat `report.usage` that does not exist. Discovered live - see DECISIONS.md.
check('report.json has signoff (top-level) and usage under totals/stages (corrected)', () => {
  const relayRoot = process.env.GP_RELAY_ROOT || join(root, '..', 'relay');
  const runsDir = join(relayRoot, 'runs');
  if (!existsSync(runsDir)) throw new Error(`no relay runs directory at ${runsDir}`);
  const dirs = readdirSync(runsDir)
    .filter((d) => existsSync(join(runsDir, d, 'report.json')))
    .sort()
    .reverse();
  if (!dirs.length) throw new Error('no relay run has a report.json to sample');
  const sample = JSON.parse(readFileSync(join(runsDir, dirs[0], 'report.json'), 'utf8'));
  if (!('signoff' in sample)) throw new Error('report.json missing top-level "signoff"');
  if ('usage' in sample) throw new Error('report.json unexpectedly HAS a top-level "usage" - re-check this assumption, ground truth changed again');
  if (!sample.totals || typeof sample.totals.input !== 'number') throw new Error('report.json missing totals.input');
  if (!Array.isArray(sample.stages) || !sample.stages[0]?.usage) throw new Error('report.json missing stages[].usage');
  return `sampled ${dirs[0]}/report.json`;
});

// 6. MCP server exports the six tools every later phase's terminal-surface parity depends on.
check('src/mcp/server.js exports the six required tools', () => {
  const text = readFileSync(join(root, 'src/mcp/server.js'), 'utf8');
  const required = ['list_seats', 'get_seat', 'start_seat', 'stop_seat', 'configure_seat', 'wait_for_idle'];
  const missing = required.filter((t) => !text.includes(`'${t}'`) && !text.includes(`"${t}"`));
  if (missing.length) throw new Error(`missing tool(s): ${missing.join(', ')}`);
  return required.join(', ');
});

const report = [
  '# Phase 0 stack-truth report',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  ...lines.map((l) => `- ${l}`),
  '',
  '## Corrections made during this script\'s own authoring (not left to fail on day one)',
  '',
  '- Adapters export `start<Name>Seat`, not a generic `spawn` (the plan\'s original wording).',
  '- `relay/chains/plan-cheap.json` has no top-level `stages` array; critics live at `seats.critics`.',
  '- `report.json` has no top-level `usage` field; usage is per-stage (`stages[].usage`) and',
  '  aggregated in `totals`. **Phase 2 Step 2 (cost meter) must read `report.totals` /',
  '  `report.stages[].usage`, not `report.usage`** - flagging this now so that step doesn\'t',
  '  rediscover it the hard way.',
  '',
  '## HUMAN STOP — DO NOT PROCEED',
  '',
  'Phase 1 may not begin until a human reviews the corrections above and appends the literal',
  'line `APPROVED-BY-HUMAN` below this section.',
  '',
].join('\n');

writeFileSync(join(root, 'docs', 'phase0-stack-truth.md'), report);

console.log(report);
process.exit(allOk ? 0 : 1);
