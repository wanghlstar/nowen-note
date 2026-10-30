/**
 * 设备本地模式的示例笔记（安卓端）。
 *
 * Mac / NAS 的示例笔记由后端种子触发器生成（newUserOnboardingFirstLoginMigration），
 * 安卓走 Capacitor 本地优先栈、没有后端，因此历史上是空的——三端不一致。
 * 这里补上同一套结构，让"各端都带示例笔记"成立；内容后续由使用者裁剪成样板，
 * 届时把这份与后端种子合并成单一来源，避免两边漂移。
 */

const SEED_FLAG = "nowen:mobile-local-guide-seeded:v1";

interface GuideNote {
  title: string;
  content: string;
}

interface GuideSection {
  title: string;
  notes: GuideNote[];
}

const SECTIONS: GuideSection[] = [
  {
    title: "中文指南",
    notes: [
      {
        title: "欢迎使用 Nowen Note",
        content: [
          "# 欢迎使用 Nowen Note",
          "",
          "Nowen Note 是一个**本地优先**的个人知识库：笔记先写在本机，断网也能读能改，",
          "添加同步服务器后再在后台与云端对账。",
          "",
          "## 从这里开始",
          "",
          "1. 在左侧知识树里新建笔记本、文件夹或笔记。",
          "2. 按内容选择富文本或 Markdown 编辑器。",
          "3. 到 设置 → 同步 添加服务器，笔记会同步到本机并双向对账。",
          "",
          "## 数据在哪里",
          "",
          "- 未添加服务器：全部数据只在这台设备上。",
          "- 添加服务器后：本机仍是权威副本，云端只作为同步目标。",
        ].join("\n"),
      },
      {
        title: "5 分钟快速上手",
        content: [
          "# 5 分钟快速上手",
          "",
          "## 1. 建立目录",
          "",
          "知识树支持多级文件夹与拖拽整理。",
          "",
          "## 2. 写下第一篇笔记",
          "",
          "- 富文本适合纪要、清单、表格。",
          "- Markdown 适合技术文档与代码。",
          "",
          "## 3. 让内容彼此关联",
          "",
          "用双链引用其他笔记，加标签，用搜索定位。",
          "",
          "## 4. 图片与附件",
          "",
          "粘贴、拖入或上传，统一进入文件管理。",
        ].join("\n"),
      },
      {
        title: "富文本与 Markdown",
        content: [
          "# 富文本与 Markdown",
          "",
          "两种编辑器可以共存于同一棵知识树，随时互相转换。",
          "",
          "## 富文本",
          "",
          "所见即所得：标题、列表、任务清单、表格、引用、代码块、图片。",
          "",
          "## Markdown",
          "",
          "源码可控、便于迁移：支持代码围栏、数学公式、Mermaid 图表。",
          "",
          "```ts",
          "const note = \"本地优先\";",
          "```",
        ].join("\n"),
      },
    ],
  },
  {
    title: "English Guide",
    notes: [
      {
        title: "Welcome to Nowen Note",
        content: [
          "# Welcome to Nowen Note",
          "",
          "Nowen Note is a **local-first** knowledge base: notes are written on this",
          "device first, readable and editable offline, and reconciled with the cloud",
          "once you add a sync server.",
          "",
          "## Get started",
          "",
          "1. Create notebooks, folders or notes in the knowledge tree.",
          "2. Pick the rich text or Markdown editor per note.",
          "3. Add a server in Settings → Sync to sync notes both ways.",
        ].join("\n"),
      },
      {
        title: "5-Minute Quick Start",
        content: [
          "# 5-Minute Quick Start",
          "",
          "## 1. Build your tree",
          "",
          "Folders support nesting and drag to reorder.",
          "",
          "## 2. Write your first note",
          "",
          "- Rich text for meeting notes, checklists and tables.",
          "- Markdown for technical writing and code.",
          "",
          "## 3. Connect knowledge",
          "",
          "Use backlinks, tags and search.",
        ].join("\n"),
      },
    ],
  },
];

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
export async function seedMobileLocalGuide(): Promise<void> {
  if (isSeeded()) return;
  markSeeded();
  try {
    // 动态引入：设备本地模式可能整次会话都不写笔记，没必要把 api / 知识树客户端
    // 拖进运行时 import 图；也避免与测试对这些模块的 mock 方式耦合。
    const { api } = await import("./api");
    const { knowledgeTreeApi } = await import("./knowledgeTreeApi");
    for (const section of SECTIONS) {
      const notebook = await knowledgeTreeApi.create({
        parentId: null,
        nodeType: "folder",
        title: section.title,
      });
      for (const note of section.notes) {
        const node = await knowledgeTreeApi.create({
          parentId: notebook.id,
          nodeType: "markdown",
          title: note.title,
        });
        if (node.resourceType === "note") {
          await api.updateNote(node.resourceId, {
            title: note.title,
            content: note.content,
            contentFormat: "markdown",
          } as Parameters<typeof api.updateNote>[1]);
        }
      }
    }
    window.dispatchEvent(new CustomEvent("nowen:knowledge-tree-changed", {
      detail: { reason: "mobile-local-guide-seeded" },
    }));
  } catch (error) {
    console.warn("[mobile onboarding] seed guide failed", error);
  }
}
