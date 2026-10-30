import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import AppBootErrorBoundary from "@/components/AppBootErrorBoundary";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(node);
  });
  return container;
}

function Boom(): React.ReactElement {
  throw new Error("模拟渲染异常");
}

describe("AppBootErrorBoundary", () => {
  it("渲染异常时给出可恢复界面而不是白屏", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = mount(
      <AppBootErrorBoundary>
        <Boom />
      </AppBootErrorBoundary>,
    );

    expect(el.textContent).toContain("应用出现异常");
    expect(el.querySelector("button")?.textContent).toBe("重新加载");
    expect(el.textContent).toContain("复制诊断信息");
    // 诊断详情必须可见：否则用户只看到一句"出错了"，无法反馈
    expect(el.textContent).toContain("模拟渲染异常");
    // 不能渲染成空白（旧行为 return null 就是白屏）
    expect(el.textContent!.trim().length).toBeGreaterThan(20);
    errorSpy.mockRestore();
  });

  it("正常子树原样渲染", () => {
    const el = mount(
      <AppBootErrorBoundary>
        <div>正常内容</div>
      </AppBootErrorBoundary>,
    );
    expect(el.textContent).toContain("正常内容");
    expect(el.textContent).not.toContain("应用出现异常");
  });
});
