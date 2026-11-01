import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loginMobileSyncAccount } from "../mobileSyncAccountLogin";

const mocks = vi.hoisted(() => {
  const state = { serverUrl: "" };
  return {
    state,
    setServerUrl: vi.fn((url: string) => { state.serverUrl = url.replace(/\/+$/, ""); }),
    getServerUrl: vi.fn(() => state.serverUrl),
    testServerConnection: vi.fn(),
    storeAuthTokens: vi.fn(),
    completeMobileAccountLogin: vi.fn(),
    saveAccountLoginHistory: vi.fn(),
    rememberServer: vi.fn(),
    getDeviceId: vi.fn(() => "device-1"),
  };
});

vi.mock("@/lib/api", () => ({
  setServerUrl: mocks.setServerUrl,
  getServerUrl: mocks.getServerUrl,
  testServerConnection: mocks.testServerConnection,
}));
vi.mock("@/lib/authSession", () => ({ storeAuthTokens: mocks.storeAuthTokens }));
vi.mock("@/lib/mobileLocalMode", () => ({
  completeMobileAccountLogin: mocks.completeMobileAccountLogin,
}));
vi.mock("@/lib/accountLoginHistory", () => ({
  saveAccountLoginHistory: mocks.saveAccountLoginHistory,
}));
vi.mock("@/lib/recentServers", () => ({ rememberServer: mocks.rememberServer }));
vi.mock("@/lib/deviceId", () => ({ getDeviceId: mocks.getDeviceId }));

const user = {
  id: "u1", username: "alice", email: "alice@example.com", avatarUrl: null,
  displayName: "Alice", role: "user", createdAt: "2026-01-01T00:00:00.000Z",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.serverUrl = "";
  mocks.testServerConnection.mockResolvedValue({
    ok: true, apiBaseUrl: "https://notes.example.com/api", serverBaseUrl: "https://notes.example.com",
  });
  mocks.saveAccountLoginHistory.mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loginMobileSyncAccount", () => {
  it("stores the new session only after the server accepts the password", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      token: "token-1", refreshToken: "refresh-1", user,
    }));

    const result = await loginMobileSyncAccount({
      serverUrl: " https://notes.example.com/ ", username: " alice ", password: "secret",
    });

    expect(result).toMatchObject({ status: "connected", token: "token-1" });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://notes.example.com/api/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "alice", password: "secret", deviceId: "device-1" }),
      }),
    );
    expect(mocks.completeMobileAccountLogin).toHaveBeenCalledTimes(1);
    expect(mocks.setServerUrl).toHaveBeenCalledWith("https://notes.example.com/");
    expect(mocks.storeAuthTokens).toHaveBeenCalledWith({ token: "token-1", refreshToken: "refresh-1" });
    expect(mocks.rememberServer).toHaveBeenCalledWith("https://notes.example.com", "Alice");
    expect(mocks.saveAccountLoginHistory).toHaveBeenCalledWith(expect.objectContaining({
      serverUrl: "https://notes.example.com", token: "token-1", refreshToken: "refresh-1",
    }));
  });

  it("returns the two-factor ticket without touching the stored session", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      requires2FA: true, ticket: "ticket-1", username: "alice",
    }));

    const result = await loginMobileSyncAccount({
      serverUrl: "https://notes.example.com", username: "alice", password: "secret",
    });

    expect(result).toEqual({
      status: "requires_2fa", ticket: "ticket-1", username: "alice", serverUrl: "https://notes.example.com",
    });
    expect(mocks.completeMobileAccountLogin).not.toHaveBeenCalled();
    expect(mocks.storeAuthTokens).not.toHaveBeenCalled();
  });

  it("verifies the two-factor code through the same server", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ token: "token-2", user }));

    const result = await loginMobileSyncAccount({
      serverUrl: "https://notes.example.com", ticket: "ticket-1", code: "123456",
    });

    expect(result).toMatchObject({ status: "connected", token: "token-2" });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://notes.example.com/api/auth/2fa/verify",
      expect.objectContaining({
        body: JSON.stringify({ ticket: "ticket-1", code: "123456", deviceId: "device-1" }),
      }),
    );
    expect(mocks.storeAuthTokens).toHaveBeenCalledWith({ token: "token-2", refreshToken: null });
  });

  it("maps an expired two-factor ticket without replacing the session", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ code: "TFA_TICKET_EXPIRED" }, 401));

    const result = await loginMobileSyncAccount({
      serverUrl: "https://notes.example.com", ticket: "ticket-1", code: "123456",
    });

    expect(result).toEqual({ status: "failed", reason: "two_factor_expired" });
    expect(mocks.storeAuthTokens).not.toHaveBeenCalled();
  });

  it("does not write a session when the server rejects the password", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: "用户名或密码错误" }, 401));

    const result = await loginMobileSyncAccount({
      serverUrl: "https://notes.example.com", username: "alice", password: "wrong",
    });

    expect(result).toEqual({ status: "failed", reason: "login", message: "用户名或密码错误" });
    expect(mocks.completeMobileAccountLogin).not.toHaveBeenCalled();
    expect(mocks.setServerUrl).not.toHaveBeenCalled();
    expect(mocks.storeAuthTokens).not.toHaveBeenCalled();
  });

  it("stops before login when the server cannot be reached", async () => {
    mocks.testServerConnection.mockResolvedValue({ ok: false, error: "unreachable" });

    const result = await loginMobileSyncAccount({
      serverUrl: "https://notes.example.com", username: "alice", password: "secret",
    });

    expect(result).toEqual({ status: "failed", reason: "network" });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(mocks.storeAuthTokens).not.toHaveBeenCalled();
  });
});
