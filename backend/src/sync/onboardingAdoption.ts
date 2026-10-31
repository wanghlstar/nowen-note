import type Database from "better-sqlite3";

import { ONBOARDING_ID_PREFIX } from "../db/onboardingGuideTemplate.js";
import { isOnboardingEntityId } from "./onboardingEntities.js";
import { purgeOnboardingMutations } from "./outbox.js";

const PREFIX_LIKE = `${ONBOARDING_ID_PREFIX}%`;
const TREE_NOTE_PREFIX_LIKE = `note:${PREFIX_LIKE}`;
const TREE_NOTEBOOK_PREFIX_LIKE = `notebook:${PREFIX_LIKE}`;

function stripEntityPrefix(entityId: string): string {
  return entityId.replace(/^(?:note|notebook):/, "");
}

/**
 * 丢弃本机自带的示例指南（设备本地种子）。
 *
 * 只删除本机行与它们的同步条目，不产生同步删除记录；服务端的指南随后
 * 按普通实体拉取到本机。用于首次连接时的「服务器优先」采纳。
 */
export function discardLocalOnboardingGuide(
  db: Database.Database,
  userId: string,
): void {
  db.transaction(() => {
    db.prepare(
      `DELETE FROM note_tags WHERE noteId IN (
        SELECT id FROM notes WHERE userId = ? AND id LIKE ?
      )`,
    ).run(userId, PREFIX_LIKE);
    db.prepare(
      `DELETE FROM favorites WHERE noteId IN (
        SELECT id FROM notes WHERE userId = ? AND id LIKE ?
      )`,
    ).run(userId, PREFIX_LIKE);
    db.prepare("DELETE FROM notes WHERE userId = ? AND id LIKE ?").run(userId, PREFIX_LIKE);
    db.prepare("DELETE FROM notebooks WHERE userId = ? AND id LIKE ?").run(userId, PREFIX_LIKE);
    db.prepare(
      `DELETE FROM knowledge_tree_nodes WHERE userId = ?
        AND (resourceId LIKE ? OR id LIKE ? OR id LIKE ?)`,
    ).run(userId, PREFIX_LIKE, TREE_NOTE_PREFIX_LIKE, TREE_NOTEBOOK_PREFIX_LIKE);
    db.prepare(
      `DELETE FROM sync_conflicts WHERE entityId LIKE ? OR entityId LIKE ? OR entityId LIKE ?`,
    ).run(PREFIX_LIKE, TREE_NOTE_PREFIX_LIKE, TREE_NOTEBOOK_PREFIX_LIKE);
    purgeOnboardingMutations(db);
  })();
}

/**
 * 首次连接时的「服务器优先」采纳：
 * 远端存在示例指南、且本机还没有这份远端指南（本机持有的是自己种的那份）时，
 * 丢弃本机指南，让远端指南按普通实体拉取进来。
 *
 * 已采纳过（远端指南实体已在本机）或本机没有指南时不做任何事，
 * 因此可重复调用，Bootstrap 断点续跑时不会误删。
 */
export function adoptRemoteOnboardingGuide(
  db: Database.Database,
  userId: string,
  remoteItems: Array<{ entityType: string; entityId: string }>,
): boolean {
  const guideItems = remoteItems.filter((item) => isOnboardingEntityId(item.entityId));
  if (guideItems.length === 0) return false;

  const alreadyAdopted = guideItems.some((item) => {
    const id = stripEntityPrefix(item.entityId);
    if (item.entityType === "note") {
      return Boolean(db.prepare("SELECT 1 FROM notes WHERE userId = ? AND id = ?").get(userId, id));
    }
    if (item.entityType === "notebook") {
      return Boolean(db.prepare("SELECT 1 FROM notebooks WHERE userId = ? AND id = ?").get(userId, id));
    }
    return false;
  });
  if (alreadyAdopted) return false;

  const hasLocalGuide = db.prepare(
    "SELECT 1 FROM notebooks WHERE userId = ? AND id LIKE ? LIMIT 1",
  ).get(userId, PREFIX_LIKE);
  if (!hasLocalGuide) return false;

  discardLocalOnboardingGuide(db, userId);
  return true;
}
