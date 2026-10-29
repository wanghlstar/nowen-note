import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-fence-marker-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");
process.env.ELECTRON_USER_DATA = tmpDir;

let closeDb: () => void;

test.after(() => {
  closeDb?.();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("未闭合代码围栏不会把内部块标记写进代码块内部", async () => {
  const [{ getDb, closeDb: close }, noteBlocks] = await Promise.all([
    import("../src/db/schema"),
    import("../src/lib/noteBlocks"),
  ]);
  closeDb = close;
  const db = getDb();
  db.prepare("INSERT INTO users (id, username, passwordHash) VALUES (?, ?, ?)")
    .run("fence-user", "fence-user", "hash");
  db.prepare("INSERT INTO notebooks (id, userId, name) VALUES (?, ?, ?)")
    .run("fence-notebook", "fence-user", "Fence");

  const insertNote = (id: string, content: string) => db.prepare(`
    INSERT INTO notes (id, userId, notebookId, title, content, contentText, contentFormat, version)
    VALUES (?, ?, ?, 'Fence', ?, '', 'markdown', 1)
  `).run(id, "fence-user", "fence-notebook", content);

  const content = "```js\nconst a = 1;";
  insertNote("fence-note-1", content);
  const first = noteBlocks.syncNoteBlocks(db, "fence-note-1", content, "markdown");
  console.log("FIRST:", JSON.stringify(first.content));
  assert.ok(!first.content.includes("^blk_"), "未闭合围栏内不应出现内部块标记");

  db.prepare("UPDATE notes SET content = ? WHERE id = ?").run(first.content, "fence-note-1");
  const second = noteBlocks.syncNoteBlocks(db, "fence-note-1", first.content, "markdown");
  console.log("SECOND:", JSON.stringify(second.content));
  assert.equal(second.content, first.content, "重复保存不应持续追加标记");
});

test("用户补上闭合围栏后才在围栏后插入独立标记行", async () => {
  const [{ getDb }, noteBlocks] = await Promise.all([
    import("../src/db/schema"),
    import("../src/lib/noteBlocks"),
  ]);
  const db = getDb();
  const closed = "```js\nconst a = 1;\n```";
  db.prepare(`
    INSERT INTO notes (id, userId, notebookId, title, content, contentText, contentFormat, version)
    VALUES (?, ?, ?, 'Fence', ?, '', 'markdown', 1)
  `).run("fence-note-2", "fence-user", "fence-notebook", closed);
  const result = noteBlocks.syncNoteBlocks(db, "fence-note-2", closed, "markdown");
  console.log("CLOSED:", JSON.stringify(result.content));
  assert.match(result.content, /```\n\^blk_[A-Za-z0-9_-]{6,}\n?$/);
});

test("围栏行上附着的内部块标记会被挪到独立行，代码块保持有效", async () => {
  const [{ getDb }, noteBlocks] = await Promise.all([
    import("../src/db/schema"),
    import("../src/lib/noteBlocks"),
  ]);
  const db = getDb();
  const brokenClose = [
    "```js",
    "const a = 1;",
    "```^blk_29f69eec-71b1-4960-887a-fd0ccedd2e75",
    "之后的正文",
  ].join("\n");
  db.prepare(`
    INSERT INTO notes (id, userId, notebookId, title, content, contentText, contentFormat, version)
    VALUES (?, ?, ?, 'Fence', ?, '', 'markdown', 1)
  `).run("fence-note-3", "fence-user", "fence-notebook", brokenClose);

  const repaired = noteBlocks.syncNoteBlocks(db, "fence-note-3", brokenClose, "markdown");
  console.log("REPAIRED:", JSON.stringify(repaired.content));
  assert.ok(repaired.content.includes("```\n^blk_"), "闭合围栏后的标记必须是独立行");
  assert.ok(repaired.content.includes("之后的正文"), "闭合围栏之后的正文不能再被算进代码块");
  const blocks = repaired.blocks.map((block) => block.blockType);
  assert.ok(blocks.includes("codeBlock"), "代码块仍应被识别为独立块");
  assert.ok(blocks.includes("paragraph"), "围栏后的正文应被识别为段落");
});
