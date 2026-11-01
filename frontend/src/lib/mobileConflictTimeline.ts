/**
 * 笔记正文的时间线自动合并（移动端离线并发编辑）。
 *
 * 场景：同一篇笔记断网时在本机改过，期间服务器也被改过。Push 收到
 * `VERSION_CONFLICT`、或 Pull 发现本机仍有待发送修改且内容不同时，按
 * `updatedAt` 让较新的一版成为当前版本；较旧的一版完整写入
 * `sync_conflicts`（`status='resolved'`、`resolvedBy='auto-timeline'`），
 * 在「已处理冲突」里可查看、可重新放回冲突中心、可另存为新笔记。
 *
 * 契约：docs/architecture/data-consistency-contract.md（DCC-004）
 * - 不批量、不跨实体，一条冲突一次决策；
 * - 被放弃的一版必须可恢复，绝不静默丢弃；
 * - 删除意图、知识树结构、时间不可判定（缺失/相等/在时钟容差内）一律不自动处理，
 *   继续留在冲突中心等用户选择。
 */

/**
 * 两端时钟不可能严格同步：差值落在容差内的两次修改视为「同时编辑」，
 * 属于协作范畴，交回冲突中心由用户决定，而不是靠毫秒级先后赌一把。
 */
export const TIMELINE_SKEW_TOLERANCE_MS = 2 * 60 * 1000;

/** 时间线可比的字段集合：必须是完整的笔记正文行。 */
function isPlainNote(payload: Record<string, unknown> | null): payload is Record<string, unknown> {
  if (!payload) return false;
  if (payload.__delete || payload._deletionRecovery || payload.lifecycle) return false;
  return typeof payload.updatedAt === "string" && payload.updatedAt.length > 0;
}

function parseUpdatedAt(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export interface TimelineMergeDecision {
  winner: "local" | "remote";
  localUpdatedAt: number;
  remoteUpdatedAt: number;
}

/**
 * 返回自动合并的胜者；返回 `null` 表示不能按时间线处理，调用方必须保留冲突让用户选。
 */
export function decideTimelineMerge(
  local: Record<string, unknown> | null,
  remote: Record<string, unknown> | null,
): TimelineMergeDecision | null {
  if (!isPlainNote(local) || !isPlainNote(remote)) return null;
  if (typeof local.id !== "string" || typeof remote.id !== "string" || local.id !== remote.id) return null;
  const localUpdatedAt = parseUpdatedAt(local.updatedAt);
  const remoteUpdatedAt = parseUpdatedAt(remote.updatedAt);
  if (localUpdatedAt === null || remoteUpdatedAt === null) return null;
  if (Math.abs(localUpdatedAt - remoteUpdatedAt) <= TIMELINE_SKEW_TOLERANCE_MS) return null;
  return {
    winner: remoteUpdatedAt > localUpdatedAt ? "remote" : "local",
    localUpdatedAt,
    remoteUpdatedAt,
  };
}
