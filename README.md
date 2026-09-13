![Sophi-A](brand/sophi-a-lockup-horizontal.png)

# Sophi-A

**Five other labs review your plan before a line of code gets written.** Sophi-A is a Tauri
desktop shell that runs eight real agent seats at once - one Command & Control chat, one Advisor,
three planning seats, three building seats (real Claude Code subprocesses) - so a vibecoder gets
more out of the models and subscriptions they already pay for. Open source (Apache-2.0); bring
your own Claude Code/API credentials, nothing is resold.

What makes this different from a parallel-session manager like conductor.build or Nimbalyst: the
three planning seats don't run more copies of the same agent racing to the same answer. Each one
spawns a real council chain on The High Council MCP, the public engine (`RELAY_PATH` overrides, see `CLAUDE.md`) where one model drafts a plan and
critic seats from five *other* labs - Qwen, GLM, Cohere, Gemini, Llama, never Grok - grade it
blind, the draft gets revised against their objections, and the run ends either with unanimous
sign-off or a `report.json` naming exactly which lab refused and why. That cross-lab argument -
**"The High Council,"** see `brand/HIGH_COUNCIL.md` - happens *before* any building seat writes
code, and the receipts stay in the run folder. Full comparison against what else exists in this
category: `docs/market-positioning.md`.

## Running it

```
npm install
npm run tauri dev
```

Or skip the setup: a packaged build exists (`v0.1.0` - Windows NSIS installer, Linux AppImage,
built for real by GitHub Actions) for **€20 one-time**, no subscription - buy it, run it, bring
your own provider keys. [Get it here.](https://buy.stripe.com/bJe00jfsCbOB7UU17BfjG03) Source
stays free either way; paying buys convenience, not the code.

Read `PLAN.md` in full before touching architecture; `CLAUDE.md` is the fuller orientation doc
(also served as `AGENTS.md`) for any agent - human or model - picking up work in this repo.
`PROGRESS.md`, `BUILT.md`, and `DECISIONS.md` track what's actually shipped and why, dated.

## The Council, in the product itself

Every `plan-N` seat's Debate panel renders a live Council seal - five sigils, one per critic lab,
lit when that lab signed off and dimmed when it objected - driven directly from that run's real
`report.json`, not a mockup. `cnc`/`advisor` can also run on several other frontier providers
(OpenAI, Google Gemini, Mistral, DeepSeek, Groq, Cohere, OpenRouter, Together, Z.ai) instead of
Anthropic, chat-only, no tool use - see `PLAN.md`'s provider-selection addendum. Grok/xAI is
deliberately never offered.

## Introspection

`src/mcp/server.js` exposes the running orchestrator (seat status/output/control) over MCP -
useful for debugging without a native window's non-existent console:

```
claude mcp add sophia -- node /path/to/cnc-harness/src/mcp/server.js
```

Then an MCP-capable session gets `list_seats`, `get_seat`, `start_seat`, `stop_seat`,
`configure_seat`, and `wait_for_idle` against whatever Sophi-A instance is actually running.

## Platform support

Windows and Linux are the v1 targets - see `PLAN_PACKAGING.md` §2.2/§2.3.

**Android and iOS are explicitly out of scope**, not "coming later without a plan": Sophi-A works
by spawning real subprocesses on your machine (the `claude` CLI, a `node` process running relay
chains), and mobile OS sandboxes forbid that entirely - there's no way to run this app's actual
architecture on a phone as-is. A thin mobile client that talks over the network to a desktop
orchestrator is a real, named future direction (not ruled out), but it's a genuine rewrite, not a
recompile, and nothing is scheduled against it yet. iOS carries an extra constraint even a thin
client wouldn't escape (App Store Review Guideline 2.5.2). Full reasoning, independently argued
for each platform: `PLAN_PACKAGING.md` §3 (Android) and §3.1 (iOS).

## How this was built

Vibecoded end-to-end with Claude Code, with each of Sophi-A's own three planning seats' plans
critiqued blind by the same kind of multi-lab relay chain the product ships (see "The Council,
in the product itself" above) before a building seat wrote code. `PROGRESS.md`, `BUILT.md`, and
`DECISIONS.md` are the dated, unedited build log - not a summary written after the fact.

One concrete decision from that log: xai/Grok is deliberately absent from the allowed-provider
list in `src/orchestrator/providers.js`, on the author's own explicit instruction, and is checked
before any API call rather than merely omitted from a UI dropdown (`DECISIONS.md`, 2026-09-09).

## License

Apache-2.0 (`LICENSE`). The source is the product's own advertisement, not a teaser for the paid
build - read it, run it, fork it.
