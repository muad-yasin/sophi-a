# BOARD_PACKAGING.md — Sophi-A packaging plan debate board

*Copied verbatim from relay run `2026-09-09T02-29-54-628Z`'s `BOARD.md` (chain: plan-debate,
task: sophi-a-packaging-plan.md, $0.34, unanimous panel sign-off round 1). Companion to
`PLAN_PACKAGING.md`/`HANDOFF_PACKAGING.md`.*

# Debate board - run 2026-09-09T02-29-54-628Z

Every proposal, what the other labs posted on it, and the author's reply.

## DEEPSEEK-1 (deepseek) - AMENDED by its author after debate
**Title:** Runtime orchestrator path resolution via Tauri resource directory with fallback chain
**Serves:** Acceptance criterion 1; Windows/Linux packaging systems; path-resolution fix subsystem
**What:** Replaces the compile-time CARGO_MANIFEST_DIR-derived orchestrator path with a runtime resolution that first checks the Tauri resource directory (where the installer places the orchestrator bundle), then a user-configurable path in the app config, then an environment variable, then a first-run discovery prompt. The resolved path is stored in the app's data directory after first successful resolution.
**Why:** This is the core fix that makes any packaged build run on a machine other than the build machine, and it is a prerequisite for both Windows and Linux packaging acceptance tests.
**How:** Resolution order: SOPHIA_ORCHESTRATOR_PATH env var, then resource_dir()/orchestrator, then app config, then first-run dialog. RELAY_PATH order: SOPHIA_RELAY_PATH env var, then platform config dir, then first-run dialog. Bundled Node binary path resolved similarly (env var SOPHIA_NODE_PATH, then resource_dir()/node, then system node on PATH). All resolved paths logged.
**Acceptance test:** Build on machine A, install on clean machine B with no source checkout and no system Node. Launch: orchestrator starts via bundled node (log line 'orchestrator ready'), all eight tiles render (plan tiles show 'relay not installed' if no relay checkout). Then set SOPHIA_ORCHESTRATOR_PATH to a valid path, relaunch, and verify it starts again. Also verify no CARGO_MANIFEST_DIR-derived path appears in logs.

**Board:**
- qwen - merge with QWEN-1: Merges with B-1 and C-1. The fallback chain (resource_dir -> config -> env) is superior to a simple lookup, but must explicitly include the bundled Node binary path in the resolution logic to satisfy the Node dependency constraint.
- glm - merge with GLM-1: Same part as C-1, B-1, D-1, E-1: five labs proposed the resource-dir path fix. Merge into one resolver spec. C-1's is the most complete (resource_dir → env var override → documented fallback + logged resolution); A-1's first-run file-picker prompt is worth keeping as the final fallback, but its precedence (resource dir before env var) should follow C-1's env-var-first order since overrides must beat bundled resources. D-1's acceptance test uses a nonexistent command (`tauri info --app-dir`) and should not be used.
- mistral - support: Comprehensive runtime path resolution with clear fallback chain and Tauri integration; directly addresses the compile-time path issue without embedding secrets.
- gemini - object: Prompting end users with a file-picker dialog to locate internal runtime source files creates an unacceptable user experience if installation resources fail to resolve.
- deepseek (author) - amend: Adopt C-1's env-var-first precedence and merge with B-1/C-1/E-1; keep the first-run prompt as final fallback but only as a last resort, and explicitly include the bundled Node binary path in the resolution logic.

## DEEPSEEK-2 (deepseek) - stands
**Title:** Windows NSIS installer with unsigned posture and explicit SmartScreen consequence
**Serves:** Acceptance criteria 2, 3, 4, 14; Windows packaging system
**What:** Uses NSIS (via Tauri's built-in Windows installer support) to produce a per-user installer that places the app and the orchestrator bundle in `%LOCALAPPDATA%\Programs\Sophi-A`, with no admin elevation. Code signing is explicitly deferred for v1; the installer is unsigned, and the plan documents the SmartScreen 'Windows protected your PC' warning and the 'More info > Run anyway' path.
**Why:** NSIS is the lowest-cost, lowest-friction installer for a solo operator targeting Windows, and being explicit about the unsigned state avoids a hidden cost while keeping the v1 budget near zero.
**How:** Set `bundle > windows > installerType` to `nsis` in `tauri.conf.json`; configure `bundle > windows > nsis > perMachine` to `false` and `installMode` to `currentUser`. Add the orchestrator directory to `bundle > resources`. Do not configure any signing certificate (leave `certificateThumbprint` unset). Add a `docs/signing-decision.md` that states the cost of skipping: SmartScreen warning on every download/run, potential user drop-off, and the $200–$400/year cost of an OV code-signing cert (or $100–$300 for EV, plus hardware token) as a future paid item. Auto-update is declared a non-goal for v1; the installer is the only update mechanism, and the plan notes users must re-download for updates.
**Acceptance test:** On a clean Windows 10/11 VM with no prior install, run the NSIS installer, confirm it installs to `%LOCALAPPDATA%\Programs\Sophi-A` without UAC prompt, launch the app, and verify the orchestrator starts (log line appears). Then run the installer again and confirm it performs an in-place update without data loss.

**Board:**
- glm - support: NSIS per-user install to %LOCALAPPDATA% with no UAC is the right Windows posture alongside C-2; its re-run-in-place-update test is a good addition to C-2's acceptance test.
- mistral - support: Explicitly documents the SmartScreen consequence of unsigned installers, aligning with near-zero budget constraints while keeping the plan credible.
- gemini - support: Correctly chooses currentUser NSIS installation without privilege elevation while explicitly detailing the SmartScreen warning trade-off and certificate costs.
- deepseek (author) - keep: The support from Labs C, D, and E confirms this is the right Windows posture; no objections raised that require changes.

## DEEPSEEK-3 (deepseek) - WITHDRAWN by deepseek in favour of GLM-3
**Title:** Linux AppImage packaging with runtime path fix and no signing
**Serves:** Acceptance criteria 2, 3, 4, 11, 14; Linux packaging system
**What:** Produces an AppImage as the sole Linux package format, bundling the app and the orchestrator resources, with the runtime path resolution from the first proposal. No code signing is performed; the plan documents that AppImage is not signed and that users may see an 'untrusted' warning depending on their desktop environment.
**Why:** AppImage is the most practical for a solo operator targeting a broad Linux audience without per-distro build infrastructure, and it avoids the maintenance burden of deb/rpm repositories.
**How:** In `tauri.conf.json`, set `bundle > targets` to `appimage` (and remove any deb/rpm targets). Ensure `bundle > resources` includes the orchestrator directory. Use the Tauri CLI's `tauri build --bundles appimage` to produce the AppImage. No signing configuration. Add a `docs/linux-signing-decision.md` stating that AppImage signing is skipped; the consequence is that some desktops (e.g., GNOME) may show an 'untrusted application' warning, and the user must right-click > 'Allow Launching'. Auto-update is a non-goal; users re-download the AppImage for updates. The build must be run on a Linux machine with `linuxdeploy` dependencies installed (the Tauri CLI handles this).
**Acceptance test:** Build the AppImage on machine A, copy it to a clean Ubuntu 22.04 VM with no Node.js or source checkout, chmod +x, run it, and verify the orchestrator starts (log line appears) without any manual path entry. Also verify that the AppImage runs on a second distro (e.g., Fedora 40) to confirm portability.

**Board:**
- glm - object with GLM-3: Conflicts with C-3: this picks AppImage while C-3 picks deb with an argued reason (Germany-only launch ⇒ Debian/Ubuntu-dominant, dependency handling, single artifact). One format must win at integration; I think C-3's reasoning is the stronger fit for a Germany-only $29 launch, but AppImage remains the fallback if the 'clean dpkg -i on a non-Ubuntu distro' test fails. These two cannot both ship.
- mistral - object: AppImage bundling does not address Node.js runtime dependency handling. Quote: "No code signing is performed; the plan documents that AppImage is not signed". This omits how the orchestrator's Node.js requirement is satisfied.
- deepseek (author) - withdraw: Lab C's deb argument is stronger for a Germany-only launch, and Lab D correctly notes the Node.js dependency handling gap. Replaced by C-3's deb proposal with the Node bundling fix.

## QWEN-1 (qwen) - WITHDRAWN by qwen in favour of DEEPSEEK-1
**Title:** Runtime Path Resolution & Node Bundling
**Serves:** Acceptance Criteria 1, 6 (Node handling), Skeleton: Path-resolution fix, Node runtime dependency handling
**What:** Replace compile-time CARGO_MANIFEST_DIR in src-tauri/src/lib.rs with a runtime lookup using tauri::api::path::resource_dir() relative to the binary. Bundle a minimal, static Node.js binary and required npm deps into the Tauri resources directory.
**Why:** Fixes the 'only works on build machine' failure by making the orchestrator path dynamic; ensures the app runs on user machines without requiring pre-installed system Node.js, satisfying the solo-operator constraint of zero external dependencies for end-users.
**How:** Replace compile-time CARGO_MANIFEST_DIR in src-tauri/src/lib.rs with a runtime resolution chain: 1) Check Tauri resource_dir() for bundled orchestrator and static Node binary. 2) Fallback to SOPHIA_ORCHESTRATOR_PATH/SOPHIA_NODE_PATH env vars. 3) Fallback to system PATH. Bundle a pinned, static Node.js binary (e.g., v20.x/win-x64/node.exe) into tauri.conf.json bundle.resources alongside src/orchestrator/. No API keys added. Authority: Solo dev. Cost: $0.
**Acceptance test:** Run 'npm run tauri build', copy the resulting installer to a fresh Windows VM that has never compiled the code and has no system Node installed. Install, launch, and verify the console log shows the orchestrator starting successfully using the bundled node binary at a path relative to the installation directory.

**Board:**
- deepseek - merge with DEEPSEEK-1: This is the same path-resolution fix as A-1 and C-1, and the same Node-bundling decision as C-2. Merge with A-1 into a single 'runtime path resolution + Node bundling' proposal, and keep the env-var fallback chain from A-1/C-1 rather than resource-dir-only.
- glm - object with GLM-1: Object to 'tauri::api::path::resource_dir()' — that is the Tauri 1.x API; on Tauri 2.x it is `app.path().resource_dir()` via the path resolver, so the snippet as written will not compile. Also pins Node 20 while C-2 pins Node 22 LTS; the merged resolver must pick one (22 LTS, matching C-2's SHA-256-pinned fetch).
- mistral - merge with DEEPSEEK-1: Bundles Node.js but overlaps with A-1's path resolution. Merge with A-1 to form a unified path resolution + Node.js bundling subsystem.
- gemini - merge with GEMINI-1: Both proposals implement runtime path discovery via Tauri resource_dir and bundle a static Node.js binary into application resources; merging establishes a single desktop runtime dependency strategy.
- qwen (author) - withdraw: Merging with A-1 creates a unified 'runtime path resolution + Node bundling' proposal, incorporating the correct Tauri 2.x API and Node 22 LTS pinning from C-1/C-2.

## QWEN-2 (qwen) - WITHDRAWN by qwen in favour of GLM-2
**Title:** Windows NSIS Installer & Signing Strategy
**Serves:** Acceptance Criteria 2, 3, 11, Skeleton: Windows packaging system
**What:** Configure Tauri to use NSIS installer format. Defer code signing for v1. Explicitly document that users will see SmartScreen warnings ('Unknown Publisher') and must click 'More info' -> 'Run anyway'.
**Why:** NSIS is lighter and easier to configure than MSI for a solo dev. Deferring signing avoids the ~$200-500/year cost of a code-signing certificate and complex CA validation process, aligning with the near-zero budget constraint while accepting the known UX friction.
**How:** Set tauri.conf.json > bundle > windows > nsis > installerIcon. Ensure no certificates are referenced in the build script. Add a 'Known Issues' section to PLAN.md stating: 'v1 installs trigger SmartScreen warnings due to unsigned binary; this is intentional to save costs.' Authority: Solo dev. Cost: $0.
**Acceptance test:** Build the NSIS installer on a CI runner or local machine. Transfer the .exe to a clean Windows 10/11 machine. Run the installer. Verify it completes installation despite the Windows Defender SmartScreen warning dialog appearing.

**Board:**
- deepseek - support: Matches A-2's NSIS and unsigned posture; the explicit 'Known Issues' documentation is a good addition. No conflict.
- glm - merge with GLM-2: Same part as C-2/A-2 (Windows NSIS, unsigned, SmartScreen documented). Merge into C-2, which additionally specifies the pinned bundled Node runtime and the no-secrets scan; take B-2's PLAN.md 'Known Issues' note as the documentation mechanism.
- mistral - support: Aligns with A-2 on NSIS and unsigned posture, reinforcing the solo-operator budget constraint with concrete UX tradeoffs.
- qwen (author) - withdraw: Merging with C-2 consolidates the Windows NSIS/unsigned strategy, adding the specific no-secrets scan and pinned runtime details while retaining B-2's documentation approach.

## QWEN-3 (qwen) - WITHDRAWN by qwen in favour of GEMINI-3
**Title:** Linux AppImage & Mobile Scope Cut
**Serves:** Acceptance Criteria 2, 5, 6, 7, Skeleton: Linux packaging system, Android/iOS feasibility
**What:** Target Linux via AppImage (single executable) to avoid distro-specific repo management. Explicitly cut Android and iOS from v1 scope because mobile sandboxes forbid spawning the required 'claude' CLI and 'node relay' subprocesses.
**Why:** AppImage requires no root/installation privileges and works across most distros, ideal for a solo dev with no repo infrastructure. Cutting mobile is necessary because Constraint 2 makes the core architecture (subprocess spawning) impossible on iOS/Android without a fundamental rewrite to a thin-client model, which is out of scope for v1.
**How:** Target Linux via AppImage (single executable) to avoid distro-specific repo management. Explicitly cut Android and iOS from v1 scope because mobile sandboxes forbid spawning the required 'claude' CLI and 'node relay' subprocesses. Build order: Windows first (largest market, easiest NSIS setup), then Linux. Add 'Mobile (Android/iOS)' to 'Out of Scope / Non-Goals' with reasoning: 'Mobile OS sandboxing prevents arbitrary subprocess execution; requires remote-orchestrator architecture not planned for v1.' Authority: Solo dev. Cost: $0.
**Acceptance test:** Build the AppImage on Ubuntu 22.04. Transfer to a fresh Fedora or Debian VM. chmod +x the AppImage and run it. Verify the app launches and the orchestrator connects successfully, confirming the runtime path fix works on Linux without root privileges.

**Board:**
- deepseek - object: The acceptance test says 'verify the orchestrator connects successfully' but does not verify the runtime path fix on a machine that did not build it — it only checks launch on a fresh VM. Also, cutting mobile without a separate iOS reasoning violates the requirement that Android and iOS get independent treatments; this proposal only gives one combined reason.
- glm - object with GEMINI-3: Same Linux-format conflict with C-3 ('Enable tauri.conf.json > bundle > linux > appimage' vs C-3's deb-only target) — must be merged to one decision. Its mobile scope cut is sound but duplicates E-3's, which is more complete (cost figures, thin-client v2 direction, iOS 2.5.2 note); merge the mobile part of B-3 into E-3.
- mistral - support: Explicitly cuts mobile scope for v1 with clear reasoning tied to subprocess constraints, avoiding hand-waving.
- qwen (author) - withdraw: The mobile scope cut is redundant with E-3, which provides more complete reasoning (costs, iOS specifics). The Linux format decision will be resolved via merge with C-3.

## GLM-1 (glm) - AMENDED by its author after debate
**Title:** Runtime orchestrator path resolution in lib.rs
**Serves:** Skeleton: Path-resolution fix; acceptance criteria 1 and 11
**What:** Replace the compile-time CARGO_MANIFEST_DIR lookup with a runtime resolution chain using Tauri's resource-dir API and an env-var override, so the orchestrator (and RELAY_PATH) resolve on machines that did not build the binary. The orchestrator becomes a Tauri resource; the resolution order is documented and logged for first-run debugging.
**Why:** Without this, no build can run anywhere but the build machine — it is the hard blocker under every packaging target, and it is small and fully specifiable now.
**How:** Merge into A-1. The merged proposal keeps the full resolution order: (1) SOPHIA_ORCHESTRATOR_PATH env var, (2) persisted first-run picker result (tauri-plugin-store), (3) app.path().resource_dir()/orchestrator, (4) file-picker prompt with persisted save; the same chain (minus the env var, which stays for the orchestrator only) applies to RELAY_PATH, and every resolution attempt is logged with the winning path and its source.
**Acceptance test:** Unchanged from C-1, plus a RELAY_PATH case: on clean machine B, the plan-1..3 seats resolve RELAY_PATH from resource_dir (or picker) and the startup log shows the resolved absolute path and its source.

**Board:**
- deepseek - merge with DEEPSEEK-1: Same path-resolution fix as A-1 and B-1. Merge with A-1, keeping the env-var override and the resource-dir fallback, and add the RELAY_PATH resolution detail from C-1 into the merged proposal.
- mistral - support: Detailed resolution chain for both orchestrator and RELAY_PATH, with logging for debugging; directly addresses acceptance criterion 1.
- glm (author) - amend: Accept A-1's merge request: the resolver and the first-run picker are the same work and should not exist twice. Keeping RELAY_PATH inside the merged proposal is correct; C-1's five-way chain and acceptance test carry over verbatim.

## GLM-2 (glm) - AMENDED by its author after debate
**Title:** Windows NSIS installer with unsigned-notice posture, bundled Node runtime, no auto-update in v1
**Serves:** Skeleton: Windows packaging system, Node runtime dependency handling, CI/build infrastructure; acceptance criteria 3, 4, 10, 11, 14
**What:** Tauri 2.x NSIS installer for x64 Windows that bundles a pinned Node 22 LTS runtime inside the app's resource directory so end users need no system Node, ships zero credentials, and defers both code signing and auto-update with explicitly named consequences.
**Why:** NSIS is the cheapest credible Windows path for a solo operator and the Node bundling decision is the other half of 'no packaging exists yet' that must be decided concretely.
**How:** Fold in B-2's documentation mechanism (a 'Known Issues' entry in PLAN.md for the SmartScreen warning) and A-2's per-user install settings (installMode=currentUser, no UAC) plus its re-run-update acceptance check.
**Acceptance test:** On a clean Windows 11 VM with no Node installed: install via the NSIS exe, launch; all tiles that require node work (orchestrator starts via the bundled node.exe, verified by the startup log), and a scan of the install directory and installer file shows no string matching a sk-ant- or other API-key pattern.

**Board:**
- deepseek - support: Concrete NSIS + bundled Node + no auto-update, with a clear signing cost and a compliance-safe claude CLI check. The SHA-256 pinning is a good reproducibility detail.
- mistral - merge with QWEN-1: Bundles Node.js and uses NSIS, overlapping with B-1 and A-2. Merge with B-1/A-1 to consolidate Windows packaging and Node.js handling.
- glm (author) - keep: D's merge suggestion duplicates A/B's merge note; I accept consolidation in principle, but C-2's specific content (bundled pinned Node 22 LTS, per-user NSIS installMode, unsigned-notice posture, no-auto-update as named non-goal, secret-scan acceptance check) is the substance the merged Windows proposal should adopt. No objection raised against the content itself.

## GLM-3 (glm) - AMENDED by its author after debate
**Title:** Linux .deb package with system-Node-or-bundled fallback, deferred signing
**Serves:** Skeleton: Linux packaging system, RELAY_PATH handling on desktop; acceptance criteria 2, 3, 11, 14
**What:** A Debian .deb package as the single v1 Linux target, bundling the same orchestrator resources and reusing the same bundled-Node mechanism as Windows, with package-level dependency declaration as an alternative resolution step.
**Why:** deb is chosen over AppImage and rpm: Germany-only launch implies a Debian/Ubuntu-dominant user base, deb gives dependency handling and clean uninstall that AppImage lacks, and rpm doubles signing/packaging maintenance for a small initial audience; AppImage's no-install convenience is not worth a second artifact pipeline for a solo operator.
**How:** Ship AppImage as the only v1 Linux artifact. Bundle Node 22 LTS inside the AppImage (no system-Node dependency resolution at all — this also dissolves A's 'nodejs >=22 depends field' objection). No APT/RPM repo, no signing; document the download-and-chmod UX and any Gatekeeper-equivalent warnings in docs/linux-packaging-decision.md. Revisit .deb (and rpm) post-v1 only if user demand from a specific distro appears.
**Acceptance test:** On clean Fedora 41 and Ubuntu 24.04 VMs, no system Node: download the AppImage, chmod +x, launch; startup log shows orchestrator running via the bundled node with a resolved resource path; all eight tiles render; RELAY_PATH resolves per C-1/A-1; deleting the AppImage file uninstalls cleanly with no config residue beyond the user-config directory.

**Board:**
- deepseek - object: The plan says 'deb is chosen over AppImage and rpm' but the acceptance test only checks Ubuntu 24.04; it does not test the dependency fallback (system Node vs bundled) or the RELAY_PATH behavior on a clean machine. Also, the 'nodejs (>=22)' dependency hint is vague — Tauri's deb config does not directly support a depends field for Node; you need to specify how that is actually added.
- qwen - object: Choosing .deb over AppImage adds significant maintenance burden for a solo operator managing distro-specific dependencies and repos. AppImage is the correct choice for 'near-zero budget' and broad compatibility without repo infrastructure.
- mistral - object: Deb format conflicts with AppImage proposals (A-3, B-3, E-2) without justification for doubling packaging maintenance. Quote: "deb is chosen over AppImage and rpm". Solo-operator budget favors a single Linux format.
- gemini - object: Restricting Linux distribution exclusively to Debian .deb packages excludes users on non-Debian distributions like Fedora and Arch, whereas AppImage provides single-binary portability without root privileges or multi-repo maintenance.
- glm (author) - amend: Four labs object and the AppImage arguments are correct on the merits: no repo infrastructure, no root, one artifact covering Fedora/Arch, and lowest maintenance for a solo operator. My deb rationale leaned on a dependency mechanism Tauri's deb pipeline doesn't cleanly support anyway. I withdraw the deb-first choice and adopt AppImage as the single v1 Linux artifact.

## MISTRAL-1 (mistral) - AMENDED by its author after debate
**Title:** Runtime-relative orchestrator path resolution
**Serves:** Acceptance criterion 1 (compile-time-absolute CARGO_MANIFEST_DIR fix)
**What:** Replace the compile-time CARGO_MANIFEST_DIR path in src-tauri/src/lib.rs with a runtime-resolved path using Tauri's app resource directory API. The orchestrator will be located relative to the installed binary.
**Why:** Enables the app to run on any machine, not just the build machine, by resolving paths at runtime using platform-standard installation locations.
**How:** Replace `CARGO_MANIFEST_DIR` in `src-tauri/src/lib.rs` with `tauri::api::path::resource_dir(&tauri::Config::default(), "main").unwrap().join("orchestrator")`. Bundle the orchestrator directory as a Tauri resource by adding it to `tauri.conf.json` under `resources`. Add fallback logic to check `SOPHIA_ORCHESTRATOR_PATH` env var if the resource path fails. Log the resolved path at startup for debugging.
**Acceptance test:** On a fresh machine, install the app and verify: 1) app logs the resolved orchestrator path at startup (e.g., `Resolved orchestrator path: /path/to/resources/orchestrator`), 2) all tiles render without path errors, 3) manually setting `SOPHIA_ORCHESTRATOR_PATH` to a custom path overrides the default resolution.

**Board:**
- deepseek - object: The 'How' is '[object Object]' — not a concrete plan. The acceptance test uses `tauri info --app-dir` which is not a real command; it should be a runtime check inside the app, not a CLI query.
- gemini - object: The proposal lacks concrete technical steps, containing '[object Object]' in place of implementation instructions.
- mistral (author) - amend: The acceptance test should verify path resolution at runtime within the app, not via CLI. The 'how' section was malformed and needs concrete steps.

## MISTRAL-2 (mistral) - WITHDRAWN by mistral in favour of DEEPSEEK-2
**Title:** Windows NSIS installer with self-signed certificate (short-term)
**Serves:** Acceptance criteria 2 (Windows installer format) and 3 (code-signing decision)
**What:** Use NSIS to create a Windows installer (.exe) with a self-signed certificate for basic trust validation. Auto-update is deferred for v1.
**Why:** NSIS is lightweight, scriptable, and widely used for Tauri apps. Self-signing avoids paid certificate costs while mitigating SmartScreen warnings (though not eliminating them).
**How:** Use NSIS via Tauri's built-in support (tauri.conf.json: `bundle.windows.installerType: nsis`). Bundle the orchestrator and a static Node.js binary (MIT-licensed, pinned SHA-256) in resources. No signing; document SmartScreen warning in installer UI and docs.
**Acceptance test:** On a clean Windows VM: 1) SmartScreen warning appears and allows 'Run anyway', 2) app launches and logs orchestrator startup via bundled Node.js, 3) no API keys/secrets in installer or install dir.

**Board:**
- deepseek - object: Self-signing does not mitigate SmartScreen in any meaningful way — Windows still shows the same 'Unknown Publisher' warning. The proposal claims it 'mitigates' the warning, which is misleading; it also adds a certificate that users must trust manually, creating extra friction for zero benefit.
- qwen - object: Self-signed certificates do not mitigate SmartScreen warnings on Windows; they often trigger *more* severe security alerts than unsigned binaries because the OS detects an untrusted issuer. This contradicts the goal of minimizing user friction while keeping costs at $0.
- glm - object with DEEPSEEK-2: Object to 'self-signed certificate for basic trust validation' — it provides none. A self-signed cert is not trusted by any machine that didn't install it, does not remove or even reduce the SmartScreen warning (reputation is per-cert-reputation and self-signed certs accrue none), and adds build complexity for zero user benefit. C-2/A-2's honest unsigned posture with the SmartScreen consequence documented is strictly better at the same €0 cost.
- gemini - object: Self-signed certificates on Windows trigger untrusted root authority warnings and do not prevent SmartScreen blocks, adding build complexity without improving user trust.
- mistral (author) - withdraw: Self-signed certificates do not mitigate SmartScreen warnings and add unnecessary complexity. The unsigned approach in A-2/C-2 is superior at the same cost.

## MISTRAL-3 (mistral) - WITHDRAWN by mistral in favour of GLM-3
**Title:** Linux AppImage with embedded Node.js runtime
**Serves:** Acceptance criterion 2 (Linux package format) and 7 (build order)
**What:** Package Sophi-A as an AppImage for Linux, bundling a portable Node.js runtime to satisfy the orchestrator's dependency. No signing or repo hosting for v1.
**Why:** AppImage is distro-agnostic, requires no root, and simplifies dependency handling (bundled Node.js). Avoids paid signing/repo costs while maximizing compatibility.
**How:** Use AppImage (tauri.conf.json: `bundle.targets: appimage`). Bundle the orchestrator and Node.js runtime as in D-2. No signing; document 'untrusted' warning in docs. RELAY_PATH resolves via env var or user config (~/.config/sophia/relay).
**Acceptance test:** On a fresh Ubuntu VM: 1) `chmod +x` the AppImage and run, 2) app logs orchestrator startup via bundled Node.js, 3) plan-1..3 tiles show 'relay not installed' if RELAY_PATH missing.

**Board:**
- deepseek - support: Matches A-3's AppImage choice and the bundled-Node approach; the acceptance test is simple and valid. No conflict.
- glm - object with GLM-3: Duplicates the Linux AppImage choice already objected to in A-3/B-3 versus C-3's deb, and its 'How' is empty ('[object Object]') so it specifies nothing. Fold any surviving content into whichever Linux format wins the C-3/A-3 merge.
- gemini - object: The proposal lacks concrete technical steps, containing '[object Object]' in place of build and packaging details.
- mistral (author) - withdraw: The proposal duplicates A-3/C-3 and lacks concrete implementation details. The Linux format debate should be resolved via C-3's deb vs. A-3's AppImage, with this proposal folded into the winner.

## GEMINI-1 (gemini) - WITHDRAWN by gemini in favour of DEEPSEEK-1
**Title:** Runtime Orchestrator & Dependency Path Resolver
**Serves:** Path-resolution fix, Node runtime dependency handling, RELAY_PATH handling
**What:** Replaces the compile-time CARGO_MANIFEST_DIR macro in src-tauri/src/lib.rs with runtime path discovery using Tauri's AppHandle resource_dir API, falling back to environment variables and system PATH. Bundles a standalone Node.js binary inside the Tauri application resources to execute the orchestrator and locate the sibling relay repository without hardcoded build-machine paths.
**Why:** Fixes hardcoded compile-host paths so built installers execute on arbitrary user machines without modifying or re-bundling the external claude CLI binary.
**How:** Updates src-tauri/src/lib.rs to call app.path().resource_dir() and resolve bundle paths at runtime. Updates src-tauri/tauri.conf.json to list 'src/orchestrator/**/*' and a standalone Node.js v20 (35MB overhead, 0 USD cost) binary in bundle.resources. Adds fallback environment variables SOPHIA_NODE_PATH, SOPHIA_ORCHESTRATOR_PATH, and SOPHIA_RELAY_PATH. Orchestrator WebSocket binds on local port 8765 (default local port).
**Acceptance test:** Execute 'npm run tauri build' on Host A, copy generated output package to clean Host B without Node/Rust installed, launch application, and verify orchestrator child process starts and logs WebSocket listener initialization on port 8765.

**Board:**
- deepseek - merge with DEEPSEEK-1: Same path-resolution and Node-bundling work as A-1/B-1/C-1/C-2. Merge with A-1, and add the SOPHIA_NODE_PATH and SOPHIA_RELAY_PATH env vars from E-1 into the merged proposal's fallback chain.
- glm - object with GLM-1: Object to 'Orchestrator WebSocket binds on local port 8765 (default local port)' — this introduces an unspecified fixed-port collision risk on user machines and a new networking surface no other proposal plans for (port-in-use handling, loopback-only binding, auth between shell and orchestrator). The existing build already has an orchestrator transport; if a WS port is genuinely needed it needs a port-selection and loopback-only statement, not a bare default. Also pins Node 20 vs C-2's 22; use 22 LTS.
- mistral - merge with DEEPSEEK-1: Overlaps with A-1 and B-1 on path resolution and Node.js bundling. Merge with A-1 to form a single subsystem.
- gemini (author) - withdraw: Withdrawn in favour of A-1 to consolidate runtime path resolution, Node.js bundling, and fallback environment variables (SOPHIA_NODE_PATH, SOPHIA_RELAY_PATH) into a unified proposal.

## GEMINI-2 (gemini) - stands
**Title:** Desktop Packaging Pipeline & Code-Signing Strategy
**Serves:** Windows packaging system, Linux packaging system, Code-signing decision, Auto-update posture
**What:** Configures Tauri 2.x to generate Windows NSIS (.exe) and Linux AppImage packages via GitHub Actions while explicitly deferring paid code signing certificates and auto-updater infrastructure for v1.
**Why:** Delivers production-ready single-file installers for desktop platforms at zero upfront operational cost while clearly documenting security warnings to end users.
**How:** Adds 'build:tauri': 'tauri build' to package.json. Updates src-tauri/tauri.conf.json setting bundle.targets to 'nsis' for Windows and 'appimage' for Linux. Adds .github/workflows/release.yml using free GitHub-hosted runners (2000 free minutes/mo, 0 USD cost). Defers Windows EV code signing certificate ($200 to $400 annual cost saved) and auto-updater service (0 USD cost in v1). Documented user impact: Windows SmartScreen warning occurs requiring clicking 'More Info' -> 'Run Anyway', and Linux AppImage requires executable permissions ('chmod +x').
**Acceptance test:** Tag repository with v0.1.0 to trigger GitHub Release workflow; download Sophi-A_0.1.0_x64-setup.exe onto a clean Windows 11 VM, confirm SmartScreen warning displays as expected, complete installer, and launch app successfully.

**Board:**
- deepseek - support: Concrete GitHub Actions pipeline with free runners, NSIS/AppImage targets, and explicit signing deferral. The acceptance test is realistic.
- glm - support: The GitHub Actions release workflow with free-runner cost math (2000 min/mo, $0) and tagging-triggered releases is the right CI shape and satisfies criterion 14; it composes cleanly with whichever installer/proposals win.
- mistral - support: GitHub Actions CI with zero-cost runners and explicit deferral of signing/auto-update aligns with budget constraints and solo-operator reality.
- gemini (author) - keep: Keep. Unanimously supported by Labs A, C, and D for its zero-cost GitHub Actions CI workflow, NSIS/AppImage target selection, and explicit signing deferral strategy.

## GEMINI-3 (gemini) - AMENDED by its author after debate
**Title:** Platform Execution Sequence & Mobile Scope Strategy Document
**Serves:** Android feasibility system, iOS feasibility system, Build order, Non-goals list
**What:** Defers Android and iOS native builds entirely for v1 due to mobile OS process execution constraints, establishing a clear Windows-first build order and non-goals document within PLAN_PACKAGING.md.
**Why:** Prevents architectural violations of Android and iOS process sandboxing while avoiding store fees during initial Germany-only market testing.
**How:** Updates docs/PLAN_PACKAGING.md with distinct subsections: 1) Android Scope Cut (local process execution sandboxing impossibility; thin-client v2), 2) iOS Scope Cut (process sandboxing + App Store Guideline 2.5.2 dynamic execution ban + $99/yr fee savings), and 3) Build Order (Windows first for solo-operator development velocity, followed by Linux AppImage).
**Acceptance test:** Inspect docs/PLAN_PACKAGING.md to verify dedicated subsections for Android and iOS with independent technical/store-fee reasoning, and verify the platform execution sequence is justified by solo-developer iteration velocity.

**Board:**
- deepseek - object: The build order says 'Windows first' but the reason is only market share, not the solo-operator budget constraint. Also, the mobile scope cut is one combined section for Android and iOS, not separate reasoned treatments — the requirement explicitly says each must stand on its own.
- glm - support: Best mobile treatment on the table: honest v1 scope cut for both platforms with separate reasoning (Android thin-client deferred to v2, iOS pending 2.5.2 review), named store-fee savings, and a concrete build order. Merge B-3's mobile cut into this rather than keeping both.
- mistral - support: Clear build order and non-goals document, with mobile deferral reasoning tied to sandboxing constraints and cost savings.
- gemini (author) - amend: Amend to explicitly separate Android and iOS scope cuts into dedicated sections with platform-specific technical/regulatory justifications, and clarify that the Windows-first order is driven by solo-operator iteration velocity.