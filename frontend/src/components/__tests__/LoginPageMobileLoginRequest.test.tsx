import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "../LoginPage";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { loginRequested } = vi.hoisted(() => ({ loginRequested: vi.fn(() => false) }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/useSiteSettings", () => ({
  useSiteSettings: () => ({
    siteConfig: { title: "nowen-note", favicon: "", icpBeian: "", editorFontFamily: "" },
  }),
}));
vi.mock("@/hooks/useCapacitor", () => ({ useKeyboardLayout: () => {} }));
vi.mock("@/hooks/useKeyboardVisible", () => ({ useKeyboardVisible: () => ({ height: 0 }) }));
vi.mock("@/components/LanDiscoveryPanel", () => ({ default: () => <div /> }));
vi.mock("@/components/AccountLoginHistory", () => ({ AccountLoginHistoryList: () => null }));
vi.mock("@/lib/accountLoginHistory", () => ({ consumePendingAccountReauth: () => null }));
vi.mock("@/lib/rememberLogin", () => ({
  canPersistPassword: vi.fn(async () => false),
  loadRememberedCredentials: vi.fn(async () => null),
  saveRememberedCredentials: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/ugreenRemoteAccess", () => ({
  isUgreenRemoteAccessUrl: () => false,
  openUgreenRemoteWorkspace: vi.fn(),
}));
vi.mock("@/lib/desktopBridge", () => ({
  getDesktopLocalLoginHint: vi.fn(async () => null),
  completeDesktopLocalLoginHint: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/api", () => ({
  clearServerUrl: vi.fn(),
  fetchRegisterConfig: vi.fn(async () => ({ allowRegistration: true, hasUsers: true })),
  getServerUrl: vi.fn(() => ""),
  registerAccount: vi.fn(),
  setServerUrl: vi.fn(),
  testServerConnection: vi.fn(async () => ({ ok: true })),
}));
// Lite 包（安卓 / 桌面 Lite）
vi.mock("@/lib/featureRegistry", () => ({ getFeatureProfile: () => "lite" }));
vi.mock("@/lib/mobileLocalMode", () => ({ isMobileAccountLoginRequested: loginRequested }));

let root: Root | null = null;
const host = document.createElement("div");

beforeEach(() => {
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  loginRequested.mockReturnValue(false);
});

describe("LoginPage lite local-first entry", () => {
  it("shows the local-first card by default", async () => {
    const onContinueLocal = vi.fn();
    await act(async () => root?.render(<LoginPage isClientMode onLogin={vi.fn()} onContinueLocal={onContinueLocal} />));
    expect(host.textContent).toContain("auth.liteLocalFirstTitle");
    const button = Array.from(host.querySelectorAll("button"))
      .find((item) => item.textContent === "auth.liteEnterLocalNotes");
    expect(button).toBeTruthy();
    await act(async () => button?.click());
    expect(onContinueLocal).toHaveBeenCalledTimes(1);
  });

  it("shows the server login form after the mobile sync settings asked for an account login", async () => {
    // 回归：安卓「设置 → 同步 → 使用自己的服务器」会 requestMobileAccountLogin()
    // 后重载；若这里仍渲染本地入口，就会在登录页和「进入本地笔记」之间死循环。
    loginRequested.mockReturnValue(true);
    const onContinueLocal = vi.fn();
    await act(async () => root?.render(<LoginPage isClientMode onLogin={vi.fn()} onContinueLocal={onContinueLocal} />));
    expect(host.textContent).not.toContain("auth.liteLocalFirstTitle");
    expect(host.querySelector('input[autocomplete="current-password"]')).toBeTruthy();
    expect(host.textContent).toContain("auth.continueLocal");
  });
});
