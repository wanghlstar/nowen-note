// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileSyncEngine } from "../mobileSyncEngine";
import type { NativeDatabase } from "../nativeDatabase";

const scope = {
  scopeKey: "personal", workspaceId: null, workspaceName: null,
  role: null, canWrite: true, accessFingerprint: "same",
};

const localNote = {
  id: "note-a", scopeKey: "personal", version: 12, title: "测试一下同步",
  content: "断网，新建笔记 安卓\n断网，安卓编辑", contentFormat: "markdown",
  contentText: "断网，新建笔记 安卓\n断网，安卓编辑", updatedAt: "2026-11-01T12:10:00.000Z",
};
const pending = { baseVersion: 12, payload: JSON.stringify(localNote) };

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

function setupDb(config: { rows?: Array<Record<string, unknown>>; conflictId?: string } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT mutationId,entityType,entityId,operation")) return config.rows ?? [];
    if (sql.includes("SELECT * FROM notes")) return [localNote];
    if (sql.includes("SELECT id FROM sync_conflicts")) return config.conflictId ? [{ id: config.conflictId }] : [];
    if (sql.includes("SELECT payload,baseVersion FROM sync_outbox")) return [pending];
    return [];
  });
  const run = vi.fn(async (sql: string, params: unknown[] = []) => ({ changes: 1, sql, params }));
  const db: NativeDatabase = {
    query: query as NativeDatabase["query"],
    run,
    transaction: async (work) => work(db),
    close: async () => undefined,
  };
  const engine = new MobileSyncEngine({
    db, attachments: {} as never, serverUrl: "https://notes.example.com",
    token: "test", userId: "user", profileId: "profile", deviceId: "device",
  }) as unknown as {
    push: (target: typeof scope) => Promise<void>;
    applyEntries: (target: typeof scope, entries: Array<{ entityType: "note"; entityId: string; payload: Record<string, unknown> }>, bootstrap: boolean) => Promise<void>;
  };
  return { engine, run };
}

const pushRow = {
  mutationId: "mutation-1", entityType: "note", entityId: "note-a",
  operation: "upsert", baseVersion: 12, payload: JSON.stringify(localNote),
};

describe("离线并发编辑的时间线自动合并", () => {
  it("本机版本较新时按服务器版本重推，并把较旧的一版归档为已处理冲突", async () => {
    const { engine, run } = setupDb({ rows: [pushRow] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ results: [{
        mutationId: "mutation-1", status: "conflict", code: "VERSION_CONFLICT", serverVersion: 16,
        serverPayload: {
          id: "note-a", version: 16, contentFormat: "markdown",
          content: "断网，新建笔记 安卓\n开网， 服务端收到", contentText: "断网，新建笔记 安卓\n开网， 服务端收到",
          updatedAt: "2026-11-01T12:00:00.000Z",
        },
      }] }),
    }));
    await engine.push(scope);
    const archived = run.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO sync_conflicts"));
    expect(archived).toBeTruthy();
    expect(String(archived?.[0])).toContain("'resolved'");
    expect(String(archived?.[0])).toContain("'auto-timeline'");
    const requeued = run.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO sync_outbox"));
    expect(requeued).toBeTruthy();
    expect((requeued?.[1] as unknown[])[7]).toBe(16);
    expect(JSON.parse(String((requeued?.[1] as unknown[])[8]))).toMatchObject({ id: "note-a", version: 17 });
    expect(run.mock.calls.some(([sql]) => String(sql).includes("status='unresolved'"))).toBe(false);
  });

  it("服务器版本更新时采用服务器正文，本机版本完整归档而不丢失", async () => {
    const { engine, run } = setupDb({ rows: [pushRow], conflictId: "conflict-1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ results: [{
        mutationId: "mutation-1", status: "conflict", code: "VERSION_CONFLICT", serverVersion: 16,
        serverPayload: {
          id: "note-a", version: 16, contentFormat: "markdown",
          content: "服务端更新", contentText: "服务端更新", updatedAt: "2026-11-01T12:30:00.000Z",
        },
      }] }),
    }));
    await engine.push(scope);
    const appliedBody = run.mock.calls.find(([sql, params]) =>
      String(sql).includes("INSERT INTO notes") && JSON.stringify(params).includes("服务端更新"));
    expect(appliedBody).toBeTruthy();
    const archived = run.mock.calls.find(([sql]) => String(sql).includes("UPDATE sync_conflicts"));
    expect(archived).toBeTruthy();
    expect(String(archived?.[0])).toContain("'auto-timeline'");
    expect(JSON.stringify(archived?.[1])).toContain("断网，安卓编辑");
    expect(run.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO sync_outbox"))).toBe(false);
  });

  it("Pull 遇到本机更新的待发送修改时保留本机内容，仍按冲突台账要求时间线再判定", async () => {
    const { engine, run } = setupDb({});
    await engine.applyEntries(scope, [{ entityType: "note", entityId: "note-a", payload: {
      id: "note-a", version: 16, contentFormat: "markdown",
      content: "更早的服务端正文", contentText: "更早的服务端正文", updatedAt: "2026-11-01T11:00:00.000Z",
    } }], false);
    expect(run.mock.calls.some(([sql, params]) =>
      String(sql).includes("INSERT INTO notes") && JSON.stringify(params).includes("更早的服务端正文"))).toBe(false);
    const requeued = run.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO sync_outbox"));
    expect(requeued).toBeTruthy();
    expect((requeued?.[1] as unknown[])[7]).toBe(16);
    expect(JSON.parse(String((requeued?.[1] as unknown[])[8]))).toMatchObject({ id: "note-a", version: 17 });
  });

  it("Pull 遇到服务器更新的正文时直接采用服务器版本并把本机版本归档", async () => {
    const { engine, run } = setupDb({});
    await engine.applyEntries(scope, [{ entityType: "note", entityId: "note-a", payload: {
      id: "note-a", version: 16, contentFormat: "markdown",
      content: "更新的服务端正文", contentText: "更新的服务端正文", updatedAt: "2026-11-01T13:00:00.000Z",
    } }], false);
    expect(run.mock.calls.some(([sql, params]) =>
      String(sql).includes("INSERT INTO notes") && JSON.stringify(params).includes("更新的服务端正文"))).toBe(true);
    const archived = run.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO sync_conflicts"));
    expect(archived).toBeTruthy();
    expect(String(archived?.[0])).toContain("'auto-timeline'");
    expect(run.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO sync_outbox"))).toBe(false);
  });
});
