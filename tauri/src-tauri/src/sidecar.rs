//! Local backend sidecar management for Nowen Note Lite.
//!
//! Mirrors the Electron implementation in `electron/main.js`:
//! - preferred port 57892 with random fallback (`getFreePort`)
//! - spawns `node backend/dist/index.js` with the same env contract
//! - polls `GET /api/health` until ready
//! - bootstraps the local admin account via `/auth/desktop/bootstrap-local`

use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

const PREFERRED_BACKEND_PORT: u16 = 57892;
const HEALTH_PATH: &str = "/api/health";
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(300);
const HEALTH_REQUEST_TIMEOUT: Duration = Duration::from_millis(1000);
const HEALTH_TOTAL_TIMEOUT: Duration = Duration::from_secs(30);
const API_TIMEOUT: Duration = Duration::from_millis(5000);

/// PID of the spawned backend, shared with the signal handler. SIGTERM/SIGINT
/// bypass Tauri's RunEvent::Exit and Rust destructors, so without this handler
/// `kill <app>` would orphan the node child.
static BACKEND_PID: AtomicU32 = AtomicU32::new(0);

#[cfg(unix)]
extern "C" fn on_terminate_signal(_sig: i32) {
    let pid = BACKEND_PID.load(Ordering::SeqCst);
    if pid != 0 {
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
    }
    unsafe {
        libc::_exit(0);
    }
}

#[cfg(unix)]
fn install_signal_handlers() {
    let handler = on_terminate_signal as *const () as libc::sighandler_t;
    unsafe {
        libc::signal(libc::SIGTERM, handler);
        libc::signal(libc::SIGINT, handler);
        libc::signal(libc::SIGHUP, handler);
    }
}

pub struct BackendProcess {
    child: Option<Child>,
    port: u16,
    app_data_dir: PathBuf,
}

impl BackendProcess {
    pub fn port(&self) -> u16 {
        self.port
    }

    fn kill(&mut self) {
        BACKEND_PID.store(0, Ordering::SeqCst);
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for BackendProcess {
    fn drop(&mut self) {
        self.kill();
    }
}

pub struct BackendState {
    pub process: Mutex<Option<BackendProcess>>,
    pub ready: AtomicBool,
}

impl Default for BackendState {
    fn default() -> Self {
        Self {
            process: Mutex::new(None),
            ready: AtomicBool::new(false),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalAuthUser {
    pub id: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub role: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalAuthAccount {
    pub token: String,
    #[serde(rename = "refreshToken", default)]
    pub refresh_token: Option<String>,
    pub user: LocalAuthUser,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalAuthResult {
    pub account: Option<LocalAuthAccount>,
    #[serde(default)]
    pub reason: Option<String>,
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir failed: {e}"))
}

/// Reads a secret file, generating and persisting a new one (mode 0600) when
/// missing or shorter than 16 chars. Mirrors `ensureJwtSecret` /
/// `getLocalAccountSecret` in electron/main.js.
fn read_or_create_secret(path: &std::path::Path, byte_len: usize) -> Result<String, String> {
    if let Ok(existing) = std::fs::read_to_string(path) {
        let trimmed = existing.trim();
        if trimmed.len() >= 16 {
            return Ok(trimmed.to_string());
        }
    }
    let mut buf = vec![0u8; byte_len];
    rand::thread_rng().fill_bytes(&mut buf);
    use std::io::Write as _;
    let secret = base64_encode(&buf);
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut file = opts
        .open(path)
        .map_err(|e| format!("create secret {} failed: {e}", path.display()))?;
    file.write_all(secret.as_bytes())
        .map_err(|e| format!("write secret failed: {e}"))?;
    Ok(secret)
}

const B64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            B64[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// Tries the preferred port first, then falls back to a random free port.
fn pick_backend_port() -> Result<u16, String> {
    // The backend listens on the IPv6 wildcard ("::"), so the probe must bind
    // the same wildcard: probing 127.0.0.1 alone misses a port held by another
    // instance (e.g. the Electron app) and the backend then dies with EADDRINUSE.
    let probe = match TcpListener::bind(("::", PREFERRED_BACKEND_PORT)) {
        Ok(listener) => listener,
        Err(_) => TcpListener::bind(("::", 0))
            .map_err(|e| format!("bind fallback port failed: {e}"))?,
    };
    let port = probe
        .local_addr()
        .map_err(|e| format!("read local addr failed: {e}"))?
        .port();
    drop(probe);
    Ok(port)
}

fn node_executable(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(from_env) = std::env::var_os("NOWEN_TAURI_NODE") {
        let p = PathBuf::from(from_env);
        if p.exists() {
            return Ok(p);
        }
    }
    // Packaged: the `node` external binary sits next to the app executable.
    if let Ok(exe_dir) = app.path().resolve("", tauri::path::BaseDirectory::Executable) {
        let candidate = exe_dir.join("node");
        if candidate.exists() {
            return Ok(candidate);
        }
    }
    // Dev: rely on PATH.
    if let Some(path_os) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_os) {
            let candidate = dir.join(if cfg!(windows) { "node.exe" } else { "node" });
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }
    Err("node executable not found: set NOWEN_TAURI_NODE or place the node sidecar binary".into())
}

fn backend_entry(app: &AppHandle) -> Result<PathBuf, String> {
    // Packaged: bundled under Resources/backend/dist/index.js
    if let Ok(resource) = app
        .path()
        .resolve("backend/dist/index.js", tauri::path::BaseDirectory::Resource)
    {
        if resource.exists() {
            return Ok(resource);
        }
    }
    // Dev: <repo>/backend/dist/index.js relative to src-tauri
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../backend/dist/index.js")
        .canonicalize()
        .map_err(|e| format!("backend/dist/index.js not built: {e}"))?;
    Ok(dev)
}

fn backend_cwd(app: &AppHandle) -> PathBuf {
    if let Ok(resource) = app
        .path()
        .resolve("backend", tauri::path::BaseDirectory::Resource)
    {
        if resource.exists() {
            return resource;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn forward_output<R: Read + Send + 'static>(label: &'static str, stream: R) {
    std::thread::spawn(move || {
        let reader = std::io::BufReader::new(stream);
        use std::io::BufRead;
        for line in reader.lines() {
            match line {
                Ok(line) => eprintln!("[backend:{label}] {line}"),
                Err(_) => break,
            }
        }
    });
}

pub fn start_backend(app: &AppHandle) -> Result<u16, String> {
    let state = app.state::<BackendState>();
    {
        let guard = state.process.lock().unwrap();
        if let Some(proc) = guard.as_ref() {
            return Ok(proc.port());
        }
    }

    let data_dir = app_data_dir(app)?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("create app data dir failed: {e}"))?;

    let db_path = data_dir.join("nowen-note.db");
    let jwt_secret = read_or_create_secret(&data_dir.join(".jwt_secret"), 48)?;
    let local_account_secret = read_or_create_secret(&data_dir.join(".local_account_secret"), 32)?;

    let port = pick_backend_port()?;
    let node = node_executable(app)?;
    let entry = backend_entry(app)?;
    let cwd = backend_cwd(app);
    let frontend_dist = if let Ok(resource) = app
        .path()
        .resolve("frontend/dist", tauri::path::BaseDirectory::Resource)
    {
        if resource.exists() {
            resource
        } else {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../frontend/dist")
        }
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../frontend/dist")
    };

    let mut command = Command::new(&node);
    command
        .arg(&entry)
        .current_dir(&cwd)
        .env("NODE_ENV", "production")
        .env("PORT", port.to_string())
        .env("DB_PATH", &db_path)
        .env("ELECTRON_USER_DATA", &data_dir)
        .env("ELECTRON_LOCAL_ACCOUNT_SECRET", &local_account_secret)
        .env("FRONTEND_DIST", &frontend_dist)
        .env("JWT_SECRET", &jwt_secret)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("spawn backend failed ({}): {e}", entry.display()))?;

    BACKEND_PID.store(child.id(), Ordering::SeqCst);
    #[cfg(unix)]
    install_signal_handlers();

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    if let Some(out) = stdout {
        forward_output("out", out);
    }
    if let Some(err) = stderr {
        forward_output("err", err);
    }

    let mut process_guard = state.process.lock().unwrap();
    if let Some(mut old) = process_guard.take() {
        old.kill();
    }
    process_guard.replace(BackendProcess {
        child: Some(child),
        port,
        app_data_dir: data_dir,
    });
    drop(process_guard);

    wait_for_backend_ready(port).map_err(|e| {
        if let Ok(mut guard) = state.process.lock() {
            if let Some(mut proc) = guard.take() {
                proc.kill();
            }
        }
        let _ = app.emit("backend-error", e.clone());
        e
    })?;

    state.ready.store(true, Ordering::SeqCst);
    let _ = app.emit("backend-ready", port);
    Ok(port)
}

fn wait_for_backend_ready(port: u16) -> Result<(), String> {
    let deadline = Instant::now() + HEALTH_TOTAL_TIMEOUT;
    let mut last_err = String::from("no attempt made");
    while Instant::now() < deadline {
        match http_request("GET", port, HEALTH_PATH, &[], None) {
            Ok((200, _)) => return Ok(()),
            Ok((status, _)) => last_err = format!("health returned {status}"),
            Err(e) => last_err = e,
        }
        std::thread::sleep(HEALTH_POLL_INTERVAL);
    }
    Err(format!(
        "backend not ready after {:?}: {last_err}",
        HEALTH_TOTAL_TIMEOUT
    ))
}

/// Minimal HTTP/1.1 client over a fresh connection (Connection: close).
fn http_request(
    method: &str,
    port: u16,
    path: &str,
    headers: &[(&str, String)],
    body: Option<&[u8]>,
) -> Result<(u16, String), String> {
    let body = body.unwrap_or(&[]);
    let timeout = if path == HEALTH_PATH {
        HEALTH_REQUEST_TIMEOUT
    } else {
        API_TIMEOUT
    };
    let addr = format!("127.0.0.1:{port}");
    let stream = TcpStream::connect_timeout(
        &addr
            .parse()
            .map_err(|e| format!("invalid backend address: {e}"))?,
        timeout,
    )
    .map_err(|e| format!("connect {addr} failed: {e}"))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|e| format!("set read timeout failed: {e}"))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|e| format!("set write timeout failed: {e}"))?;

    let mut request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\nContent-Length: {}\r\n",
        body.len()
    );
    for (name, value) in headers {
        request.push_str(&format!("{name}: {value}\r\n"));
    }
    request.push_str("\r\n");

    let mut stream = stream;
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("send request failed: {e}"))?;
    if !body.is_empty() {
        stream
            .write_all(body)
            .map_err(|e| format!("send body failed: {e}"))?;
    }
    stream
        .flush()
        .map_err(|e| format!("flush request failed: {e}"))?;

    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|e| format!("read response failed: {e}"))?;

    let head_end = response
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| "malformed HTTP response".to_string())?;
    let head = String::from_utf8_lossy(&response[..head_end]).to_string();
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| "missing HTTP status line".to_string())?;
    let body_text = String::from_utf8_lossy(&response[head_end + 4..]).to_string();
    Ok((status, body_text))
}

#[tauri::command]
pub fn backend_port(state: State<'_, BackendState>) -> Result<u16, String> {
    let guard = state.process.lock().unwrap();
    guard
        .as_ref()
        .map(|proc| proc.port())
        .ok_or_else(|| "backend not started".to_string())
}

#[tauri::command]
pub fn ensure_backend(app: AppHandle, state: State<'_, BackendState>) -> Result<u16, String> {
    let _ = state;
    start_backend(&app)
}

/// Bootstraps the local admin account, mirroring electron/localAccountBootstrap.js.
/// Synchronous on purpose: it runs on Tauri's command thread pool, never on the
/// async runtime.
#[tauri::command]
pub fn get_local_auth(
    _app: AppHandle,
    state: State<'_, BackendState>,
) -> Result<LocalAuthResult, String> {
    let (port, data_dir) = {
        let guard = state.process.lock().unwrap();
        let proc = guard
            .as_ref()
            .ok_or_else(|| "backend not started".to_string())?;
        (proc.port(), proc.app_data_dir.clone())
    };

    let secret_path = data_dir.join(".local_account_secret");
    let secret = read_or_create_secret(&secret_path, 32)?;
    let db_path = data_dir.join("nowen-note.db");
    let allow_create = if db_path.exists() { "0" } else { "1" };

    let body = serde_json::json!({
        "password": secret,
        "username": "admin",
    })
    .to_string();

    let (status, text) = http_request(
        "POST",
        port,
        "/api/auth/desktop/bootstrap-local",
        &[
            ("Content-Type", "application/json".to_string()),
            ("X-Nowen-Desktop-Secret", secret.clone()),
            ("X-Nowen-Desktop-Allow-Create", allow_create.to_string()),
        ],
        Some(body.as_bytes()),
    )?;

    if status != 200 {
        return Ok(LocalAuthResult {
            account: None,
            reason: Some(status.to_string()),
        });
    }

    #[derive(Deserialize)]
    struct Envelope {
        #[serde(default)]
        data: Option<Data>,
    }
    #[derive(Deserialize)]
    struct Data {
        #[serde(default)]
        token: Option<String>,
        #[serde(rename = "refreshToken", default)]
        refresh_token: Option<String>,
        #[serde(default)]
        user: Option<LocalAuthUser>,
    }

    let envelope: Envelope =
        serde_json::from_str(&text).map_err(|e| format!("parse bootstrap response failed: {e}"))?;
    let account = match envelope.data {
        Some(data) => match (data.token, data.user) {
            (Some(token), Some(user)) if user.role == "admin" => Some(LocalAuthAccount {
                token,
                refresh_token: data.refresh_token,
                user,
            }),
            _ => None,
        },
        None => None,
    };
    let reason = if account.is_some() {
        None
    } else {
        Some("no_local_account".to_string())
    };
    Ok(LocalAuthResult { account, reason })
}

pub fn shutdown(state: State<'_, BackendState>) {
    if let Ok(mut guard) = state.process.lock() {
        if let Some(mut proc) = guard.take() {
            proc.kill();
        }
    }
    state.ready.store(false, Ordering::SeqCst);
}
