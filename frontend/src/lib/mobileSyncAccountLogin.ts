import { getServerUrl, setServerUrl, testServerConnection } from "@/lib/api";
import { getResolvedApiBaseUrl } from "@/lib/serverUrl";
import { getDeviceId } from "@/lib/deviceId";
import type { User } from "@/types";
import { storeAuthTokens } from "@/lib/authSession";
import { completeMobileAccountLogin } from "@/lib/mobileLocalMode";
import { saveAccountLoginHistory } from "@/lib/accountLoginHistory";
import { rememberServer } from "@/lib/recentServers";
import { getAuthCacheScope, saveCachedAuthUser } from "@/lib/authUserCache";

export type MobileSyncAccountLoginFailureReason =
  | "network"
  | "login"
  | "two_factor_invalid"
  | "two_factor_expired"
  | "session";

export type MobileSyncAccountLoginResult =
  | { status: "connected"; token: string; user: User }
  | { status: "requires_2fa"; ticket: string; username: string; serverUrl: string }
  | { status: "failed"; reason: MobileSyncAccountLoginFailureReason; message?: string };

export interface MobileSyncAccountLoginInput {
  serverUrl: string;
  username?: string;
  password?: string;
  ticket?: string;
  code?: string;
}

interface JsonObject {
  [key: string]: unknown;
}

function isJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(data: JsonObject, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readUser(value: unknown): User | null {
  if (!isJsonObject(value)) return null;
  const id = readString(value, "id");
  const username = readString(value, "username");
  if (!id || !username) return null;
  return {
    id,
    username,
    email: readString(value, "email") ?? null,
    avatarUrl: readString(value, "avatarUrl") ?? null,
    displayName: readString(value, "displayName") ?? username,
    role: value.role === "admin" ? "admin" : "user",
    createdAt: readString(value, "createdAt") ?? new Date(0).toISOString(),
  };
}

async function postJson(url: string, body: Record<string, unknown>): Promise<
  | { ok: true; response: Response; data: JsonObject }
  | { ok: false; reason: "network" }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const parsed: unknown = await response.json().catch(() => ({}));
    return { ok: true, response, data: isJsonObject(parsed) ? parsed : {} };
  } catch {
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timer);
  }
}

async function commitSession(
  serverUrl: string,
  data: JsonObject,
): Promise<MobileSyncAccountLoginResult> {
  const token = readString(data, "token");
  const user = readUser(data.user);
  if (!token || !user) return { status: "failed", reason: "session" };

  try {
    setServerUrl(serverUrl);
    completeMobileAccountLogin();
    storeAuthTokens({ token, refreshToken: readString(data, "refreshToken") ?? null });
    saveCachedAuthUser(getAuthCacheScope(getServerUrl()), token, user);
    rememberServer(getServerUrl(), user.displayName || user.username);
    void saveAccountLoginHistory({
      serverUrl: getServerUrl(),
      token,
      refreshToken: readString(data, "refreshToken"),
      user,
    }).catch((error) => {
      console.warn("[mobile-sync] save account login history failed:", error);
    });
    return { status: "connected", token, user };
  } catch {
    return { status: "failed", reason: "session" };
  }
}

/**
 * 在移动端同步设置里直接完成服务器账号登录。
 *
 * 只负责建立账号会话；本地库仍由按账号隔离的 Native runtime 打开，并在
 * `configureRuntime` 中把设备本地笔记幂等迁移到该账号后启动同步。
 */
export async function loginMobileSyncAccount(
  input: MobileSyncAccountLoginInput,
): Promise<MobileSyncAccountLoginResult> {
  const serverUrl = input.serverUrl.trim();
  if (!serverUrl) return { status: "failed", reason: "login" };

  if (input.ticket) {
    if (!input.code?.trim()) return { status: "failed", reason: "two_factor_invalid" };
    const result = await postJson(`${getResolvedApiBaseUrl(serverUrl)}/auth/2fa/verify`, {
      ticket: input.ticket,
      code: input.code.trim(),
      deviceId: getDeviceId(),
    });
    if (!result.ok) return { status: "failed", reason: "network" };
    const { response, data } = result;
    if (!response.ok) {
      if (data.code === "TFA_TICKET_EXPIRED") return { status: "failed", reason: "two_factor_expired" };
      if (data.code === "TFA_INVALID_CODE") return { status: "failed", reason: "two_factor_invalid" };
      return { status: "failed", reason: "login", message: readString(data, "error") };
    }
    return commitSession(serverUrl, data);
  }

  const username = input.username?.trim();
  if (!username || !input.password) return { status: "failed", reason: "login" };

  const probe = await testServerConnection(serverUrl).catch(() => null);
  if (!probe?.ok) return { status: "failed", reason: "network" };
  const apiBaseUrl = probe.apiBaseUrl || getResolvedApiBaseUrl(serverUrl);
  const result = await postJson(`${apiBaseUrl}/auth/login`, {
    username,
    password: input.password,
    deviceId: getDeviceId(),
  });
  if (!result.ok) return { status: "failed", reason: "network" };
  const { response, data } = result;
  if (!response.ok) {
    return { status: "failed", reason: "login", message: readString(data, "error") };
  }

  const requiresTwoFactor = data.requires2FA || data.requiresTwoFactor || data.twoFactorRequired;
  const ticket = readString(data, "ticket");
  if (requiresTwoFactor && ticket) {
    return {
      status: "requires_2fa",
      ticket,
      username,
      serverUrl: probe.serverBaseUrl || serverUrl,
    };
  }
  return commitSession(serverUrl, data);
}
