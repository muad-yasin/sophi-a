// Which council engine Sophi-A runs its plan seats on.
//
// Sophi-A's plan seats spawn `node <engine>/src/cli.js` and poll `<engine>/runs/`. Until
// 2026-09-13 that engine was hardwired to the private `../relay` checkout. The public MIT repo
// (The High Council MCP, github.com/muad-yasin/the-high-council-mcp, folder `THCMCP` locally)
// carries the same src/cli.js, the same chains/ (plan-fast, plan-thorough, plan-cheap, mock...)
// and the same run-folder shape, so the product can - and should - run on the code everyone
// else gets. Resolution order, first hit wins, each candidate must actually look like an engine
// (src/cli.js + chains/ present):
//
//   1. RELAY_PATH            explicit override, unchanged behaviour for anyone who set it
//   2. ../THCMCP             sibling checkout of the public repo (this machine's layout)
//   3. ../the-high-council-mcp   sibling checkout under the GitHub name
//   4. node_modules/the-high-council   the npm package, once it is published
//   5. ../relay              the private source repo, last so it stays the fallback not the default
//
// Pure module on purpose: no import of index.js, so no circular-import/`root`-before-init trap
// (see relayChainSubprocess.js and run-recorder.js for why that matters). Callers pass `root`.
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';

function looksLikeEngine(dir) {
  return existsSync(join(dir, 'src', 'cli.js')) && existsSync(join(dir, 'chains'));
}

function installedPackageDir() {
  try {
    const req = createRequire(import.meta.url);
    return dirname(req.resolve('the-high-council/package.json'));
  } catch {
    return null;
  }
}

/**
 * @param {string} root - cnc-harness repo root
 * @returns {{ path: string, source: string }} resolved engine dir and which rule picked it
 */
export function resolveEngine(root) {
  const candidates = [
    ['RELAY_PATH', process.env.RELAY_PATH ? resolve(process.env.RELAY_PATH) : null],
    ['sibling THCMCP', join(root, '..', 'THCMCP')],
    ['sibling the-high-council-mcp', join(root, '..', 'the-high-council-mcp')],
    ['npm package the-high-council', installedPackageDir()],
    ['sibling relay (private fallback)', join(root, '..', 'relay')],
  ];
  for (const [source, dir] of candidates) {
    if (dir && looksLikeEngine(dir)) return { path: resolve(dir), source };
  }
  // Nothing on disk looks like an engine: keep the historical default so the error a seat
  // reports still names a concrete path the operator can create or override.
  return { path: resolve(join(root, '..', 'relay')), source: 'default (nothing found)' };
}

let announced = null;
/** Same as resolveEngine but logs the choice once per process, so a run's log says which engine ran it. */
export function resolveEnginePath(root) {
  const r = resolveEngine(root);
  if (announced !== r.path) {
    announced = r.path;
    console.log(`[engine] council engine: ${r.path} (${r.source})`);
  }
  return r.path;
}

/**
 * .env files to read provider keys from, first file to define a variable wins. The public
 * engine is BYOK and ships no .env; keys the operator keeps in the private relay checkout
 * still load when that checkout sits next to this repo, so nothing regresses locally.
 */
export function engineEnvFiles(root) {
  const engine = resolveEngine(root).path;
  const files = [join(engine, '.env'), join(root, '..', 'relay', '.env')];
  return [...new Set(files)].filter(f => existsSync(f));
}
