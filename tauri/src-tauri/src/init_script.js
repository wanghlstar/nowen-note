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
    // Prefer the real Tauri JS API when the frontend is built with
    // @tauri-apps/api (later phase); the prebuilt dist does not include it,
    // so fall back to the values embedded at window creation.
    if (window.__TAURI__ && typeof window.__TAURI__.invoke === 'function') {
      return window.__TAURI__.invoke(name);
    }
    if (name === 'get_local_auth') return Promise.resolve(auth);
    if (name === 'get_app_info') return Promise.resolve(appInfo);
    if (name === 'backend_port') return Promise.resolve(backendPort);
    return Promise.reject(new Error('nowenDesktop command unavailable: ' + name));
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
    getLocalAuth: function () { return invoke('get_local_auth'); },
    getAppInfo: function () { return invoke('get_app_info'); },
    getBackendPort: function () { return invoke('backend_port'); },
    // Phase A 未实现的能力：返回明确的 not-supported，UI 据此降级提示
    // （tauri-plugin-updater / opener / 日志目录见 docs/tauri-lite-plan.md §8）。
    checkForUpdates: function () { return Promise.resolve({ ok: false, reason: 'not-supported' }); },
    quitAndInstall: function () { return Promise.resolve({ ok: false }); },
    openLogDir: function () { return Promise.resolve({ ok: false, path: '' }); },
  };
})();
