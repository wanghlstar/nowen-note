/**
 * 新账号示例内容：中文指南（1 篇欢迎）+ 工作笔记 / 个人日记 / 技术学习 三个空白笔记本。
 *
 * 后端种子（v136 重建首次登录触发器）以本文件为唯一内容来源；
 * 安卓设备本地种子（frontend/src/lib/mobileOnboardingGuide.ts）维护同一份内容，
 * 修改模板时两处必须同步。
 */

export const ONBOARDING_VERSION = 1;
export const ONBOARDING_ID_PREFIX = "onboarding-v1-";

export interface OnboardingGuideNote {
  key: string;
  title: string;
  content: string;
  contentText: string;
  isPinned: boolean;
}

/** 空白起始笔记本：不预置任何笔记。 */
export const ONBOARDING_STARTER_NOTEBOOKS = [
  { key: "work", name: "工作笔记", icon: "💼", sortOrder: 1 },
  { key: "diary", name: "个人日记", icon: "📔", sortOrder: 2 },
  { key: "study", name: "技术学习", icon: "🧑‍💻", sortOrder: 3 },
] as const;

export const ONBOARDING_GUIDE_NOTEBOOK = {
  suffix: "zh",
  name: "中文指南",
  description: "Nowen Note onboarding guide / 新用户使用指南",
  icon: "🇨🇳",
  sortOrder: 0,
} as const;

export const ONBOARDING_GUIDE_NOTES: OnboardingGuideNote[] = [
  {
    key: "welcome",
    title: "欢迎使用 Nowen Note",
    content: "# 欢迎使用 Nowen Note\n\nNowen Note 是一个**开源、自托管、数据由你掌控**的知识库、协作笔记与任务工作台。\n\n## 从这里开始\n\n1. 在左侧知识树中新建笔记本、文件夹或笔记。\n2. 根据内容选择富文本编辑器或 Markdown 编辑器。\n3. 使用标签、双链、附件、任务和 AI，把零散信息整理成自己的知识库。\n\n工作笔记、个人日记、技术学习是给你准备的空白笔记本，可以重命名、移动或删除。这些内容都是普通笔记，删除后系统不会重新创建。\n",
    contentText: "欢迎使用 Nowen Note\n\nNowen Note 是一个开源、自托管、数据由你掌控的知识库、协作笔记与任务工作台。\n\n在左侧知识树中新建笔记本、文件夹或笔记；根据内容选择富文本编辑器或 Markdown 编辑器；使用标签、双链、附件、任务和 AI 把零散信息整理成自己的知识库。\n\n工作笔记、个人日记、技术学习是空白笔记本，可以重命名、移动或删除。删除后系统不会重新创建。",
    isPinned: true,
  },
];

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function expressionId(suffix: string): string {
  return `(${sqlString(ONBOARDING_ID_PREFIX)} || NEW.id || ${sqlString(`-${suffix}`)})`;
}

/** 首次登录种子触发器 BEGIN…END 内的语句（调用方负责 user_onboarding_state 标记）。 */
export function buildOnboardingGuideSeedSql(): string {
  const notebook = ONBOARDING_GUIDE_NOTEBOOK;
  const notebookInsert = `
    INSERT INTO notebooks (
      id, userId, parentId, name, description, icon, sortOrder, isExpanded
    ) VALUES (
      ${expressionId(notebook.suffix)},
      NEW.id,
      NULL,
      ${sqlString(notebook.name)},
      ${sqlString(notebook.description)},
      ${sqlString(notebook.icon)},
      ${notebook.sortOrder},
      1
    );`;
  const noteInserts = ONBOARDING_GUIDE_NOTES.map((note, index) => `
    INSERT INTO notes (
      id, userId, notebookId, title, content, contentText,
      contentFormat, isPinned, sortOrder
    ) VALUES (
      ${expressionId(`${notebook.suffix}-${note.key}`)},
      NEW.id,
      ${expressionId(notebook.suffix)},
      ${sqlString(note.title)},
      ${sqlString(note.content)},
      ${sqlString(note.contentText)},
      'markdown',
      ${note.isPinned ? 1 : 0},
      ${index}
    );`).join("");
  const starterInserts = ONBOARDING_STARTER_NOTEBOOKS.map((starter) => `
    INSERT INTO notebooks (
      id, userId, parentId, name, icon, sortOrder, isExpanded
    ) VALUES (
      ${expressionId(`${notebook.suffix}-${starter.key}`)},
      NEW.id,
      NULL,
      ${sqlString(starter.name)},
      ${sqlString(starter.icon)},
      ${starter.sortOrder},
      1
    );`).join("");
  return `${notebookInsert}${noteInserts}${starterInserts}`;
}
