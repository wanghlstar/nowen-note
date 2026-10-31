import { ONBOARDING_ID_PREFIX } from "../db/onboardingGuideTemplate.js";

const ONBOARDING_TREE_PREFIXES = [
  `note:${ONBOARDING_ID_PREFIX}`,
  `notebook:${ONBOARDING_ID_PREFIX}`,
];

/**
 * 示例笔记（onboarding guide）的实体 ID 前缀。
 *
 * 指南本身按普通笔记同步；这个前缀只用于识别「种子」：
 * 首次连接时若服务端已有指南，本机种子会被丢弃、改用服务端那份
 *（见 onboardingAdoption.ts），避免两端各一份。
 *
 * 实体 ID 有两种形态：
 * - 业务实体：`onboarding-v1-<userId>-zh-…`
 * - 知识树节点：`note:onboarding-v1-…` / `notebook:onboarding-v1-…`
 */
export function isOnboardingEntityId(entityId: string): boolean {
  return entityId.startsWith(ONBOARDING_ID_PREFIX)
    || ONBOARDING_TREE_PREFIXES.some((prefix) => entityId.startsWith(prefix));
}
