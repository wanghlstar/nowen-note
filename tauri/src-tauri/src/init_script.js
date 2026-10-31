// Injected into the Lite webview before any page script (built by
// build_init_script in main.rs; see docs/tauri-lite-plan.md).
// Placeholders substituted at window creation:
//   __AUTH_JSON__     - bootstrap-local result ({token,refreshToken,user}) or null
//   __APP_INFO_JSON__ - { name, version, platform, releaseChannel }
//   __BACKEND_PORT__  - local backend port
(function () {
  var auth = __AUTH_JSON__;
  var appInfo = __APP_INFO_JSON__;
  var backendPort = __BACKEND_PORT__;
  function invoke(name) {
    // Tauri injects window.__TAURI_INTERNALS__ before user initialization
    // scripts (tauri::manager::webview prepends its own scripts), so commands
    // can be invoked even though the prebuilt frontend does not bundle
    // @tauri-apps/api.
    var internals = window.__TAURI_INTERNALS__;
    if (internals && typeof internals.invoke === 'function') {
      return internals.invoke(name);
    }
    if (window.__TAURI__ && typeof window.__TAURI__.invoke === 'function') {
      return window.__TAURI__.invoke(name);
    }
    if (name === 'get_local_auth') return Promise.resolve(auth);
    if (name === 'get_app_info') return Promise.resolve(appInfo);
    if (name === 'backend_port') return Promise.resolve(backendPort);
    return Promise.reject(new Error('nowenDesktop command unavailable: ' + name));
  }
  // Rust 命令返回 { account, reason }；无 IPC 的嵌入回落是裸 account。
  function unwrapLocalAuth(result) {
    if (!result) return null;
    var account = result.account || null;
    if (account && account.token) return account;
    if (result.token) return result;
    return null;
  }
  if (window.nowenDesktop) return;
  var listeners = {};
  window.nowenDesktop = {
    isDesktop: true,
    isLiteOnly: true,
    platform: 'tauri',
    releaseChannel: 'lite',
    on: function (channel, listener) {
      (listeners[channel] = listeners[channel] || []).push(listener);
      return function () {
        listeners[channel] = (listeners[channel] || []).filter(function (l) { return l !== listener; });
      };
    },
    // 每次调用都让主进程重新 bootstrap-local 签一张新会话的 token。
    // 窗口创建时嵌入的 auth 是静态的：登出会吊销它的会话（access 与 refresh
    // 同一 jti，一起失效），而 reload 后 init script 会把同一个已失效 token
    // 再次注入，零登录路径不经验证直接信任 → 请求 401 → broadcastLogout +
    // reload → 再注入 → 无限闪屏。重新签发与 Electron clear-local-auth 后的
    // 行为一致。主进程明确没有本地账号时返回 null（前端回登录页），绝不能
    // 回落嵌入的失效 token；仅传输层失败（后端未就绪）才退回嵌入值——后端
    // 不可达时请求只会网络失败，不会 401，不构成循环。
    getLocalAuth: function () {
      return invoke('get_local_auth').then(unwrapLocalAuth).catch(function () { return auth; });
    },
    getAppInfo: function () { return invoke('get_app_info'); },
    getBackendPort: function () { return invoke('backend_port'); },
    // Phase A 未实现的能力：返回明确的 not-supported，UI 据此降级提示
    // （tauri-plugin-updater / opener / 日志目录见 docs/tauri-lite-plan.md §8）。
    checkForUpdates: function () { return Promise.resolve({ ok: false, reason: 'not-supported' }); },
    quitAndInstall: function () { return Promise.resolve({ ok: false }); },
    openLogDir: function () { return Promise.resolve({ ok: false, path: '' }); },
  };
})();
