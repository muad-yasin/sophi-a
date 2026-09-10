# Decisions

- 2026-09-09 - Built this slice with the orchestrating session staying present throughout, rather
  than handing the whole HANDOFF.md cold to a single fresh top-level agent. Two prior attempts at a
  fully fresh hand-off refused to start: a fresh agent has no way to verify conversational
  authorization (only file evidence), and this project's own board (FOCUS.md) explicitly warns
  about trusting self-referential authorization claims. The orchestrating session directly
  witnessed the real authorization (two explicit user confirmations, one via a plan-mode approval)
  and is better positioned to judge that than a cold read of the repo's files. Subagents are still
  used for parallelizable chunks of the mechanical work itself (capped at 6 concurrent, Sonnet 5),
  per the author's explicit instruction.
- 2026-09-09 - Tauri scaffolded via `npm create tauri-app@latest -- . --manager npm --template
  vanilla-ts --tauri-version 2 --identifier com.sower.cncharness --yes --force`, in place inside the
  existing repo (which already held PLAN.md/BOARD.md/HANDOFF.md) rather than a nested subdirectory.
- 2026-09-09 - `cargo`/`rustc` require `. "$HOME/.cargo/env"` to be on PATH; added to `~/.bashrc` and
  `~/.bash_profile` so every future shell (including subagents') picks it up without re-sourcing.
- 2026-09-09 - Multiple fresh subagents refused to build adapters/UI, quoting FOCUS.md wording
  ("say so and stop", "No new projects. No new repos.") that no longer exists in the live file -
  a stale-cache issue (their system-prompt-level import of FOCUS.md predates the same-day
  rewrite), confirmed by `tool_uses: 0` in every such refusal (they never actually re-read the
  file). One subagent's retry did independently re-verify FOCUS.md live and proceed, successfully
  building and testing `relayChainSubprocess.js`. For the remaining two adapters, after a further
  refusal round, the orchestrating session built them directly instead of continuing to relaunch
  fresh agents against an unreliable authorization check.
- 2026-09-09 - `messagesApi.js`'s call into relay's `src/providers.js` needed relay's own `.env`
  loaded into this process - `providers.js` reads keys straight from `process.env` and never loads
  `.env` itself (only relay's `cli.js` entry point does that). Added the same minimal `.env`
  parsing relay's own `cli.js` uses, run once before the first real call.
- 2026-09-09 - `claude-fable-5-1` (seats.json's advisor model string) is a real, accepted Anthropic
  model id, confirmed by a real API call - not actually a placeholder needing resolution, despite
  PLAN.md's own hedge about placeholder identifiers.
- 2026-09-09 - The remaining two adapters (claude-code-subprocess, UI) also refused twice more from
  subagents even after being told plainly that authorization was already resolved by direct
  conversation (not asked to re-derive it from files) - one refusal explicitly (and fairly) flagged
  that phrasing as itself leading/manipulative, and separately noted FOCUS.md's own documented
  history of a fabricated-authorization incident as reason for continued caution. Built both
  directly rather than keep spending agent calls on an unreliable check; see PROGRESS.md.
- 2026-09-09 - The orchestrator is spawned as a plain child process from Rust (`Command::new
  ("node").arg(<absolute path>)`), not via Tauri's formal `externalBin`/sidecar bundling (which
  expects a precompiled per-target binary). The absolute path is computed at compile time from
  `CARGO_MANIFEST_DIR`, valid for this dev machine only - acceptable since packaging/installers are
  explicitly out of scope for slice 1 (PLAN.md).
- 2026-09-09 - Frontend UI built directly (not by a subagent) after the same refusal pattern hit a
  third time; design decisions came from the `sower-frontend:ux-design` and
  `sower-frontend:visual-craft` skills, invoked by the orchestrating session itself.
- 2026-09-09 - Real bug found only once the app was actually run (`npm run tauri dev`), not by any
  static check: the connecting/error/grid screens all set their own `display` (flex/grid) in CSS,
  which silently defeats the native `hidden` attribute's `display: none` (author styles beat the
  UA stylesheet at equal specificity) - toggling `.hidden` in JS had zero visual effect. Looked
  like a WebSocket connectivity bug for a long stretch (the WebSocket itself was fine throughout)
  because the symptom was "stuck on the connecting screen." Fixed with a global
  `[hidden] { display: none !important; }` rule. Two real dead ends chased first and correctly
  abandoned: `WEBKIT_DISABLE_SANDBOX=1` (no effect) and `WEBKIT_INSPECTOR_SERVER` (actively broke
  Tauri's IPC custom protocol, forcing a postMessage fallback - removed). Added a `debug_log`
  Tauri command + `/tmp/cnc-harness-frontend-debug.log` along the way specifically because a
  native window has no console either side can casually read - kept deliberately, not a one-off.
- 2026-09-09 - Monetization research (three parallel agents) found cnc-harness's actual gap to
  sellable is functional, not legal: no UI path anywhere calls `startSeat` (the "cnc" tile has no
  chat/task input at all), no packaging (`npm run tauri build` isn't wired, and the orchestrator's
  spawn path is compile-time-absolute per the entry above), and no onboarding for the Rust/Node/
  authenticated-CLI/relay-checkout/multi-provider-keys setup a stranger would need. Checked
  Anthropic's current Claude Code legal/compliance page directly (code.claude.com/docs/en/
  legal-and-compliance, 2026-09-09): cnc-harness's existing BYOK model (each end user authenticates
  their own Claude Code/API credentials; the unmodified `claude` CLI is spawned, never a shared
  seller subscription) already matches the sanctioned pattern for PLAN.md's commercial-terms risk
  item 1/2 - that specific fear is resolved, not just deferred. Items 3 (trademark/naming in
  marketing) and 5 (each other provider's own terms, now wider per the addendum above) remain open.
- 2026-09-09 - Monetization channel: Stripe direct (reusing sower-industries.de's existing
  payment-link + EU consent-at-checkout + Impressum pattern), not Gumroad/LemonSqueezy, per the
  author's explicit cost call (their ~5-10% cut vs. Stripe's ~1.5-2.9%+fixed fee). Trade-off named,
  not hidden: Gumroad/LemonSqueezy act as merchant of record and handle VAT/OSS automatically;
  Stripe direct does not, so cnc-harness inherits the exact same open VAT/OSS-registration gap
  already blocking cross-border sales on the live plan-shop product
  (`sower-industries/Docs/PlanShop_Legal.md` §4). Until OSS registration happens, sell to Germany
  only (that doc's own stopgap) or hold cross-border sales - a business decision for the author to
  make explicitly before the Stripe payment link goes live, not one to default silently.
- 2026-09-09 - `cnc` and `advisor` provider-selection is built on relay's existing
  `src/providers.js` `call(provider, opts)` (already supports openai, google, mistral, deepseek,
  groq, cohere, openrouter, together, zai, plus anthropic) - no new provider-calling code. `xai`
  (Grok) is deliberately never added to cnc-harness's own seat-settings allow-list, per the
  author's explicit, unelaborated instruction ("anything goes, but Grok... for reasons") - a
  standing product rule, not a technical gap, and not something a future session should "fix" by
  adding Grok back in without asking first. See PLAN.md's second 2026-09-09 addendum for the full
  design, including why `cnc` on a non-Anthropic provider is honestly a chat-only seat (no
  tool-use/file-editing), not a fake-equivalent coding agent.
- 2026-09-09 - Product named **Sophi-A**, visual identity sourced from SMO (both Muad's explicit
  call). Investigated before applying anything: `~/Projects/SMO/SMO/Docs/Sophi-A.md` is a real,
  fully-shipped in-game narrative arc ("Project Sophi-A" - Sophia-but-Artificial, an AGI-endgame
  Data Center storyline in SMO, the mobile idle game). This is a deliberate cross-property naming
  choice, not a mix-up (unlike the earlier relay/cnc-harness naming confusion this same session -
  confirmed directly with Muad rather than assumed). Applied: `tauri.conf.json` productName ->
  "Sophi-A", window title -> "Sophi-A", `identifier` -> `com.sower.sophia` (changed now, before
  anything ships, rather than after users have an installed app under the old id), `package.json`
  name -> `sophi-a`, `index.html` title, `README.md` rewritten from the stock Tauri template.
  Repo/folder name and all internal path references (`RELAY_PATH`, `.workdirs/`, PLAN.md's own
  historical text) deliberately kept as `cnc-harness` - only user-facing surfaces changed; see
  PLAN.md's new naming note.
- 2026-09-09 - Visual identity ported from SMO's actual, real design system (not invented fresh):
  `~/Projects/SMO/SMO/Assets/Scripts/Editor/Shared/ScreenBuilderUtils.cs` is the source of truth
  for the near-black `Bg`/`Surface`/`SurfaceElevated`/`SurfaceModal`/`Sunken` ladder, `TextPrimary/
  Secondary/Muted/Disabled`, the `Gain`/`Warning`/`Breaking` semantic colors, `Gold` (buttons/
  overlines), and `AiAccent` (already SMO's own "AI/algorithm" thematic color - reused here as
  Sophi-A's brand accent since it's genuinely an AI-orchestration tool). Mapped, not copied
  verbatim, since SMO has no "agent seat status" concept of its own: idle -> Gain, working ->
  Warning, problem -> Breaking (previously plain green/amber/red hex values with no source of
  truth). Fonts (Space Grotesk for chrome/numerals, IBM Plex Sans for body) copied from SMO's own
  `Assets/Fonts/` (both Google Fonts under OFL, safe to reuse - OFL.txt copied alongside each into
  `src/fonts/`) and wired via `@font-face`. Deliberately did NOT adopt SMO's third face, Hanken
  Grotesk (a named hero-title tier used at exactly 2 call sites in SMO, by SMO's own "never an
  inheritance" rule) - this app has no equivalent single hero-headline surface to justify one.
  `src/styles.css`'s header comment names `ScreenBuilderUtils.cs` as the resync source if SMO's
  palette changes again.
- 2026-09-09 - The author wants cnc-harness open source. No LICENSE file exists yet in this repo -
  named here as an open item, not resolved: license choice (MIT/Apache-2.0 are the likely
  candidates for a project selling a packaged build while keeping source free) is a real decision
  with consequences (e.g. Apache-2.0's patent grant vs. MIT's simplicity) and hasn't been made.
- 2026-09-09 - Task-echo on submit ("> task text" in the tile's output slot) is deliberately
  transient, not a persistent transcript: it renders in the same single-line/line-clamped output
  slot the seat's own next `seat.output`/`seat.idle` event will immediately overwrite. A real
  append-only transcript would mean restructuring the output model from "shows the last event's
  text" to a log the UI renders incrementally - more than this pass needs; PLAN.md doesn't specify
  either way, so the smaller change was made and is named here rather than silently assumed.
- 2026-09-09 - Provider `<select>`/model-id input for `cnc`/`advisor` are disabled while that
  seat's status is `"working"`, same as its task input/Send - PLAN.md only says to disable "the
  input+button", but swapping a seat's provider mid-turn (with in-memory chat history keyed to the
  old provider) is confusing enough that the same rule was extended to cover it.
- 2026-09-09 - The model-id field sends `{cmd:'configure', ...}` on blur/Enter, not per keystroke -
  a free-text field firing a WebSocket command on every character would spam the orchestrator with
  intermediate, invalid model ids while the operator is still typing.
- 2026-09-09 - The "chat only - no file access" badge (PLAN.md's second 2026-09-09 addendum) was
  built for the `cnc` tile only, not `advisor`'s - `advisor` is messages-api in every provider
  configuration and its capability never changes when its provider changes, so disclosing a mode
  switch there would be disclosing something that isn't true.
- 2026-09-09 - Verification of this UI pass was real but partial: `npx tsc --noEmit` is clean, and
  the new WebSocket protocol (`start`/`stop`/`configure`) was exercised for real against both a
  freshly spawned orchestrator and the orchestrator sidecar actually backing an already-running
  `npm run tauri dev` window (found via its bound port). What was *not* verified is the visual
  render itself - ImageMagick's `import` errored on its own arguments in this sandbox
  (`import: missing an image filename` even when one was given), and no other capture tool
  (Xvfb/wmctrl/xdotool/grim/gnome-screenshot) was present, so no screenshot of the actual tiles,
  layout, or badge exists. Named here rather than implied by the protocol-level test passing.
- 2026-09-09 - License resolved: Apache-2.0, not MIT. `LICENSE` added; `package.json` and
  `src-tauri/Cargo.toml` both carry a matching `"license": "Apache-2.0"` field. Reasoning: this
  project wraps and calls multiple third-party AI providers' APIs (Anthropic, OpenAI, Google,
  Mistral, DeepSeek, Groq, Cohere, OpenRouter, Together, Z.ai) and ships a paid packaged build
  alongside the free source - Apache-2.0's explicit patent grant plus its patent-litigation
  retaliation clause (§3: sue over patents, lose the license) gives real protection here that MIT
  is silent on, and it's the standard choice for the "free source, paid packaged/hosted build"
  commercial pattern this project follows. Note for the record, not a reversal: relay
  (`~/Projects/relay`, this project's own dependency) is MIT per its `package.json` - that's fine,
  it's a separate repo consumed via `RELAY_PATH`/CLI spawn, not code merged into this one, so the
  two projects are free to pick different licenses. Quick embarrassing-secrets pass done alongside
  this (grepped for API keys/tokens/passwords, hardcoded emails, and `/home/user` paths across
  tracked source): clean. No secrets or personal paths beyond the one already-known, already-
  documented dev-machine-only absolute path in `src-tauri/src/lib.rs` (`CARGO_MANIFEST_DIR`,
  build-time, accepted limitation - see the "spawned as a plain child process" entry above). Minor,
  non-blocking: `README.md` is still the stock `npm create tauri-app` template text, not
  project-specific - worth a pass before the repo goes public, not a security issue (resolved same
  day - see the naming-rename entry above, `README.md` now has real content).
- 2026-09-09 - Ran the packaging/installer question through the actual relay harness, per Muad's
  explicit instruction ("run it through the harness"), mirroring exactly how the original
  `PLAN.md` was produced - not a shortcut, the real thing. Task written to
  `~/Projects/relay/tasks/sophi-a-packaging-plan.md` (deliberately front-loaded the mobile
  subprocess-sandboxing wall and the BYOK/unmodified-CLI legal constraint into the task itself, so
  the panel would be forced to confront them rather than produce a naively-uniform four-platform
  plan). Chain: `plan-debate` (5 real labs debate, blind panel, up to 3 revision rounds) - picked
  over the cheaper `plan-cheap`/`verify` chains because this is genuine new architecture (mobile
  subprocess constraints, signing trade-offs) worth real cross-lab debate, and over the heavier
  `idea-open-c2`/`plan-debate-open-c2` (open-scope, 6-lab) chains because this is a bounded slice
  of an existing product, not a genuinely new idea. Dry-run priced worst-case at $2.01; actual run
  (`2026-09-09T02-29-54-628Z`) converged in round 1 - every lab signed off on the first draft, no
  revision needed - for $0.34. Result: `PLAN_PACKAGING.md`/`HANDOFF_PACKAGING.md`/
  `BOARD_PACKAGING.md`, same shape as the original plan triplet. Headline decisions: Windows first
  (NSIS, unsigned v1, no auto-update), Linux second (AppImage only, not deb - a real debate-round
  reversal after four of five labs objected to an initial deb proposal), Android and iOS both
  explicitly out of scope for v1 with independent reasoning per platform (not a combined "mobile is
  hard" hand-wave) - see PLAN_PACKAGING.md §3/§3.1. Not yet built; HANDOFF_PACKAGING.md is the next
  session's starting point.
- 2026-09-09 - Stripe payment link created (Muad's own dashboard click, per the standing rule).
  Real settled price: **€20**, not `SHOP.md`'s $29 recommendation - a real, deliberate call, not
  drift; matches `sower-industries.de/plan`'s own €20 price and this same conversation's earlier
  "we cannot afford" pushback on higher numbers. `SHOP.md` updated to record €20 as settled while
  keeping the original $29 pricing-math reasoning intact (not rewritten to retrofit €20 - the math
  was real reasoning at the time, just anchored to a number the author didn't ultimately pick).
- 2026-09-09 - Built `HANDOFF_PACKAGING.md` item 1 (PLAN_PACKAGING.md §2.1, the runtime
  path-resolution chain), same session, no gap - see PROGRESS.md's "why not now" note.
  `src-tauri/src/lib.rs` rewritten: `resolve()` implements the four-step chain (env var ->
  persisted JSON at `<app_config_dir>/resolved-paths.json` -> `app.path().resource_dir()` ->
  RELAY_PATH-only picker via `tauri-plugin-dialog`'s `blocking_pick_folder()`), with a
  `cfg!(debug_assertions)`-gated dev fallback to the old CARGO_MANIFEST_DIR-relative paths so
  `npm run tauri dev` needs no setup - that fallback is compiled out of release builds entirely,
  so it can never be the silent culprit AT-1 checks for. Added `tauri-plugin-dialog` (only Rust
  dependency needed; the picker is invoked from `setup()`, not through JS, so no capability grant
  was needed). The resolved `RELAY_PATH` is passed to the spawned orchestrator via `Command::env`,
  replacing its own independent `../relay`-relative default.
  **Tested for real, three of the four steps, live**: (1) env var - set
  `SOPHIA_ORCHESTRATOR_PATH`, relaunched, log confirmed it won over the dev fallback; (2) persisted
  path - hand-edited `resolved-paths.json` to point at a copy of the orchestrator in `/tmp`,
  relaunched, log confirmed it won and the process actually spawned from there (see next
  paragraph for what that surfaced); (3) dev fallback - confirmed multiple times across every test,
  including a plain "nothing else set" baseline before and after. Step 4 (the picker) was not
  interactively exercised - `blocking_pick_folder()` needs a real display, this sandbox is
  headless, and the only way to force the picker to fire here would be making the dev-fallback
  relay checkout at `~/Projects/relay` temporarily unavailable, which risks disrupting other
  concurrent work in this workspace. Code-complete and compiles; named as unverified rather than
  claimed.
  **A real finding from the persisted-path test**: pointing the resolver at a bare copy of
  `src/orchestrator/` (source files only, no `node_modules`) failed with `ERR_MODULE_NOT_FOUND:
  'ws'` - not a resolver bug (it correctly found and spawned from the copy), but a genuine
  packaging requirement PLAN_PACKAGING.md's §2.1/§2.4 didn't spell out: whatever gets bundled into
  Tauri's `bundle.resources` for the orchestrator must include its resolved `node_modules` (or be
  pre-bundled into one file, e.g. via esbuild/ncc) - a bare copy of the source directory is not
  enough. Worth doing explicitly as part of HANDOFF_PACKAGING.md item 2/3, not assumed.
  All test artifacts (the `/tmp` orchestrator copy, the temporarily-edited persisted-paths.json,
  stray dev-server instances) were cleaned up after; `resolved-paths.json` is back to
  `{orchestrator: null, node: null, relay: null}` and a plain `npm run tauri dev` was re-verified
  clean as the last step.
- 2026-09-09 - Noticed mid-session, unprompted: another concurrent process/session is actively
  using this exact repo right now - `brand/BRAND.md` and a full icon regeneration landed on disk
  without this session writing them (real, high-quality visual-identity work, consistent with the
  naming/SMO-palette decisions already recorded here; not reverted, per this workspace's own "take
  it as current state" convention), and `ps` shows a live `node .../relay/src/cli.js --resume
  runs/2026-09-09T02-53-53-017Z` process plus a live `vite`/orchestrator pair that this session did
  not start. Read as: Sophi-A (or another session) is being genuinely dogfooded concurrently while
  this session builds the packaging pipeline - exactly the multi-seat premise the product is built
  on. Consequence: stopped killing `cnc-harness`-related processes indiscriminately partway through
  this session once this became clear, to avoid disrupting that live activity; one `cargo check`
  hit a real "Text file busy" error trying to overwrite `target/debug/node/node` while a
  concurrently-running orchestrator instance had that exact file open - not a bug in the code
  written this session, a resource-contention artifact from two things building/running against
  the same `target/debug` directory at once. Left as-is rather than force-killing the other
  session's process to make a redundant check pass (the same resolver logic was already verified
  clean earlier in this same session, before the concurrent activity ramped up).
- 2026-09-09 - Built `HANDOFF_PACKAGING.md` items 2-4 (PLAN_PACKAGING.md §2.2-§2.4) same session.
  `package.json`: added `esbuild` (devDependency) and `package:orchestrator`
  (bundles `src/orchestrator/index.js` into one self-contained ESM file via esbuild, inlining `ws`
  - resolves the `node_modules` gap named above - then copies `seats.json` alongside; verified for
  real by running the bundled output completely standalone in an empty `/tmp` directory with zero
  `node_modules`, confirmed it binds and prints `PORT:<n>`). `scripts/fetch-node-runtime.sh`: pins
  Node 22.23.2, hardcodes its real linux-x64/win-x64 SHA-256 hashes (read once from
  nodejs.org's own SHASUMS256.txt, not re-fetched and trusted at run time - that would defeat
  pinning), verifies before extracting; run for real for linux-x64, binary confirmed executable
  (`--version` prints `v22.23.2`). `tauri.conf.json`: `bundle.targets` narrowed from `"all"` to
  `["nsis", "appimage"]` (no deb/rpm/msi/dmg - macOS was never in scope for this plan either, only
  Windows/Linux/Android/iOS per the original ask), `windows.nsis.installMode: "currentUser"`, and
  `beforeBuildCommand` extended to also run `package:orchestrator`. Per-platform resource mappings
  split into new `tauri.linux.conf.json`/`tauri.windows.conf.json` (each maps the bundled
  orchestrator to `orchestrator/` and its platform's `dist-node/<target>` to `node/` in the
  resource dir) rather than relying on unclear merge semantics for a shared `resources` key.
  `.gitignore` updated - `dist-orchestrator`/`dist-node` are regenerated build output, never
  committed (the Node runtime alone is 50-100MB/platform). `docs/signing-decision.md` and
  `docs/linux-packaging-decision.md` written per §6's requirement that these trade-offs be named,
  not silently assumed. `.github/workflows/release.yml` written: tag-triggered, a Linux job
  (installs `libfuse2` explicitly - Ubuntu's GitHub-hosted runner images have dropped it by
  default, a known AppImage-CI gap, not Sophi-A-specific) and a Windows job (fetches the pinned
  win-x64 Node runtime via a PowerShell step, same pinned hash as the local script), both
  uploading to a shared release job. `README.md` gained a "Platform support" section covering the
  Android/iOS scope cut for anyone who doesn't read PLAN_PACKAGING.md directly (item 5).
  **Honestly verified vs. not**: the orchestrator bundling and Node-runtime-fetch-and-verify steps
  were run for real, successfully, in this sandbox. A full `npm run tauri build --bundles
  appimage` was attempted for real and got all the way through a real 2m15s release compile and
  into the actual AppImage bundling step (proving the Rust resource-resolution code and
  `tauri.conf.json` config are structurally sound) before failing on `linuxdeploy` needing
  `libfuse.so.2`, which this sandbox doesn't have and `sudo` can't install non-interactively here -
  see `docs/linux-packaging-decision.md` for the full trace, including the manual
  `--appimage-extract-and-run` workaround that confirmed linuxdeploy itself works fine once that's
  supplied. The Windows NSIS build was never attempted locally at all - there is no Windows machine
  or cross-compilation toolchain in this sandbox; the CI workflow is the first place it will
  actually run, and that hasn't happened yet either (no tag has been pushed). Named as unverified,
  not claimed working.
- 2026-09-09 - Pushed for real: created `github.com/muad-yasin/sophi-a` (private, per Muad's
  explicit correction from an initial public suggestion), pushed two commits, tagged `v0.1.0`.
  CI ran for real: both `build-windows` and `build-linux` **succeeded** on GitHub's actual
  runners - the first time either installer has ever built anywhere. `publish-release` then
  failed with a 403 (default `GITHUB_TOKEN` only grants `contents: read`) - fixed by adding an
  explicit `permissions: contents: write` to that job and pushed; the v0.1.0 release itself was
  created by hand from the two real artifacts already produced (downloaded via `gh run download`,
  attached via `gh release create`), not re-built. Real Windows NSIS installer and Linux
  AppImage now exist as actual files, for the first time.
- 2026-09-09 - Built the onboarding/first-run setup panel (the monetization research's original
  "no onboarding exists" gap, still open until now). New Rust commands: `list_api_key_providers`
  (returns which providers have a saved key - never the key value itself, by design),
  `set_api_key` (validates against the same provider allow-list `providers.js` defines, persists
  to a new `<app_config_dir>/api-keys.json` - deliberately separate from `resolved-paths.json`,
  which PLAN_PACKAGING.md §2.1 is explicit holds filesystem paths only, never secrets),
  `check_claude_cli` (`claude --version`, an existence/version check, not a real auth probe - an
  actual auth check would mean spending a real Claude Code turn just to say hello), and
  `restart_orchestrator` (kills and respawns the orchestrator child so a newly-saved key takes
  effect without quitting the whole app - the frontend's existing WebSocket reconnect-with-backoff
  handles the resulting disconnect automatically, no new signal needed). `spawn_orchestrator` now
  passes every saved key through as the exact env var name relay's own `providers.js` expects
  (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) - `messagesApi.js`'s existing `loadRelayEnv()`
  only fills a var if unset, so a key entered here always wins over a sibling relay checkout's
  own `.env`. Frontend: an always-visible "Setup" button (independent of WebSocket connection
  state, since key entry is a plain Tauri invoke, not a seat command) opens a panel listing all
  10 providers with a masked input, a per-provider "set/not set" badge, and the CLI check button.
  Included `anthropic` in the key list, not just the 9 alternates - a real thing this pass
  clarified: `advisor` always calls relay's `messages-api` path regardless of provider choice,
  which means it needs `ANTHROPIC_API_KEY` even in the fully-default configuration (`cnc`'s
  default Claude-Code-subprocess path uses the `claude` CLI's own login instead, no key needed
  there).
  **Verified vs. not**: `npx tsc --noEmit` clean; `cargo check` clean (run against an isolated
  `CARGO_TARGET_DIR` specifically to avoid touching the shared `target/debug` directory a
  concurrent session's own running orchestrator instance had open - hit a real `Text file busy`
  there earlier this session, see the "noticed mid-session" entry above). `claude --version`
  confirmed working standalone on this machine. The full live setup panel (open panel, save a
  key, see the badge flip, restart) was **not** exercised end-to-end in the real app - Vite's dev
  port (1420, `strictPort: true`) was already held by that same concurrent session's dev server,
  and forcing a competing instance or editing shared config to dodge it risked disrupting live
  work happening in parallel. The JSON persistence code is the same read/serde/write shape already
  proven live earlier this session for `resolved-paths.json`, which is why this was judged an
  acceptable, named gap rather than a blocking one - but it is a real gap, not a checked box.
- 2026-09-09 - Tested the actual `v0.1.0` release artifacts (downloaded via `gh release
  download`, not rebuilt) - the strongest verification available without a real separate clean
  VM. **Linux AppImage: a real success**, and a meaningfully closer approximation of AT-4 than
  anything earlier this session. Extracted it (`--appimage-extract`, same FUSE-less workaround as
  before) and ran its `AppRun` directly with an isolated `XDG_CONFIG_HOME` (simulating a machine
  that has never run Sophi-A - no persisted-paths.json to short-circuit resolution). Confirmed
  from the logs: the orchestrator entry and the Node runtime both resolved via
  `app.path().resource_dir()` pointing at paths *inside the AppImage itself*
  (`.../squashfs-root/usr/lib/Sophi-A/orchestrator/index.js`,
  `.../squashfs-root/usr/lib/Sophi-A/node/node`) - not a dev fallback, not a stale persisted path,
  the real packaged-resource mechanism. With `SOPHIA_RELAY_PATH` set (bypassing the interactive
  picker, which needs a real display to dismiss), the orchestrator child actually spawned from
  the bundled Node binary running the bundled orchestrator file, bound a real WebSocket port, and
  answered the real seat-replay protocol correctly (`seat.idle` for all 8 seats, verified with a
  direct `ws` client). The only failure was Tauri's own window creation
  (`Could not create default EGL display: EGL_BAD_PARAMETER`) - a headless-sandbox GPU/display
  limitation, not a Sophi-A defect; irrelevant to what AT-4 is actually checking (path resolution
  and the orchestrator working from a foreign machine), which is now about as verified as this
  sandbox allows. (An earlier attempt without the isolated `XDG_CONFIG_HOME` correctly picked up
  *this machine's own* leftover dev-mode persisted state - not a bug, exactly the persisted-path
  precedence step working as designed, but a reminder that this machine isn't genuinely clean and
  the isolated-config version is the one that actually approximates AT-4.)
  **Windows NSIS under Wine: attempted, abandoned, not a finding either way.** `wine
  Sophi-A_0.1.0_x64-setup.exe /S` was run for real, but Wine's own one-time prefix bootstrap
  (`wineboot`/`rundll32 setupapi`) never finished after 8+ minutes at ~98% CPU in this sandbox -
  plausibly a resource-constrained-sandbox problem with Wine itself, not with the installer,
  since the installer was never actually reached. Killed and cleaned up (`~/.wine` removed)
  rather than let it run indefinitely. AT-1/AT-2/AT-3 remain genuinely untested; a real Windows
  VM is still the only way to check them.
- 2026-09-09 - Built `src/mcp/server.js`, the MCP introspection CLAUDE.md's "what's next" named
  since the first build session. Mirrors relay's own `src/mcp/server.js` pattern (`McpServer` +
  `StdioServerTransport`, tools mirroring the underlying protocol) but drives a *running*
  orchestrator over its existing WebSocket rather than shelling out to a CLI - the orchestrator
  has none of its own. Discovers the orchestrator's ephemeral port via a new well-known file
  (`os.tmpdir()/sophia-orchestrator-port`) that `src/orchestrator/index.js` now writes alongside
  its existing `PORT:<n>` stdout line, watched with `fs.watchFile` so a freshly-(re)started
  orchestrator gets picked up without restarting the MCP server itself. Maintains one persistent
  WS connection and an in-memory per-seat cache (status + last output), updated as events arrive,
  so tool calls answer instantly from cache rather than opening a fresh connection and racing the
  on-connect status replay. Six tools: `list_seats`, `get_seat`, `start_seat`, `stop_seat`,
  `configure_seat`, `wait_for_idle`. Added `@modelcontextprotocol/sdk` and `zod` as dependencies,
  matching relay's own versions.
  **Tested for real, found and fixed a genuine bug in the process**: spun up a standalone
  orchestrator, then drove `src/mcp/server.js` through an actual MCP client
  (`@modelcontextprotocol/sdk`'s own `Client`/`StdioClientTransport`, not a hand-rolled
  approximation) - confirmed `list_seats`/`get_seat` answer correctly from the port-file-discovery
  connection. Calling `start_seat` then immediately `wait_for_idle` for a real `advisor` call
  (real Anthropic API round trip) surfaced a real race: the first version of `wait_for_idle`
  checked "is this seat currently not-working" without first confirming it had actually started -
  called right after `start_seat`, before the seat's own `seat.working` event had arrived, it
  would see the seat's pre-existing idle state and report the just-requested task as already
  finished (with stale/null output). Fixed by requiring `wait_for_idle` to observe either a
  working transition first, or an event timestamped after the tool call began, before trusting a
  "not working" reading. Re-tested after the fix: three consecutive real runs (a raw-WS check, a
  polling-`get_seat` check, and the original `start_seat`+`wait_for_idle` sequence that surfaced
  the bug) all correctly captured the real reply text (`"mcp-advisor-ok"`/`"mcp-advisor-ok-2"`).
  All test artifacts (throwaway client scripts, the standalone orchestrator process, its port
  file) cleaned up after - confirmed the concurrent session's own orchestrator/vite instances
  were untouched throughout (different process, matched by absolute vs. relative path in `ps`,
  checked explicitly before and after).
- 2026-09-09 - Built `HANDOFF_PARALLEL_BUILD.md` item 1 (PLAN_PARALLEL_BUILD.md §3): the fan-out
  dispatch + cost gate. One real, deliberate deviation from the plan's literal wording, logged
  per HANDOFF_PARALLEL_BUILD.md's own rule ("if a decision contradicts or extends the plan, stop
  and flag it"): §3 says "a fused fan-out **Tauri command**," but seat start/stop/configure in
  this codebase were never Tauri commands at all - they're WebSocket messages the frontend sends
  directly to the orchestrator (Rust never sees them). The relay panel that designed this had no
  visibility into that distinction and defaulted to "Tauri command" by analogy with the
  onboarding feature's real Rust commands. Implemented instead as a new WebSocket command,
  `start_many` (`src/orchestrator/index.js`), sitting exactly where `start`/`stop`/`configure`
  already do - this is the architecturally consistent choice, not a shortcut: the orchestrator
  already owns seat dispatch and validation, and routing through Rust would have meant Rust
  opening its own WebSocket connection back into the orchestrator for no reason. The
  backend-enforcement requirement itself (§3's real point - "not just a UI courtesy") is honored
  exactly: `startMany()` rejects any call with `seatIds.length > 1 && confirmed !== true`, or any
  non-builder seat id, before any subprocess exists.
  Frontend: build-1's task-form is special-cased (every other seat's form is untouched) - a
  checkbox row (`also run on build-2/3`), non-sticky (reset on both confirm and cancel, per §3),
  a custom cost-confirm modal (not a native `confirm()`, to stay visually consistent with the
  rest of the app - `#cost-confirm-modal`, styled with the same SMO-sourced tokens, a new `--scrim`
  variable added from `ScreenBuilderUtils.cs`'s real value rather than an ad-hoc rgba). No
  boxes ticked -> the exact original single-seat `{cmd:'start'}` path, byte-for-byte unchanged.
  **Tested for real** against a standalone orchestrator with real WebSocket messages (not a
  hand-rolled approximation): confirmed a 2-seat dispatch with `confirmed:false` is rejected (no
  `seat.start` events at all); a mixed builder+non-builder seat list is rejected; a single-seat
  `start_many` with `confirmed:false` is correctly *allowed* (the gate only applies at 2+ seats);
  and a real 2-seat dispatch with `confirmed:true` correctly spawned two real `claude` CLI
  subprocesses (`seat.start` fired for both `build-1` and `build-2`, `build-1` progressed to a
  real `seat.working`/`seat.output`). A real, incidental finding, not a bug introduced by this
  change: `.workdirs/build-1`/`build-2` are fixed repo-relative paths, not per-orchestrator-
  instance, so a standalone test orchestrator and the concurrent session's real running instance
  briefly shared the same builder working directories during this test - harmless here (the test
  tasks were trivial, no file edits resulted, confirmed via `git status`/directory listing after),
  but worth knowing: running two orchestrator instances against the same checkout is not safe if
  both use the same builder seat at the same time. Pre-existing architectural fact, not introduced
  by this session's changes, and out of scope to fix as part of this feature.
- 2026-09-09 - Built `HANDOFF_PARALLEL_BUILD.md` item 2 (PLAN_PARALLEL_BUILD.md §4): the
  dispatch-time snapshot manifest. New `src/orchestrator/compareSnapshot.js`:
  `writeCompareSnapshot(workdir)` walks the workdir recursively and writes
  `<workdir>/.compare-snapshot.json` (`{takenAt, files: {relativePath: {mtimeMs, sha256}}}`);
  `readCompareSnapshot(workdir)` reads it back (unused until item 3's UI, added now since it's
  the natural pair). Wired into `startMany()`: only taken when `unique.length > 1` (a real
  comparison run) - an ordinary single-builder dispatch never writes one, matching the
  single-builder-path-untouched theme running through this whole feature. Handles a builder
  that has never run before (its workdir doesn't exist yet): `writeCompareSnapshot` creates the
  directory itself rather than assuming `claudeCodeSubprocess.js`'s own lazy `workdirFor()` has
  already run first - order-of-operations matters here since the snapshot is taken *before* the
  seat spawns.
  **Tested for real** against a standalone orchestrator: a 2-builder dispatch where `build-1` had
  a real pre-existing file and `build-3` had never been used before (no workdir on disk at all) -
  confirmed `build-1`'s manifest correctly captured that file's real mtime/sha256, `build-3`'s
  workdir was created and got a manifest with an empty `files: {}`, and a subsequent single-seat
  `start_many` call (the gate-bypass path) correctly wrote **no** manifest at all.
  **Found and fixed a real gap along the way, incidental to this feature but a genuine repo-
  hygiene issue**: `.workdirs/` (real Claude Code session output, `build-1..3`'s working
  directories) was untracked *and unignored* - `git status` showed it as a plain untracked
  directory, meaning a future `git add -A` could sweep a builder's real file edits into a commit.
  Confirmed via `git log --all -- .workdirs` that nothing from it was ever actually committed
  historically, then added it to `.gitignore` so it can't happen going forward.
- 2026-09-09 - Critical read of `docs/market-positioning.md` (written earlier today from a
  sower-industries session) against this repo's actual code, documentation-only pass. Four
  findings, three corrected in place, one deliberately left open:
  (1) **The differentiator claim is real but was overstated.** The mechanism exists and is not
  aspirational - `src/orchestrator/adapters/relayChainSubprocess.js` spawns `node <relay>/src/
  cli.js --chain <chain>` for real and polls `report.json`, exactly as PLAN.md's first addendum
  and BOARD.md describe. But `seats.json` gives `plan-1..3` the `plan-cheap` chain, and there is
  no per-task chain override in the WebSocket `start` command (`index.js` reads only
  `seatConfig.default_chain`). `relay/chains/plan-cheap.json` is one Anthropic Sonnet 5 builder
  drafting, five critic seats from other labs (Qwen, GLM, Cohere, Gemini, Llama) grading blind,
  Sonnet revising - real cross-lab adversarial critique, but *one* proposer. "Multiple labs
  independently proposing" describes relay's `plan-debate` chain (real; it produced
  PLAN_PACKAGING.md and PLAN_PARALLEL_BUILD.md), not the seat default. "Seven labs" is wrong in
  either chain: six (Anthropic plus five), matching BOARD.md. Corrected in market-positioning.md
  with a precision note rather than a silent rewrite; `CLAUDE.md`'s pitch paragraph and
  `README.md`'s description rewritten to state the differentiator as what the code does
  (one drafts, five other labs grade blind, sign-off or a named refusal, before any build seat
  runs) instead of the structural "eight seats" framing that reads as a Conductor/Nimbalyst
  clone.
  (2) **The MCP-server claim was technically wrong, corrected in place.** market-positioning.md
  said `src/mcp/server.js` "exposes seat status/output over a WebSocket." Read the file: it is a
  `StdioServerTransport` MCP server that is itself a WebSocket *client* to the loopback
  orchestrator (`ws://127.0.0.1:<port>` from `os.tmpdir()/sophia-orchestrator-port`). It exposes
  nothing a browser or phone could connect to. The reusable seam for any remote-monitoring
  feature is the orchestrator's own WS protocol, which PLAN_PACKAGING.md §3 already names as
  loopback-only and needing an authenticated non-loopback listener first. Struck through and
  corrected in the doc, original wording kept visible.
  (3) **Feature idea 4 (inline diff review) checked: genuinely missing.** `src/main.ts` contains
  no diff view; `compareSnapshot.js` is a mtime/sha256 manifest, not a renderer. Noted in the doc.
  (4) **macOS: an unreconciled scope claim, left for Muad, not resolved here.** The doc's
  "Standing direction" says the macOS gap should be closed before marketing and cites "the
  harness-prompt draft for a macOS packaging/notarization plan, discussed the same session." No
  such draft exists anywhere findable: searched this repo, `~/Projects/sower-industries`,
  `~/Projects/relay` (incl. `tasks/`), `~/Projects/Ideas.md`, `~/Projects/FOCUS.md`, by filename
  (`*harness-prompt*`, `*macos*`, `*prompt*`) and content (`harness-prompt`, `notariz`). The only
  macOS-notarization text in the whole workspace belongs to `~/Projects/parztream` (a separate
  product with its own `packaging/macos/` and CI) - plausibly what the positioning session had
  in mind, but it is not a Sophi-A plan. Meanwhile every concrete artifact says the opposite:
  PLAN_PACKAGING.md scopes Windows+Linux only and never names macOS (the "no dmg" entry above
  records that explicitly), and both the live shop page (`sower-industries/Docs/
  SophiAShop_Page.md`) and this repo's `docs/fulfillment-mails.md` tell buyers "no macOS build
  exists yet." So either the draft lives somewhere outside `~/Projects` (a chat transcript, an
  unsaved session), or the positioning doc asserted a commitment nothing else records. Either
  way, whether macOS is a precondition for marketing Sophi-A is a real product decision with a
  cost (Apple Developer Program, notarization CI, a Mac runner) that only Muad can make -
  annotated in market-positioning.md and named here; PLAN_PACKAGING.md's scope deliberately not
  touched.
- 2026-09-09 - Built `HANDOFF_PARALLEL_BUILD.md` item 3 (PLAN_PARALLEL_BUILD.md §4): the
  comparison UI. Real, logged extension of item 2's original design: a hash-only manifest can
  prove a file changed but can't show *what* changed - there's no "before" text to diff against.
  `compareSnapshot.js`'s `writeCompareSnapshot` now also copies every tracked file's dispatch-
  time content into `<workdir>/.compare-snapshot/` (mirroring the workdir's relative paths),
  alongside the original `.compare-snapshot.json` hash index. Added the `diff` npm package
  (small, standard, MIT) for `structuredPatch` - real line-level unified-diff hunks, not a
  hand-rolled algorithm.
  New pure functions: `changedSinceSnapshot(workdir)` (added/modified/deleted since dispatch,
  hash-compared, never git - A1), `diffAgainstSnapshot(workdir, path)` (a real structured patch
  against the preserved snapshot content), `currentFileHash(workdir, path)` (for the cross-
  builder badge). New in-memory `compareGroups` Map in `index.js` (seatId -> the other seat ids
  it was last dispatched with via `startMany`) - not persisted, not item 4's run-record, just
  enough to compute §4's "same"/"differs" badge by comparing current hashes across whichever
  seats were actually part of the same fan-out. Two new read-only WS commands,
  `inspect_changes`/`get_diff`, replying directly on the requesting `ws` rather than
  `broadcast()` - this is per-client query data, not seat state every connected client needs
  pushed to it, a genuinely different shape than the existing `seat.*` event vocabulary.
  Frontend: every builder tile (not just build-1) gets an "Inspect changes" toggle - a file list
  with added/modified/deleted + same/differs/unique badges, and a click-to-diff pane rendering
  real hunks with +/- line coloring.
  **Cut, deliberately, matching PLAN_PARALLEL_BUILD.md §7's own explicit allowance**:
  builder-vs-builder direct diff mode (diffing build-1's result against build-2's result
  directly, rather than each against its own dispatch-time snapshot) - the plan names this as
  the one item allowed to slip without re-scoping the rest if not trivial, and it wasn't: it
  would need a second patch-computation path keyed by relative path across two arbitrary
  workdirs rather than one workdir against its own snapshot. Same/differs still works without it
  (computed from live hashes, not from a cross-diff render) - only the actual side-by-side diff
  render for that specific comparison is deferred.
  **Tested for real** against a standalone orchestrator, including the scenario the badge logic
  exists for: two builders started on the same task, one file edited identically in both
  (correctly badged "same"), then edited differently in one (correctly flips to "differs" on the
  next query), plus a file only one builder touched (correctly "unique"), plus a real generated
  diff for both a modified and a newly-added file, plus a rejected path-traversal attempt
  (`../../etc/passwd`).
- 2026-09-09 - Built `HANDOFF_PARALLEL_BUILD.md` item 4 (PLAN_PARALLEL_BUILD.md §5): pick +
  disposition. Run records live at the repo's own `.workdirs/.compare/<taskId>.json` (already
  gitignored - it's under `.workdirs`), not inside any one builder's own workdir, so picking a
  winner never touches the thing being judged. `taskId` is generated once per multi-seat
  dispatch (`startMany`'s own `Date.now()`), and `compareGroups` (item 3's in-memory tracking)
  was extended to carry `{siblings, taskId, task}` instead of just `siblings`, so a pick can name
  exactly which task and which other seats were part of the same comparison run.
  Two new mutating WS commands (`select_winner`, `delete_workdir`) both require an explicit
  `humanClick: true` flag, rejected server-side if absent or false - PLAN_PARALLEL_BUILD.md §5 is
  explicit this must be enforced, not a UI courtesy. **Updated 2026-09-09** (`docs/security-
  prompt-injection.md`'s P0 fix): this entry used to say the flag was "defense-in-depth against
  nothing that can reach this code path right now," honestly, because any caller could set
  `humanClick: true` itself and the WebSocket had no real access control at all. It now sits
  behind a real one - a random per-launch token the connection handler requires before any
  command is dispatched (`src/orchestrator/index.js`'s `AUTH_TOKEN`/`main()`) - so `humanClick` is
  a genuine audit field layered on a real check, not a stand-in for one. `select_winner` broadcasts
  `compare.pick` (unlike item 3's query commands,
  this is shared state - every participating tile's badge needs to update, not just the
  requester's). One new read-only query, `list_compare_runs`, for the run-history strip.
  **Disposition matches §5 exactly**: `delete_workdir` is the *only* code path that removes a
  workdir, and only on an explicit human click - nothing in `select_winner`, `startMany`, or
  anywhere else moves, renames, or auto-deletes a builder's output, ever.
  Frontend: a "Winner"/"Retained" badge per tile (gold border for Winner, matching Gold's
  reserved "primary action" role in the SMO palette), a "Pick this one"/"Delete workdir" row
  inside each tile's inspect panel (hidden until there's an actual comparison to act on), and a
  compact global "Run history" panel (reusing `.setup-panel`'s box, its own toggle button) - a
  native `window.confirm()` guards the delete click specifically, the one place this pass used a
  browser-native dialog rather than a custom modal, since it's a rare, deliberate, destructive
  action where the standard browser confirmation is honest UI, not worth a bespoke component for.
  **Tested for real** end to end against a standalone orchestrator: dispatched two builders on
  the same task, gave them genuinely different output, inspected changes (correctly "differs"),
  picked build-1 as winner, confirmed the run record via `list_compare_runs`, then deleted
  build-2's (the retained seat's) workdir - build-1's stayed untouched on disk throughout.
- 2026-09-09 - Built `HANDOFF_PARALLEL_BUILD.md` item 5 (PLAN_PARALLEL_BUILD.md §6): advisor's
  non-binding recommendation - the last of the 5 build-order items, parallel-build-and-compare
  is now fully built. `messagesApi.js`'s `startMessagesApiSeat` gained an optional 5th `mode`
  param (`'compare'`), used only by a new `ADVISOR_COMPARE_SYSTEM` prompt and a stateless call
  (never touches advisor's own ongoing `histories` - a one-off aside, not part of whatever
  conversation advisor and the human were already having). `index.js`'s new
  `handleAdvisorRecommend(wss, seatId)` deliberately bypasses the normal `startSeat`/adapter
  dispatch table (this isn't a generic seat command) - it looks up the seat's `compareGroups`
  entry, builds a per-file summary (status + a short current-content preview, not full diffs -
  §6's own token-cost concern) for every participant, and calls `startMessagesApiSeat` directly
  with `mode:'compare'`.
  **A real, reproducible model-behavior finding, isolated by actually bisecting the prompt
  against the live API rather than guessing**: the first working version's system prompt used
  the words "opinion"/"view" ("giving a non-binding opinion on several build attempts") and got
  a genuine `claude-fable-5-1` API refusal (`stop: "refusal"`, empty text) on the *exact* same
  task content that succeeded fine with a neutral system prompt. Bisected word-by-word against
  the real API (not assumed): "You are Fable, a helpful assistant." → succeeds; "You are Fable,
  giving an opinion." → refuses, on the identical task, every time (3/3). Rewording to
  "recommendation"/"suggestion" (no "opinion" or "view" anywhere) fixed it, confirmed twice more
  against the real API before treating it as resolved. Not documented anywhere as intentional
  Anthropic-side behavior; recorded as an observed fact in case it recurs elsewhere in this
  codebase or a future session hits the same wall.
  **A second real finding from the same debugging pass**: the first working version's per-file
  summary was status+path only ("added impl.py"), which reads identically for two builders that
  both *create* a same-named file with completely different content - confirmed live: advisor
  correctly declined to guess rather than fabricate a preference ("both summaries are
  identical... treat this as a coin flip"), an honest response to a genuinely underspecified
  prompt, not a bug in the model. Fixed by adding a short current-content preview (200 chars) per
  changed file, and separately by actually including the original task text in the prompt
  (`compareGroups`'s own `task` field, previously computed but never passed through) - advisor's
  first real recommendation had also flagged this exact gap unprompted ("the task statement isn't
  included"). Both fixes verified against the real API with a task that has a genuinely correct
  answer (ascending vs. descending sort): advisor correctly recommended the matching builder by
  name, with an accurate reason, twice in a row.
  Frontend: an "Ask advisor" button in each builder tile's pick-actions row; the reply surfaces
  through the existing `seat.output`/advisor-tile path, no new rendering code needed - §6 is
  explicit this is commentary only, so it deliberately does not gate or pre-select the Pick
  button in any way.
- 2026-09-09 - Built "surface the debate" - `docs/market-positioning.md`'s headline feature idea,
  the first thing built from that analysis rather than the parallel-build-and-compare backlog.
  Relay's own `report.json` (written by `relay/src/cli.js`) already carries exactly the
  structured data a real "who objected, what got overruled" view needs - `signoff` (per-lab
  provider/model/signedOff), `scoreboard` (proposed/accepted per lab, proposal-based chains
  only), and `lastCritique.failures` (the specific objections behind a non-pass). Previously none
  of this reached the UI structured - only a flattened string, buried in a `seat.problem`'s
  `detail` (`summarizeFailures`). `relayChainSubprocess.js` now also emits a `debate.report`
  event (`{runId, passed, signoff, scoreboard, failures}`) the moment `report.json` appears,
  win or lose - a new event type alongside `seat.*`, following the same "distinct event
  namespace for data every client needs, not a per-client query" reasoning `compare.*` already
  established. Frontend: a "Debate" toggle on each `plan-N` tile (an in-memory cache per seat,
  since a real chain run takes minutes and the panel is very likely closed when the event
  actually arrives) rendering a signoff list (✓/✗/? per lab) and any recorded objections.
  **Tested for real against relay's own free `mock`/`mock-unanimous` chains** (no API cost) by
  calling `startRelayChainSeat` directly: confirmed a real `report.json` produces a correctly-
  shaped `debate.report` event end to end, including the exact `signoff` array shape
  (`{provider, model, signedOff: true}` per lab) `mock-unanimous`'s real unanimous-signoff branch
  produces - the same shape a real paid chain (`plan-cheap`, `plan-debate`) would produce, per
  `relay/src/cli.js`'s own report-writing code, not re-spent real money to re-confirm what the
  source already shows plainly.
- 2026-09-09 - Built cost transparency - `docs/market-positioning.md` feature idea #3, the last
  item of "build all of it, in that order". Chosen approach: reuse relay's own `--dry-run` CLI
  path exactly as-is, not reimplement its pricing math. relay already prices a whole chain run
  from the chain config's own declared token assumptions, without calling any model
  (`relay/src/cli.js`'s `--dry-run` branch; the same thing relay's own MCP server's `dry_run`
  tool does - `execFileSync`, not a re-derivation). A new `src/orchestrator/costEstimate.js`
  spawns `node <relayPath>/src/cli.js --chain <chain> --dry-run` and parses its real stdout table
  (label/seat/input/output/$ per stage, a TOTAL line, an optional "no price on file for" line)
  into structured JSON - deliberately parsing the CLI's real output rather than adding a
  machine-readable flag to relay itself, since this module already promises (in its header
  comment, mirroring `relayChainSubprocess.js`'s existing promise) "does not modify relay in any
  way". A future change to relay's chain configs or `pricing.json` is reflected here for free the
  next time a tile asks - nothing here can drift out of sync with the thing actually pricing a
  run, because nothing here re-derives the price. New WS request/response command
  `estimate_cost` (`{seatId}` -> `{type:'cost.estimate', seatId, chain, rows, total, unpriced}`
  or `{error}`) in `src/orchestrator/index.js` - request/response, not broadcast, same reasoning
  as `inspect_changes`/`get_diff`: a price estimate is only relevant to whichever client asked.
  Scoped to `plan-1..3` only (the only seats with a `default_chain`) - `build-N`'s Claude Code
  subprocesses and `cnc`/`advisor`'s messages-api calls have no relay chain to price and are
  metered differently (subscription seat-minutes / provider API billing respectively), out of
  scope for this feature by construction, not an oversight.
  Frontend: a "Cost" toggle on each `plan-N` tile, next to Debate, following the exact same
  per-seat-cache-so-reopening-renders-instantly pattern `debateCache`/`renderDebatePanel`
  established - except costCache is populated by an explicit `estimate_cost` request the first
  time a tile's Cost panel opens (a chain's own token assumptions don't change task-to-task, and
  there is no runtime chain-swap UI for `plan-N` seats, so one estimate per seat per session is
  correct, not a staleness risk to guard against).
  **Verified for real, twice, against no faked data**: (1) `estimateChainCost` run directly
  against relay's actual `plan-cheap` chain (no `--task` needed for `--dry-run` per relay's own
  CLI, confirmed via `relay/src/cli.js`'s own arg-parsing: `!taskPath && !dryRun && !resumeRun`
  is the only case that prints `--help` and exits) - parsed output matched the real CLI's
  11-row table and $1.75 TOTAL exactly, byte for byte against manually running the same command.
  (2) A standalone orchestrator instance spun up in isolation, sent `{cmd:'estimate_cost',
  seatId:'plan-1'}` over a real WebSocket, and received back the correctly-shaped
  `cost.estimate` event - the full request/response path, not just the parser in isolation.
  `npx tsc --noEmit` and `node --check` both clean. The live Tauri window itself was not
  exercised for this feature (port 1420 is held by a concurrent session's dev server, the same
  constraint noted for every other UI-only feature built this session) - the HTML/CSS/TS were
  hand-verified against the existing, already-shipped Debate panel's exact structure instead.

- 2026-09-10 - Pre-public-release secret audit, ahead of making the repo public. Full `git log
  --all -p` content sweep (not just current-tree grep - going public exposes every commit, so
  history matters as much as HEAD) for known key/token shapes (`sk-ant-`, `sk_live_`/`sk_test_`,
  `AIza...`, `ghp_`/`github_pat_`, `AKIA...`, `xoxb-`, PEM private-key headers) and for generic
  `SOMETHING_KEY=<value>`/`SOMETHING_SECRET=<value>` assignment patterns: zero matches. Every
  `*_API_KEY` occurrence in history is either an env-var *name* (`ANTHROPIC_API_KEY`, etc. -
  `providers.js`'s `PROVIDER_ENV_VARS` list) or prose describing the architecture, never a real
  value. `.env.example` is the only `.env*`-shaped file ever committed, unchanged since its first
  commit (path placeholder only, `RELAY_PATH=../relay`) - confirmed via `git log --follow -p`.
  `api-keys.json`/`resolved-paths.json` (where real secrets actually live, via
  `<app_config_dir>`) were never added by name in any commit. No PEM/certificate material
  anywhere (matches `docs/signing-decision.md`'s "v1 ships unsigned, no certificate configured").
  `.github/workflows/release.yml` uses only the implicit default `GITHUB_TOKEN` via
  `permissions: contents: write`, no other secrets referenced. No personal email addresses
  leaked into `docs/fulfillment-mails.md`/`docs/manual-fulfillment-runbook.md`. `.gitignore`
  hardened with explicit `.env`/`api-keys.json`/`resolved-paths.json`/cert-file rules as a
  backstop, even though no code path in this repo currently writes any of them into the working
  tree (API keys are Tauri `<app_config_dir>`-scoped, outside the repo entirely; relay's own
  `.env` belongs to the separate relay checkout). Conclusion: clean to make public as-is.

- 2026-09-10 - Dependabot alert #1 (GHSA-wrw7-89jp-8q8g / RUSTSEC-2024-0429), surfaced within
  minutes of enabling Dependabot security updates: `glib` 0.18.5 (transitive, via Tauri's Linux
  GTK/webkit2gtk bindings in `src-tauri/Cargo.lock`) has a soundness bug in
  `VariantStrIter::impl_get` (an unsound out-argument pointer, undefined behavior under recent
  rustc optimizations) - medium severity, fixed upstream in glib 0.20.0. **Not fixable directly
  here**: `cargo update -p glib` locks 0 packages - 0.18.5 is already the ceiling every other
  crate in the dependency graph (gtk-sys/webkit2gtk-sys, pulled in by Tauri 2.11.5 itself) allows;
  reaching 0.20.x needs those upstream crates to bump their own `glib` requirement first, not
  something this repo's Cargo.toml can force without either patching a git dependency (fragile,
  its own maintenance burden) or waiting on a Tauri/gtk-rs release. Real-world exposure is narrow:
  Linux-only, desktop-only, triggered only by iterating a GVariant string array - not a path any
  currently-written Sophi-A code exercises directly (Tauri's own internals may, unverified).
  Tracked, not silently dismissed: re-run `cargo update -p glib` after any future `tauri`
  version bump and check whether the ceiling has moved.

- 2026-09-10 - Real mistake, found and fixed live: ran `cargo check` manually against
  `src-tauri/target/debug` while the live `npm run tauri dev` process (the one Muad was actively
  using) was mid-rebuild against the same target directory. Both processes tried to write the
  same binary; Linux refused with `Text file busy` and the live dev process's own rebuild failed
  and exited, killing Muad's window. Not a code bug - a process-hygiene mistake. Relaunched
  `npm run tauri dev` cleanly and confirmed with Muad the window was back before continuing.
  **Rule for future sessions**: never run a manual `cargo build`/`cargo check`/`cargo run`
  against `src-tauri/target` while a `npm run tauri dev` process might be running (check `ps aux`
  first) - use `CARGO_TARGET_DIR=/tmp/<something>` for a manual verification build, or just trust
  the live dev process's own file-watcher rebuild and read its log instead of triggering a second
  parallel build.

- 2026-09-10 - Phase 0 of the long-horizon build plan (relay run 2026-09-10T20-03-03-692Z) ran
  for real: `scripts/verify-assumptions.js`, `docs/phase0-stack-truth.md`. All 6 checks VERIFIED,
  but 2 of the plan's original assumptions were wrong and corrected during the script's own
  authoring rather than shipped to fail on day one: (1) adapters export `start<Name>Seat`
  functions, not a generic `spawn`; (2) `report.json` has no top-level `usage` field - usage is
  per-stage (`stages[].usage`) and aggregated in `totals`, which **Phase 2 Step 2's cost meter
  must read from**, not a flat `report.usage` that doesn't exist. `relay/chains/plan-cheap.json`
  also has no top-level `stages` array (critics live at `seats.critics`), corrected the same way.
  Awaiting the human-approval line in `docs/phase0-stack-truth.md` before Phase 1 starts -
  not typed here, that line is the author's own per the plan's own rule.

## 2026-09-10: Phase 1 Step 1 - preflight.js network-error classification, tested paths

`checkBinary`/`checkEnv` in `src/orchestrator/preflight.js` classify a seat's readiness failure
as `missing_cli` (binary not on PATH), `auth` (env var unset, or a real provider rejection), or
`network` (no reply within the 2s timeout). Verified for real, not just read back from the code:
`ready` (all 8 seats, real keys, real live pings, 5.4s total), `missing_cli` (a synthetic seat
requiring a nonexistent binary - real ENOENT), `auth`/unset (a synthetic seat requiring an unset
env var), `auth`/rejected (a real HTTP 401 from Anthropic's actual API against a deliberately
garbage key). **Not independently verified**: the `network` classification path itself (the
`Promise.race` timeout branch) - simulating a real network blackout safely in this environment
(without touching `/etc/hosts` or another invasive mechanism) wasn't attempted; the mechanism is
a standard `Promise.race` + `setTimeout`, low risk, but this is named honestly as assumed-correct-
by-construction rather than tested, not silently claimed as verified.

Also found and fixed live during this same step: the original `checkEnv` checked
`process.env[envVar]` *before* calling `loadProviders()` - but `loadProviders()` is what actually
loads relay's own `.env` into `process.env` (via `messagesApi.js`'s `loadRelayEnv()`). A key that
only exists in relay's `.env`, never in the orchestrator process's own inherited environment,
would have read as "not set" even though it's real - reordered so the env-loading call happens
first.

Scope limit, deliberate: a `relay-chain-subprocess` seat (`plan-1..3`) only has `requires:
[{type:'env', name:'ANTHROPIC_API_KEY'}]` in `seats.json`, even though `plan-cheap.json`'s real
chain uses six providers total. Checking every critic provider a chain might reach is real added
scope this step's acceptance test doesn't ask for - the seat that drafts/revises (and whose
failure aborts a run immediately) is what's checked.

## 2026-09-10: Phase 1 Step 2 - verification method (Tauri isn't present in a plain browser)

The wizard panel's acceptance test ("a bad key names itself exactly; after fixing it, that seat's
Send enables without restarting the app") was verified against the real code path, not a
DOM-only mockup: `window.__TAURI_INTERNALS__.invoke` and `window.WebSocket` were stubbed in a
real Chrome tab (no Tauri webview available outside the packaged app), then the page was left to
run its own real `connect()` -> auth -> `{cmd:'preflight'}` flow, and a fake `message` event
carried a synthetic `preflight.result` payload into the real `handlePreflightResult` handler.
Confirmed: the panel auto-shows on a failure, each row shows the exact per-seat failing-check
text (not a generic error), only failing seats' Send buttons disable, and re-firing a second
`preflight.result` with everything green re-enables the previously-disabled Send button with no
reload - the literal acceptance test. `formatPreflightDetail` doesn't reproduce the plan's exact
example string ("Anthropic key: 401") verbatim - it renders "Key rejected (HTTP 401)" instead,
extracting the same real information (which check, what code) without hardcoding a provider-name
lookup the frontend doesn't otherwise need. Judged as meeting the acceptance test's real intent,
named here rather than silently claimed as a literal string match.
