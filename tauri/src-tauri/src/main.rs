// Nowen Note Lite — Tauri shell.
//
// Responsibilities (Phase A, see docs/tauri-lite-plan.md):
// 1. Start the local backend sidecar (node backend/dist/index.js) before the
//    window opens, mirroring electron/main.js.
// 2. Open the prebuilt frontend (frontend/dist/index.html) with the backend
//    address injected via the `?serverUrl=` query, mirroring how Electron
//    loads the renderer.
// 3. Inject a minimal `window.nowenDesktop` bridge shim so the existing
//    desktop login path (App.tsx local auth) works unchanged. The prebuilt
//    frontend does not bundle @tauri-apps/api, so the zero-login payload is
//    embedded into the init script instead of being fetched via IPC.
// 4. Kill the backend on exit.

mod sidecar;

use sidecar::{backend_port, ensure_backend, bootstrap_local_auth, shutdown, BackendState, LocalAuthAccount};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// The init script template lives in its own file so the exact shipped JS can
/// also be executed by a Node-based check (no Rust/JS drift).
const INIT_SCRIPT_TEMPLATE: &str = include_str!("init_script.js");

/// Escapes `<`, `>` and `&` so embedded JSON can never break out of the
/// enclosing <script> element (`</script>` in a token or username).
fn escape_json(value: &serde_json::Value) -> String {
    serde_json::to_string(value)
        .unwrap_or_else(|_| "null".to_string())
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026")
}

/// Builds the webview initialization script with the runtime values baked in.
fn build_init_script(
    port: u16,
    auth: Option<&LocalAuthAccount>,
    app_info: &serde_json::Value,
) -> String {
    let auth_json = match auth {
        Some(account) => escape_json(&serde_json::to_value(account).unwrap_or(serde_json::Value::Null)),
        None => "null".to_string(),
    };
    INIT_SCRIPT_TEMPLATE
        .replace("__AUTH_JSON__", &auth_json)
        .replace("__APP_INFO_JSON__", &escape_json(app_info))
        .replace("__BACKEND_PORT__", &port.to_string())
}

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

            // Zero-login payload is embedded (not fetched via IPC): the
            // prebuilt frontend has no Tauri JS API. Failure resolves to
            // null, which makes App.tsx fall back to the login page.
            let auth = bootstrap_local_auth(handle.state::<BackendState>().inner());
            let app_info = get_app_info(handle.clone());
            let init_script = build_init_script(port, auth.as_ref(), &app_info);

            let url = format!("index.html?serverUrl=http://127.0.0.1:{port}");
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App(url.into()))
                .title("Nowen Note Lite")
                .inner_size(1280.0, 800.0)
                .min_inner_size(960.0, 600.0)
                .initialization_script(init_script)
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
            // macOS 习惯：点红叉 / Cmd+W 只关闭窗口（隐藏），进程与后端继续运行；
            // 只有 Cmd+Q（RunEvent::Exit）才真正退出并停止 sidecar。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            backend_port,
            ensure_backend,
            sidecar::get_local_auth,
            get_app_info,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Nowen Note Lite application");

    app.run(|app_handle: &tauri::AppHandle, event| {
        match event {
            tauri::RunEvent::Exit => shutdown(app_handle.state::<BackendState>()),
            // 点 Dock 图标重新显示窗口
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        }
    });
}

fn main() {
    run();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_auth() -> LocalAuthAccount {
        LocalAuthAccount {
            token: "tok-123".to_string(),
            refresh_token: Some("ref-456".to_string()),
            user: sidecar::LocalAuthUser {
                id: "u1".to_string(),
                username: "admin".to_string(),
                role: "admin".to_string(),
            },
        }
    }

    #[test]
    fn init_script_embeds_runtime_values() {
        let info = serde_json::json!({"name": "Nowen Note Lite", "version": "1.5.1"});
        let script = build_init_script(58587, Some(&sample_auth()), &info);
        assert!(script.contains("tok-123"), "token embedded");
        assert!(script.contains("ref-456"), "refresh token embedded");
        assert!(script.contains("58587"), "port embedded");
        assert!(script.contains("getLocalAuth"), "shim surface present");
        assert!(!script.contains("__AUTH_JSON__"), "placeholders substituted");
    }

    #[test]
    fn init_script_handles_missing_account() {
        let info = serde_json::json!({"name": "Nowen Note Lite"});
        let script = build_init_script(57892, None, &info);
        assert!(script.contains("var auth = null;"), "null auth falls back to login page");
        assert!(script.contains("57892"));
    }

    #[test]
    fn init_script_escapes_script_breakout() {
        let mut auth = sample_auth();
        auth.user.username = "</script><script>alert(1)</script>".to_string();
        let info = serde_json::json!({"name": "x"});
        let script = build_init_script(1, Some(&auth), &info);
        assert!(
            !script.contains("</script><script>alert(1)</script>"),
            "embedded JSON must not be able to close the script element"
        );
        assert!(script.contains("\\u003c/script\\u003e"), "angle brackets escaped");
    }
}
