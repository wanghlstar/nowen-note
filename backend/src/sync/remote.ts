import { withEncryptedBlocksSupport } from "../lib/encryptedNotes.js";
import {
  SYNC_PERSONAL_SCOPE_KEY,
  SYNC_V2_BASE_PATH,
  SYNC_V2_ROUTES,
} from "./constants";
import { SyncError } from "./errors";
import { isSyncEntityType, isSyncNegotiatedEntityType, isSyncOperation } from "./types";
import type { SyncScopeDescriptor } from "./scope";
import type {
  SyncEntityType,
  SyncNegotiatedEntityType,
  SyncOperation,
} from "./types";

/**
 * Sync V2 远端客户端。
 *
 * 只负责"把请求打到远端并归类错误"，不碰本地数据库。
 * 之所以严格区分错误类别：Engine 要据此决定是继续重试、暂停同步，
 * 还是进入冲突流程。任何情况下这些失败都不得升级为"保存失败"——
 * 本地写入早已成功。
 */

export interface RemoteCredentials {
  serverUrl: string;
  /** 远端访问令牌。过期时同步暂停，本地读写不受影响。 */
  token: string;
  /** 远端刷新令牌。access token 15 分钟过期是设计行为，长期同步靠它静默续期。 */
  refreshToken?: string;
}

export interface RemotePlan {
  scopeKey: string;
  accessFingerprint: string;
  serverSequence: number;
  minAvailableSequence: number;
  resetRequired: boolean;
  notebookCount: number;
  noteCount: number;
  tagCount: number;
}

export interface RemoteChanges<T extends SyncNegotiatedEntityType = SyncEntityType> {
  scopeKey: string;
  accessFingerprint: string;
  serverSequence: number;
  nextSequence: number;
  hasMore: boolean;
  resetRequired: boolean;
  items: Array<{
    sequence: number;
    entityType: T;
    entityId: string;
    operation: SyncOperation;
  }>;
}

export interface RemoteSnapshotPage<T extends SyncNegotiatedEntityType = SyncEntityType> {
  scopeKey: string;
  accessFingerprint: string;
  snapshotSequence: number;
  hasMore: boolean;
  nextCursor: string | null;
  items: Array<{
    entityType: T;
    entityId: string;
    payload: Record<string, unknown>;
  }>;
}

export interface PushMutationPayload {
  mutationId: string;
  entityType: SyncNegotiatedEntityType;
  entityId: string;
  operation: SyncOperation;
  baseVersion?: number;
  payload?: Record<string, unknown>;
}

export interface PushResultItem {
  mutationId: string;
  status: "applied" | "duplicate" | "conflict";
  version?: number;
  code?: string;
  serverVersion?: number;
  serverPayload?: Record<string, unknown>;
  error?: string;
}

export interface RemotePushResult {
  scopeKey: string;
  accessFingerprint: string;
  serverSequence: number;
  results: PushResultItem[];
}

export interface SyncProtocolSubscription {
  entityTypes: readonly SyncNegotiatedEntityType[];
  deviceId?: string;
}

/** Unknown future entities must stop Pull before the caller advances its cursor or ACKs. */
function assertSupportedItems(
  items: unknown,
  kind: "changes" | "snapshot",
  subscription?: SyncProtocolSubscription,
): void {
  if (!Array.isArray(items)) throw new SyncError("SERVER_ERROR", "远端同步条目格式无效");
  for (const item of items) {
    if (!item || typeof item !== "object") {
      throw new SyncError("SERVER_ERROR", "远端同步条目格式无效");
    }
    const entry = item as Record<string, unknown>;
    const entitySupported = subscription
      ? isSyncNegotiatedEntityType(entry.entityType)
        && subscription.entityTypes.includes(entry.entityType)
      : isSyncEntityType(entry.entityType);
    if (!entitySupported) {
      throw new SyncError("SERVER_ERROR", `不支持的同步实体：${String(entry.entityType)}`);
    }
    if (typeof entry.entityId !== "string" || !entry.entityId) {
      throw new SyncError("SERVER_ERROR", "远端同步实体 ID 无效");
    }
    if (kind === "changes" && !isSyncOperation(entry.operation)) {
      throw new SyncError("SERVER_ERROR", "远端同步操作无效");
    }
    if (kind === "snapshot" && (!entry.payload || typeof entry.payload !== "object" || Array.isArray(entry.payload))) {
      throw new SyncError("SERVER_ERROR", "远端同步快照载荷无效");
    }
  }
}

/** 允许测试注入，避免真实网络。 */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<any>;
  text: () => Promise<string>;
}>;

const DEFAULT_TIMEOUT_MS = 30_000;

function joinUrl(serverUrl: string, route: string, query = ""): string {
  const base = serverUrl.replace(/\/+$/, "");
  return `${base}${SYNC_V2_BASE_PATH}${route}${query}`;
}

export class SyncRemoteClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly onTokenRefreshed?: (token: string) => void;

  constructor(
    private readonly credentials: RemoteCredentials,
    options: { fetchImpl?: FetchLike; timeoutMs?: number; onTokenRefreshed?: (token: string) => void } = {},
  ) {
    this.fetchImpl = options.fetchImpl
      ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onTokenRefreshed = options.onTokenRefreshed;
  }

  /**
   * 统一请求入口。
   *
   * 错误分类是这里最重要的职责：
   * - 网络层异常 / 超时 → NETWORK_UNAVAILABLE（可重试）
   * - 401 / 403        → 先尝试 refreshToken 静默续期并重试一次；仍失败才
   *                      AUTH_EXPIRED（暂停同步，等重新授权）
   * - 404              → 远端未启用 V2，按服务端错误处理，避免误判为"数据不存在"
   * - 5xx              → SERVER_ERROR（可重试）
   * - 其它 4xx         → INVALID_PAYLOAD（重发同样会失败，不该无脑轮询）
   */
  private async request<T>(
    route: string,
    init: { method: string; query?: string; body?: unknown },
  ): Promise<T> {
    let response = await this.send(route, init, this.credentials.token);

    if (!response.ok) {
      if (
        (response.status === 401 || response.status === 403)
        && this.credentials.refreshToken
        && await this.refreshAccessToken()
      ) {
        response = await this.send(route, init, this.credentials.token);
        if (response.ok) return this.parseJson<T>(response);
      }
      await this.throwRemoteFailure(response);
    }

    return this.parseJson<T>(response);
  }

  /** 单次 HTTP 发送；token 由调用方显式传入，刷新重试时用新值。 */
  private async send(
    route: string,
    init: { method: string; query?: string; body?: unknown },
    token: string,
  ): Promise<Awaited<ReturnType<FetchLike>>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(
        joinUrl(this.credentials.serverUrl, route, init.query || ""),
        {
          method: init.method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: controller.signal,
        },
      );
    } catch (error: any) {
      // AbortError 与 DNS/连接失败都归为网络不可用：都应该继续重试。
      throw new SyncError("NETWORK_UNAVAILABLE", error?.message || "网络请求失败");
    } finally {
      clearTimeout(timer);
    }
  }

  /** 把远端错误响应归类为 SyncError。响应体只能读一次，由本方法统一消费。 */
  private async throwRemoteFailure(
    response: Awaited<ReturnType<FetchLike>>,
  ): Promise<never> {
    let payload: any = null;
    try { payload = await response.json(); } catch { /* 非 JSON 错误响应 */ }
    const remoteCode = typeof payload?.code === "string" ? payload.code : "";
    if (remoteCode === "ACCESS_REVOKED" || remoteCode === "SCOPE_FORBIDDEN") {
      throw new SyncError(remoteCode, payload?.error || remoteCode);
    }
    if (response.status === 401 || response.status === 403) {
      throw new SyncError("AUTH_EXPIRED", `远端拒绝访问（${response.status}）`);
    }
    if (response.status >= 500 || response.status === 404) {
      throw new SyncError("SERVER_ERROR", `远端返回 ${response.status}`);
    }
    throw new SyncError("INVALID_PAYLOAD", `远端返回 ${response.status}`);
  }

  private async parseJson<T>(
    response: Awaited<ReturnType<FetchLike>>,
  ): Promise<T> {
    try {
      return await response.json() as T;
    } catch {
      throw new SyncError("SERVER_ERROR", "远端响应不是合法 JSON");
    }
  }

  /**
   * 用 refreshToken 静默续期 access token。
   *
   * 官方契约：POST {serverUrl}/api/auth/refresh，body { refreshToken }，
   * 成功返回 { token }（refresh token 本身 30 天有效、不轮换）。
   *
   * 刻意不走 request()：那里的 401 归类会再次触发刷新，形成无限递归。
   * 任何失败都返回 false，由调用方按原来的 AUTH_EXPIRED 规则处理——
   * 刷新失败意味着必须重新登录，同步暂停但本地读写不受影响。
   */
  private async refreshAccessToken(): Promise<boolean> {
    const refreshToken = this.credentials.refreshToken;
    if (!refreshToken) return false;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        `${this.credentials.serverUrl.replace(/\/+$/, "")}/api/auth/refresh`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
          signal: controller.signal,
        },
      );
      if (!response.ok) return false;
      const payload = await response.json().catch(() => null) as { token?: unknown } | null;
      const token = typeof payload?.token === "string" ? payload.token.trim() : "";
      if (!token) return false;
      this.credentials.token = token;
      this.onTokenRefreshed?.(token);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private query(
    scopeKey: string,
    values: Record<string, string | number | undefined>,
    subscription?: SyncProtocolSubscription,
  ): string {
    const params = new URLSearchParams({ scopeKey });
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) params.set(key, String(value));
    }
    if (subscription) {
      params.set("entityTypes", subscription.entityTypes.join(","));
      if (subscription.deviceId) params.set("deviceId", subscription.deviceId);
    }
    return `?${params.toString()}`;
  }

  listScopes(): Promise<SyncScopeDescriptor[]> {
    return this.request<{ items: SyncScopeDescriptor[] }>(SYNC_V2_ROUTES.scopes, {
      method: "GET",
    }).then((response) => response.items);
  }

  plan(
    after: number,
    scopeKey = SYNC_PERSONAL_SCOPE_KEY,
    subscription?: SyncProtocolSubscription,
  ): Promise<RemotePlan> {
    return this.request<RemotePlan>(SYNC_V2_ROUTES.plan, {
      method: "GET",
      query: this.query(scopeKey, { after }, subscription),
    });
  }

  changes<T extends SyncNegotiatedEntityType = SyncEntityType>(
    after: number,
    limit?: number,
    scopeKey = SYNC_PERSONAL_SCOPE_KEY,
    subscription?: SyncProtocolSubscription,
  ): Promise<RemoteChanges<T>> {
    const query = this.query(scopeKey, { after, limit }, subscription);
    return this.request<RemoteChanges<T>>(SYNC_V2_ROUTES.changes, { method: "GET", query })
      .then((response) => {
        assertSupportedItems(response.items, "changes", subscription);
        return response;
      });
  }

  snapshot<T extends SyncNegotiatedEntityType = SyncEntityType>(
    cursor: string | null,
    snapshotSequence: number,
    limit?: number,
    scopeKey = SYNC_PERSONAL_SCOPE_KEY,
    subscription?: SyncProtocolSubscription,
  ): Promise<RemoteSnapshotPage<T>> {
    const query = this.query(scopeKey, {
      cursor: cursor || undefined,
      snapshotSequence: snapshotSequence > 0 ? snapshotSequence : undefined,
      limit,
    }, subscription);
    return this.request<RemoteSnapshotPage<T>>(SYNC_V2_ROUTES.snapshot, { method: "GET", query })
      .then((response) => {
        assertSupportedItems(response.items, "snapshot", subscription);
        return response;
      });
  }

  push(
    deviceId: string,
    mutations: PushMutationPayload[],
    scopeKey = SYNC_PERSONAL_SCOPE_KEY,
    subscription?: SyncProtocolSubscription,
  ): Promise<RemotePushResult> {
    return this.request<RemotePushResult>(SYNC_V2_ROUTES.push, {
      method: "POST",
      query: this.query(scopeKey, {}, subscription),
      body: {
        scopeKey, deviceId,
        mutations: mutations.map((mutation) => mutation.entityType === "note" && mutation.operation === "upsert" && mutation.payload
          ? { ...mutation, payload: withEncryptedBlocksSupport(mutation.payload) }
          : mutation),
      },
    });
  }

  ack(
    deviceId: string,
    sequence: number,
    scopeKey = SYNC_PERSONAL_SCOPE_KEY,
    subscription?: SyncProtocolSubscription,
  ): Promise<{ lastSequence: number; accessFingerprint: string }> {
    return this.request<{ lastSequence: number; accessFingerprint: string }>(SYNC_V2_ROUTES.ack, {
      method: "POST",
      query: this.query(scopeKey, {}, subscription),
      body: { scopeKey, deviceId, sequence },
    });
  }
}
