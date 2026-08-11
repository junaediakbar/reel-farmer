use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_updater::UpdaterExt;

/// Holds the `bun run web` child process so it can be killed when the window closes.
struct ServerProcess(Mutex<Option<Child>>);

fn server_port() -> u16 {
    std::env::var("WEB_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3001)
}

fn wait_for_server(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

/// Checks the configured GitHub Releases endpoint for a newer signed build,
/// installs it, and restarts the app. Silent — no progress UI or user consent
/// prompt yet (ponytail: single-user desktop app, install-and-restart is the
/// whole roadmap item; add a prompt/progress bar if silent restarts surprise users).
async fn check_for_update(app: tauri::AppHandle) -> tauri_plugin_updater::Result<()> {
    if let Some(update) = app.updater()?.check().await? {
        log::info!("update {} available, installing", update.version);
        update.download_and_install(|_, _| {}, || {}).await?;
        log::info!("update installed, restarting");
        app.restart();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ServerProcess(Mutex::new(None)))
        .setup(|app| {
            let port = server_port();

            // dev: cargo's cwd is src-tauri/, so its parent is the project root `bun run web` needs.
            // ponytail: still assumes `bun` itself is on PATH — bundling the Bun runtime as a Tauri
            // sidecar (rather than relying on a dev-tree install) is separate from Fase 1 item #6
            // (yt-dlp/ffmpeg/whisper-cli/model download, now handled in src/modules/dependency-installer.ts).
            let project_root = std::env::current_dir()?
                .parent()
                .expect("src-tauri has no parent directory")
                .to_path_buf();

            let child = Command::new("bun")
                .args(["run", "web"])
                .current_dir(&project_root)
                .stdout(Stdio::inherit())
                .stderr(Stdio::inherit())
                .spawn()
                .expect("failed to start the reel-farmer web server — is `bun` on PATH?");

            app.state::<ServerProcess>().0.lock().unwrap().replace(child);

            if !wait_for_server(port, Duration::from_secs(20)) {
                log::warn!("web server not reachable on port {port} after 20s; opening window anyway");
            }

            let url = format!("http://localhost:{port}").parse().expect("invalid server URL");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Reel Farmer")
                .inner_size(1280.0, 860.0)
                .build()?;

            let update_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = check_for_update(update_handle).await {
                    log::warn!("update check failed: {e}");
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window.app_handle().state::<ServerProcess>();
                let child = state.0.lock().unwrap().take();
                if let Some(mut child) = child {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
