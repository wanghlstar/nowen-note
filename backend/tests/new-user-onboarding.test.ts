import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import {
  newUserOnboardingMigration,
  onboardingWelcomeNoteId,
} from "../src/db/newUserOnboardingMigration.js";
import { newUserOnboardingFirstLoginMigration } from "../src/db/newUserOnboardingFirstLoginMigration.js";
import { onboardingGuideTemplateMigration } from "../src/db/onboardingGuideTemplateMigration.js";
import { ONBOARDING_GUIDE_NOTES } from "../src/db/onboardingGuideTemplate.js";

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      displayName TEXT,
      lastLoginAt TEXT
    );

    CREATE TABLE notebooks (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      parentId TEXT,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT DEFAULT '📒',
      sortOrder INTEGER DEFAULT 0,
      isExpanded INTEGER DEFAULT 1,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parentId) REFERENCES notebooks(id) ON DELETE CASCADE
    );

    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      notebookId TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT DEFAULT '{}',
      contentText TEXT DEFAULT '',
      contentFormat TEXT DEFAULT 'tiptap-json',
      isPinned INTEGER DEFAULT 0,
      sortOrder INTEGER DEFAULT 0,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (notebookId) REFERENCES notebooks(id) ON DELETE CASCADE
    );
  `);
  return db;
}

function installOnboarding(db: Database.Database): void {
  newUserOnboardingMigration.up(db);
  newUserOnboardingFirstLoginMigration.up(db);
  onboardingGuideTemplateMigration.up(db);
}

function confirmLogin(db: Database.Database, userId: string): void {
  db.prepare("UPDATE users SET lastLoginAt = datetime('now') WHERE id = ?").run(userId);
}

test("seeds the trimmed Chinese guide only on a new account's first confirmed login", () => {
  const db = createDb();
  try {
    db.prepare("INSERT INTO users (id, username, passwordHash) VALUES (?, ?, ?)")
      .run("legacy-user", "legacy", "hash");

    installOnboarding(db);
    confirmLogin(db, "legacy-user");

    const legacyNotebookCount = db.prepare(
      "SELECT COUNT(*) AS count FROM notebooks WHERE userId = ?",
    ).get("legacy-user") as { count: number };
    assert.equal(legacyNotebookCount.count, 0, "existing users must not be backfilled");

    const userId = "new-user";
    db.prepare("INSERT INTO users (id, username, passwordHash) VALUES (?, ?, ?)")
      .run(userId, "new-user", "hash");

    const beforeLogin = db.prepare(
      "SELECT COUNT(*) AS count FROM notebooks WHERE userId = ?",
    ).get(userId) as { count: number };
    assert.equal(beforeLogin.count, 0, "raw user inserts must not pollute fixtures or maintenance flows");

    confirmLogin(db, userId);

    const onboardingState = db.prepare(`
      SELECT status FROM user_onboarding_state
      WHERE userId = ? AND version = 1
    `).get(userId) as { status: string } | undefined;
    assert.equal(onboardingState?.status, "seeded");

    const notebooks = db.prepare(`
      SELECT id, parentId, name, icon, sortOrder
      FROM notebooks
      WHERE userId = ?
      ORDER BY sortOrder ASC, name ASC
    `).all(userId) as Array<{
      id: string;
      parentId: string | null;
      name: string;
      icon: string;
      sortOrder: number;
    }>;
    assert.equal(notebooks.length, 1);

    const chinese = notebooks[0];
    assert.equal(chinese.name, "中文指南");
    assert.equal(chinese.icon, "🇨🇳");
    assert.equal(chinese.parentId, null);

    const notes = db.prepare(`
      SELECT id, notebookId, title, content, contentText, contentFormat, isPinned, sortOrder
      FROM notes
      WHERE userId = ?
      ORDER BY notebookId ASC, sortOrder ASC
    `).all(userId) as Array<{
      id: string;
      notebookId: string;
      title: string;
      content: string;
      contentText: string;
      contentFormat: string;
      isPinned: number;
      sortOrder: number;
    }>;

    assert.equal(notes.length, 8);
    assert.equal(notes.filter((note) => note.notebookId === chinese.id).length, 8);
    assert.ok(notes.every((note) => note.contentFormat === "markdown"));
    assert.ok(notes.every((note) => note.content.length > 100));
    assert.ok(notes.every((note) => note.contentText.length > 20));
    assert.deepEqual(
      notes.map((note) => note.title),
      ONBOARDING_GUIDE_NOTES.map((note) => note.title),
    );

    const chineseWelcome = notes.find((note) => note.id === onboardingWelcomeNoteId(userId));
    assert.ok(chineseWelcome);
    assert.equal(chineseWelcome.title, "欢迎使用 Nowen Note");
    assert.equal(chineseWelcome.isPinned, 1);
    assert.match(chineseWelcome.content, /删除后系统不会重新创建/);

    assert.equal(notes.some((note) => note.title === "项目启动会议纪要"), false);
    assert.equal(notes.some((note) => note.title === "周末计划"), false);
  } finally {
    db.close();
  }
});

test("deleting the guide does not recreate it on later logins", () => {
  const db = createDb();
  try {
    installOnboarding(db);
    const userId = "delete-guide-user";
    db.prepare("INSERT INTO users (id, username, passwordHash) VALUES (?, ?, ?)")
      .run(userId, "delete-guide-user", "hash");
    confirmLogin(db, userId);

    const root = db.prepare(`
      SELECT id FROM notebooks
      WHERE userId = ? AND parentId IS NULL
    `).get(userId) as { id: string };
    db.prepare("DELETE FROM notebooks WHERE id = ?").run(root.id);

    confirmLogin(db, userId);
    db.prepare("UPDATE users SET displayName = ? WHERE id = ?")
      .run("Updated", userId);

    const notebooks = db.prepare(
      "SELECT COUNT(*) AS count FROM notebooks WHERE userId = ?",
    ).get(userId) as { count: number };
    const notes = db.prepare(
      "SELECT COUNT(*) AS count FROM notes WHERE userId = ?",
    ).get(userId) as { count: number };
    const state = db.prepare(`
      SELECT status FROM user_onboarding_state
      WHERE userId = ? AND version = 1
    `).get(userId) as { status: string } | undefined;

    assert.equal(notebooks.count, 0);
    assert.equal(notes.count, 0);
    assert.equal(state?.status, "seeded");
  } finally {
    db.close();
  }
});
