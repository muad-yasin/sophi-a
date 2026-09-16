// The one shared definition of a real `claude` subprocess's env allowlist and restricted-mode
// args - previously duplicated between claudeCodeSubprocess.js and peer-pool.js (found by the
// Sophi-A Seat Families council review, relay/runs/2026-09-15T19-57-10-287Z/deliverable.md §b
// "Flag/reversal guards": two independent copies of a security-relevant allowlist is regression
// risk (3) from that plan's §0 materialized already, before any family code existed - a
// family-motivated edit to one copy would not touch the other, and nothing proved they stayed
// identical). Both call sites now import from here; neither defines its own copy - verified by
// test/env-restrictions.test.mjs's source-grep and byte-identical-argv/env test.
//
// G6 (relay/Docs/SophiA-Seat-Families-Plan.md §7): any change to RESTRICTED_ARGS, SAFE_ENV_KEYS,
// or safeEnv() itself is a human-stop gate - a session that thinks it needs one stops and asks.
// This file's own content is otherwise unchanged from what both call sites already carried.

// docs/security-prompt-injection.md S1/P0: a claude-code-subprocess seat (cnc, build-1..3) or a
// peer must never inherit process.env wholesale. The orchestrator's own env accumulates every
// saved provider API key (src-tauri/src/lib.rs's spawn_orchestrator) plus whatever relay's .env
// holds (messagesApi.js's loadRelayEnv merges it into process.env on first use) - a builder that
// runs `env` in Bash would otherwise see all of it in one shot. Build the child's env from an
// allowlist instead of filtering process.env, so nothing new leaks in by accident later.
export const SAFE_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TMP', 'TEMP', 'USER', 'USERNAME', 'SHELL'];

export function safeEnv() {
  const env = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  // The one exception: the claude CLI's own Anthropic auth. An OAuth session lives under HOME
  // (already kept above); API-key auth needs ANTHROPIC_API_KEY specifically. Every OTHER
  // provider key (OPENAI_API_KEY, OPENROUTER_API_KEY, ...) stays out - neither a
  // claude-code-subprocess seat nor a peer ever calls those providers, so neither needs their
  // keys.
  if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  return env;
}

// docs/security-prompt-injection.md S1: no --permission-mode/--allowedTools meant the only thing
// standing between an injected instruction and real damage was whatever the user's own global
// ~/.claude/settings.json happened to allow. --restricted ignores user/project/local settings
// files entirely (closing the "a builder writes .workdirs/build-N/.claude/settings.json to grant
// itself Bash(*)" vector), confines file tools to the working directory (--add-dir included), and
// refuses --dangerously-skip-permissions outright. --tools re-admits exactly what a builder needs
// to do its job (code-running tools are stripped by --restricted "unless --tools names them") -
// Bash, the file tools, and TodoWrite - deliberately not WebFetch/WebSearch, which nothing in
// this product's design says a builder needs. --strict-mcp-config means no MCP server is loaded
// at all, so a seat or peer can no longer start a real, paid relay run via mcp__relay__* outside
// Sophi-A's own plan-N path and its start_many cost gate.
//
// --permission-mode: "acceptEdits" is verified live (raw `claude -p`) to let Write/Edit/Bash
// actually execute under --restricted's other protections (no local settings, confined to the
// working dir, no bypassPermissions). --permission-prompts none stays on top as a hang-safety
// net: if some other tool category would prompt under acceptEdits, this resolves to a fast deny
// instead of a silent hang until timeout.
export const RESTRICTED_ARGS = [
  '--restricted',
  '--tools', 'Bash,Edit,Write,Read,Glob,Grep,MultiEdit,TodoWrite',
  '--strict-mcp-config',
  '--permission-mode', 'acceptEdits',
  '--permission-prompts', 'none',
];
