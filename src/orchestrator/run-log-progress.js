// Live progress for a plan-N seat, read out of relay's own run.log - the same file
// relayChainSubprocess.js already tails line by line for the tile's output slot. This is the
// only real source for "Round 2 of 3 · 1 objection open" / "Proposals in · 5 of 5 posted" style
// subtitles: relay's chain.js writes one structured line per stage/round/verdict (grepped from
// its `log(...)` calls, 2026-09-16, and checked against real run.log files under
// ~/Projects/THCMCP/runs/), and report.json only exists once the run is over. Nothing here is
// estimated - a field stays `null` until the line that carries it has actually been seen.
//
// Pure: `foldProgress(state, line)` returns a new state, no I/O, no clock. The exact line shapes
// this reads (relay/src/chain.js + src/cli.js, verbatim prefixes):
//   `chain: <name> (<N> round cap)`                 -> chain, maxRounds
//   `cap:   $<usd> per run (--max-usd)`             -> capUsd
//   `Stage: <name>[ (...)]`                         -> stage
//   `Stage: proposals (<N> labs, ...)`              -> proposalsExpected
//   `  <N> proposal(s) go to the builder.`          -> proposalsIn
//   `Round <N>: build|critique|panel review|revise` -> round, stage; resets the round's verdicts
//   `  verdict: MEETS - ...` / `  verdict: <N> failure(s) - ...`
//                                                  -> openObjections (summed over the round)
//   `  round cap (<N>) reached ...`                 -> capReached
//   `---`                                           -> done (the summary block follows; its own
//                                                     `verdict:` line is a different thing and
//                                                     must not be read as a critic verdict)
// A relay log-format change makes a field go silent (stay null), never wrong - the tests pin the
// real lines, so the change shows up there first.

export function emptyProgress() {
  return {
    chain: null,
    maxRounds: null,
    capUsd: null,
    stage: null,
    round: null,
    proposalsExpected: null,
    proposalsIn: null,
    openObjections: null,
    capReached: false,
    done: false,
  };
}

const CHAIN_RE = /^chain:\s+(\S+)\s+\((\d+) round cap\)/;
const CAP_RE = /^cap:\s+\$([0-9]+(?:\.[0-9]+)?) per run/;
const STAGE_RE = /^Stage(?: \(descending\))?:\s+([a-z][a-z -]*?)(?:\s+\(|$)/;
const PROPOSALS_STAGE_RE = /^Stage:\s+proposals \((\d+) labs?,/;
const PROPOSALS_IN_RE = /^\s+(\d+) proposal\(s\) go to the builder\./;
const ROUND_RE = /^Round (\d+):\s+(build|critique|panel review|revise)/;
const VERDICT_RE = /^\s+verdict:\s+(MEETS|(\d+) failure\(s\))/;
const CAP_REACHED_RE = /^\s+round cap \((\d+)\) reached/;

/**
 * @param {ReturnType<typeof emptyProgress>} state
 * @param {string} line - one run.log line, as relayChainSubprocess.js's readNewLogLines yields it
 */
export function foldProgress(state, line) {
  if (state.done) return state;
  if (line === '---') return { ...state, done: true };

  let m;
  if ((m = CHAIN_RE.exec(line))) return { ...state, chain: m[1], maxRounds: Number(m[2]) };
  if ((m = CAP_RE.exec(line))) return { ...state, capUsd: Number(m[1]) };
  if ((m = ROUND_RE.exec(line))) {
    // A new round's verdicts replace the previous round's - the count is "open right now",
    // not "ever raised". Reset to null (unknown) rather than 0: until a critic in this round
    // has actually spoken, nothing is known about it.
    return { ...state, round: Number(m[1]), stage: m[2], openObjections: null };
  }
  if ((m = VERDICT_RE.exec(line))) {
    const failures = m[1] === 'MEETS' ? 0 : Number(m[2]);
    return { ...state, openObjections: (state.openObjections ?? 0) + failures };
  }
  if ((m = PROPOSALS_STAGE_RE.exec(line))) {
    return { ...state, stage: 'proposals', proposalsExpected: Number(m[1]), proposalsIn: null };
  }
  if ((m = PROPOSALS_IN_RE.exec(line))) return { ...state, proposalsIn: Number(m[1]) };
  if ((m = CAP_REACHED_RE.exec(line))) return { ...state, capReached: true };
  if ((m = STAGE_RE.exec(line))) return { ...state, stage: m[1].trim() };
  return state;
}

/** Fold a whole batch of lines; returns `{ state, changed }` so a caller can emit only on change. */
export function foldProgressLines(state, lines) {
  let next = state;
  for (const line of lines) next = foldProgress(next, line);
  return { state: next, changed: next !== state };
}
