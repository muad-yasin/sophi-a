// Cost transparency (market-positioning.md's feature idea #3, last item in the user-approved
// "build all of it, in that order" list): relay already prices a whole chain run for real, from
// the chain config's own declared token assumptions, without calling any model - `relay --chain
// X --dry-run` (src/cli.js, its own `--help` text: "estimate tokens and cost, call nothing"; the
// same thing relay's own MCP server's `dry_run` tool does, src/mcp/server.js). This module runs
// that exact CLI command and parses its own real stdout - it does not reimplement relay's pricing
// logic, so a change to relay's chain configs or its pricing.json is reflected here for free the
// next time a tile asks, never silently drifts out of sync with the thing actually pricing a run.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROW_RE = /^\s*(\S+)\s+(\S+\/\S+)\s+(\d+)\s+in\s+(\d+)\s+out\s+(\$[\d.]+|unpriced)\s*$/;
const TOTAL_RE = /^\s*TOTAL\s+(\d+)\s+in\s+(\d+)\s+out\s+(\$[\d.]+)\s+per run/;
const HEADER_RE = /^Chain:\s*(\S+)\s*-\s*(.*)$/;
const ROUNDS_RE = /^Rounds:\s*(\d+)/;
const UNPRICED_RE = /^\s*No price on file for:\s*(.+)$/;

function parseDryRun(stdout) {
  const rows = [];
  let name = null, description = null, rounds = null, total = null, unpriced = [];
  for (const line of stdout.split('\n')) {
    const header = line.match(HEADER_RE);
    if (header) { name = header[1]; description = header[2]; continue; }
    const roundsMatch = line.match(ROUNDS_RE);
    if (roundsMatch) { rounds = Number(roundsMatch[1]); continue; }
    const totalMatch = line.match(TOTAL_RE);
    if (totalMatch) {
      total = { input: Number(totalMatch[1]), output: Number(totalMatch[2]), usd: Number(totalMatch[3].slice(1)) };
      continue;
    }
    const unpricedMatch = line.match(UNPRICED_RE);
    if (unpricedMatch) { unpriced = unpricedMatch[1].split(',').map(s => s.trim()); continue; }
    const row = line.match(ROW_RE);
    if (row) {
      const priced = row[5] !== 'unpriced';
      rows.push({ label: row[1], seat: row[2], input: Number(row[3]), output: Number(row[4]), usd: priced ? Number(row[5].slice(1)) : null, priced });
    }
  }
  return { name, description, rounds, rows, total, unpriced };
}

/**
 * Price one relay chain by running its own real `--dry-run` (no model calls, no cost).
 * @param {string} relayPath - resolved relay repo root (relayChainSubprocess.js's resolveRelayPath)
 * @param {string} chain - a chain name under <relayPath>/chains/*.json
 * @returns {object} parsed estimate, or {error} if the chain config doesn't exist / relay failed
 */
export function estimateChainCost(relayPath, chain) {
  const cli = join(relayPath, 'src', 'cli.js');
  let stdout;
  try {
    stdout = execFileSync('node', [cli, '--chain', chain, '--dry-run'], { cwd: relayPath, encoding: 'utf8' });
  } catch (err) {
    return { error: `relay --dry-run failed for chain "${chain}": ${err.message}` };
  }
  const parsed = parseDryRun(stdout);
  if (!parsed.total) return { error: `could not parse relay's --dry-run output for chain "${chain}"` };
  return parsed;
}
