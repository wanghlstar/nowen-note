/**
 * 新账号示例笔记模板：用户裁剪后的「中文指南」+ 8 篇 Markdown。
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
    content: "# 欢迎使用 Nowen Note\n\nNowen Note 是一个**开源、自托管、数据由你掌控**的知识库、协作笔记与任务工作台。\n\n## 从这里开始\n\n1. 在左侧知识树中新建笔记本、文件夹或笔记。\n2. 根据内容选择富文本编辑器或 Markdown 编辑器。\n3. 使用标签、双链、附件、任务和 AI，把零散信息整理成自己的知识库。\n\n## 推荐阅读\n\n- [[5 分钟快速上手]]\n- [[富文本与 Markdown]]\n- [[知识树、双链与标签]]\n- [[图片、附件与文件管理]]\n- [[AI 知识问答]]\n- [[任务、协作与多端访问]]\n- [[数据安全、备份与自托管]]\n\n> 这些教程都是普通笔记，可以自由编辑、移动或删除。删除后系统不会重新创建。\n",
    contentText: "欢迎使用 Nowen Note\n\nNowen Note 是一个**开源、自托管、数据由你掌控**的知识库、协作笔记与任务工作台。\n\n从这里开始\n\n在左侧知识树中新建笔记本、文件夹或笔记。\n\n根据内容选择富文本编辑器或 Markdown 编辑器。\n\n使用标签、双链、附件、任务和 AI，把零散信息整理成自己的知识库。\n\n推荐阅读\n\n[[5 分钟快速上手]]\n\n[[富文本与 Markdown]]\n\n[[知识树、双链与标签]]\n\n[[图片、附件与文件管理]]\n\n[[AI 知识问答]]\n\n[[任务、协作与多端访问]]\n\n[[数据安全、备份与自托管]]\n\n这些教程都是普通笔记，可以自由编辑、移动或删除。删除后系统不会重新创建。",
    isPinned: true,
  },
  {
    key: "quick-start",
    title: "5 分钟快速上手",
    content: "# 5 分钟快速上手\n\n## 1. 建立自己的目录\n\n在左侧知识树点击 **+**，创建笔记本、文件夹、富文本笔记或 Markdown 文档。目录支持拖拽排序和多层级整理。\n\n## 2. 写下第一篇笔记\n\n- 富文本适合会议纪要、清单、表格和日常记录。\n- Markdown 适合技术文档、代码和跨平台迁移。\n\n## 3. 让内容彼此关联\n\n输入双链引用其他笔记，添加标签，并通过知识树快速定位内容。\n\n## 4. 保存图片和附件\n\n粘贴、拖入或上传图片与文件，它们会统一进入文件管理。\n\n## 5. 继续探索\n\n打开任务中心、AI 知识问答、说说、思维导图和协作功能，按自己的工作方式组合使用。\n",
    contentText: "5 分钟快速上手：建立目录、创建富文本或 Markdown 笔记、添加双链和标签、上传图片附件并探索任务与 AI。",
    isPinned: false,
  },
  {
    key: "editors",
    title: "富文本与 Markdown",
    content: "# 富文本与 Markdown\n\nNowen Note 同时提供两种编辑体验。\n\n## 富文本编辑器\n\n适合直接排版，支持标题、列表、任务清单、表格、引用、代码块、图片和附件。\n\n## Markdown 编辑器\n\n适合技术写作和可迁移文档，支持源码、预览与分屏模式。\n\n```ts\nconst note = \"Your data, your knowledge\";\n```\n\n## 怎么选择\n\n- 追求所见即所得：选择富文本。\n- 需要源码可控、Git 友好：选择 Markdown。\n- 两种格式可以共存于同一个知识树中。\n",
    contentText: "富文本适合所见即所得排版，Markdown 适合技术写作、源码控制和跨平台迁移，两种格式可以共存。",
    isPinned: false,
  },
  {
    key: "knowledge-tree",
    title: "知识树、双链与标签",
    content: "# 知识树、双链与标签\n\n## 知识树\n\n使用笔记本和文件夹建立层级结构。目录支持展开、折叠、拖拽移动和排序。\n\n## 双链\n\n在正文中引用另一篇笔记，让知识形成网络。被引用笔记可以查看反向链接，快速找到相关上下文。\n\n## 标签\n\n标签适合跨目录归类，例如「项目」「待整理」「灵感」。目录负责位置，标签负责主题，双链负责关系。\n\n建议从简单结构开始，等内容增长后再逐步细分。\n",
    contentText: "知识树负责层级位置，标签负责跨目录主题，双链负责笔记之间的关系与反向链接。",
    isPinned: false,
  },
  {
    key: "files",
    title: "图片、附件与文件管理",
    content: "# 图片、附件与文件管理\n\n你可以在编辑器中粘贴、拖拽或上传图片和文件。\n\n- 图片会在正文中显示，并支持预览。\n- 文件统一进入文件管理，可按类型、大小和时间查找。\n- 导入 Markdown 或第三方笔记时，受支持的图片会尽量本地化保存。\n- 删除笔记前，请确认其中的附件是否仍被其他内容引用。\n\n自托管部署时，附件保存在你自己的服务器或 NAS 中。\n",
    contentText: "图片和附件可以粘贴、拖拽或上传，并统一进入文件管理；自托管时文件保存在自己的服务器或 NAS。",
    isPinned: false,
  },
  {
    key: "ai",
    title: "AI 知识问答",
    content: "# AI 知识问答\n\n配置 AI 服务后，可以基于自己的笔记进行提问、总结和写作辅助。\n\n## 常见用法\n\n- 总结当前笔记或一组资料。\n- 从知识库中查找答案并查看引用来源。\n- 改写、翻译、扩写或整理选中文本。\n- 将零散记录转换为结构化文档。\n\nAI 生成内容可能存在错误。重要结论请结合引用来源和原始资料核对。\n",
    contentText: "AI 知识问答支持基于笔记提问、总结、改写、翻译和整理，并展示引用来源；重要结论需要核对。",
    isPinned: false,
  },
  {
    key: "tasks-collaboration",
    title: "任务、协作与多端访问",
    content: "# 任务、协作与多端访问\n\n## 任务\n\n把笔记中的行动项整理到任务中心，设置优先级、截止日期和完成状态。\n\n## 协作\n\n通过共享笔记本或工作区邀请成员，根据需要分配查看或编辑权限。\n\n## 多端访问\n\n可以通过 Web、桌面端和移动端访问同一套数据。客户端还可以配置离线同步，在网络不稳定时继续阅读和编辑。\n",
    contentText: "任务中心用于管理行动项；共享笔记本和工作区支持成员协作；Web、桌面和移动端可访问并支持离线同步。",
    isPinned: false,
  },
  {
    key: "security",
    title: "数据安全、备份与自托管",
    content: "# 数据安全、备份与自托管\n\nNowen Note 支持自托管，数据可以保存在自己的电脑、服务器或 NAS 中。\n\n## 建议\n\n- 定期使用数据管理中的备份与导出功能。\n- 对数据库和附件目录同时做备份。\n- 为远程访问配置 HTTPS、强密码和必要的访问控制。\n- 升级前先创建可恢复的备份。\n- 不要把唯一副本只保存在单块硬盘中。\n\n掌控数据也意味着需要认真对待备份和恢复。\n",
    contentText: "Nowen Note 支持自托管。请同时备份数据库和附件目录，远程访问使用 HTTPS 和强密码，升级前先创建可恢复备份。",
    isPinned: false,
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
  return `${notebookInsert}${noteInserts}`;
}
