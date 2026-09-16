#!/usr/bin/env node
// A fake THCMCP `src/cli.js` for offline securityGate.js tests - never spawns the real THCMCP
// repo, never makes a network call. Mirrors just the two invocation shapes securityGate.js
// depends on (a fresh run that pauses at an external stage, and --resume), same "fake-claude.sh"
// pattern test/fixtures/fake-claude.sh already uses for peer-pool.js's tests: env-var knobs, no
// hidden state, one clearly-named responsibility.
//
// Its main purpose is the deterministic not_judged fault-injection fixture (thcmcp-66's own
// instruction: "not a real-chain race"): FAKE_THC_WRITE_REPORT=0 simulates a resume that exits
// looking-successful (any exit code, including 0) but never produces report.json - the exact
// case securityGate.js must treat as not_judged regardless of exit code, since "not_judged is
// never a pass" only holds if the caller actually checks for the artifact, not just the code.
//
// Env knobs, all optional:
//   FAKE_THC_FIRST_EXIT     exit code for the first (non-resume) call (default 3, a real pause)
//   FAKE_THC_LABEL          external-stage label named in NEEDS-<label>.md (default "build")
//   FAKE_THC_WRITE_NEEDS    '0' to skip writing NEEDS-<label>.md on the first call (default '1')
//   FAKE_THC_RESUME_EXIT    exit code for the --resume call (default 0)
//   FAKE_THC_WRITE_REPORT   '0' to skip writing report.json on resume (default '1')
//   FAKE_THC_REPORT_JSON    literal JSON string for report.json's content, overrides the default
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const resumeIdx = argv.indexOf('--resume');
const cwd = process.cwd();

function flag(name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
}

if (resumeIdx === -1) {
  // Fresh run: create a run folder the same shape a real caller expects to find under runs/.
  const runId = process.env.FAKE_THC_RUN_ID || `fake-${Date.now()}`;
  const runDir = join(cwd, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const label = process.env.FAKE_THC_LABEL || 'build';
  const writeNeeds = process.env.FAKE_THC_WRITE_NEEDS !== '0';
  if (writeNeeds) {
    const needsPath = join(runDir, `NEEDS-${label}.md`);
    writeFileSync(needsPath, `# External stage: ${label}\n\nWrite the reply to \`${join(runDir, `${label}.md`)}\`.\n`);
    console.log(`PAUSED: stage "${label}" is an external seat.`);
    console.log(`  prompt:  ${needsPath}`);
    console.log(`  answer:  write ${join(runDir, `${label}.md`)}`);
    console.log(`  resume:  node src/cli.js --resume runs/${runId}`);
  }
  process.exit(Number(process.env.FAKE_THC_FIRST_EXIT ?? 3));
} else {
  // Resume: optionally write report.json, then exit with the configured code.
  const runArg = argv[resumeIdx + 1];
  const runDir = resolve(cwd, runArg);
  const writeReport = process.env.FAKE_THC_WRITE_REPORT !== '0';
  if (writeReport) {
    const reportJson = process.env.FAKE_THC_REPORT_JSON || JSON.stringify({
      passed: true,
      security_review: { label: 'security-review', seat: 'anthropic/claude-fable-5-1', gate: 'pass', findings: [], blocking_count: 0 },
    });
    writeFileSync(join(runDir, 'report.json'), reportJson);
  }
  process.exit(Number(process.env.FAKE_THC_RESUME_EXIT ?? 0));
}
