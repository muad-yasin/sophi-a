#!/usr/bin/env bash
# Sophi-A "family" MVP, build item 1 (relay/runs/2026-09-15T18-55-34-601Z/build.md §5.1):
# a fake `claude` binary for offline acceptance tests - never spawns a real process, never makes
# a network call. Put its directory first on PATH so peer-pool.js's real `spawn('claude', ...)`
# resolves to this script instead of the real CLI.
#
# Env knobs, all optional:
#   FAKE_CLAUDE_EXIT        exit code to return (default 0)
#   FAKE_CLAUDE_DELAY_SECS  seconds to sleep before printing/exiting (default 0)
#   FAKE_CLAUDE_MARKER      path to a file to write on invocation (proves the process actually
#                            ran, with what args) - not written if unset
#   FAKE_CLAUDE_STDOUT      text to print to stdout (default: a fixed placeholder line)
set -euo pipefail

delay="${FAKE_CLAUDE_DELAY_SECS:-0}"
if [ "$delay" != "0" ]; then
  sleep "$delay"
fi

if [ -n "${FAKE_CLAUDE_MARKER:-}" ]; then
  printf '%s\n' "$*" > "$FAKE_CLAUDE_MARKER"
fi

printf '%s\n' "${FAKE_CLAUDE_STDOUT:-fake-claude: no real model was called}"

exit "${FAKE_CLAUDE_EXIT:-0}"
