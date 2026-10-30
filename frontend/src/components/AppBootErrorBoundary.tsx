import React from "react";

/**
 * 顶层渲染错误边界。
 *
 * 启动完成之后才抛出的渲染异常，HTML 启动卡此时已标记 ready、不会再显示故障界面
 * （index.html 的 showBootFailure 有 __NOWEN_BOOT_READY__ 守卫）。边界必须自己
 * 给出可恢复 UI：否则整个应用就是一片白，用户既无法操作也看不到原因——只能杀进程。
 */
export default class AppBootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean; message: string }
> {
  state = { failed: false, message: "" };

  static getDerivedStateFromError() {
    return { failed: true, message: "" };
  }

  componentDidCatch(error: unknown) {
    const message = error instanceof Error
      ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
      : String(error);
    this.setState({ message });
    // 同时喂给 index.html 的启动诊断（若启动卡还在）；它启动后会自行失效，
    // 因此上面的可恢复界面才是主路径，不能依赖它。
    try {
      (window as unknown as { __NOWEN_REPORT_BOOT_ERROR__?: (source: string, error: unknown, fatal?: boolean) => void })
        .__NOWEN_REPORT_BOOT_ERROR__?.("react-render", error, true);
    } catch {
      /* 诊断上报失败不影响恢复界面 */
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    // 启动完成之后才抛出的渲染异常：HTML 启动卡此时已标记 ready、不会再显示故障
    // 界面（showBootFailure 有 __NOWEN_BOOT_READY__ 守卫）。边界必须自己给出可
    // 恢复 UI，否则整个应用就是一片白，用户既无法操作也看不到原因。
    const detail = this.state.message || "(无详细信息)";
    const copy = () => {
      const done = () => { const b = document.getElementById("boot-recover-copy"); if (b) b.textContent = "已复制"; };
      try {
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(detail).then(done, () => fallbackCopy(detail, done));
          return;
        }
      } catch { /* 走剪贴板兜底 */ }
      fallbackCopy(detail, done);
    };
    return (
      <div style={{
        minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#f8fafc", color: "#0f172a", fontFamily: "system-ui, -apple-system, sans-serif",
        padding: 24, boxSizing: "border-box",
      }}>
        <div style={{
          maxWidth: 520, width: "100%", background: "#ffffff", border: "1px solid #e2e8f0",
          borderRadius: 16, padding: 24, boxShadow: "0 10px 30px rgba(15,23,42,.08)",
        }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 600 }}>应用出现异常</h1>
          <p style={{ margin: "0 0 16px", fontSize: 13, lineHeight: 1.6, color: "#475569" }}>
            界面渲染时发生错误，已停止渲染以避免进一步损坏。可以重新加载；若反复出现，请把下面信息反馈给开发者。
          </p>
          <pre style={{
            maxHeight: 168, overflow: "auto", background: "rgba(100,116,139,.10)", borderRadius: 8,
            padding: 10, margin: "0 0 16px", fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap",
            wordBreak: "break-word", color: "#475569",
          }}>{detail}</pre>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                flex: 1, minHeight: 38, borderRadius: 10, border: "none", background: "#4f46e5",
                color: "#ffffff", fontSize: 13, fontWeight: 500, cursor: "pointer",
              }}
            >重新加载</button>
            <button
              id="boot-recover-copy"
              type="button"
              onClick={copy}
              style={{
                minHeight: 38, borderRadius: 10, border: "1px solid #e2e8f0", background: "#ffffff",
                color: "#334155", fontSize: 13, cursor: "pointer", padding: "0 14px",
              }}
            >复制诊断信息</button>
          </div>
        </div>
      </div>
    );
  }
}

function fallbackCopy(text: string, done: () => void): void {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    document.body.removeChild(area);
    done();
  } catch {
    /* 复制失败时保留可见文本，用户仍可截图 */
  }
}


export { AppBootErrorBoundary };
