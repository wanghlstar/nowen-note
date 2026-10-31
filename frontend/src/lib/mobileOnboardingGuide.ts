/**
 * 设备本地模式的示例笔记（安卓）。
 *
 * Mac / NAS 的示例笔记由后端首次登录种子触发器生成
 *（backend/src/db/onboardingGuideTemplate.ts），安卓走 Capacitor 本地优先栈、
 * 没有后端，所以在这里补同一份内容。两端模板必须保持一致。
 *
 * 指南本身按普通笔记同步。ID 使用 `onboarding-v1-` 前缀只是为了识别
 * 「本机种子」：首次连接时若服务端已有指南，同步引擎会丢弃本机这份、
 * 改用服务端那份（见 mobileSyncEngine.discardLocalOnboardingGuide）。
 */

import type { NativeLocalRepository } from "./nativeLocalRepository";

const SEED_FLAG = "nowen:mobile-local-guide-seeded:v2";
const GUIDE_ID_PREFIX = "onboarding-v1-";
const GUIDE_NOTEBOOK_ID = `${GUIDE_ID_PREFIX}local-zh`;
const STARTER_NOTEBOOKS = [
  { key: "work", name: "工作笔记", icon: "💼", sortOrder: 1 },
  { key: "diary", name: "个人日记", icon: "📔", sortOrder: 2 },
  { key: "study", name: "技术学习", icon: "🧑‍💻", sortOrder: 3 },
] as const;

interface GuideNote {
  key: string;
  title: string;
  content: string;
  contentText: string;
}

const GUIDE_NOTES: GuideNote[] = [
  {
    key: "welcome",
    title: "欢迎使用 Nowen Note",
    content: "# 欢迎使用 Nowen Note\n\nNowen Note 是一个**开源、自托管、数据由你掌控**的知识库、协作笔记与任务工作台。\n\n## 从这里开始\n\n1. 在左侧知识树中新建笔记本、文件夹或笔记。\n2. 根据内容选择富文本编辑器或 Markdown 编辑器。\n3. 使用标签、双链、附件、任务和 AI，把零散信息整理成自己的知识库。\n\n工作笔记、个人日记、技术学习是给你准备的空白笔记本，可以重命名、移动或删除。这些内容都是普通笔记，删除后系统不会重新创建。\n",
    contentText: "欢迎使用 Nowen Note\n\nNowen Note 是一个开源、自托管、数据由你掌控的知识库、协作笔记与任务工作台。\n\n在左侧知识树中新建笔记本、文件夹或笔记；根据内容选择富文本编辑器或 Markdown 编辑器；使用标签、双链、附件、任务和 AI 把零散信息整理成自己的知识库。\n\n工作笔记、个人日记、技术学习是空白笔记本，可以重命名、移动或删除。删除后系统不会重新创建。",
  },
];

/** 示例笔记实体（含知识树节点 ID 的 note:/notebook: 前缀）是否属于本地示例内容。 */
export function isMobileGuideEntityId(entityId: string): boolean {
  const bare = entityId.replace(/^(?:note|notebook):/, "");
  return bare.startsWith(GUIDE_ID_PREFIX);
}

function isSeeded(): boolean {
  try {
    return localStorage.getItem(SEED_FLAG) === "1";
  } catch {
    return false;
  }
}

function markSeeded(): void {
  try {
    localStorage.setItem(SEED_FLAG, "1");
  } catch {
    /* 存储不可用时下次会再试一次，幂等创建不会产生重复内容 */
  }
}

/**
 * 设备本地模式首次进入时创建示例笔记。失败只记日志：示例笔记是体验内容，
 * 不能因为写不进去就挡住用户写自己的笔记。
 */
export async function seedMobileLocalGuide(repository: NativeLocalRepository): Promise<void> {
  if (isSeeded()) return;
  markSeeded();
  try {
    // 已经有指南（例如从服务器采纳的、或本地种子还在）时不再种一份。
    // localStorage 被清空后也能靠这个兜住，不会出现两份指南。
    const notebooks = await repository.notebooks.list();
    if (notebooks.some((notebook) => isMobileGuideEntityId(notebook.id))) return;
    await repository.notebooks.create({
      id: GUIDE_NOTEBOOK_ID,
      name: "中文指南",
      icon: "🇨🇳",
      sortOrder: 0,
    });
    for (const [index, note] of GUIDE_NOTES.entries()) {
      await repository.notes.create({
        id: `${GUIDE_ID_PREFIX}local-zh-${note.key}`,
        notebookId: GUIDE_NOTEBOOK_ID,
        title: note.title,
        content: note.content,
        contentText: note.contentText,
        contentFormat: "markdown",
        sortOrder: index,
        isPinned: note.key === "welcome" ? 1 : 0,
      });
    }
    for (const notebook of STARTER_NOTEBOOKS) {
      await repository.notebooks.create({
        id: `${GUIDE_NOTEBOOK_ID}-${notebook.key}`,
        name: notebook.name,
        icon: notebook.icon,
        sortOrder: notebook.sortOrder,
      });
    }
    window.dispatchEvent(new CustomEvent("nowen:knowledge-tree-changed", {
      detail: { reason: "mobile-local-guide-seeded" },
    }));
  } catch (error) {
    console.warn("[mobile onboarding] seed guide failed", error);
  }
}
