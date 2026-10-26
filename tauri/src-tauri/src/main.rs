// Nowen Note Lite — Tauri shell.
//
// Responsibilities (Phase A, see docs/tauri-lite-plan.md):
// 1. Start the local backend sidecar (node backend/dist/index.js) before the
//    window opens, mirroring electron/main.js.
// 2. Open the prebuilt frontend (frontend/dist/index.html) with the backend
//    address injected via the `?serverUrl=` query, mirroring how Electron
//    loads the renderer.
// 3. Inject a minimal `window.nowenDesktop` bridge shim so the existing
//    desktop login path (App.tsx local auth) works unchanged.
// 4. Kill the backend on exit.

mod sidecar;

use sidecar::{backend_port, ensure_backend, get_local_auth, shutdown, BackendState};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Injected before any page script. Mirrors the subset of the Electron
/// preload bridge that App.tsx needs for zero-login local mode.
const DESKTOP_BRIDGE_SHIM: &str = r#"
(function () {
  if (window.nowenDesktop) return;
  var listeners = {};
  window.nowenDesktop = {
    isDesktop: true,
    platform: 'tauri',
    releaseChannel: 'lite',
    on: function (channel, listener) {
      (listeners[channel] = listeners[channel] || []).push(listener);
      return function () {
        listeners[channel] = (listeners[channel] || []).filter(function (l) { return l !== listener; });
      };
    },
    getLocalAuth: function () { return window.__TAURI__.invoke('get_local_auth'); },
    getAppInfo: function () { return window.__TAURI__.invoke('get_app_info'); },
    getBackendPort: function () { return window.__TAURI__.invoke('backend_port'); },
  };
})();
"#;

#[tauri::command]
fn get_app_info(app: tauri::AppHandle) -> serde_json::Value {
    let version = app.package_info().version.to_string();
    let name = app.package_info().name.clone();
    serde_json::json!({
        "name": name,
        "version": version,
        "platform": "tauri",
        "releaseChannel": "lite",
    })
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(BackendState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let port = match ensure_backend(handle.clone(), handle.state::<BackendState>()) {
                Ok(port) => port,
                Err(e) => {
                    eprintln!("[tauri] backend failed to start: {e}");
                    return Err(e.into());
                }
            };

            let url = format!("index.html?serverUrl=http://127.0.0.1:{port}");
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App(url.into()))
                .title("Nowen Note Lite")
                .inner_size(1280.0, 800.0)
                .min_inner_size(960.0, 600.0)
                .initialization_script(DESKTOP_BRIDGE_SHIM)
                .build()?;

            // macOS traffic lights need the transparent titlebar treatment the
            // frontend already implements (docs/lite-mode-design.md D11).
            #[cfg(target_os = "macos")]
            {
                use tauri::TitleBarStyle;
                let _ = window.set_title_bar_style(TitleBarStyle::Transparent);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                shutdown(window.state::<BackendState>());
            }
        })
        .invoke_handler(tauri::generate_handler![
            backend_port,
            ensure_backend,
            get_local_auth,
            get_app_info,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Nowen Note Lite application");

    app.run(|app_handle: &tauri::AppHandle, event| {
        if let tauri::RunEvent::Exit = event {
            shutdown(app_handle.state::<BackendState>());
        }
    });
}

fn main() {
    run();
}
