# Linux packaging decision

*Per PLAN_PACKAGING.md §2.3/§6. Read that first - this file states the consequence plainly, it
doesn't re-argue the decision.*

**v1 ships as a single AppImage, unsigned, no `.deb`/`.rpm`.** `tauri.conf.json`'s
`bundle.targets` is `["nsis", "appimage"]` - deb/rpm/msi/dmg are deliberately excluded, not
forgotten.

**Why AppImage, not deb (a real reversal during review):** an earlier draft of the packaging plan
picked `.deb`, reasoning that a Germany-only launch implies a Debian/Ubuntu-leaning audience. Four
of five labs on the review panel objected (`BOARD_PACKAGING.md`, GLM-3's debate thread) - Tauri's
Debian bundler doesn't cleanly support declaring a dependency on a bundled (not system-packaged)
Node runtime, a `.deb` excludes Fedora/Arch users outright, and a solo operator maintaining a
`.deb` needs a signed APT repository, which is real ongoing infrastructure this project has no
reason to carry yet. AppImage needs none of that: one file, no root, no package-manager
transaction, runs on any of the major distros.

**What this actually costs the user:** some desktop environments (GNOME notably) show an
"untrusted application" style warning, or simply won't execute the file until the user
right-clicks it in a file manager and chooses "Allow Launching" (or runs `chmod +x` from a
terminal). This is real friction, named rather than hidden.

**No dollar cost is being avoided by skipping this** - unlike the Windows signing deferral,
AppImage-signing tooling exists but buys negligible trust on Linux desktops (there's no
OS-level reputation system the way Windows SmartScreen has one), so this is a low-stakes
deferral, not a budget trade-off.

**A real packaging requirement found while building this** (not in the original plan, added here
because it will bite anyone who tries to package the orchestrator by copying `src/orchestrator/`
directly): the orchestrator's one real dependency (`ws`) must be present wherever the entry point
runs. The build pipeline (`npm run package:orchestrator`) solves this by bundling the orchestrator
into a single self-contained file with `esbuild` rather than shipping `src/orchestrator/` +
`node_modules/` as separate resources - confirmed by running the bundled output in a directory
with nothing else in it.

**A local sandbox limitation, not a Sophi-A bug:** attempting `npm run tauri build --bundles
appimage` in this development sandbox failed with `failed to run linuxdeploy` - traced to the
sandbox missing `libfuse.so.2` (AppImages need FUSE2 to self-mount; the sandbox's `/dev/fuse`
device exists but the userspace library doesn't, and installing it requires `sudo`, which needs an
interactive password this session doesn't have). Manually invoking `linuxdeploy` with
`--appimage-extract-and-run` (or setting `APPIMAGE_EXTRACT_AND_RUN=1`) works around the missing
FUSE2 library directly, but Tauri's own bundler doesn't expose a way to pass that flag through to
its internal `linuxdeploy` invocation, and setting the env var on the `tauri build` process itself
did not get forwarded. This blocks a *local* build in this specific sandbox only - GitHub Actions'
`ubuntu-latest` runners have working FUSE, but recent Ubuntu images ship without `libfuse2`
pre-installed either (a known issue for AppImage-building CI generally), so
`.github/workflows/release.yml` installs it explicitly as its own step rather than assuming it's
there.
