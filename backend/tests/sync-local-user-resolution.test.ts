import assert from "node:assert/strict";
import test from "node:test";

import { getDb } from "../src/db/schema";
import { resolveLocalUserId } from "../src/sync/runtime";

function insertUser(db: ReturnType<typeof getDb>, id: string, username: string, createdAt: string) {
  db.prepare("INSERT INTO users (id, username, passwordHash, createdAt) VALUES (?, ?, ?, ?)")
    .run(id, username, "hash", createdAt);
}

test("同步引擎优先使用 desktop 机器账号，而不是更早种子的 admin", () => {
  const db = getDb();
  db.exec("DELETE FROM users");
  insertUser(db, "admin-early", "admin", "2020-01-01");
  insertUser(db, "desktop-later", "desktop", "2021-01-01");

  assert.equal(resolveLocalUserId(db), "desktop-later");

  db.exec("DELETE FROM users");
  insertUser(db, "admin-only", "admin", "2020-01-01");
  assert.equal(resolveLocalUserId(db), "admin-only");
});
