// Where the relay-chain-subprocess seat keeps its own side files (2026-09-23).
//
// Each plan seat writes two throwaway files per run: the task text it hands the engine's CLI,
// and a side log that captures the detached child's console output (a duplicate of run.log).
// Until 2026-09-23 both were written INTO the engine repo - the task under <engine>/tasks/ and
// the log at <engine>/ itself - so every seat start left a `cnc-harness-*.log` in the public
// THCMCP checkout's root (31 of them by then, all mock-chain test debris; moved to
// ~/.cache/cnc-harness/legacy-2026-09/ on Muad's call). The engine repo is a curated public tree
// whose CLAUDE.md forbids adding tasks/ content, so neither file belongs there.
//
// They now live under ~/.cache/cnc-harness/ (override: CNC_HARNESS_CACHE_DIR, used by tests).
// The task is passed to the CLI as an ABSOLUTE --task path; THCMCP's cli.js resolves it with
// path.resolve(cwd, task), which returns an absolute path unchanged. Not under <engine>/runs/:
// the engine's spend report enumerates runs/ entries as run ids, and a stray file there is
// exactly what its degradation contract has to survive.
import { join } from 'node:path';
import { homedir } from 'node:os';

export function sideFileDir() {
  return process.env.CNC_HARNESS_CACHE_DIR || join(homedir(), '.cache', 'cnc-harness');
}

export function sideFilePaths(seatId, timestamp, base = sideFileDir()) {
  const name = `cnc-harness-${seatId}-${timestamp}`;
  return {
    tasksDir: join(base, 'tasks'),
    logsDir: join(base, 'side-logs'),
    taskPath: join(base, 'tasks', `${name}.md`),
    logPath: join(base, 'side-logs', `${name}.log`),
  };
}
