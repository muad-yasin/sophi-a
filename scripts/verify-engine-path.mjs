// Proves Sophi-A's plan seats run on the public council engine (THCMCP) and that the
// resolution order in src/orchestrator/enginePath.js holds. Zero API spend: the only chain
// run is `mock`, which calls no provider. Run: node scripts/verify-engine-path.mjs
import { resolveEngine, engineEnvFiles } from '../src/orchestrator/enginePath.js';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); if (!ok) failed++; };

// 1. Default resolution prefers the public repo over the private one.
delete process.env.RELAY_PATH;
const r1 = resolveEngine(root);
check('default resolves to sibling THCMCP', r1.source === 'sibling THCMCP' && r1.path === resolve(root, '..', 'THCMCP'), `${r1.path} (${r1.source})`);

// 2. RELAY_PATH still overrides when it points at a real engine.
process.env.RELAY_PATH = resolve(root, '..', 'relay');
const r2 = resolveEngine(root);
check('RELAY_PATH override wins', r2.source === 'RELAY_PATH' && r2.path === resolve(root, '..', 'relay'), `${r2.path} (${r2.source})`);

// 3. A RELAY_PATH that is not an engine is skipped, not trusted.
process.env.RELAY_PATH = '/tmp/definitely-not-an-engine';
const r3 = resolveEngine(root);
check('bogus RELAY_PATH is skipped', r3.source !== 'RELAY_PATH', `${r3.path} (${r3.source})`);
delete process.env.RELAY_PATH;

// 4. Keys: the public engine has no .env, the private checkout's .env still loads.
const envs = engineEnvFiles(root);
check('env files include private relay .env when present', envs.some(f => f.endsWith('/relay/.env')) || !existsSync(resolve(root, '..', 'relay', '.env')), envs.join(', '));

// 5. Real mock chain through the public engine with the exact args the seat adapter uses.
const engine = r1.path;
const tasksDir = join(engine, 'tasks'); mkdirSync(tasksDir, { recursive: true });
const runsDir = join(engine, 'runs'); mkdirSync(runsDir, { recursive: true });
const taskName = `cnc-harness-verify-engine-${Date.now()}.md`;
writeFileSync(join(tasksDir, taskName), '# Task\nVerify the public engine runs a mock chain for Sophi-A.\n');
const before = new Set(readdirSync(runsDir));
const res = spawnSync('node', [join(engine, 'src', 'cli.js'), '--chain', 'mock', '--task', join('tasks', taskName)], { cwd: engine, encoding: 'utf8', timeout: 120000 });
const newRuns = readdirSync(runsDir).filter(d => !before.has(d));
check('mock chain exits 0 on public engine', res.status === 0, (res.stderr || '').split('\n').slice(-2).join(' '));
check('exactly one new run folder', newRuns.length === 1, newRuns.join(','));
if (newRuns.length === 1) {
  const reportPath = join(runsDir, newRuns[0], 'report.json');
  check('report.json written', existsSync(reportPath), reportPath);
  if (existsSync(reportPath)) {
    const rep = JSON.parse(readFileSync(reportPath, 'utf8'));
    check('report has passed + totals fields the seat parser reads', 'passed' in rep && rep.totals && typeof rep.totals.usd === 'number', `passed=${rep.passed} usd=${rep.totals?.usd}`);
    check('mock run cost nothing', rep.totals.usd === 0);
  }
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
