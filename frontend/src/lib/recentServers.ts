/**
 * 最近使用过的服务器（本地记忆，零依赖兜底）。
 *
 * 组网 / 跨网段场景 mDNS 不生效，扫描也需要用户知道网段；
 * 记住最近连上过的服务器，登录页可以一键回填。
 */

const KEY = "nowen-note:recent-servers";
const MAX_ITEMS = 5;

export interface RecentServer {
  url: string;
  name?: string;
  ts: number;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function listRecentServers(): RecentServer[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is RecentServer =>
        Boolean(item) && typeof item.url === "string" && item.url.length > 0)
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

export function rememberServer(url: string, name?: string): void {
  const normalized = url.trim().replace(/\/+$/, "");
  if (!normalized) return;
  const store = storage();
  if (!store) return;
  const next: RecentServer[] = [
    { url: normalized, ...(name ? { name } : {}), ts: Date.now() },
    ...listRecentServers().filter((item) => item.url !== normalized),
  ].slice(0, MAX_ITEMS);
  try {
    store.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore quota errors */
  }
}
