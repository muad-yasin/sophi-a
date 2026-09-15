// Sophi-A "family" MVP, build item 1's own acceptance test (relay/runs/2026-09-15T18-55-34-601Z/
// build.md §5.1): proves fake-claude.sh and mock-relay-chain.mjs actually behave as the plan
// requires, before any later session (B/C) builds on top of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, mockRelayChain } from './mock-relay-chain.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fakeClaude = join(here, 'fake-claude.sh');

test('fake-claude.sh exits 0 by default', () => {
  const out = execFileSync(fakeClaude, [], { encoding: 'utf8' });
  assert.match(out, /fake-claude: no real model was called/);
});

test('fake-claude.sh exits 7 when FAKE_CLAUDE_EXIT=7', () => {
  assert.throws(
    () => execFileSync(fakeClaude, [], { env: { ...process.env, FAKE_CLAUDE_EXIT: '7' } }),
    (e) => e.status === 7
  );
});

test('fake-claude.sh writes the marker file with its invocation args when FAKE_CLAUDE_MARKER is set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fake-claude-marker-'));
  const marker = join(dir, 'marker.txt');
  execFileSync(fakeClaude, ['--add-dir', '/tmp/worktree-a'], {
    env: { ...process.env, FAKE_CLAUDE_MARKER: marker },
  });
  assert.equal(readFileSync(marker, 'utf8').trim(), '--add-dir /tmp/worktree-a');
});

test('fake-claude.sh prints FAKE_CLAUDE_STDOUT verbatim when set', () => {
  const out = execFileSync(fakeClaude, [], {
    env: { ...process.env, FAKE_CLAUDE_STDOUT: 'a custom line' },
    encoding: 'utf8',
  });
  assert.equal(out.trim(), 'a custom line');
});

test('fake-claude.sh honors FAKE_CLAUDE_DELAY_SECS (short delay, kept fast for the test suite)', () => {
  const start = Date.now();
  execFileSync(fakeClaude, [], { env: { ...process.env, FAKE_CLAUDE_DELAY_SECS: '0.3' } });
  assert.ok(Date.now() - start >= 250, 'fake-claude.sh did not actually sleep');
});

test('fake-claude.sh makes no outbound network call - no known networking tool named in source', () => {
  // Ground-truth check on the artifact itself (verification-and-critique's rule), not a claim:
  // this greps for a fixed list of common networking invocations (curl/wget/nc/fetch/etc) and
  // finds none. That is evidence, not a proof of unreachability - the check doesn't rule out
  // every conceivable way a shell script could reach the network (a bare /dev/tcp redirect, a
  // renamed binary, a future edit adding one), only that none of the obvious ones are present
  // (security-review fix, fable-5.1 review of 8005602, item 2: the prior comment overclaimed).
  const src = readFileSync(fakeClaude, 'utf8');
  assert.doesNotMatch(src, /\b(curl|wget|\bnc\b|netcat|fetch\(|http\.request|https\.request)\b/);
});

test('mockRelayChain: all-approve scenario has every provider signed off clean', () => {
  const { signoff, holdout } = mockRelayChain('all-approve');
  assert.equal(signoff.length, 3);
  assert.ok(signoff.every(s => s.signedOff === true && s.objections.length === 0));
  assert.equal(holdout, null);
});

test('mockRelayChain: one-holdout scenario\'s holdout critic entry carries a refusal field', () => {
  const { signoff, holdout } = mockRelayChain('one-holdout');
  const holdoutEntry = signoff.find(s => s.signedOff === false);
  assert.ok(holdoutEntry, 'expected exactly one non-signed-off critic entry');
  assert.equal(typeof holdoutEntry.refusal, 'string');
  assert.ok(holdoutEntry.refusal.length > 0);
  assert.equal(holdout.provider, holdoutEntry.provider);
});

test('mockRelayChain: malformed-json-critic scenario reproduces the fenced-markdown reply shape', () => {
  const { signoff, rawCriticReplies } = mockRelayChain('malformed-json-critic');
  const unreadable = signoff.find(s => s.signedOff === null);
  assert.ok(unreadable, 'expected exactly one unreadable (signedOff: null) critic entry, not a false pass/fail');
  assert.match(rawCriticReplies[unreadable.provider], /^```json\n/);
  // The unreadable entry's raw text is nonetheless valid JSON once the fence is stripped - the
  // scenario models a formatting bug, not an actually-malformed payload.
  const stripped = rawCriticReplies[unreadable.provider].replace(/^```json\n|\n```$/g, '');
  assert.doesNotThrow(() => JSON.parse(stripped));
});

test('mockRelayChain rejects an unknown scenario name rather than returning a default silently', () => {
  assert.throws(() => mockRelayChain('not-a-real-scenario'), /unknown scenario/);
});

test('SCENARIOS lists exactly the three canned scenarios the plan names', () => {
  assert.deepEqual([...SCENARIOS].sort(), ['all-approve', 'malformed-json-critic', 'one-holdout']);
});
