import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * 回归：登出后无限闪屏（P0）。
 *
 * 根因是 init script 把窗口创建时嵌入的静态零登录 token 在每次 reload 后
 * 重新注入：登出已吊销它的会话，零登录路径却不经验证直接信任 → 401 →
 * broadcastLogout + reload → 再注入，循环不止。
 *
 * 本测试执行真实发货的 init_script.js（main.rs 的 include_str! 源），
 * 断言 getLocalAuth 每次调用都经 IPC 重新签发（新会话 token），
 * 主进程明确无账号时返回 null 而不是回落失效的嵌入 token。
 */

const INIT_SCRIPT_SOURCE = readFileSync(
  path.resolve(__dirname, "../../../../tauri/src-tauri/src/init_script.js"),
  "utf8",
);

const EMBEDDED_ACCOUNT = {
  token: "embedded-revoked-token",
  refreshToken: "embedded-revoked-refresh",
  user: { id: "u1", username: "desktop", role: "admin" },
};

const FRESH_ACCOUNT = {
  token: "fresh-session-token",
  refreshToken: "fresh-session-refresh",
  user: { id: "u1", username: "desktop", role: "admin" },
};

type DesktopBridge = {
  isDesktop: boolean;
  getLocalAuth: () => Promise<unknown>;
  getAppInfo: () => Promise<unknown>;
  getBackendPort: () => Promise<unknown>;
};

function runInitScript(options: {
  embedded?: unknown;
  invoke: (command: string) => Promise<unknown>;
}) {
  // main.rs 的 build_init_script 用 Rust str::replace（全量替换），
  // 占位符在注释与代码中各出现一次，这里同样必须全量替换。
  const source = INIT_SCRIPT_SOURCE.replaceAll("__AUTH_JSON__", JSON.stringify(options.embedded ?? null))
    .replaceAll("__APP_INFO_JSON__", JSON.stringify({ name: "Nowen Note Lite", version: "1.5.3" }))
    .replaceAll("__BACKEND_PORT__", "8781");
  const fakeWindow: {
    nowenDesktop?: DesktopBridge;
    __TAURI_INTERNALS__?: { invoke: (command: string) => Promise<unknown> };
  } = { __TAURI_INTERNALS__: { invoke: options.invoke } };
  new Function("window", source)(fakeWindow);
  if (!fakeWindow.nowenDesktop) throw new Error("init script did not install nowenDesktop");
  return fakeWindow.nowenDesktop;
}

describe("tauri init script getLocalAuth（登出闪屏回归）", () => {
  it("每次调用都经 IPC 重新签发，不返回窗口创建时嵌入的静态 token", async () => {
    const invoke = vi.fn(async (command: string) => {
      expect(command).toBe("get_local_auth");
      return { account: FRESH_ACCOUNT, reason: null };
    });
    const bridge = runInitScript({ embedded: EMBEDDED_ACCOUNT, invoke });

    const first = await bridge.getLocalAuth();
    const second = await bridge.getLocalAuth();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(first).toEqual(FRESH_ACCOUNT);
    expect(second).toEqual(FRESH_ACCOUNT);
  });

  it("解包 Rust 命令的 { account, reason } 结构", async () => {
    const bridge = runInitScript({
      embedded: EMBEDDED_ACCOUNT,
      invoke: async () => ({ account: FRESH_ACCOUNT, reason: null }),
    });

    await expect(bridge.getLocalAuth()).resolves.toEqual(FRESH_ACCOUNT);
  });

  it("主进程明确没有本地账号时返回 null，不回落已失效的嵌入 token", async () => {
    const bridge = runInitScript({
      embedded: EMBEDDED_ACCOUNT,
      invoke: async () => ({ account: null, reason: "LOCAL_ACCOUNT_DISABLED" }),
    });

    await expect(bridge.getLocalAuth()).resolves.toBeNull();
  });

  it("传输层失败（后端未就绪）才退回嵌入值", async () => {
    const bridge = runInitScript({
      embedded: EMBEDDED_ACCOUNT,
      invoke: async () => { throw new Error("backend not started"); },
    });

    await expect(bridge.getLocalAuth()).resolves.toEqual(EMBEDDED_ACCOUNT);
  });

  it("getAppInfo / getBackendPort 仍走 IPC", async () => {
    const bridge = runInitScript({
      embedded: EMBEDDED_ACCOUNT,
      invoke: async (command: string) =>
        command === "get_app_info"
          ? { name: "Nowen Note Lite", version: "1.5.3" }
          : command === "backend_port"
            ? 8781
            : { account: FRESH_ACCOUNT, reason: null },
    });

    await expect(bridge.getAppInfo()).resolves.toMatchObject({ name: "Nowen Note Lite" });
    await expect(bridge.getBackendPort()).resolves.toBe(8781);
  });
});
