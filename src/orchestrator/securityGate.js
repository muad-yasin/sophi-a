// F6 (relay/Docs/SophiA-Seat-Families-Plan.md §2.9, §5) - Sophi-A's own half of the security
// gate call, paired with THCMCP's F9 (`chains/security-review-only.json`, built separately in
// that repo). This module starts THCMCP's `security-review-only` chain (or an equivalent test
// double engine) against one artifact, drives it through the existing ExternalPause/resume
// mechanism exactly the way a human operator would by hand, and maps the outcome to
// pass/blocked/not_judged - the three values THCMCP's own gate already defines
// (docs/security-review-gate.md). No THCMCP code is touched or duplicated here; this only
// spawns its CLI and reads its run folder, the same relationship enginePath.js/
// relayChainSubprocess.js already have with the engine.
//
// **not_judged is never a pass.** This is enforced at every failure point below, not just the
// CLI's own exit code 8: an unexpected exit code, a missing report.json, or a report.json with
// no security_review block are all fail-closed to not_judged, because an exit code alone is not
// evidence a review actually ran (see runSecurityGate's own reasonCode list).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { resolveEnginePath } from './enginePath.js';

const here = dirname(fileURLToPath(import.meta.url));
const defaultCncRoot = resolve(here, '../..');

// Same allowlist convention as peer-pool.js's safeEnv() / claudeCodeSubprocess.js's safeEnv() -
// a spawned THCMCP process is exactly as untrusted as any other subprocess this app spawns.
const SAFE_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TMP', 'TEMP', 'USER', 'USERNAME', 'SHELL'];

function safeEnv() {
  const env = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  return env;
}

// Fable-5.1 security review (2026-09-15) of this module's first version, findings fixed here,
// not left for a later pass:
//
// 1. `chain` used to pass straight to `--chain` with no validation; THCMCP resolves it as
//    `join(work,'chains',\`${name}.json\`)` with no name check, so `chain: '../../../etc/x'`-style
//    values could load an arbitrary config as the "gate". Allowlisted below to the same charset a
//    real chain filename can have.
// 2. `engineDir` used to be handed straight to `join(engine,'src','cli.js')` and spawned with no
//    check that it actually looks like the THCMCP engine (chains/ present) - requireEngineShape
//    closes that.
// 3. `env` ("test-only" per its own comment) was merged over safeEnv() with no enforcement, so a
//    real caller could smuggle arbitrary env (e.g. NODE_OPTIONS) into the spawned process.
//    Restricted to the FAKE_THC_ prefix the test fixture actually uses - nothing else passes.
// 4. `canApplyArtifact` checked `gateResult.gate === 'pass'` with no binding to which artifact was
//    reviewed, so a caller could apply artifact B under a `gateResult` computed for artifact A.
//    `runSecurityGate` now returns `artifactSha256`, and `canApplyArtifact` requires the artifact
//    being applied to hash-match it.
// 5. A `mock/`-provider reviewer seat could report a real "pass" with zero actual review - which
//    matters because the shipped chain's own docs suggest swapping to a mock seat "for the
//    passing path" (a testing instruction, not a production one). `allowMockReviewer` (default
//    false) refuses to call a mock-seat pass a pass unless a caller opts in explicitly.
const CHAIN_NAME_RE = /^[A-Za-z0-9._-]+$/;
const FAKE_ENV_PREFIX = 'FAKE_THC_';

function restrictedTestEnv(testEnv) {
  if (!testEnv) return {};
  const out = {};
  for (const [key, value] of Object.entries(testEnv)) {
    if (key.startsWith(FAKE_ENV_PREFIX)) out[key] = value;
  }
  return out;
}

function requireEngineShape(engine) {
  if (!existsSync(join(engine, 'src', 'cli.js')) || !existsSync(join(engine, 'chains'))) {
    throw new Error(`securityGate: "${engine}" does not look like a THCMCP-shaped engine (needs src/cli.js and chains/)`);
  }
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export const GATE_RESULTS = Object.freeze(['pass', 'blocked', 'not_judged']);

// Every way this module itself refuses to call something "judged" - distinct from THCMCP's own
// reason codes (SEAT_UNREACHABLE etc., inside security_review.reason_code), because these name a
// failure of the *call*, not of the reviewer seat.
export const NOT_JUDGED_REASONS = Object.freeze([
  'no_initial_pause',     // the first call didn't exit 3 - crashed, or the chain never paused
  'no_needs_file',        // exited 3 but wrote no NEEDS-*.md - the real label can't be discovered
  'unexpected_exit_code', // the resume call exited something other than this chain's own 0/7/8
  'no_report_json',       // the exit code looked terminal but report.json never appeared
  'no_security_review',   // report.json exists but carries no security_review block at all
  'mock_reviewer_not_allowed', // exit 0 came from a mock-provider reviewer seat, not a real one
]);

/**
 * Run THCMCP's security-review-only chain (or a test-double engine with the same src/cli.js
 * contract) against one artifact, end to end.
 *
 * @param {object} opts
 * @param {string} opts.artifactText - the artifact under review (a diff, a plan, any text)
 * @param {string} [opts.engineDir] - a THCMCP-shaped engine dir (has src/cli.js); defaults to
 *   the real resolved engine (enginePath.js) when omitted. Tests always pass one explicitly, so
 *   they never depend on what happens to be checked out next to this repo.
 * @param {string} [opts.chain] - chain name, default 'security-review-only'
 * @param {string} [opts.taskText]
 * @param {string} [opts.cncRoot] - cnc-harness root, only used to resolve the default engine
 * @param {object} [opts.env] - test-only: extra env vars merged over the real safeEnv()
 *   allowlist. Only keys prefixed `FAKE_THC_` (the test fixture's own convention) ever pass
 *   through - anything else is silently dropped, so this can never smuggle arbitrary env (e.g.
 *   NODE_OPTIONS) into the spawned process even if a non-test caller passed it.
 * @param {boolean} [opts.allowMockReviewer] - default false: a `security_reviewer` seat whose
 *   provider is `mock` is never allowed to produce a real `pass` unless a caller opts in
 *   explicitly (tests do). Production callers never set this.
 * @returns {{ gate: 'pass'|'blocked'|'not_judged', exitCode: number|null,
 *             reasonCode: string|null, security_review: object|null, runDir: string|null,
 *             artifactSha256: string }}
 */
export function runSecurityGate({
  artifactText,
  engineDir,
  chain = 'security-review-only',
  taskText = 'Security review of the artifact provided at the paused build stage.',
  cncRoot = defaultCncRoot,
  env: testEnv,
  allowMockReviewer = false,
} = {}) {
  if (typeof artifactText !== 'string' || !artifactText.trim()) {
    throw new TypeError('runSecurityGate needs a non-empty artifactText to review');
  }
  if (!CHAIN_NAME_RE.test(chain)) {
    throw new TypeError(`securityGate: "chain" must match ${CHAIN_NAME_RE} (got ${JSON.stringify(chain)})`);
  }
  const artifactSha256 = sha256(artifactText);
  const engine = engineDir || resolveEnginePath(cncRoot);
  requireEngineShape(engine);
  const cliPath = join(engine, 'src', 'cli.js');

  // A scratch work directory, not a `sessions/<id>/turns/` slot - F7 (familyManager.js, not yet
  // built) owns deciding where a turn's real receipts live and copying security_review out of
  // this run folder into its own NNNN.gate.json; this module's job ends at producing the verdict
  // and leaving the run folder on disk for that caller to read from. Not cleaned up here on
  // purpose - the caller may still need runDir after this returns.
  const workDir = mkdtempSync(join(tmpdir(), 'sophia-secgate-'));
  mkdirSync(join(workDir, 'tasks'), { recursive: true });
  writeFileSync(join(workDir, 'tasks', 'security-gate-task.md'), taskText);

  const env = { ...safeEnv(), ...restrictedTestEnv(testEnv) };
  const run = args => execFileSync('node', [cliPath, ...args], { cwd: workDir, env, encoding: 'utf8', stdio: 'pipe' });

  let firstExit;
  try { run(['--chain', chain, '--task', join('tasks', 'security-gate-task.md')]); firstExit = 0; }
  catch (err) { firstExit = typeof err.status === 'number' ? err.status : null; }

  if (firstExit !== 3) {
    return { gate: 'not_judged', exitCode: firstExit, reasonCode: 'no_initial_pause', security_review: null, runDir: null, artifactSha256 };
  }

  const runsDir = join(workDir, 'runs');
  const runId = existsSync(runsDir) ? readdirSync(runsDir)[0] : null;
  const runDir = runId ? join(runsDir, runId) : null;
  // The real label, read from the run folder every time - never assumed to be "build". This
  // chain's only external seat is the builder, but the discovery has to hold even if that ever
  // changes, and it's the same thing a human operator reads off their own terminal.
  const needsFile = runDir && existsSync(runDir) ? readdirSync(runDir).find(f => /^NEEDS-.+\.md$/.test(f)) : null;
  if (!needsFile) {
    return { gate: 'not_judged', exitCode: firstExit, reasonCode: 'no_needs_file', security_review: null, runDir, artifactSha256 };
  }
  const label = needsFile.slice('NEEDS-'.length, -'.md'.length);
  writeFileSync(join(runDir, `${label}.md`), artifactText);

  let resumeExit;
  try { run(['--resume', join('runs', runId)]); resumeExit = 0; }
  catch (err) { resumeExit = typeof err.status === 'number' ? err.status : null; }

  const reportPath = join(runDir, 'report.json');
  let report = null;
  if (existsSync(reportPath)) {
    try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch { report = null; }
  }

  // Fail closed on the exit code first: this chain's own contract defines exactly three terminal
  // codes (0/7/8, docs/security-review-gate.md). Anything else is a surprise, not a verdict.
  if (![0, 7, 8].includes(resumeExit)) {
    return { gate: 'not_judged', exitCode: resumeExit, reasonCode: 'unexpected_exit_code', security_review: report?.security_review ?? null, runDir, artifactSha256 };
  }
  // Fail closed a second, independent way: the exit code alone is not evidence a review actually
  // ran. This is the deterministic case a fixture proves rather than a real-chain race - a "0"
  // that produced no report.json is not a pass.
  if (!report) {
    return { gate: 'not_judged', exitCode: resumeExit, reasonCode: 'no_report_json', security_review: null, runDir, artifactSha256 };
  }
  if (!report.security_review) {
    return { gate: 'not_judged', exitCode: resumeExit, reasonCode: 'no_security_review', security_review: null, runDir, artifactSha256 };
  }

  // A mock-provider reviewer seat reports a real "pass" with zero actual review having happened
  // - the shipped chain's own docs even suggest swapping to a mock seat "for the passing path",
  // which is a testing instruction, not a production one. Refuse to call that a pass unless a
  // caller opts in explicitly (tests do); a mock-seat pass is reported as not_judged with its own
  // reasonCode instead, never silently downgraded to blocked (that would be a false claim too).
  const reviewerIsMock = typeof report.security_review.seat === 'string' && report.security_review.seat.startsWith('mock/');
  if (resumeExit === 0 && reviewerIsMock && !allowMockReviewer) {
    return { gate: 'not_judged', exitCode: resumeExit, reasonCode: 'mock_reviewer_not_allowed', security_review: report.security_review, runDir, artifactSha256 };
  }

  const gate = resumeExit === 7 ? 'blocked'
    : resumeExit === 8 ? 'not_judged'
    : report.security_review.gate === 'pass' ? 'pass' : 'not_judged';
  return { gate, exitCode: resumeExit, reasonCode: null, security_review: report.security_review, runDir, artifactSha256 };
}

/**
 * The Apply/Forward server-side double-check (relay/Docs/SophiA-Seat-Families-Plan.md §7 G5,
 * §2.9): a UI click alone is a client-side signal a rendering bug could get wrong even with a
 * disabled-looking button. Three conditions are required, checked independently here rather than
 * trusting any one signal alone: a real click, a real `gate: "pass"` result, and - the artifact
 * actually being applied hash-matches the one the gate result was computed for, so a
 * `gateResult` from a different (or forged) artifact can never authorize applying this one.
 * @param {{ humanClick: boolean, gateResult: { gate: string, artifactSha256?: string },
 *            artifactText?: string }} args - `artifactText` is required when `gateResult` carries
 *   an `artifactSha256` to bind against; omit both to fall back to the unbound check (only for
 *   callers that genuinely have no artifact text at this point, e.g. a pre-F7 stub).
 */
export function canApplyArtifact({ humanClick, gateResult, artifactText }) {
  if (humanClick !== true || gateResult?.gate !== 'pass') return false;
  if (typeof gateResult?.artifactSha256 === 'string') {
    return typeof artifactText === 'string' && sha256(artifactText) === gateResult.artifactSha256;
  }
  return true;
}
