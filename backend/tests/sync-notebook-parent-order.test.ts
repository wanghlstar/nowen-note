import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-notebook-order-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");
process.env.ELECTRON_USER_DATA = tmpDir;

let closeDb: () => void;

test.after(() => {
  closeDb?.();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("远端批次里子笔记本先返回时也能对账成功", async () => {
  const [{ getDb, closeDb: close }, applyLocal] = await Promise.all([
    import("../src/db/schema"),
    import("../src/sync/applyLocal"),
  ]);
  closeDb = close;
  const db = getDb();
  const userId = "order-user";
  db.prepare("INSERT INTO users (id, username, passwordHash) VALUES (?, ?, ?)")
    .run(userId, userId, "hash");

  // 服务端返回顺序：子在前、父在后（复现 NOTEBOOK_PARENT_NOT_FOUND）
  const child = {
    entityType: "notebook" as const,
    entityId: "nb-child",
    operation: "upsert" as const,
    payload: { id: "nb-child", parentId: "nb-parent", name: "子笔记本", version: 1 },
  };
  const parent = {
    entityType: "notebook" as const,
    entityId: "nb-parent",
    operation: "upsert" as const,
    payload: { id: "nb-parent", parentId: null, name: "父笔记本", version: 1 },
  };
  const note = {
    entityType: "note" as const,
    entityId: "note-1",
    operation: "upsert" as const,
    payload: {
      id: "note-1", notebookId: "nb-child", title: "笔记", content: "{}",
      contentText: "", contentFormat: "tiptap-json", version: 1,
    },
  };

  const result = applyLocal.applyRemoteChanges(db, [child, parent, note], { userId });
  assert.equal(result.applied, 3);

  const rows = db.prepare("SELECT id, parentId, name FROM notebooks ORDER BY id").all();
  assert.deepEqual(rows, [
    { id: "nb-child", parentId: "nb-parent", name: "子笔记本" },
    { id: "nb-parent", parentId: null, name: "父笔记本" },
  ]);
  assert.equal(
    (db.prepare("SELECT notebookId FROM notes WHERE id = ?").get("note-1") as { notebookId: string }).notebookId,
    "nb-child",
  );
});

test("父笔记本本地已存在时无需重排也能应用", async () => {
  const [{ getDb }, applyLocal] = await Promise.all([
    import("../src/db/schema"),
    import("../src/sync/applyLocal"),
  ]);
  const db = getDb();
  const userId = "order-user";
  db.prepare("INSERT INTO notebooks (id, userId, name) VALUES (?, ?, ?)")
    .run("nb-existing", userId, "已存在");

  const result = applyLocal.applyRemoteChanges(db, [{
    entityType: "notebook" as const,
    entityId: "nb-child-2",
    operation: "upsert" as const,
    payload: { id: "nb-child-2", parentId: "nb-existing", name: "子2", version: 1 },
  }], { userId });
  assert.equal(result.applied, 1);
  assert.equal(
    (db.prepare("SELECT parentId FROM notebooks WHERE id = ?").get("nb-child-2") as { parentId: string }).parentId,
    "nb-existing",
  );
});
