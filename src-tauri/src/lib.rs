// Bridge/IPC (PLAN.md "Bridge/IPC", "Orchestrator core"; PLAN_PACKAGING.md §2.1): spawns the Node
// orchestrator as a plain child process on app start (not Tauri's formal externalBin/sidecar
// bundling mechanism - see DECISIONS.md), reads its stdout for the `PORT:<n>` line the
// orchestrator prints once its ephemeral WebSocket is listening, and exposes that port to the
// frontend via the `get_orchestrator_port` command so it can connect directly.
//
// Path resolution (PLAN_PACKAGING.md §2.1, replacing the old CARGO_MANIFEST_DIR-compile-time
// path): for the orchestrator entry point, the bundled Node binary, and RELAY_PATH, each resolved
// independently via the same four-step chain, in order: (1) an env var override
// (SOPHIA_ORCHESTRATOR_PATH / SOPHIA_NODE_PATH / SOPHIA_RELAY_PATH), (2) a path persisted from an
// earlier run (`<app config dir>/resolved-paths.json`), (3) Tauri's resource directory
// (`app.path().resource_dir()` - Tauri 2.x's `PathResolver` API, where a packaged installer
// places the orchestrator bundle and pinned Node runtime), (4) for RELAY_PATH only, a one-time
// folder-picker prompt whose answer is persisted for next launch (relay is a sibling git checkout
// the installer cannot itself place - the orchestrator/Node paths are always resource-bundled in
// a real install, so they never need step 4). A debug-build-only fallback to the old
// CARGO_MANIFEST_DIR-relative path keeps `npm run tauri dev` working exactly as before; it is
// compiled out of release builds entirely (`cfg!(debug_assertions)`), so it can never be the
// silent culprit PLAN_PACKAGING.md's AT-1 checks for. Every attempt is logged with its outcome.
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

struct OrchestratorState {
    port: Arc<Mutex<Option<u16>>>,
    // docs/security-prompt-injection.md S0/P0: the orchestrator generates a random per-launch
    // token and prints it to stdout the same way it prints its port (`TOKEN:<hex>` next to
    // `PORT:<n>`); this only ever reaches the frontend over Tauri's own IPC (get_orchestrator_token
    // below), never the network, so a page or process that can merely open a WebSocket to the
    // orchestrator's port can no longer complete its auth handshake.
    token: Arc<Mutex<Option<String>>>,
    child: Mutex<Option<Child>>,
}

// Mirrors src/orchestrator/providers.js's ALLOWED_PROVIDERS envVar field - kept in sync manually,
// same discipline as that file's own "no shared-module setup" note. Used only to know which env
// var a saved key becomes when the orchestrator is spawned; the allow/deny policy itself (no
// xai/Grok) lives in the one place, providers.js - this list intentionally omits xai so a key for
// it can never be saved or passed through from this side either.
const PROVIDER_ENV_VARS: &[(&str, &str)] = &[
    ("anthropic", "ANTHROPIC_API_KEY"),
    ("openai", "OPENAI_API_KEY"),
    ("google", "GOOGLE_API_KEY"),
    ("mistral", "MISTRAL_API_KEY"),
    ("deepseek", "DEEPSEEK_API_KEY"),
    ("groq", "GROQ_API_KEY"),
    ("cohere", "COHERE_API_KEY"),
    ("openrouter", "OPENROUTER_API_KEY"),
    ("together", "TOGETHER_API_KEY"),
    ("zai", "ZAI_API_KEY"),
];

#[derive(Serialize, Deserialize, Default)]
struct PersistedPaths {
    orchestrator: Option<PathBuf>,
    node: Option<PathBuf>,
    relay: Option<PathBuf>,
}

fn store_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("resolved-paths.json"))
}

fn load_persisted(app: &tauri::AppHandle) -> PersistedPaths {
    store_file(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_persisted(app: &tauri::AppHandle, paths: &PersistedPaths) {
    let Some(path) = store_file(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(paths) {
        let _ = fs::write(path, json);
    }
}

/// One resolution attempt through steps 1-3 of PLAN_PACKAGING.md §2.1's chain. Step 4 (the
/// picker) is handled separately by `resolve_relay_path`, since it's the only path that gets one.
fn resolve(
    app: &tauri::AppHandle,
    label: &str,
    env_var: &str,
    persisted: Option<PathBuf>,
    resource_relative: Option<&str>,
    dev_fallback: Option<PathBuf>,
) -> Option<PathBuf> {
    if let Ok(v) = env::var(env_var) {
        let p = PathBuf::from(&v);
        if p.exists() {
            eprintln!("[sophia] {label}: resolved via {env_var} env var -> {}", p.display());
            return Some(p);
        }
        eprintln!("[sophia] {label}: {env_var} is set to {v:?} but that path does not exist, trying the next step");
    }

    if let Some(p) = persisted {
        if p.exists() {
            eprintln!("[sophia] {label}: resolved via persisted path -> {}", p.display());
            return Some(p);
        }
    }

    if let Some(rel) = resource_relative {
        if let Ok(resource_dir) = app.path().resource_dir() {
            let p = resource_dir.join(rel);
            if p.exists() {
                eprintln!("[sophia] {label}: resolved via Tauri resource_dir() -> {}", p.display());
                return Some(p);
            }
        }
    }

    // Dev-only convenience so `npm run tauri dev` keeps working with no install step at all -
    // never compiled into a release build, so it can never be what a packaged app quietly falls
    // back on (PLAN_PACKAGING.md AT-1's whole point).
    if cfg!(debug_assertions) {
        if let Some(p) = dev_fallback {
            if p.exists() {
                eprintln!("[sophia] {label}: resolved via dev-build fallback (source tree) -> {}", p.display());
                return Some(p);
            }
        }
    }

    eprintln!("[sophia] {label}: not resolved (env var / persisted path / resource dir{} all failed)",
        if cfg!(debug_assertions) { " / dev fallback" } else { "" });
    None
}

/// The dev-build-only source-tree layout: .../cnc-harness/src-tauri, walked up to the repo root.
fn dev_repo_root() -> Option<PathBuf> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().map(|p| p.to_path_buf())
}

fn resolve_orchestrator_path(app: &tauri::AppHandle, persisted: &PersistedPaths) -> Option<PathBuf> {
    let dev_fallback = dev_repo_root().map(|r| r.join("src").join("orchestrator").join("index.js"));
    resolve(
        app,
        "orchestrator entry",
        "SOPHIA_ORCHESTRATOR_PATH",
        persisted.orchestrator.clone(),
        Some("orchestrator/index.js"),
        dev_fallback,
    )
}

fn resolve_node_path(app: &tauri::AppHandle, persisted: &PersistedPaths) -> Option<PathBuf> {
    // Matches scripts/fetch-node-runtime.sh's output layout: dist-node/<target>/node(.exe),
    // placed at resources/node/ by tauri.conf.json's bundle.resources mapping.
    let resource_relative = if cfg!(target_os = "windows") { "node/node.exe" } else { "node/node" };
    // No dev fallback needed here - a dev machine always has `node` on PATH already, and
    // `Command::new("node")` (relying on PATH lookup) is simpler than fabricating a path to it.
    let resolved = resolve(app, "Node runtime", "SOPHIA_NODE_PATH", persisted.node.clone(), Some(resource_relative), None);
    resolved.or_else(|| {
        eprintln!("[sophia] Node runtime: falling back to \"node\" on PATH (fine in dev; a packaged release should always resolve the bundled runtime above)");
        None
    })
}

fn resolve_relay_path(app: &tauri::AppHandle, persisted: &mut PersistedPaths) -> Option<PathBuf> {
    let dev_fallback = dev_repo_root().and_then(|r| r.parent().map(|p| p.join("relay")));
    if let Some(p) = resolve(app, "RELAY_PATH", "SOPHIA_RELAY_PATH", persisted.relay.clone(), None, dev_fallback) {
        return Some(p);
    }

    // Step 4, RELAY_PATH only (PLAN_PACKAGING.md §2.1): relay is a sibling git checkout the
    // installer cannot place itself, so ask once and remember the answer. A cancelled/failed
    // picker is not an error - plan-1..3 simply report "relay not installed" (existing adapter
    // behavior), matching AT-1/AT-4/AT-6's expectation that this degrades gracefully.
    eprintln!("[sophia] RELAY_PATH: prompting the user once (first-run only; the answer is persisted)");
    let picked = app
        .dialog()
        .file()
        .set_title("Locate your relay checkout (used by the Planning-module seats)")
        .blocking_pick_folder();

    match picked {
        Some(folder) => {
            let path = folder.into_path().ok()?;
            eprintln!("[sophia] RELAY_PATH: resolved via first-run picker -> {}", path.display());
            persisted.relay = Some(path.clone());
            Some(path)
        }
        None => {
            eprintln!("[sophia] RELAY_PATH: picker cancelled - plan-1..3 will report \"relay not installed\" this run");
            None
        }
    }
}

// Onboarding (fills the gap monetization research named: no first-run setup exists - a stranger
// has no way to enter provider keys or confirm the `claude` CLI without hand-editing files).
// Keys live in their own file, separate from resolved-paths.json (that one holds filesystem
// paths only, by design - PLAN_PACKAGING.md §2.1 is explicit that no secret belongs in it).
fn api_keys_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("api-keys.json"))
}

fn load_api_keys(app: &tauri::AppHandle) -> HashMap<String, String> {
    api_keys_file(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_api_keys(app: &tauri::AppHandle, keys: &HashMap<String, String>) {
    let Some(path) = api_keys_file(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(keys) {
        let _ = fs::write(path, json);
    }
}

/// Providers with a saved, non-empty key - never the key values themselves. The frontend only
/// ever needs to know "is this one set", not read a secret back out of storage.
#[tauri::command]
fn list_api_key_providers(app: tauri::AppHandle) -> Vec<String> {
    load_api_keys(&app).into_iter().filter(|(_, v)| !v.is_empty()).map(|(k, _)| k).collect()
}

#[tauri::command]
fn set_api_key(app: tauri::AppHandle, provider: String, key: String) -> Result<(), String> {
    if !PROVIDER_ENV_VARS.iter().any(|(id, _)| *id == provider) {
        return Err(format!("\"{provider}\" is not a provider Sophi-A accepts a key for"));
    }
    let mut keys = load_api_keys(&app);
    if key.trim().is_empty() {
        keys.remove(&provider);
    } else {
        keys.insert(provider, key.trim().to_string());
    }
    save_api_keys(&app, &keys);
    Ok(())
}

/// A plain existence + version check, not a real auth probe (that would mean spending a real
/// Claude Code turn just to say hello) - `claude --version` succeeding means the CLI is
/// installed and executable; actual authentication is only really confirmed the first time a
/// seat runs for real, same as it always has been.
#[tauri::command]
fn check_claude_cli() -> Result<String, String> {
    match Command::new("claude").arg("--version").output() {
        Ok(out) if out.status.success() => {
            Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
        }
        Ok(out) => Err(format!(
            "claude --version exited with {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        )),
        Err(e) => Err(format!("could not run \"claude\" - is it installed and on PATH? ({e})")),
    }
}

fn spawn_orchestrator(app: &tauri::AppHandle, state: &OrchestratorState) {
    let mut persisted = load_persisted(app);

    let Some(entry) = resolve_orchestrator_path(app, &persisted) else {
        eprintln!("[sophia] cannot start: no orchestrator entry point could be resolved");
        return;
    };
    let node_path = resolve_node_path(app, &persisted);
    let relay_path = resolve_relay_path(app, &mut persisted);

    // Persist whatever resolved this run (steps 2/3 don't need re-persisting since they're
    // already durable; this mainly captures a fresh picker answer for RELAY_PATH).
    persisted.orchestrator = Some(entry.clone());
    if let Some(ref n) = node_path {
        persisted.node = Some(n.clone());
    }
    save_persisted(app, &persisted);

    let cwd = entry
        .parent() // .../orchestrator
        .and_then(|p| p.parent()) // .../src (dev) or the resource dir (packaged)
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| entry.clone());

    let node_command = node_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "node".to_string());

    let mut command = Command::new(&node_command);
    command.arg(&entry).current_dir(&cwd).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(relay) = &relay_path {
        // Overrides the orchestrator/adapters' own `RELAY_PATH || ../relay` default (PLAN.md
        // "What 'reuses relay's backend' means, precisely") with the path this chain resolved,
        // rather than leaving the Node side to guess relative to itself.
        command.env("RELAY_PATH", relay);
    }
    // Keys saved via the onboarding UI (`set_api_key`) become env vars on the orchestrator child
    // exactly like RELAY_PATH above - messagesApi.js's `loadRelayEnv()` only fills a var if it
    // isn't already set, so a key entered here always wins over whatever's in a sibling relay
    // checkout's own .env.
    for (provider, key) in load_api_keys(app) {
        if key.is_empty() {
            continue;
        }
        if let Some((_, env_var)) = PROVIDER_ENV_VARS.iter().find(|(id, _)| *id == provider) {
            command.env(env_var, key);
        }
    }

    let mut child = match command.spawn() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[sophia] failed to spawn orchestrator ({node_command} {entry:?}): {e}");
            return;
        }
    };

    let stdout = child.stdout.take().expect("orchestrator stdout should be piped");
    let port_handle = Arc::clone(&state.port);
    let token_handle = Arc::clone(&state.token);
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            if let Some(rest) = line.strip_prefix("PORT:") {
                if let Ok(port) = rest.trim().parse::<u16>() {
                    *port_handle.lock().unwrap() = Some(port);
                }
            } else if let Some(rest) = line.strip_prefix("TOKEN:") {
                *token_handle.lock().unwrap() = Some(rest.trim().to_string());
            } else {
                // Anything else the orchestrator prints to stdout - forward to this process's
                // own stderr so it shows up in `npm run tauri dev`'s console during development.
                eprintln!("[orchestrator] {line}");
            }
        }
    });

    let stderr = child.stderr.take().expect("orchestrator stderr should be piped");
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            eprintln!("[orchestrator:stderr] {line}");
        }
    });

    *state.child.lock().unwrap() = Some(child);
}

// Debug aid, kept deliberately: lets the frontend write its own diagnostic/lifecycle state to a
// plain file (`cat /tmp/cnc-harness-frontend-debug.log`) since a native window has no attached
// console. This is what found the real bug (a CSS specificity issue silently defeating the
// `hidden` attribute, not the WebSocket connection itself) - genuinely useful going forward, not
// a one-off hack to remove.
#[tauri::command]
fn debug_log(text: String) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/cnc-harness-frontend-debug.log")
    {
        let _ = writeln!(f, "{text}");
    }
}

#[tauri::command]
fn get_orchestrator_port(state: tauri::State<OrchestratorState>) -> Result<u16, String> {
    state
        .port
        .lock()
        .unwrap()
        .ok_or_else(|| "orchestrator not ready yet".to_string())
}

#[tauri::command]
fn get_orchestrator_token(state: tauri::State<OrchestratorState>) -> Result<String, String> {
    state
        .token
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "orchestrator not ready yet".to_string())
}

/// Lets a saved API key take effect without quitting the whole app - kills the current
/// orchestrator child and spawns a fresh one, which re-reads api-keys.json from scratch. A real,
/// previously-shipped bug here: this command has no way to signal the frontend that a restart
/// happened, and depending on the old WebSocket's own `close` event alone to trigger
/// `scheduleReconnect` (src/main.ts) proved unreliable in practice. Fixed on the frontend side
/// instead - the Restart button's own click handler now explicitly closes the stale connection
/// and calls `connect()` itself right after this command resolves, rather than waiting on that
/// event.
#[tauri::command]
fn restart_orchestrator(app: tauri::AppHandle, state: tauri::State<OrchestratorState>) {
    *state.port.lock().unwrap() = None;
    *state.token.lock().unwrap() = None;
    let taken = state.child.lock().unwrap().take();
    if let Some(mut child) = taken {
        let _ = child.kill();
    }
    spawn_orchestrator(&app, &state);
}

// Phase 2 Step 3 of the long-horizon build plan (relay run
// 2026-09-10T20-03-03-692Z/revise-1.md, "Export a run as markdown"): "Copy as Markdown"
// (clipboard, handled entirely on the frontend) and "Export" (this file) for each seat and
// the Debate panel. Export always lands in this one app-owned directory, never a
// user-chosen path - that's what makes "Recent exports" (list_recent_exports) a real,
// browsable feature instead of the app having to remember an arbitrary picker answer per file.
const EXPORTS_SUBDIR: &str = "exports";

fn exports_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?
        .join(EXPORTS_SUBDIR);
    fs::create_dir_all(&dir).map_err(|e| format!("could not create exports dir: {e}"))?;
    Ok(dir)
}

/// `filename` is generated by the frontend (seat id + export kind + timestamp -
/// src/exportMarkdown.ts callers in main.ts) but never trusted as a safe path on its own -
/// reduced to its bare file-name component here before it ever reaches `fs::write`.
fn sanitize_export_filename(name: &str) -> Result<String, String> {
    let base = std::path::Path::new(name)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "invalid export filename".to_string())?;
    if base.is_empty() || base == "." || base == ".." {
        return Err("invalid export filename".to_string());
    }
    Ok(base.to_string())
}

#[tauri::command]
fn export_run_markdown(app: tauri::AppHandle, filename: String, content: String) -> Result<String, String> {
    let safe_name = sanitize_export_filename(&filename)?;
    let dir = exports_dir(&app)?;
    let path = dir.join(&safe_name);
    fs::write(&path, &content).map_err(|e| format!("could not write export: {e}"))?;
    // "via Tauri's dialog" (PLAN.md Phase 2 Step 3's own wording) - a real native confirmation
    // that the write happened and where, not a silent success. Best-effort: a failed/blocked
    // dialog (e.g. no display) must never undo an export that already succeeded on disk.
    let _ = app
        .dialog()
        .message(format!("Exported to {}", path.display()))
        .title("Sophi-A export")
        .blocking_show();
    Ok(path.display().to_string())
}

#[derive(Serialize)]
struct ExportEntry {
    name: String,
    path: String,
    modified_ms: u64,
}

// Generous - matches history-list/run-recorder-style "most recent N" lists elsewhere in this
// app; this is a browse list for a human, not a paginated archive.
const RECENT_EXPORTS_LIMIT: usize = 30;

#[tauri::command]
fn list_recent_exports(app: tauri::AppHandle) -> Result<Vec<ExportEntry>, String> {
    let dir = exports_dir(&app)?;
    let mut entries: Vec<ExportEntry> = fs::read_dir(&dir)
        .map_err(|e| format!("could not read exports dir: {e}"))?
        .filter_map(|e| e.ok())
        // Backlog item 6: CSV cost-breakdown exports share this same directory/command
        // (export_run_markdown just writes a string - nothing markdown-specific about it), so
        // they belong in this same browse list, not a second one.
        .filter(|e| e.path().extension().map(|ext| ext == "md" || ext == "csv").unwrap_or(false))
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let modified = meta.modified().ok()?;
            let modified_ms = modified.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
            Some(ExportEntry {
                name: e.file_name().to_string_lossy().to_string(),
                path: e.path().display().to_string(),
                modified_ms,
            })
        })
        .collect();
    entries.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    entries.truncate(RECENT_EXPORTS_LIMIT);
    Ok(entries)
}

/// Reopens one file from "Recent exports". Re-validates the requested path actually resolves
/// inside this app's own exports dir - never an arbitrary filesystem read from a string the
/// frontend hands back, even though today the frontend only ever passes back a path this same
/// session just listed via `list_recent_exports`.
#[tauri::command]
fn read_export_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let dir = exports_dir(&app)?;
    let canonical_dir = fs::canonicalize(&dir).map_err(|e| format!("could not resolve exports dir: {e}"))?;
    let canonical_requested =
        fs::canonicalize(PathBuf::from(&path)).map_err(|e| format!("export not found: {e}"))?;
    if !canonical_requested.starts_with(&canonical_dir) {
        return Err("refusing to read a path outside the exports directory".to_string());
    }
    fs::read_to_string(&canonical_requested).map_err(|e| format!("could not read export: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = OrchestratorState {
        port: Arc::new(Mutex::new(None)),
        token: Arc::new(Mutex::new(None)),
        child: Mutex::new(None),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(state)
        .setup(|app| {
            let handle = app.handle().clone();
            let state: tauri::State<OrchestratorState> = app.state();
            spawn_orchestrator(&handle, &state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_orchestrator_port,
            get_orchestrator_token,
            debug_log,
            list_api_key_providers,
            set_api_key,
            check_claude_cli,
            restart_orchestrator,
            export_run_markdown,
            list_recent_exports,
            read_export_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state: tauri::State<OrchestratorState> = app_handle.state();
                let taken = state.child.lock().unwrap().take();
                if let Some(mut child) = taken {
                    let _ = child.kill();
                }
            }
        });
}
