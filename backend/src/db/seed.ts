import { getDb } from "./schema";
import { v4 as uuid } from "uuid";
import crypto from "crypto";

function syncIcpBeianFromEnv() {
  const db = getDb();
  const raw = process.env.NOWEN_ICP_BEIAN ?? process.env.ICP_BEIAN ?? "";
  const value = String(raw).trim().slice(0, 80);
  db.prepare(`
    INSERT INTO system_settings (key, value, updatedAt)
    VALUES ('site_icp_beian', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = datetime('now')
  `).run(value);
}

export function seedDatabase() {
  const db = getDb();

  // ICP 备案号由 Docker/运行时环境变量驱动，不再通过设置页写入。
  // 每次启动都同步一次，避免旧数据库里残留的 site_icp_beian 继续影响登录页展示。
  syncIcpBeianFromEnv();

  const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  if (userCount.count > 0) return;

  const userId = uuid();
  const passwordHash = crypto.createHash("sha256").update("admin123").digest("hex");

  db.prepare(`
    INSERT INTO users (id, username, email, passwordHash, role, displayName) VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, "admin", "admin@nowen-note.local", passwordHash, "admin", "管理员");

  // 示例内容（中文指南 + 三个空白笔记本）由首次登录种子触发器创建，
  // 见 backend/src/db/onboardingGuideTemplate.ts。这里不再预置演示笔记。
  const tag1Id = uuid();
  const tag2Id = uuid();
  const tag3Id = uuid();
  db.prepare(`INSERT INTO tags (id, userId, name, color) VALUES (?, ?, ?, ?)`).run(tag1Id, userId, "重要", "#f85149");
  db.prepare(`INSERT INTO tags (id, userId, name, color) VALUES (?, ?, ?, ?)`).run(tag2Id, userId, "技术", "#58a6ff");
  db.prepare(`INSERT INTO tags (id, userId, name, color) VALUES (?, ?, ?, ?)`).run(tag3Id, userId, "灵感", "#7ee787");

  console.log("✅ Database seeded successfully");
}
