/**
 * W3 构建开关（VITE_LITE=1）：模块级 P1 依赖的禁用替身。
 *
 * 由 vite.config.ts 的 lite alias 引用，两个用途：
 *   1. `y-codemirror.next` → yCollab：lite 无协作（collabReady 恒 false），
 *      该函数不会被调用，存在仅为让打包器剔除真实依赖；
 *   2. `@/lib/wordNoteService` → Word 导入四函数：lite 关闭 importCenter，
 *      入口均已被门控；若仍被触发（如拖拽 .docx），抛出明确禁用错误。
 * 完整模式不注册这些 alias，本文件不被引用。
 */

/** y-codemirror.next 的 yCollab 替身：返回空扩展数组。 */
export function yCollab(): unknown[] {
  return [];
}

function disabled(name: string): never {
  throw new Error(`Lite 配置下不可用：${name}`);
}

export async function pickDocxFile(): Promise<never> {
  return disabled("pickDocxFile");
}

export async function importDocxAsNote(): Promise<never> {
  return disabled("importDocxAsNote");
}

export async function exportNoteAsDocx(): Promise<never> {
  return disabled("exportNoteAsDocx");
}

export async function downloadDocxBlob(): Promise<never> {
  return disabled("downloadDocxBlob");
}
