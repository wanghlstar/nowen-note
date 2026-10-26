/**
 * W3 构建开关（VITE_LITE=1）：P1 组件入口的禁用壳。
 *
 * vite.config.ts 在 lite 构建时把 P1 组件路径 alias 到本组件，使 P1 组件树
 * （TaskCenter/tasks/、MindMapEditor、AI、分享、Sheet、语音、多源导入等）
 * 与专属依赖不进入产物。运行期门（featureRegistry.isFeatureEnabled）在 lite
 * 构建下同样默认关闭，双保险；完整模式不注册这些 alias，本文件不被引用。
 */
export default function LiteDisabledFeature() {
  return null;
}
