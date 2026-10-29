import { realtime } from "./realtime";
import { isMobileSyncEnabled } from "./mobileSyncStatus";
import type { MobileSyncEngine } from "./mobileSyncEngine";

/** One notification transport; durable data always comes from Sync V2 Pull. */
export function installMobileSyncRealtime(engine: MobileSyncEngine): () => void {
  const wake = () => { if (isMobileSyncEnabled()) engine.requestSync(150); };
  const removeNotice = realtime.on("sync.changed", wake);
  const removeOpen = realtime.on("open", wake);
  const onVisible = () => { if (document.visibilityState === "visible") wake(); };
  document.addEventListener("visibilitychange", onVisible);
  // 兜底轮询：前台停留时最多 60 秒同步一次，避免依赖其他设备推送通知。
  const poll = setInterval(onVisible, 60_000);
  if (isMobileSyncEnabled()) realtime.connect();
  return () => {
    clearInterval(poll);
    removeNotice(); removeOpen();
    document.removeEventListener("visibilitychange", onVisible);
  };
}
