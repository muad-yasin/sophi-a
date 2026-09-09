// Bridge/IPC (PLAN.md "Bridge/IPC", "Orchestrator core"): spawns the Node orchestrator as a
// plain child process on app start (not Tauri's formal externalBin/sidecar bundling mechanism -
// that expects a precompiled per-target binary, which is overkill for a dev-only slice with no
// installer yet, per PLAN.md's own "Out of scope for slice 1" decision), reads its stdout for the
// `PORT:<n>` line the orchestrator prints once its ephemeral WebSocket is listening, and exposes
// that port to the frontend via the `get_orchestrator_port` command so it can connect directly.
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::Manager;

struct OrchestratorState {
    port: Arc<Mutex<Option<u16>>>,
    child: Mutex<Option<Child>>,
}

// Absolute path to src/orchestrator/index.js on this machine, computed at compile time from
// this crate's own manifest directory. Slice 1 is dev-only (no installer, PLAN.md "Out of
// scope"), so a build-time absolute path is an accepted, deliberate limitation, not an oversight.
fn orchestrator_entry_path() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")); // .../cnc-harness/src-tauri
    manifest_dir
        .parent()
        .expect("src-tauri should have a parent directory")
        .join("src")
        .join("orchestrator")
        .join("index.js")
}

fn spawn_orchestrator(state: &OrchestratorState) {
    let entry = orchestrator_entry_path();
    let cwd = entry
        .parent() // .../src/orchestrator
        .and_then(|p| p.parent()) // .../src
        .and_then(|p| p.parent()) // .../cnc-harness (repo root)
        .expect("orchestrator entry path should be three levels under the repo root");

    let mut child = match Command::new("node")
        .arg(&entry)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("cnc-harness: failed to spawn orchestrator ({entry:?}): {e}");
            return;
        }
    };

    let stdout = child.stdout.take().expect("orchestrator stdout should be piped");
    let port_handle = Arc::clone(&state.port);
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            if let Some(rest) = line.strip_prefix("PORT:") {
                if let Ok(port) = rest.trim().parse::<u16>() {
                    *port_handle.lock().unwrap() = Some(port);
                }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = OrchestratorState {
        port: Arc::new(Mutex::new(None)),
        child: Mutex::new(None),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .setup(|app| {
            let state: tauri::State<OrchestratorState> = app.state();
            spawn_orchestrator(&state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_orchestrator_port, debug_log])
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
