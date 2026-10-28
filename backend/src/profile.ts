/**
 * 部署 profile（W2，docs/lite-mode-design.md §1/§3）。
 *
 * NOWEN_PROFILE=lite 时关闭 P1 模块：
 * - 路由挂载处按功能键过滤（index.ts），被禁前缀返回 403 feature_disabled（非 500）
 * - 启动副作用（WS 协作 / 定时器 / 向量索引）条件化
 *
 * 功能分级单一事实来源是 frontend/src/lib/featureRegistry.ts；本文件是其后端镜像，
 * 修改 P1 集合时两边同步（后端按路由文件粒度关，不按组件粒度）。
 */

import type { MiddlewareHandler } from "hono";

export type ServerProfile = "full" | "lite";

export const SERVER_PROFILE: ServerProfile =
  (process.env.NOWEN_PROFILE || "").trim().toLowerCase() === "lite" ? "lite" : "full";
/** 与 featureRegistry.ts 的 P1 feature 键一一对应。 */
const P1_FEATURES = new Set([
  "ai",
  "tasks",
  "diary",
  "mindmap",
  "collab",
  "sharing",
  "plugins",
  "openApi",
  "importCenter",
  "sheet",
  "voiceMemo",
  "automation",
]);

export function isLiteProfile(): boolean {
  return SERVER_PROFILE === "lite";
}

/** 功能在当前 profile 下是否启用。完整模式恒为 true。 */
export function isFeatureEnabled(feature: string): boolean {
  return !(SERVER_PROFILE === "lite" && P1_FEATURES.has(feature));
}

/**
 * Sync V2 实体 → 功能键。只有 P1 实体需要映射，其余（notebook/note/tag/
 * note_tag/favorite/attachment/知识树节点）属于 P0。
 */
const SYNC_ENTITY_FEATURES: Record<string, string> = {
  task: "tasks",
  task_reminder: "tasks",
  diary: "diary",
  mindmap: "mindmap",
};

/** Lite 部署下，P1 实体不得出现在同步协议的任何一侧。 */
export function isSyncEntityEnabled(entityType: string): boolean {
  const feature = SYNC_ENTITY_FEATURES[entityType];
  return feature === undefined || isFeatureEnabled(feature);
}

/** 被禁模块的统一响应体：明确禁用错误，而非 500 或误导性 404。 */
export function featureDisabledBody(feature: string) {
  return {
    error: "feature_disabled",
    feature,
    message: `该功能在当前部署配置（Lite）下已禁用：${feature}`,
  };
}

/**
 * 路径守卫中间件：MIXED 路由文件（export/settings/attachments/user-preferences*）
 * 内 P0/P1 子路径并存时，用它在子路径级返回 403 feature_disabled。
 * 完整模式下是直通 no-op。
 */
export function featureGuard(feature: string): MiddlewareHandler {
  return async (c, next) => {
    if (!isFeatureEnabled(feature)) {
      return c.json(featureDisabledBody(feature), 403);
    }
    await next();
  };
}
