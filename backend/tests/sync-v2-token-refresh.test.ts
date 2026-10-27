import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SyncRemoteClient } from "../src/sync/remote.js";

/**
 * access token 15 分钟过期是官方设计（auth-security.ts 默认 "15m"），
 * 长期同步靠 refresh token 静默续期。这里锁定续期契约与失败归类。
 */

type Recorded = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

type Init = { method?: string; headers?: Record<string, string>; body?: string };

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function recordingFetch(
  handler: (url: string, init?: Init) => Promise<ReturnType<typeof jsonResponse>>,
): { fetchImpl: (url: string, init?: Init) => Promise<ReturnType<typeof jsonResponse>>; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchImpl = async (url: string, init?: Init) => {
    calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
    return handler(url, init);
  };
  return { fetchImpl, calls };
}

test("401 后用 refreshToken 续期，并以新 token 重试原请求", async () => {
  const { fetchImpl, calls } = recordingFetch(async (url) => {
    if (url.endsWith("/api/auth/refresh")) {
      return jsonResponse(200, { token: "fresh-token" });
    }
    // 旧 token 第一次必被拒，之后放行
    return calls.filter((c) => !c.url.endsWith("/api/auth/refresh")).length <= 1
      ? jsonResponse(401, { error: "token expired" })
      : jsonResponse(200, { nextSequence: 9, items: [] });
  });

  const refreshed: string[] = [];
  const client = new SyncRemoteClient(
    { serverUrl: "http://sync.example/", token: "expired-token", refreshToken: "refresh-1" },
    { fetchImpl, onTokenRefreshed: (token) => refreshed.push(token) },
  );

  const result = await client.changes(8);
  assert.equal(result.nextSequence, 9);
  assert.deepEqual(refreshed, ["fresh-token"]);

  const refreshCall = calls.find((c) => c.url.endsWith("/api/auth/refresh"));
  assert.ok(refreshCall, "应调用 /api/auth/refresh");
  assert.equal(refreshCall!.method, "POST");
  assert.deepEqual(JSON.parse(refreshCall!.body!), { refreshToken: "refresh-1" });
  // 刷新请求本身不能带旧 access token
  assert.equal(refreshCall!.headers?.Authorization, undefined);

  const dataCalls = calls.filter((c) => !c.url.endsWith("/api/auth/refresh"));
  assert.equal(dataCalls.length, 2, "原请求应只重试一次");
  assert.equal(dataCalls[0].headers?.Authorization, "Bearer expired-token");
  assert.equal(dataCalls[1].headers?.Authorization, "Bearer fresh-token");
});

test("没有 refreshToken 时 401 直接 AUTH_EXPIRED，且不额外发请求", async () => {
  const { fetchImpl, calls } = recordingFetch(async () =>
    jsonResponse(401, { error: "token expired" }),
  );
  const client = new SyncRemoteClient(
    { serverUrl: "http://sync.example", token: "expired-token" },
    { fetchImpl },
  );
  await assert.rejects(client.changes(8), /AUTH_EXPIRED|远端拒绝访问/);
  assert.equal(calls.length, 1);
  assert.ok(!calls.some((c) => c.url.endsWith("/api/auth/refresh")));
});

test("刷新失败（refreshToken 也过期）仍归 AUTH_EXPIRED", async () => {
  const { fetchImpl, calls } = recordingFetch(async (url) =>
    url.endsWith("/api/auth/refresh")
      ? jsonResponse(401, { error: "登录已过期，请重新登录", code: "REFRESH_TOKEN_INVALID" })
      : jsonResponse(401, { error: "token expired" }),
  );
  const client = new SyncRemoteClient(
    { serverUrl: "http://sync.example", token: "expired-token", refreshToken: "stale-refresh" },
    { fetchImpl },
  );
  await assert.rejects(client.changes(8), /AUTH_EXPIRED|远端拒绝访问/);
  // 一次原请求 + 一次刷新尝试，不重试原请求
  assert.equal(calls.length, 2);
});

test("刷新成功但重试仍被拒 → AUTH_EXPIRED，不会无限重试", async () => {
  const { fetchImpl, calls } = recordingFetch(async (url) =>
    url.endsWith("/api/auth/refresh")
      ? jsonResponse(200, { token: "fresh-token" })
      : jsonResponse(401, { error: "still rejected" }),
  );
  const client = new SyncRemoteClient(
    { serverUrl: "http://sync.example", token: "expired-token", refreshToken: "refresh-1" },
    { fetchImpl },
  );
  await assert.rejects(client.changes(8), /AUTH_EXPIRED|远端拒绝访问/);
  assert.equal(calls.length, 3, "原请求 + 刷新 + 重试一次，共 3 次");
});

test("ACCESS_REVOKED 等远端码优先于刷新归类", async () => {
  const { fetchImpl, calls } = recordingFetch(async () =>
    jsonResponse(403, { error: "access revoked", code: "ACCESS_REVOKED" }),
  );
  const client = new SyncRemoteClient(
    { serverUrl: "http://sync.example", token: "t", refreshToken: "r" },
    { fetchImpl },
  );
  await assert.rejects(client.changes(8), (error: any) => {
    assert.equal(error?.code, "ACCESS_REVOKED");
    return true;
  });
  // 刷新失败后仍按原响应归类，不会把 ACCESS_REVOKED 吞成 AUTH_EXPIRED
  assert.equal(calls.length, 2);
});

test("刷新端点网络异常不炸掉同步循环，归 AUTH_EXPIRED", async () => {
  const fetchImpl = async (url: string) => {
    if (url.endsWith("/api/auth/refresh")) {
      throw new Error("connect ECONNREFUSED");
    }
    return jsonResponse(401, { error: "token expired" });
  };
  const client = new SyncRemoteClient(
    { serverUrl: "http://sync.example", token: "expired-token", refreshToken: "refresh-1" },
    { fetchImpl: fetchImpl as any },
  );
  await assert.rejects(client.changes(8), /AUTH_EXPIRED|远端拒绝访问/);
});

// ---------------------------------------------------------------------------
// 凭据持久化：刷新后的 token 必须落盘，refreshToken 不能被清掉
// ---------------------------------------------------------------------------

test("凭据文件 roundtrip：刷新持久化保留 refreshToken", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-sync-creds-"));
  process.env.ELECTRON_USER_DATA = tmp;
  // credentials.ts 在模块加载时读取 DATA_DIR，必须在 import 前设置好环境变量
  const credentials = await import("../src/sync/credentials.js");

  try {
    credentials.saveRemoteCredential({
      profileId: "p1",
      serverUrl: "http://sync.example/",
      token: "access-1",
      refreshToken: "refresh-1",
      remoteUserId: "u1",
    });
    const stored = credentials.getRemoteCredential("p1");
    assert.equal(stored?.token, "access-1");
    assert.equal(stored?.refreshToken, "refresh-1");
    assert.equal(stored?.serverUrl, "http://sync.example");

    // 模拟刷新回调：只带新 access token
    credentials.saveRemoteCredential({
      profileId: "p1",
      serverUrl: "http://sync.example",
      token: "access-2",
      remoteUserId: "u1",
    });
    const afterRefresh = credentials.getRemoteCredential("p1");
    assert.equal(afterRefresh?.token, "access-2");
    assert.equal(afterRefresh?.refreshToken, "refresh-1", "refreshToken 必须保留");

    // client 构造：已授权返回 client，未授权返回 null
    assert.ok(credentials.createRemoteClientForProfile("p1", "http://sync.example"));
    assert.equal(
      credentials.createRemoteClientForProfile("missing", "http://sync.example"),
      null,
    );

    // 刷新回调链：401 → 刷新 → 重试成功 → 新 token 落盘且 refreshToken 不丢
    let dataCalls = 0;
    let persistedToken = "";
    const injected = new SyncRemoteClient(
      { serverUrl: "http://sync.example", token: "access-2", refreshToken: "refresh-1" },
      {
        fetchImpl: async (url, init) => {
          if (url.endsWith("/api/auth/refresh")) {
            return jsonResponse(200, { token: "access-3" });
          }
          dataCalls += 1;
          return dataCalls === 1
            ? jsonResponse(401, { error: "expired" })
            : jsonResponse(200, { nextSequence: 3, items: [] });
        },
        onTokenRefreshed: (token) => {
          credentials.saveRemoteCredential({
            profileId: "p1",
            serverUrl: "http://sync.example",
            token,
            remoteUserId: "u1",
          });
          persistedToken = token;
        },
      },
    );
    assert.equal((await injected.changes(2)).nextSequence, 3);
    assert.equal(persistedToken, "access-3");
    const final = credentials.getRemoteCredential("p1");
    assert.equal(final?.token, "access-3");
    assert.equal(final?.refreshToken, "refresh-1");

    // 文件权限保持 0600
    const mode = fs.statSync(path.join(tmp, ".sync_credentials.json")).mode & 0o777;
    assert.equal(mode, 0o600);

    credentials.clearRemoteCredential("p1");
    assert.equal(credentials.getRemoteCredential("p1"), null);
  } finally {
    delete process.env.ELECTRON_USER_DATA;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
