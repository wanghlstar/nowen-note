export type KnowledgeTreeInlineCreateKind = "folder" | "note" | "markdown" | "plaintext" | "mindmap" | "sheet";

export interface KnowledgeTreeInlineDraft {
  parentId: string | null;
  kind: KnowledgeTreeInlineCreateKind;
  title: string;
  saving: boolean;
  error: string | null;
}

export function defaultInlineCreateTitle(kind: KnowledgeTreeInlineCreateKind): string {
  if (kind === "folder") return "未命名文件夹";
  // 笔记类默认标题必须与 UntitledNoteTitleBridge 认识的字面量一致，
  // 否则编辑器里会显示成真实文本而不是"未命名"占位符。
  if (kind === "markdown") return "无标题 Markdown";
  if (kind === "plaintext") return "无标题笔记";
  if (kind === "mindmap") return "无标题导图";
  if (kind === "sheet") return "无标题表格";
  return "无标题笔记";
}

export function normalizeInlineCreateTitle(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
