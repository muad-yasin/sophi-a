# PLAN_PACKAGING.md — Sophi-A Packaging & Installer Plan

*Produced 2026-09-09 via a real relay `plan-debate` chain run (task `sophi-a-packaging-plan.md`,
run id `2026-09-09T02-29-54-628Z`, $0.34, unanimous panel sign-off in round 1 - no revision
needed). Full debate: `BOARD_PACKAGING.md`. Build-order handoff: `HANDOFF_PACKAGING.md`. This
mirrors exactly how the original `PLAN.md`/`BOARD.md`/`HANDOFF.md` were produced.*

**Status:** proposed, not yet built
**Scope:** Windows, Linux, Android, iOS packaging/installer strategy for the Tauri 2.x desktop app
currently known as `cnc-harness` (product name: Sophi-A)
**Repo shape:** follows the existing `PLAN.md` / `HANDOFF.md` / `BOARD.md` convention - this
document is the packaging-specific `PLAN.md` companion.

---

## 1. Context and hard constraints

Today `npm run tauri build` is not wired up at all - `package.json` only has `dev`/`preview`/
`tauri`. Nothing has ever been packaged, signed, or submitted anywhere. The orchestrator path in
`src-tauri/src/lib.rs` is baked in from `CARGO_MANIFEST_DIR` at compile time, so the only machine
a build has ever run on is the machine that built it.

The runtime shape that packaging must survive:

- Rust shell (Tauri) spawns `node src/orchestrator/index.js` as a child process on startup.
- The orchestrator spawns further subprocesses per tile: the real `claude` CLI binary (`cnc`,
  `build-1..3`), and `node <RELAY_PATH>/src/cli.js` (`plan-1..3`), where `RELAY_PATH` points at a
  sibling git checkout of a second real repo, not an npm package.
- BYOK: users bring their own Claude/API credentials. No key is ever bundled, generated, or
  shipped by us.
- Anthropic's Commercial Terms require the unmodified `claude` CLI, run as published. **This plan
  does not touch, wrap, rebundle, or modify that binary anywhere - it only locates it on the
  user's machine at runtime.**
- Team: solo/small operator (Sower Industries, Berlin), monetizing via a ~$29 one-time Stripe
  purchase, Germany-only launch initially, near-zero budget for signing certs, store fees, or
  dedicated CI.

None of this works on Android or iOS as-is: mobile sandboxes forbid arbitrary subprocess
execution, and neither `node` nor `claude` ship on either OS. This is treated head-on in §5-§6,
not hand-waved.

---

## 2. Architecture reasoning

### 2.1 The path-resolution fix (blocks everything)

**Fix:** Replace the `CARGO_MANIFEST_DIR`-derived path in `src-tauri/src/lib.rs` with a runtime
resolution chain, resolved fresh at app startup on whatever machine the app is running on - never
baked in at compile time.

**Resolution order** (applies separately to the orchestrator entry point, the bundled Node
runtime, and `RELAY_PATH`):

1. **Environment variable override** - `SOPHIA_ORCHESTRATOR_PATH`, `SOPHIA_NODE_PATH`,
   `SOPHIA_RELAY_PATH`. Checked first so a power user or a future CI/test harness can always force
   a path, and so overrides never get shadowed by a bundled resource.
2. **Persisted first-run result** - if a previous run already resolved a path (via picker or
   otherwise), it's stored via `tauri-plugin-store` in the app's config directory and reused
   without re-prompting.
3. **Tauri resource directory** - `app.path().resource_dir()` (Tauri 2.x `PathResolver` API - *not*
   the removed 1.x `tauri::api::path::resource_dir()` free function). The installer places the
   orchestrator bundle and a pinned static Node runtime under this directory, so on a normal
   end-user machine this is the path that actually fires.
4. **File-picker prompt, persisted** - only as a last resort, when 1-3 all fail (e.g. `RELAY_PATH`,
   which is a sibling git checkout the installer cannot itself place). The user is asked once to
   locate the relay checkout; the result is saved via step 2 for all future launches. This is not
   the primary path for a normal user - it exists so `plan-1..3` degrade gracefully to "relay not
   installed" instead of crashing, rather than being the expected first-run experience for the
   orchestrator itself (which is always resource-bundled).

Every resolution attempt is logged at startup with the winning path and which step produced it, so
first-run debugging on a machine the developer has never touched is possible from a
support-requested log dump alone.

The bundled Node runtime is a **pinned Node 22 LTS** static build, fetched and verified by SHA-256
at packaging time, placed under Tauri's `bundle.resources`. This removes the "does the user have
Node installed" variable entirely for the orchestrator and for `plan-1..3`'s
`node <relay>/src/cli.js` spawn - only the `claude` CLI (already installed and authenticated by
the user per BYOK) and the relay checkout itself remain external dependencies, both handled by the
same resolution chain.

**No API keys or secrets are part of this resolver or its config store at any step.** The store
persists filesystem paths only.

### 2.2 Windows

**Installer format: NSIS**, via Tauri's built-in Windows bundler, over MSI. NSIS is picked because
it is scriptable, lightweight, requires no WiX-toolchain ceremony, and Tauri's NSIS path supports
per-user (`installMode: currentUser`) installation with no UAC elevation - appropriate for a $29
indie tool where forcing an admin prompt on first run is pure friction with no benefit. MSI's
advantages (enterprise GPO deployment, Windows Installer service integration) don't matter for
this audience.

Install target: `%LOCALAPPDATA%\Programs\Sophi-A`, `installMode: currentUser`, no elevation. The
orchestrator directory and the pinned Node 22 LTS binary are added to `bundle.resources`.

**Code signing: explicitly deferred for v1.** The installer ships unsigned. `docs/signing-decision.md`
states the named consequence plainly: Windows SmartScreen will show "Windows protected your PC" on
first run, requiring the user to click "More info" -> "Run anyway." This costs some fraction of
first-time users who bail at that dialog - a real cost for a paid product, accepted deliberately
rather than silently. The paid alternative (an OV code-signing certificate, ~$200-$400/year, or EV
at ~$100-$300/year plus a hardware token requirement) is named as a concrete future item once
revenue justifies it, not ruled out forever.

**Auto-update: explicit non-goal for v1.** No `tauri-plugin-updater`, no update server. The NSIS
installer is the only update mechanism; re-running the installer performs an in-place update
(verified in acceptance tests below). Users must manually re-download for new versions. This is a
stated cost, not an oversight: standing up signed update artifacts and an update feed is
meaningfully more infrastructure than a solo operator should carry before there are paying users
to justify it.

### 2.3 Linux

**Package format: AppImage**, as the sole v1 target, over deb and rpm. Reasoning: a solo operator
maintaining a `.deb` (or `.rpm`) means owning a repo, a GPG signing key for that repo, and
dependency declarations that Tauri's Debian bundler doesn't cleanly support for a non-packaged
runtime dependency like a bundled Node binary in the first place. AppImage needs none of that - it
is a single portable executable that runs on Fedora, Arch, Ubuntu, and Debian alike without root
and without a package manager transaction. For a Germany-only $29 launch with no packaging team,
one artifact that covers the whole distro landscape beats a "better on Debian, absent everywhere
else" deb with a second pipeline to maintain. (This resolves a genuine debate in review: an
earlier deb proposal argued a Debian-leaning German audience justified `.deb`; that reasoning
didn't survive contact with Tauri's actual deb dependency-declaration limitations and was
withdrawn by its author in favor of AppImage.)

The same pinned Node 22 LTS binary is bundled inside the AppImage (no system-Node dependency at
all), and the same resolution chain from §2.1 handles the orchestrator and `RELAY_PATH`.

**Code signing: skipped, documented.** AppImage has no equivalent of a trusted-publisher chain the
way Authenticode does; some desktop environments may show an "untrusted application" style warning
or refuse to execute without `chmod +x` + "Allow Launching" via file manager.
`docs/linux-packaging-decision.md` states this plainly. No dollar cost is being avoided here
(AppImage signing tooling exists but buys negligible trust on Linux desktops compared to Windows
SmartScreen reputation systems), so this is a low-stakes deferral, unlike the Windows one.

**Auto-update: non-goal for v1**, same reasoning as Windows - users re-download the AppImage.

### 2.4 CI / build infrastructure

GitHub Actions, free-tier hosted runners (2,000 free minutes/month on a public or eligible private
repo - $0 cost at this project's release cadence). A `.github/workflows/release.yml` triggers on
version tags, builds the NSIS `.exe` and the Linux AppImage, and attaches both to a GitHub
Release. This is named and costed explicitly rather than assumed: $0 today, with the honest
caveat that if release frequency or build time grows past the free-tier minutes, the next cost is
GitHub Actions overage billing (currently ~$0.008/minute for Linux runners), which is worth paying
only once there's revenue to justify it.

---

## 3. Android — confronting constraint 2 directly

Android forbids arbitrary subprocess execution from an installed app's sandbox. There is no way to
spawn `claude` or `node <relay>/src/cli.js` as local child processes on a stock Android device -
this is not a packaging inconvenience to route around, it is an architectural wall.

**Decision for v1: Android is explicitly out of scope**, not "packaged the same way." No APK, no
Play Store listing, no thin client - deferred as a *named future direction*, not silently dropped:

- The only architecture that could plausibly bring Sophi-A to Android is a **thin mobile client
  that talks over the network to an orchestrator running elsewhere** - a desktop instance on the
  user's own machine or a self-hosted box, with the orchestrator's existing WebSocket-style
  transport exposed (loopback-only today; would need to become a properly authenticated,
  non-loopback listener). That is a real architecture change - new auth story, new
  network-exposure surface, new UI mode for "point this at a remote orchestrator" - not a
  recompile.
- This is deferred to a **v2 direction**, not ruled out permanently: it is named here so it isn't
  silently lost, but no work against it is scheduled in this plan.
- Cost of building it now would not be recovered: the launch is Germany-only, one-time $29
  purchase, solo operator - a remote-orchestrator rewrite before the desktop product has any users
  to validate it against is the wrong sequencing.

### 3.1 iOS — a separate, stricter case

iOS is treated independently, not folded into "same as Android," because Apple's constraints are
stricter in a way that changes the answer even if a thin client existed:

- iOS sandboxing forbids dynamic code execution and arbitrary subprocess spawning even more
  absolutely than Android's - there is no side-loading path for mainstream distribution, and no
  "advanced settings toggle" equivalent to Android's ability to at least install unsigned APKs
  out-of-store.
- App Store Review Guideline 2.5.2 explicitly bans apps that download or execute code not embedded
  in the reviewed binary - this would block even a *legitimate* thin client if that client tried
  to dynamically fetch/interpret anything beyond normal app updates, and it categorically blocks
  any residual idea of shipping `node`/`claude` execution on-device.
- Even the Android thin-client v2 direction does **not** carry over cleanly: a remote-orchestrator
  client is architecturally fine on iOS (it's just a network client), but shipping it through the
  App Store means passing 2.5.2 review as a "remote control" app, which is a materially different
  review conversation than a normal utility app and is not something to plan against without
  dedicated legal/review research.
- Named cost of *not* doing this now: the $99/year Apple Developer Program fee is avoided entirely
  for v1, which is the correct call at Germany-only, pre-revenue-validation stage.

**Decision for v1: iOS is explicitly out of scope**, for both the Android-shared technical reason
(no local subprocess execution) and the iOS-specific stricter reason (2.5.2 review risk even for a
thin client). This is not scheduled for a v2 either, unless the desktop product's traction later
justifies the App Store review investment.

---

## 4. Build order

1. **Windows first.**
2. **Linux second.**
3. **Android and iOS: not built in v1** (see §3).

Reasoning tied to the solo-operator/near-zero-budget constraint: Windows is where the largest
share of the target Germany-only paying audience already sits, Tauri's Windows/NSIS path is the
most mature and best-documented of the two viable desktop targets, and getting *one* platform
fully working (path fix, packaging, signing decision, CI) end-to-end first gives a working,
sellable artifact fastest - critical when there is no dedicated QA or release engineering, just
one person's iteration velocity. Linux follows immediately after using the same path-resolution
and Node-bundling mechanism already built for Windows, so the marginal cost of the second platform
is mostly "swap the bundler target," not new architecture. Mobile is ordered last conceptually
only in the sense that it isn't ordered at all for v1 - no partial mobile work is scheduled ahead
of validating the desktop product has buyers.

---

## 5. Named assumptions

- The `claude` CLI is already installed and authenticated by the end user before they run Sophi-A;
  the app never installs, wraps, or modifies it, and never manages its auth.
- `RELAY_PATH` is expected to be a manually-provided sibling checkout for `plan-1..3` seats; a
  missing one degrades those three tiles to a "relay not installed" state rather than crashing the
  app.
- Node 22 LTS is the pinned bundled runtime version across Windows and Linux, fetched and
  SHA-256-verified at build time (not fetched at install/run time from the user's machine).
- Germany-only Stripe launch means no localization, currency, or regional-pricing work is in scope
  here - this plan is packaging/installer only.
- GitHub Actions free-tier minutes are sufficient for this project's expected release cadence in
  v1; overage costs are named in §2.4 rather than assumed away.
- Where the source material used Tauri 1.x API names (`tauri::api::path::resource_dir`), this plan
  specifies the correct Tauri 2.x equivalent (`app.path().resource_dir()` via the `PathResolver`),
  since the app is stated to be Tauri 2.x throughout.

---

## 6. Out of scope / non-goals for v1 (explicit, not silently dropped)

- **Android app of any kind** - see §3. Deferred to a possible v2 thin-client architecture, not
  ruled out forever, but zero work scheduled now.
- **iOS app of any kind** - see §3.1. Same deferred status, with the added App Store review risk
  named.
- **Code signing on Windows** - deferred, cost and consequence named in §2.2, revisit once revenue
  justifies ~$200-$400/year.
- **Code signing/notarization equivalent on Linux** - deferred, low-stakes, named in §2.3.
- **Auto-update on Windows or Linux** - explicit non-goal for v1 on both platforms; re-download is
  the update path.
- **`.deb` and `.rpm` packages** - considered and rejected in favor of AppImage for v1 (§2.3); may
  be revisited if distro-specific user demand appears post-launch.
- **MSI installer** - considered and rejected in favor of NSIS (§2.2).
- **Enterprise/GPO deployment tooling** - out of scope; not this audience.
- **Any store submission** (Microsoft Store, Snap Store, Flathub, Google Play, Apple App Store) -
  none are in scope for v1; this plan covers direct-download installers only.
- **Modifying, wrapping, or rebundling the `claude` CLI binary in any form** - never in scope, at
  any point, per Anthropic's Commercial Terms; the plan only ever *locates* the user's own
  installed copy at runtime.
- **Embedding, generating, or shipping any API key or credential in any installer artifact** -
  never in scope; BYOK is absolute across every platform this plan touches.

---

## 7. Acceptance tests

**AT-1 - Path resolution survives a foreign machine (Windows).**
Build on machine A. Install the NSIS output on a clean Windows 10/11 VM (machine B) with no prior
source checkout and no system Node installed. Launch the app; confirm the startup log shows the
orchestrator starting via the bundled Node 22 LTS runtime resolved from the Tauri resource
directory, and that no `CARGO_MANIFEST_DIR`-derived path string appears anywhere in the log. All
eight tiles render; `plan-1..3` show "relay not installed" (no `RELAY_PATH` present on this clean
VM). Then set `SOPHIA_ORCHESTRATOR_PATH` to a valid path and relaunch; confirm the log shows that
env var as the winning resolution source.

**AT-2 - Windows install, no elevation, in-place update.**
On a clean Windows 10/11 VM with no prior install, run the NSIS installer; confirm it installs to
`%LOCALAPPDATA%\Programs\Sophi-A` with no UAC prompt, and the app launches with the orchestrator
startup log line present. Run the installer a second time and confirm it performs an in-place
update with no data loss (existing config/state persists).

**AT-3 - Windows unsigned posture is real and documented, no secrets leak.**
Confirm the shipped `.exe` is unsigned (no Authenticode signature present) and that running it on
a clean VM triggers the SmartScreen "Windows protected your PC" dialog as documented in
`docs/signing-decision.md`. Scan the installer file and the installed directory tree for any
string matching an API-key pattern (e.g. `sk-ant-`, `sk-`); confirm zero matches.

**AT-4 - Path resolution and Node bundling survive a foreign machine (Linux), across distros.**
Build the AppImage on machine A (Ubuntu). Copy it - no other files - to a clean Fedora 41 VM with
no system Node installed and no source checkout; `chmod +x`, run it; confirm the startup log shows
the orchestrator running via the bundled Node runtime resolved from inside the AppImage, all eight
tiles render, and `plan-1..3` show "relay not installed" absent a `RELAY_PATH`. Repeat on a clean
Ubuntu 24.04 VM to confirm cross-distro portability. Confirm no `CARGO_MANIFEST_DIR`-derived path
appears in either log.

**AT-5 - Linux clean uninstall, no signing claims.**
Confirm `docs/linux-packaging-decision.md` accurately states AppImage is unsigned and names the
"untrusted application" / "Allow Launching" consequence. Delete the AppImage file on the Fedora VM
from AT-4; confirm no residual files remain outside the user's XDG config directory.

**AT-6 - RELAY_PATH resolution end to end.**
On either clean VM from AT-1/AT-4, place a real relay checkout at an arbitrary path, set
`SOPHIA_RELAY_PATH` to it, relaunch; confirm `plan-1..3` tiles report a healthy seat instead of
"relay not installed," and the log shows `SOPHIA_RELAY_PATH` as the winning resolution source.
Then unset the env var, delete the persisted store entry, and confirm the app falls back to the
first-run picker prompt rather than crashing.

**AT-7 - No claude CLI modification.**
Confirm no build step, packaging script, or resource bundle in the repo copies, patches, wraps, or
re-signs a `claude` binary. The only reference to `claude` anywhere in packaging code is a runtime
`which`/`where`-style lookup on the user's own PATH.

**AT-8 - Mobile scope cut is documented, not silent.**
Confirm this document contains dedicated, independently-reasoned Android and iOS sections stating
the out-of-scope decision and the technical/regulatory reasoning behind each, per §3 and §3.1.

---

## Scope ledger

- DEEPSEEK-1 - accepted - merged runtime path-resolution chain (env var -> persisted store ->
  resource_dir -> first-run picker), Node/orchestrator/RELAY_PATH resolution, §2.1 and
  AT-1/AT-4/AT-6
- DEEPSEEK-2 - accepted - Windows NSIS, per-user install, unsigned posture and SmartScreen
  consequence, no auto-update, §2.2 and AT-2/AT-3
- DEEPSEEK-3 - withdrawn - by deepseek in favour of GLM-3's AppImage-with-bundled-Node Linux
  proposal
- QWEN-1 - withdrawn - by qwen, merged into DEEPSEEK-1's path-resolution + Node-bundling chain
- QWEN-2 - withdrawn - by qwen, merged into GLM-2's Windows NSIS/unsigned/bundled-Node proposal
- QWEN-3 - withdrawn - by qwen, mobile scope cut superseded by GEMINI-3's more complete
  independent Android/iOS treatment
- GLM-1 - accepted - merged into the §2.1 resolver spec, contributes the RELAY_PATH resolution
  branch and logged-source detail, AT-6
- GLM-2 - accepted - Windows NSIS with bundled pinned Node 22 LTS, per-user install, unsigned/
  no-auto-update posture, no-secrets scan, §2.2 and AT-2/AT-3
- GLM-3 - accepted - Linux AppImage as sole v1 target (amended from an initial deb proposal after
  panel objection), bundled Node, deferred signing, §2.3 and AT-4/AT-5
- MISTRAL-1 - withdrawn - by mistral, malformed "How"/acceptance test superseded by
  DEEPSEEK-1/GLM-1's concrete resolver spec
- MISTRAL-2 - withdrawn - by mistral, self-signed-cert approach rejected as providing no real
  SmartScreen mitigation; superseded by DEEPSEEK-2's honest-unsigned posture
- MISTRAL-3 - withdrawn - by mistral, malformed/duplicate AppImage proposal superseded by GLM-3
- GEMINI-1 - withdrawn - by gemini, merged into DEEPSEEK-1's path-resolution + Node-bundling chain
- GEMINI-2 - accepted - GitHub Actions CI pipeline (NSIS + AppImage builds, free-tier runners, $0
  cost), §2.4 and referenced by AT-1/AT-4 build provenance
- GEMINI-3 - accepted - independent Android (§3) and iOS (§3.1) scope-cut reasoning and the
  Windows-then-Linux build order (§4), amended to separate the two mobile platforms' reasoning per
  panel objection
