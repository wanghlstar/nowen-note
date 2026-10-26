// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  FEATURE_PROFILE_CHANGED_EVENT,
  getFeatureProfile,
  isFeatureEnabled,
  isNavigationModeEnabled,
  setServerFeatureProfile,
} from "../featureRegistry";

/**
 * W1/W3 profile 门单测：服务端下发 lite profile 后 P1 全部关闭、P0 不受影响；
 * 完整模式（默认）恒真。构建期 VITE_LITE 在 vitest 下不设置，走 full 默认路径。
 */
describe("feature profile gate", () => {
  beforeEach(() => {
    // 复位到完整模式，避免用例间互相污染模块级 serverProfile。
    setServerFeatureProfile("full");
  });

  it("默认（完整模式）全部功能启用", () => {
    expect(getFeatureProfile()).toBe("full");
    for (const feature of [
      "notes",
      "importBasic",
      "encrypted",
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
    ] as const) {
      expect(isFeatureEnabled(feature)).toBe(true);
    }
  });

  it("服务端下发 lite 后 P1 全部关闭、P0 保持启用", () => {
    setServerFeatureProfile("lite");
    expect(getFeatureProfile()).toBe("lite");
    for (const p1 of [
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
    ] as const) {
      expect(isFeatureEnabled(p1)).toBe(false);
    }
    for (const p0 of ["notes", "importBasic", "encrypted"] as const) {
      expect(isFeatureEnabled(p0)).toBe(true);
    }
  });

  it("导航模式按映射表判定：P1 模式关闭、P0 模式（all/favorites/trash 等）不受影响", () => {
    setServerFeatureProfile("lite");
    for (const mode of ["diary", "tasks", "mindmaps", "ai-chat", "shares"]) {
      expect(isNavigationModeEnabled(mode)).toBe(false);
    }
    for (const mode of ["all", "favorites", "trash", "search", "files", "issues", "tag", "notebook"]) {
      expect(isNavigationModeEnabled(mode)).toBe(true);
    }
  });

  it("profile 变化时派发事件，供 React 组件重渲染", () => {
    let events = 0;
    const listener = () => { events += 1; };
    window.addEventListener(FEATURE_PROFILE_CHANGED_EVENT, listener);
    try {
      setServerFeatureProfile("lite");
      expect(events).toBe(1);
      expect(getFeatureProfile()).toBe("lite");
      // 相同值不重复派发
      setServerFeatureProfile("lite");
      expect(events).toBe(1);
      setServerFeatureProfile("full");
      expect(events).toBe(2);
    } finally {
      window.removeEventListener(FEATURE_PROFILE_CHANGED_EVENT, listener);
    }
  });

  it("未知 profile 值按完整模式处理（向后兼容）", () => {
    setServerFeatureProfile("garbage");
    expect(getFeatureProfile()).toBe("full");
    expect(isFeatureEnabled("ai")).toBe(true);
  });
});
