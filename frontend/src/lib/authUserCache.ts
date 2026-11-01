import type { User } from "@/types";

const AUTH_USER_CACHE_PREFIX = "nowen-auth-user:";

function isLoopbackAuthUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === "127.0.0.1" ||
      u.hostname === "localhost" ||
      u.hostname === "::1" ||
      u.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

export function getAuthCacheScope(serverUrl: string): string {
  const origin =
    typeof window !== "undefined" && window.location.origin.startsWith("http")
      ? window.location.origin
      : "";
  const isDesktop =
    typeof window !== "undefined" &&
    !!(window as Window & { nowenDesktop?: { isDesktop?: boolean } }).nowenDesktop?.isDesktop;
  if (
    isDesktop &&
    ((serverUrl && isLoopbackAuthUrl(serverUrl)) ||
      (!serverUrl && origin && isLoopbackAuthUrl(origin)))
  ) {
    return "local-desktop";
  }
  if (serverUrl) return serverUrl.replace(/\/+$/, "").toLowerCase();
  if (origin) return origin.replace(/\/+$/, "").toLowerCase();
  return "same-origin";
}

function decodeUserFromToken(token: string): User | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      Array.from(
        atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")),
      )
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join(""),
    );
    const data = JSON.parse(json) as { userId?: string; username?: string };
    if (!data.userId || !data.username) return null;
    return {
      id: data.userId,
      username: data.username,
      email: null,
      avatarUrl: null,
      displayName: data.username,
      createdAt: new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveCachedAuthUser(scope: string, token: string, user: User): void {
  try {
    localStorage.setItem(
      `${AUTH_USER_CACHE_PREFIX}${scope}`,
      JSON.stringify({ token, user, cachedAt: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

export function loadCachedAuthUser(scope: string, token: string): User | null {
  try {
    const raw = localStorage.getItem(`${AUTH_USER_CACHE_PREFIX}${scope}`);
    if (raw) {
      const cached = JSON.parse(raw) as { token?: string; user?: User };
      const decoded = decodeUserFromToken(token);
      if (
        cached.user?.id &&
        (cached.token === token || cached.user.id === decoded?.id)
      ) {
        return cached.user;
      }
    }
  } catch {
    /* ignore */
  }
  return decodeUserFromToken(token);
}
