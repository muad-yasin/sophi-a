# Sophi-A

A Tauri desktop shell that visualizes and drives eight real Claude/Fable/relay agent "seats" at
once - one Command & Control chat, one Advisor, three planning modules (each a real relay debate
chain), three building modules (real Claude Code subprocesses) - so a vibecoder gets more out of
the models and subscriptions they already pay for. Open source (Apache-2.0); bring your own
Claude Code/API credentials, nothing is resold.

`cnc`/`advisor` can also run on any of several other frontier providers (OpenAI, Google Gemini,
Mistral, DeepSeek, Groq, Cohere, OpenRouter, Together, Z.ai) instead of Anthropic - see PLAN.md's
"Addendum (2026-09-09, second)". Grok/xAI is deliberately never offered, by standing policy.

Read `PLAN.md` in full before touching anything; `HANDOFF.md`, `PROGRESS.md`, `DECISIONS.md`, and
`BUILT.md` track what's actually shipped and why.

## Running it

```
npm install
npm run tauri dev
```

A packaged build now exists: `v0.1.0` (Windows NSIS installer, Linux AppImage) - both built for
real by GitHub Actions, see `PLAN_PACKAGING.md`/`HANDOFF_PACKAGING.md` for the plan and
`DECISIONS.md` for what's actually been verified vs. not (real-VM acceptance testing is still
open).

## Introspection

`src/mcp/server.js` exposes the running orchestrator (seat status/output/control) over MCP -
useful for debugging without a native window's non-existent console:

```
claude mcp add sophia -- node /path/to/cnc-harness/src/mcp/server.js
```

Then a Claude Code session gets `list_seats`, `get_seat`, `start_seat`, `stop_seat`,
`configure_seat`, and `wait_for_idle` against whatever Sophi-A instance is actually running.

## Platform support

Windows and Linux are the v1 targets - see `PLAN_PACKAGING.md` §2.2/§2.3.

**Android and iOS are explicitly out of scope**, not "coming later without a plan": Sophi-A works
by spawning real subprocesses on your machine (the `claude` CLI, a `node` process running relay
chains), and mobile OS sandboxes forbid that entirely - there's no way to run this app's actual
architecture on a phone as-is. A thin mobile client that talks over the network to a desktop
orchestrator is a real, named future direction (not ruled out), but it's a genuine rewrite, not a
recompile, and nothing is scheduled against it yet. iOS carries an extra constraint even a thin
client wouldn't escape (App Store Review Guideline 2.5.2). Full reasoning, independently argued for
each platform: `PLAN_PACKAGING.md` §3 (Android) and §3.1 (iOS).
