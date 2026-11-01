## 已完成但需真机验证
- NOTE-IMAGE-EXPORT-02: Android 导出图片保存到相册
- NOTE-EDITOR-IMAGE-SAVE-01: 移动端编辑器单图保存到相册

## 待开发
- SEARCH-RESULT-KEYWORD-01: 搜索结果必须包含并展示关键词
- CONTEXT-MENU-COMPACT-01: 右键菜单导出项折叠优化
- MARKDOWN-NATIVE-FILE-01: 原生 Markdown 笔记与独立编辑器（评估中）

## GitHub Issues 中未修复的 Bug
- #96: 回收站笔记可编辑/收藏（已修复编辑器和侧边栏，待验证）
- #73: 分享页面大纲 PC 端定位后消失
- #79: Joplin JEX 格式 ZIP 导入无响应
- #76: DOCX 导入大文件性能不足

## Lite / Tauri 已知问题
- 富文本编辑器代码块渲染抖动：输入 ```sql 回车后继续输入会让代码块视觉消失，数据正常。详见 `docs/lite-handover-2026-10-30.md` §5。
- 安卓同步设置内直接添加服务器（就地登录 + 2FA）已实现，待真机走查；本地库仍为权威源，登录后由 `mobileLocalFirstRuntime` 重建账号库并启动同步。
- 安卓组网/VPN 下局域网发现失败：WebRTC 拿不到真实路由网段，需要原生 Capacitor 插件读 `ConnectivityManager.getLinkProperties`。
- macOS 签名公证、Linux AppImage、Windows/Linux 真机验收未完成。
- 示例指南目前只有「欢迎使用 Nowen Note」，其余 7 篇教程待补回。
- Tauri 未完成项（自动更新、应用菜单/托盘、文件关联、加密笔记自动锁定、附件打开/打印桥、数据目录迁移）见 `docs/tauri-lite-plan.md`。
